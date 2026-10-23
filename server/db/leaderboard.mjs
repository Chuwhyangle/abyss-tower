import { db, transaction } from './index.mjs';
import { dayKey } from '../../public/js/shared/scoring.js';

// v2：每日挑战使用固定规则集，与 v1（受账号解锁影响）的旧榜分开；旧数据保留不迁移。
// 无尽模式使用独立榜单，不与普通榜的三档难度合并。
export function boardKeyFor(mode, day) {
  if (mode === 'daily') return `daily:${day}:v2`;
  if (mode === 'endless') return 'endless';
  return 'normal';
}

export const SEASON_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isSeasonKey(value) {
  return typeof value === 'string' && SEASON_KEY_RE.test(value);
}

// 赛季按服务器本地时区的自然月划分；旧数据按 created_at 自动归入所在赛季。
export function seasonOf(ts = Date.now()) {
  const date = new Date(Number(ts));
  if (Number.isNaN(date.getTime())) return null;
  return dayKey(date).slice(0, 7);
}

// 返回赛季的毫秒区间 [start, end)，边界同样按服务器本地时区。
export function seasonBounds(season) {
  if (!isSeasonKey(season)) return null;
  const [year, month] = season.split('-').map(Number);
  return {
    start: new Date(year, month - 1, 1).getTime(),
    end: new Date(year, month, 1).getTime(),
  };
}

export function listSeasons() {
  const rows = db
    .prepare(
      `SELECT DISTINCT strftime('%Y-%m', created_at / 1000, 'unixepoch', 'localtime') AS season
         FROM leaderboard_entries
        ORDER BY season DESC`
    )
    .all();
  return rows.map((row) => row.season).filter(isSeasonKey);
}

export function recordLeaderboardEntry({
  accountId,
  displayName,
  runId,
  mode,
  day,
  difficulty,
  score,
  durationMs,
  wave,
  kills,
  victory,
  contentVersion,
  createdAt = Date.now(),
}) {
  const metrics = JSON.stringify({
    wave: Number(wave) || 0,
    kills: Number(kills) || 0,
    victory: victory ? 1 : 0,
  });
  db.prepare(
    `INSERT INTO leaderboard_entries
       (board_key, account_id, display_name, run_id, difficulty, score, duration_ms,
        content_version, metrics_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    boardKeyFor(mode, day),
    accountId,
    displayName,
    runId,
    difficulty,
    Number(score) || 0,
    Number(durationMs) || 0,
    contentVersion || 'v1.4-map2',
    metrics,
    createdAt
  );
}

export function personalBest(accountId, mode, day) {
  const row = db
    .prepare(
      `SELECT MAX(score) AS s FROM leaderboard_entries
        WHERE account_id = ? AND board_key = ?`
    )
    .get(accountId, boardKeyFor(mode, day));
  return row?.s || 0;
}

export function rankFor(mode, day, score, { includeUnclaimed = false } = {}) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM (
         SELECT e.account_id, MAX(e.score) AS s
           FROM leaderboard_entries e
           JOIN accounts a ON a.id = e.account_id
          WHERE e.board_key = ? AND (? = 1 OR a.kind = 'registered')
          GROUP BY e.account_id
       ) WHERE s > ?`
    )
    .get(boardKeyFor(mode, day), includeUnclaimed ? 1 : 0, Number(score) || 0);
  return (row?.c || 0) + 1;
}

export const MAX_BOARD_PAGE_SIZE = 50;

function boardScope(mode, day, { includeUnclaimed = false, difficulty = null, season = null } = {}) {
  const clauses = ['e.board_key = ?', "(? = 1 OR a.kind = 'registered')"];
  const params = [boardKeyFor(mode, day), includeUnclaimed ? 1 : 0];
  if (difficulty) {
    clauses.push('e.difficulty = ?');
    params.push(difficulty);
  }
  const bounds = season ? seasonBounds(season) : null;
  if (bounds) {
    clauses.push('e.created_at >= ?', 'e.created_at < ?');
    params.push(bounds.start, bounds.end);
  }
  return { where: clauses.join(' AND '), params };
}

function publicEntry(row) {
  let metrics = {};
  try {
    metrics = JSON.parse(row.metrics_json) || {};
  } catch {
    metrics = {};
  }
  return {
    name: row.display_name,
    difficulty: row.difficulty || 'standard',
    wave: Number(metrics.wave) || 0,
    score: row.score,
    kills: Number(metrics.kills) || 0,
    victory: !!metrics.victory,
    durationMs: row.duration_ms || 0,
    contentVersion: row.content_version,
    createdAt: row.created_at,
  };
}

