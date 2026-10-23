// 悬赏持久化：进度从既有对局派生并落库，领取通过主键 + claimed_at 保证幂等。
import { db, grantCores, getCores, transaction } from '../db.mjs';
import {
  BOUNTY_PERIODS,
  BOUNTY_PERIOD_LABELS,
  bountyPeriodBounds,
  bountyPeriodKey,
  bountyProgress,
  deriveBounties,
} from '../../public/js/shared/bounties.js';

function parseJson(text) {
  try {
    return JSON.parse(text || 'null') ?? {};
  } catch {
    return {};
  }
}

// 只读取周期内已完成的对局；无伤判定沿用结算时写入的开局/剩余基地生命。
function periodRuns(accountId, bounds) {
  if (!bounds) return [];
  const rows = db
    .prepare(
      `SELECT mode, difficulty, victory, wave_reached, kills, score, duration_ms,
              created_at, ruleset_json, result_json
         FROM runs
        WHERE account_id = ? AND status = 'finished'
          AND created_at >= ? AND created_at < ?
        ORDER BY created_at ASC`
    )
    .all(accountId, bounds.start, bounds.end);

  return rows.map((row) => {
    const ruleset = parseJson(row.ruleset_json);
    const result = parseJson(row.result_json);
    const startHp = Number(ruleset?.meta?.baseHp);
    const leftHp = Number(result?.baseHp);
    return {
      mode: row.mode,
      difficulty: row.difficulty || 'standard',
      victory: !!row.victory,
      waveReached: Number(row.wave_reached) || 0,
      kills: Number(row.kills) || 0,
      score: Number(row.score) || 0,
      durationMs: Number(row.duration_ms) || 0,
      baseHpStart: Number.isFinite(startHp) && startHp > 0 ? startHp : null,
      baseHpLeft: Number.isFinite(leftHp) ? leftHp : null,
      createdAt: Number(row.created_at) || 0,
    };
  });
}

function periodRows(accountId, period, periodKey) {
  return db
    .prepare(
      `SELECT bounty_id, target, progress, claimed_at FROM account_bounties
        WHERE account_id = ? AND period = ? AND period_key = ?`
    )
    .all(accountId, period, periodKey);
}

// 记录进度快照：不覆盖 claimed_at，已领取的目标保持领取状态。
function recordProgress(accountId, period, periodKey, bounties, now) {
  const upsert = db.prepare(
    `INSERT INTO account_bounties
       (account_id, period, period_key, bounty_id, target, progress, claimed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
     ON CONFLICT(account_id, period, period_key, bounty_id) DO UPDATE SET
       target = excluded.target,
       progress = excluded.progress,
       updated_at = excluded.updated_at`
  );
  for (const bounty of bounties) {
    upsert.run(
      accountId,
      period,
      periodKey,
      bounty.id,
      bounty.target,
      bounty.progress,
      now
    );
  }
}

function buildPeriod(accountId, period, now) {
  const key = bountyPeriodKey(period, now);
  const bounds = bountyPeriodBounds(period, now);
  const runs = periodRuns(accountId, bounds);
  const existing = new Map(
    periodRows(accountId, period, key).map((row) => [row.bounty_id, row])
  );

  const bounties = deriveBounties(period, key).map((definition) => {
    const progress = bountyProgress(definition, runs);
    const row = existing.get(definition.id);
    const claimedAt = row?.claimed_at ? Number(row.claimed_at) : null;
    return {
      id: definition.id,
      title: definition.title,
      desc: definition.desc,
      metric: definition.metric,
      target: progress.target,
      progress: progress.current,
      reward: definition.reward,
      complete: progress.current >= progress.target,
      claimed: claimedAt != null,
      claimedAt,
    };
  });

  recordProgress(accountId, period, key, bounties, now);

  return {
    period,
    label: BOUNTY_PERIOD_LABELS[period],
    key,
    endsAt: bounds?.end ?? null,
    claimedCount: bounties.filter((bounty) => bounty.claimed).length,
    bounties,
  };
}

export function bountySummary(accountId, now = Date.now()) {
  return {
    now,
    periods: BOUNTY_PERIODS.map((period) => buildPeriod(accountId, period, now)),
  };
}

// 幂等领取：先确认目标属于当前周期，再在写事务内检查完成度与领取状态。
// 已领取的重复调用返回 awarded: 0，不重复发放星核。
export function claimBounty(accountId, bountyId, now = Date.now()) {
  for (const period of BOUNTY_PERIODS) {
    const key = bountyPeriodKey(period, now);
    const definition = deriveBounties(period, key).find((item) => item.id === bountyId);
    if (!definition) continue;

    const bounds = bountyPeriodBounds(period, now);
    const runs = periodRuns(accountId, bounds);
    const progress = bountyProgress(definition, runs);

    return transaction(() => {
      const row = db
        .prepare(
          `SELECT claimed_at FROM account_bounties
            WHERE account_id = ? AND period = ? AND period_key = ? AND bounty_id = ?`
        )
        .get(accountId, period, key, bountyId);

      if (row?.claimed_at) {
        return {
          ok: true,
          claimed: false,
          alreadyClaimed: true,
          awarded: 0,
          balance: getCores(accountId),
          bounty: { ...definition, ...progress },
        };
      }

      if (progress.current < progress.target) {
        return {
          ok: false,
          code: 'BOUNTY_INCOMPLETE',
          bounty: { ...definition, ...progress },
        };
      }

      db.prepare(
        `INSERT INTO account_bounties
           (account_id, period, period_key, bounty_id, target, progress, claimed_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
         ON CONFLICT(account_id, period, period_key, bounty_id) DO UPDATE SET
           target = excluded.target,
           progress = excluded.progress,
           updated_at = excluded.updated_at`
      ).run(accountId, period, key, bountyId, progress.target, progress.current, now);

      const result = db
        .prepare(
          `UPDATE account_bounties SET claimed_at = ?, updated_at = ?
            WHERE account_id = ? AND period = ? AND period_key = ? AND bounty_id = ?
              AND claimed_at IS NULL`
        )
        .run(now, now, accountId, period, key, bountyId);

      if (result.changes !== 1) {
        return {
          ok: true,
          claimed: false,
          alreadyClaimed: true,
          awarded: 0,
          balance: getCores(accountId),
          bounty: { ...definition, ...progress },
        };
      }

      const balance = grantCores(accountId, definition.reward);
      return {
        ok: true,
        claimed: true,
        alreadyClaimed: false,
        awarded: definition.reward,
        balance,
        bounty: { ...definition, ...progress },
      };
    });
  }

  return { ok: false, code: 'UNKNOWN_BOUNTY' };
}
