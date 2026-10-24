// 赛季通行证持久化：积分由赛季内的对局、赛季悬赏与成就三类来源派生，里程碑领取与奖励发放同事务。
// 赛季边界直接复用排行榜的 seasonOf / seasonBounds，保证与榜单口径一致。
import { db, grantCores, getCores, transaction } from '../db.mjs';
import { seasonBounds, seasonOf } from './leaderboard.mjs';
import { ACHIEVEMENT_BY_ID } from '../../public/js/shared/achievements.js';
import {
  SEASON_PASS_MAX_POINTS,
  SEASON_PASS_MILESTONES,
  SEASON_POINT_LEDGER_NAMESPACE,
  SEASON_POINT_SOURCE_LABELS,
  SEASON_POINT_SOURCES,
  pointsBreakdown,
  seasonAchievementPoints,
  seasonBonusLedgerPrefix,
  seasonBountyPoints,
  seasonPassMilestone,
  seasonPassProgress,
} from '../../public/js/shared/season-pass.js';

const SHARD_CURRENCY = 'skin_shards';
const COSMETIC_NAMESPACE = 'cosmetics';
const SOURCE_NAMESPACE = 'season_pass_sources';

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

// 对局来源：赛季内已完成对局的分数求和，并记录最近一局的落库时间。
function matchSource(accountId, bounds) {
  if (!bounds) return { source: SEASON_POINT_SOURCES.MATCH, points: 0, updatedAt: null };
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN score > 0 THEN score ELSE 0 END), 0) AS points,
              MAX(CASE WHEN score > 0 THEN created_at END) AS updated_at
         FROM runs
        WHERE account_id = ? AND status = 'finished'
          AND created_at >= ? AND created_at < ?`
    )
    .get(accountId, bounds.start, bounds.end);
  return {
    source: SEASON_POINT_SOURCES.MATCH,
    points: Math.max(0, Math.floor(Number(row?.points) || 0)),
    updatedAt: Number(row?.updated_at) || null,
  };
}

// 悬赏来源：只统计已领取的赛季悬赏；赛季悬赏的周期键就是赛季键。
function bountySource(accountId, season) {
  const rows = db
    .prepare(
      `SELECT bounty_id, claimed_at FROM account_bounties
        WHERE account_id = ? AND period = 'season' AND period_key = ?
          AND claimed_at IS NOT NULL`
    )
    .all(accountId, season);
  let points = 0;
  let updatedAt = null;
  for (const row of rows) {
    const id = String(row.bounty_id || '');
    const tier = id.endsWith(':extreme')
      ? 'extreme'
      : id.endsWith(':challenge')
        ? 'challenge'
        : 'normal';
    points += seasonBountyPoints(tier);
    const at = Number(row.claimed_at) || 0;
    if (at > (updatedAt || 0)) updatedAt = at;
  }
  return { source: SEASON_POINT_SOURCES.BOUNTY, points, updatedAt };
}

// 成就来源：只统计本赛季解锁的成就，按稀有度折算额外积分。
function achievementSource(accountId, bounds) {
  if (!bounds) return { source: SEASON_POINT_SOURCES.ACHIEVEMENT, points: 0, updatedAt: null };
  const rows = db
    .prepare(
      `SELECT achievement_id, unlocked_at FROM account_achievements
        WHERE account_id = ? AND unlocked_at >= ? AND unlocked_at < ?`
    )
    .all(accountId, bounds.start, bounds.end);
  let points = 0;
  let updatedAt = null;
  for (const row of rows) {
    points += seasonAchievementPoints(ACHIEVEMENT_BY_ID[row.achievement_id]?.rarity);
    const at = Number(row.unlocked_at) || 0;
    if (at > (updatedAt || 0)) updatedAt = at;
  }
  return { source: SEASON_POINT_SOURCES.ACHIEVEMENT, points, updatedAt };
}

// 解锁加成来源：只读账本里本赛季的一次性加成，与 account_achievements 的派生积分互不重叠。
function achievementBonusSource(accountId, season) {
  const rows = db
    .prepare(
      `SELECT value_json, updated_at FROM player_kv
        WHERE account_id = ? AND namespace = ? AND key LIKE ?`
    )
    .all(accountId, SEASON_POINT_LEDGER_NAMESPACE, `${seasonBonusLedgerPrefix(season)}%`);
  let points = 0;
  let updatedAt = null;
  for (const row of rows) {
    let value = null;
    try {
      value = JSON.parse(row.value_json || 'null');
    } catch {
      value = null;
    }
    const amount = Math.floor(Number(value?.points));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    points += amount;
    const at = Number(value?.updatedAt ?? row.updated_at) || 0;
    if (at > (updatedAt || 0)) updatedAt = at;
  }
  return { source: SEASON_POINT_SOURCES.ACHIEVEMENT_BONUS, points, updatedAt };
}

function storedPoints(accountId, season) {
  const row = db
    .prepare('SELECT points FROM account_season_pass WHERE account_id = ? AND season = ?')
    .get(accountId, season);
  return Math.max(0, Math.floor(Number(row?.points) || 0));
}

// 赛季积分 = 对局 + 已领取赛季悬赏 + 本赛季解锁成就 + 解锁一次性加成。
// 旧数据只有总分、没有来源记录：整笔按对局积分处理，保证明细合计不丢分。
function seasonSources(accountId, season, bounds) {
  if (!bounds) return pointsBreakdown([]);
  const derived = pointsBreakdown([
    matchSource(accountId, bounds),
    bountySource(accountId, season),
    achievementSource(accountId, bounds),
  ]);
  const bonus = achievementBonusSource(accountId, season);

  let sources = derived.sources;
  let total = derived.total;
  if (total === 0 && bonus.points === 0) {
    // 没有任何可派生来源时才回退到旧快照，避免把新账本加成当成历史的全部积分。
    const legacy = pointsBreakdown(storedPoints(accountId, season));
    if (legacy.total > 0) {
      sources = legacy.sources;
      total = legacy.total;
    }
  }
  if (bonus.points > 0) {
    sources = [
      ...sources,
      { ...bonus, label: SEASON_POINT_SOURCE_LABELS[bonus.source] },
    ];
    total += bonus.points;
  }
  return { total, sources };
}

function seasonPoints(accountId, season, bounds) {
  return seasonSources(accountId, season, bounds).total;
}

// 必须在调用方事务内执行：悬赏领取、成就解锁据此把积分快照与领取/解锁一起落库。
export function syncSeasonPassPointsInTx(accountId, now = Date.now()) {
  const season = seasonOf(now);
  if (!season) return null;
  const bounds = seasonBounds(season);
  const breakdown = seasonSources(accountId, season, bounds);
  recordPoints(accountId, season, breakdown.total, now);
  recordSources(accountId, season, breakdown, now);
  return { season, points: breakdown.total, sources: breakdown.sources };
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

// 来源与时间随积分快照一起落库，明细展示无需回算历史数据。
function recordSources(accountId, season, breakdown, now) {
  db.prepare(
    `INSERT INTO player_kv (account_id, namespace, key, value_json, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(account_id, namespace, key) DO UPDATE SET
       value_json = excluded.value_json,
       updated_at = excluded.updated_at`
  ).run(
    accountId,
    SOURCE_NAMESPACE,
    `sources:${season}`,
    JSON.stringify({ total: breakdown.total, sources: breakdown.sources }),
    now
  );
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
      sources: pointsBreakdown([]).sources,
      milestones: seasonPassProgress(0, []),
    };
  }

  const bounds = seasonBounds(season);
  const breakdown = seasonSources(accountId, season, bounds);
  const points = breakdown.total;
  transaction(() => {
    recordPoints(accountId, season, points, now);
    recordSources(accountId, season, breakdown, now);
  });

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
    sources: breakdown.sources,
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
    const breakdown = seasonSources(accountId, season, bounds);
    const points = breakdown.total;
    recordPoints(accountId, season, points, now);
    recordSources(accountId, season, breakdown, now);

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

// 一键领取：在同一事务内按阈值升序补齐全部可领取里程碑。
// 主键 + INSERT OR IGNORE 让重复点击只命中既有行，不会重复发放。
export function claimAllSeasonPassMilestones(accountId, now = Date.now()) {
  const season = seasonOf(now);
  if (!season) return { ok: false, code: 'SEASON_UNAVAILABLE' };

  return transaction(() => {
    const bounds = seasonBounds(season);
    const breakdown = seasonSources(accountId, season, bounds);
    const points = breakdown.total;
    recordPoints(accountId, season, points, now);
    recordSources(accountId, season, breakdown, now);

    const claimed = new Set(
      db
        .prepare(
          `SELECT milestone_id FROM account_season_pass_claims
            WHERE account_id = ? AND season = ?`
        )
        .all(accountId, season)
        .map((row) => row.milestone_id)
    );

    const awarded = [];
    for (const milestone of SEASON_PASS_MILESTONES) {
      if (points < milestone.points) break;
      if (claimed.has(milestone.id)) continue;

      const inserted = db
        .prepare(
          `INSERT OR IGNORE INTO account_season_pass_claims
             (account_id, season, milestone_id, points, claimed_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(accountId, season, milestone.id, points, now);
      if (inserted.changes !== 1) continue;

      const { cores = 0, shards = 0, title = null } = milestone.reward || {};
      if (cores > 0) grantCores(accountId, cores);
      if (shards > 0) grantShardsInTx(accountId, shards, now);
      if (title) grantTitleInTx(accountId, title, season, milestone.id, now);
      awarded.push({ id: milestone.id, reward: { ...(milestone.reward || {}) } });
    }

    return {
      ok: true,
      claimedCount: awarded.length,
      alreadyClaimed: awarded.length === 0,
      awarded,
      season,
      points,
      wallet: wallet(accountId),
    };
  });
}
