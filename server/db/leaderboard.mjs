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

export function listBoard(mode, day, { includeUnclaimed = false, limit = 20 } = {}) {
  const rows = db
    .prepare(
      `SELECT * FROM (
         SELECT e.id, e.account_id, e.display_name, e.difficulty, e.score,
                e.duration_ms, e.metrics_json, e.content_version, e.created_at,
                ROW_NUMBER() OVER (
                  PARTITION BY e.account_id
                  ORDER BY e.score DESC, e.duration_ms ASC
                ) AS rn
           FROM leaderboard_entries e
           JOIN accounts a ON a.id = e.account_id
          WHERE e.board_key = ? AND (? = 1 OR a.kind = 'registered')
       ) WHERE rn = 1
       ORDER BY score DESC, duration_ms ASC
       LIMIT ?`
    )
    .all(boardKeyFor(mode, day), includeUnclaimed ? 1 : 0, Math.max(1, Number(limit) || 20));

  return rows.map((row) => {
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
  });
}
