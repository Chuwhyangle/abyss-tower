import { db } from './index.mjs';

// v2：每日挑战使用固定规则集，与 v1（受账号解锁影响）的旧榜分开；旧数据保留不迁移。
export function boardKeyFor(mode, day) {
  return mode === 'daily' ? `daily:${day}:v2` : 'normal';
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

function boardScope(mode, day, { includeUnclaimed = false, difficulty = null } = {}) {
  const filtered = difficulty ? ' AND e.difficulty = ?' : '';
  const params = [boardKeyFor(mode, day), includeUnclaimed ? 1 : 0];
  if (difficulty) params.push(difficulty);
  return {
    where: `e.board_key = ? AND (? = 1 OR a.kind = 'registered')${filtered}`,
    params,
  };
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
  { includeUnclaimed = false, limit = 20, offset = 0, difficulty = null, accountId = null } = {}
) {
  const size = Math.max(1, Math.min(MAX_BOARD_PAGE_SIZE, Math.floor(Number(limit) || 20)));
  const start = Math.max(0, Math.floor(Number(offset) || 0));
  const scope = boardScope(mode, day, { includeUnclaimed, difficulty });
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

export function countBoard(mode, day, { includeUnclaimed = false, difficulty = null } = {}) {
  const scope = boardScope(mode, day, { includeUnclaimed, difficulty });
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
  { includeUnclaimed = false, difficulty = null } = {}
) {
  const empty = { rank: null, best: null, latest: null };
  if (!accountId) return empty;

  const scope = boardScope(mode, day, { includeUnclaimed, difficulty });
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