// 个人汇总只含自己的成绩，不暴露账号 id、未知昵称或对局 id。
function personalEntry(row) {
  const entry = publicEntry(row);
  return {
    score: entry.score,
    difficulty: entry.difficulty,
    wave: entry.wave,
    victory: entry.victory,
    durationMs: entry.durationMs,
    createdAt: entry.createdAt,
  };
}

export function listBoard(
  mode,
  day,
  {
    includeUnclaimed = false,
    limit = 20,
    offset = 0,
    difficulty = null,
    accountId = null,
    season = null,
  } = {}
) {
  const size = Math.max(1, Math.min(MAX_BOARD_PAGE_SIZE, Math.floor(Number(limit) || 20)));
  const start = Math.max(0, Math.floor(Number(offset) || 0));
  const scope = boardScope(mode, day, { includeUnclaimed, difficulty, season });
  const rows = db
    .prepare(
      `SELECT * FROM (
         SELECT e.id, e.account_id, e.display_name, e.difficulty, e.score,
                e.duration_ms, e.metrics_json, e.content_version, e.created_at,
                ROW_NUMBER() OVER (
                  PARTITION BY e.account_id
                  ORDER BY e.score DESC, e.duration_ms ASC, e.id ASC
                ) AS rn
           FROM leaderboard_entries e
           JOIN accounts a ON a.id = e.account_id
          WHERE ${scope.where}
       ) WHERE rn = 1
       ORDER BY score DESC, duration_ms ASC, created_at ASC
       LIMIT ? OFFSET ?`
    )
    .all(...scope.params, size, start);

  return rows.map((row, index) => ({
    rank: start + index + 1,
    isMe: !!accountId && row.account_id === accountId,
    ...publicEntry(row),
  }));
}

