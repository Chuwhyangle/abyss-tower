// 赛季通行证持久化：积分由赛季内已完成对局派生，里程碑领取与奖励发放同事务。
// 赛季边界直接复用排行榜的 seasonOf / seasonBounds，保证与榜单口径一致。
import { db, grantCores, getCores, transaction } from '../db.mjs';
import { seasonBounds, seasonOf } from './leaderboard.mjs';
import {
  SEASON_PASS_MAX_POINTS,
  seasonPassMilestone,
  seasonPassProgress,
} from '../../public/js/shared/season-pass.js';

const SHARD_CURRENCY = 'skin_shards';
const COSMETIC_NAMESPACE = 'cosmetics';

export const SEASON_PASS_SHARD_CURRENCY = SHARD_CURRENCY;

export function getSeasonShards(accountId) {
  const row = db
    .prepare('SELECT balance FROM player_wallets WHERE account_id = ? AND currency_id = ?')
    .get(accountId, SHARD_CURRENCY);
  return Math.max(0, Math.floor(Number(row?.balance) || 0));
}

// 必须在调用方事务内执行：奖励与领取状态要么一起落库，要么一起回滚。
function grantShardsInTx(accountId, amount, now) {
  const gain = Math.floor(Number(amount));
  if (!Number.isFinite(gain) || gain <= 0) return getSeasonShards(accountId);
  db.prepare(
    `INSERT INTO player_wallets (account_id, currency_id, balance, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(account_id, currency_id) DO UPDATE SET
       balance = balance + excluded.balance,
       updated_at = excluded.updated_at`
  ).run(accountId, SHARD_CURRENCY, gain, now);
  return getSeasonShards(accountId);
}

// 称号写入与成就相同的 cosmetics 命名空间，外观接口无需新增读取分支。
function grantTitleInTx(accountId, titleId, season, milestoneId, now) {
  db.prepare(
    `INSERT INTO player_kv (account_id, namespace, key, value_json, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(account_id, namespace, key) DO NOTHING`
  ).run(
    accountId,
    COSMETIC_NAMESPACE,
    `title:${titleId}`,
    JSON.stringify({ seasonPass: { season, milestoneId }, unlockedAt: now }),
    now
  );
}

function seasonPoints(accountId, bounds) {
  if (!bounds) return 0;
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN score > 0 THEN score ELSE 0 END), 0) AS points
         FROM runs
        WHERE account_id = ? AND status = 'finished'
          AND created_at >= ? AND created_at < ?`
    )
    .get(accountId, bounds.start, bounds.end);
  return Math.max(0, Math.floor(Number(row?.points) || 0));
}

function recordPoints(accountId, season, points, now) {
  db.prepare(
    `INSERT INTO account_season_pass (account_id, season, points, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(account_id, season) DO UPDATE SET
       points = excluded.points,
       updated_at = excluded.updated_at`
  ).run(accountId, season, points, now);
}

function claimRows(accountId, season) {
  return db
    .prepare(
      `SELECT milestone_id, claimed_at FROM account_season_pass_claims
        WHERE account_id = ? AND season = ?
        ORDER BY claimed_at ASC`
    )
    .all(accountId, season);
}

function wallet(accountId) {
  return { cores: getCores(accountId), shards: getSeasonShards(accountId) };
}

export function seasonLabel(season) {
  if (typeof season !== 'string' || !/^\d{4}-\d{2}$/.test(season)) return season || '';
  const [year, month] = season.split('-');
  return `${year} 年 ${Number(month)} 月`;
}

export function seasonPassSummary(accountId, now = Date.now()) {
  const season = seasonOf(now);
  if (!season) {
    return {
      season: null,
      label: '',
      points: 0,
      maxPoints: SEASON_PASS_MAX_POINTS,
      startsAt: null,
      endsAt: null,
      claimedCount: 0,
      claimableCount: 0,
      wallet: wallet(accountId),
      milestones: seasonPassProgress(0, []),
    };
  }

  const bounds = seasonBounds(season);
  const points = seasonPoints(accountId, bounds);
  transaction(() => recordPoints(accountId, season, points, now));

  const claims = new Map(
    claimRows(accountId, season).map((row) => [row.milestone_id, Number(row.claimed_at)])
  );
  const milestones = seasonPassProgress(points, [...claims.keys()]).map((milestone) => ({
    ...milestone,
    claimedAt: claims.get(milestone.id) ?? null,
  }));

  return {
    season,
    label: seasonLabel(season),
    points,
    maxPoints: SEASON_PASS_MAX_POINTS,
    startsAt: bounds?.start ?? null,
    endsAt: bounds?.end ?? null,
    claimedCount: milestones.filter((milestone) => milestone.claimed).length,
    claimableCount: milestones.filter((milestone) => milestone.claimable).length,
    wallet: wallet(accountId),
    milestones,
  };
}

// 幂等领取：已领取直接返回，不发奖；首次领取在写事务内落领取行并发放全部奖励。
export function claimSeasonPassMilestone(accountId, milestoneId, now = Date.now()) {
  const milestone = seasonPassMilestone(milestoneId);
  if (!milestone) return { ok: false, code: 'UNKNOWN_MILESTONE' };

  const season = seasonOf(now);
  if (!season) return { ok: false, code: 'SEASON_UNAVAILABLE' };

  return transaction(() => {
    const bounds = seasonBounds(season);
    const points = seasonPoints(accountId, bounds);
    recordPoints(accountId, season, points, now);

    const existing = db
      .prepare(
        `SELECT claimed_at FROM account_season_pass_claims
          WHERE account_id = ? AND season = ? AND milestone_id = ?`
      )
      .get(accountId, season, milestone.id);

    if (existing) {
      return {
        ok: true,
        claimed: false,
        alreadyClaimed: true,
        awarded: null,
        season,
        points,
        milestone,
        wallet: wallet(accountId),
      };
    }

    if (points < milestone.points) {
      return {
        ok: false,
        code: 'SEASON_PASS_INCOMPLETE',
        season,
        points,
        target: milestone.points,
        milestone,
      };
    }

    const inserted = db
      .prepare(
        `INSERT OR IGNORE INTO account_season_pass_claims
           (account_id, season, milestone_id, points, claimed_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(accountId, season, milestone.id, points, now);

    if (inserted.changes !== 1) {
      return {
        ok: true,
        claimed: false,
        alreadyClaimed: true,
        awarded: null,
        season,
        points,
        milestone,
        wallet: wallet(accountId),
      };
    }

    const { cores = 0, shards = 0, title = null } = milestone.reward || {};
    if (cores > 0) grantCores(accountId, cores);
    if (shards > 0) grantShardsInTx(accountId, shards, now);
    if (title) grantTitleInTx(accountId, title, season, milestone.id, now);

    return {
      ok: true,
      claimed: true,
      alreadyClaimed: false,
      awarded: { ...(milestone.reward || {}) },
      season,
      points,
      milestone,
      wallet: wallet(accountId),
    };
  });
}
