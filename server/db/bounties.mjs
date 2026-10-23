// 悬赏持久化：进度从既有对局派生并落库，领取通过主键 + claimed_at 保证幂等。
import { db, grantCores, getCores, transaction } from '../db.mjs';
import {
  BOUNTY_PERIODS,
  BOUNTY_PERIOD_LABELS,
  BOUNTY_REFRESH_LIMIT,
  BOUNTY_REFRESH_PERIOD,
  bountyPeriodBounds,
  bountyPeriodKey,
  bountyProgress,
  deriveBounties,
} from '../../public/js/shared/bounties.js';
import { notify } from './notifications.mjs';

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

// 本周已用刷新次数：只有周悬赏参与刷新代数，其它周期固定为第 0 代。
function refreshCount(accountId, periodKey) {
  const row = db
    .prepare(
      'SELECT refresh_count FROM account_bounty_refreshes WHERE account_id = ? AND period_key = ?'
    )
    .get(accountId, periodKey);
  return Math.max(0, Number(row?.refresh_count) || 0);
}

function periodGeneration(accountId, period, periodKey) {
  if (period !== BOUNTY_REFRESH_PERIOD) return 0;
  return Math.min(refreshCount(accountId, periodKey), BOUNTY_REFRESH_LIMIT);
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
  const generation = periodGeneration(accountId, period, key);
  const existing = new Map(
    periodRows(accountId, period, key).map((row) => [row.bounty_id, row])
  );

  const bounties = deriveBounties(period, key, generation).map((definition) => {
    const progress = bountyProgress(definition, runs);
    const row = existing.get(definition.id);
    const claimedAt = row?.claimed_at ? Number(row.claimed_at) : null;
    return {
      id: definition.id,
      title: definition.title,
      desc: definition.desc,
      metric: definition.metric,
      tier: definition.tier,
      tierLabel: definition.tierLabel,
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
  const refreshKey = bountyPeriodKey(BOUNTY_REFRESH_PERIOD, now);
  const used = Math.min(refreshCount(accountId, refreshKey), BOUNTY_REFRESH_LIMIT);
  return {
    now,
    refresh: {
      period: BOUNTY_REFRESH_PERIOD,
      periodKey: refreshKey,
      limit: BOUNTY_REFRESH_LIMIT,
      used,
      remaining: Math.max(0, BOUNTY_REFRESH_LIMIT - used),
    },
    periods: BOUNTY_PERIODS.map((period) => buildPeriod(accountId, period, now)),
  };
}

// 每周一次免费刷新：写事务内检查并递增次数，随后按新代数重建周悬赏。
// 旧周的行不删除，已领取状态与历史进度原样保留。
export function refreshBounties(accountId, now = Date.now()) {
  const periodKey = bountyPeriodKey(BOUNTY_REFRESH_PERIOD, now);
  if (!periodKey) return { ok: false, code: 'REFRESH_UNAVAILABLE' };

  return transaction(() => {
    const used = refreshCount(accountId, periodKey);
    if (used >= BOUNTY_REFRESH_LIMIT) {
      return {
        ok: false,
        code: 'REFRESH_LIMIT',
        limit: BOUNTY_REFRESH_LIMIT,
        used,
        remaining: 0,
      };
    }

    const next = used + 1;
    db.prepare(
      `INSERT INTO account_bounty_refreshes
         (account_id, period_key, refresh_count, refreshed_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(account_id, period_key) DO UPDATE SET
         refresh_count = excluded.refresh_count,
         refreshed_at = excluded.refreshed_at,
         updated_at = excluded.updated_at`
    ).run(accountId, periodKey, next, now, now);

    return {
      ok: true,
      refreshCount: next,
      remaining: Math.max(0, BOUNTY_REFRESH_LIMIT - next),
      summary: bountySummary(accountId, now),
    };
  });
}

// 幂等领取：先确认目标属于当前周期，再在写事务内检查完成度与领取状态。
// 已领取的重复调用返回 awarded: 0，不重复发放星核。
export function claimBounty(accountId, bountyId, now = Date.now()) {
  for (const period of BOUNTY_PERIODS) {
    const key = bountyPeriodKey(period, now);
    const generation = periodGeneration(accountId, period, key);
    const definition = deriveBounties(period, key, generation).find((item) => item.id === bountyId);
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
      // 通知失败不改变领取结果：星核已经写入钱包。
      notify(accountId, {
        kind: 'bounty',
        dedupeKey: `bounty:${period}:${key}:${bountyId}`,
        payload: {
          bountyId,
          title: definition.title,
          reward: definition.reward,
          period,
          periodKey: key,
        },
      }, now);
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