export function countBoard(
  mode,
  day,
  { includeUnclaimed = false, difficulty = null, season = null } = {}
) {
  const scope = boardScope(mode, day, { includeUnclaimed, difficulty, season });
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT e.account_id) AS c
         FROM leaderboard_entries e
         JOIN accounts a ON a.id = e.account_id
        WHERE ${scope.where}`
    )
    .get(...scope.params);
  return row?.c || 0;
}

export function accountBoardSummary(
  accountId,
  mode,
  day,
  { includeUnclaimed = false, difficulty = null, season = null } = {}
) {
  const empty = { rank: null, best: null, latest: null };
  if (!accountId) return empty;

  const scope = boardScope(mode, day, { includeUnclaimed, difficulty, season });
  const mine = `e.account_id = ? AND ${scope.where}`;
  const mineParams = [accountId, ...scope.params];

  const bestRow = db
    .prepare(
      `SELECT e.difficulty, e.score, e.duration_ms, e.metrics_json, e.content_version, e.created_at
         FROM leaderboard_entries e
         JOIN accounts a ON a.id = e.account_id
        WHERE ${mine}
        ORDER BY e.score DESC, e.duration_ms ASC, e.id ASC
        LIMIT 1`
    )
    .get(...mineParams);
  if (!bestRow) return empty;

  const latestRow = db
    .prepare(
      `SELECT e.difficulty, e.score, e.duration_ms, e.metrics_json, e.content_version, e.created_at
         FROM leaderboard_entries e
         JOIN accounts a ON a.id = e.account_id
        WHERE ${mine}
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT 1`
    )
    .get(...mineParams);

  const better = db
    .prepare(
      `SELECT COUNT(*) AS c FROM (
         SELECT e.account_id, e.score, e.duration_ms,
                ROW_NUMBER() OVER (
                  PARTITION BY e.account_id
                  ORDER BY e.score DESC, e.duration_ms ASC, e.id ASC
                ) AS rn
           FROM leaderboard_entries e
           JOIN accounts a ON a.id = e.account_id
          WHERE ${scope.where}
       ) WHERE rn = 1 AND (score > ? OR (score = ? AND duration_ms < ?))`
    )
    .get(...scope.params, bestRow.score, bestRow.score, bestRow.duration_ms);

  return {
    rank: (better?.c || 0) + 1,
    best: personalEntry(bestRow),
    latest: personalEntry(latestRow),
  };
}

// ---------- 赛季结算 ----------

// 名次区间与奖励集中定义：结算、CLI 展示与测试都以这里为准。
export const SEASON_REWARD_TIERS = [
  { from: 1, to: 1, cores: 300 },
  { from: 2, to: 3, cores: 180 },
  { from: 4, to: 10, cores: 100 },
  { from: 11, to: 50, cores: 40 },
];

export const SEASON_REWARD_LIMIT = SEASON_REWARD_TIERS.at(-1).to;

export function seasonRewardForRank(rank) {
  const value = Math.floor(Number(rank));
  if (!Number.isFinite(value) || value < 1) return 0;
  return SEASON_REWARD_TIERS.find((tier) => value >= tier.from && value <= tier.to)?.cores || 0;
}

// 赛季名次：注册账号在赛季区间内所有榜单的最高分（同分比时长，再比记录先后）。
// 无尽榜独立于三档难度，不参与赛季排名，避免高波次分数压过普通/每日榜。
function seasonStandings(season) {
  const bounds = seasonBounds(season);
  if (!bounds) return [];
  return db
    .prepare(
      `SELECT account_id, score, duration_ms, created_at, id FROM (
         SELECT e.account_id, e.score, e.duration_ms, e.created_at, e.id,
                ROW_NUMBER() OVER (
                  PARTITION BY e.account_id
                  ORDER BY e.score DESC, e.duration_ms ASC, e.id ASC
                ) AS rn
           FROM leaderboard_entries e
           JOIN accounts a ON a.id = e.account_id
          WHERE a.kind = 'registered'
            AND e.board_key <> 'endless'
            AND e.created_at >= ? AND e.created_at < ?
       ) WHERE rn = 1
       ORDER BY score DESC, duration_ms ASC, created_at ASC, id ASC
       LIMIT ?`
    )
    .all(bounds.start, bounds.end, SEASON_REWARD_LIMIT);
}

function settledRows(season) {
  return db
    .prepare(
      'SELECT account_id, rank, cores, settled_at FROM season_results WHERE season = ? ORDER BY rank ASC'
    )
    .all(season);
}

function settledSummary(season, rows, dryRun) {
  return {
    season,
    dryRun,
    alreadySettled: true,
    settledCount: rows.length,
    totalCores: rows.reduce((sum, row) => sum + (Number(row.cores) || 0), 0),
    rewards: rows.map((row) => ({
      accountId: row.account_id,
      rank: Number(row.rank),
      cores: Number(row.cores),
      settledAt: Number(row.settled_at),
    })),
  };
}

function planRewards(season) {
  return seasonStandings(season).map((row, index) => ({
    accountId: row.account_id,
    rank: index + 1,
    cores: seasonRewardForRank(index + 1),
  }));
}

// 幂等结算：已有结果的赛季直接返回既存结果，绝不重复发放。
// 奖励写入与结果记录在同一事务内，中途失败整体回滚。
export function settleSeason(season, { dryRun = false } = {}) {
  if (!isSeasonKey(season)) throw new Error(`非法赛季：${season}`);

  if (dryRun) {
    const existing = settledRows(season);
    if (existing.length) return settledSummary(season, existing, true);
    const rewards = planRewards(season);
    return {
      season,
      dryRun: true,
      alreadySettled: false,
      settledCount: rewards.length,
      totalCores: rewards.reduce((sum, item) => sum + item.cores, 0),
      rewards,
    };
  }

  return transaction(() => {
    const existing = settledRows(season);
    if (existing.length) return settledSummary(season, existing, false);

    const rewards = planRewards(season);
    const settledAt = Date.now();
    const insertResult = db.prepare(
      `INSERT INTO season_results (account_id, season, rank, cores, settled_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    const grantCores = db.prepare(
      `INSERT INTO player_wallets (account_id, currency_id, balance, updated_at)
       VALUES (?, 'cores', ?, ?)
       ON CONFLICT(account_id, currency_id) DO UPDATE SET
         balance = balance + excluded.balance,
         updated_at = excluded.updated_at`
    );
    for (const item of rewards) {
      insertResult.run(item.accountId, season, item.rank, item.cores, settledAt);
      if (item.cores > 0) grantCores.run(item.accountId, item.cores, settledAt);
    }
    return {
      season,
      dryRun: false,
      alreadySettled: false,
      settledCount: rewards.length,
      totalCores: rewards.reduce((sum, item) => sum + item.cores, 0),
      rewards: rewards.map((item) => ({ ...item, settledAt })),
    };
  });
}

// 个人赛季结果：只返回本人，未结算或未上榜返回 null。
export function seasonResultFor(accountId, season) {
  if (!accountId || !isSeasonKey(season)) return null;
  const row = db
    .prepare('SELECT season, rank, cores, settled_at FROM season_results WHERE account_id = ? AND season = ?')
    .get(accountId, season);
  if (!row) return null;
  return {
    season: row.season,
    rank: Number(row.rank),
    cores: Number(row.cores),
    settledAt: Number(row.settled_at),
  };
}
