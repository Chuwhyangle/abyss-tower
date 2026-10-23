// 最近对局回放摘要仓储：replays 表的全部 SQL 只在这里出现。
// 每账号最多保留 REPLAY_LIMIT 局，超出部分按结算时间从旧到新删除。
import { db } from './index.mjs';

export const REPLAY_LIMIT = 20;

function parseJson(text, fallback) {
  try {
    const value = JSON.parse(text);
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

function hydrateReplay(row) {
  if (!row) return null;
  const summary = parseJson(row.summary_json, {});
  return {
    id: row.id,
    runId: row.run_id,
    mode: row.mode,
    difficulty: row.difficulty,
    seed: row.seed,
    mapChoice: row.map_choice,
    map: summary.map || null,
    skill: summary.skill || null,
    mutations: summary.mutations || null,
    relics: Array.isArray(summary.relics) ? summary.relics : [],
    events: Array.isArray(summary.events) ? summary.events : [],
    waves: summary.waves || {},
    result: parseJson(row.result_json, {}),
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}

export function insertReplay({
  id,
  accountId,
  runId,
  mode,
  difficulty,
  seed,
  mapChoice,
  summary,
  result,
  createdAt,
  finishedAt,
}) {
  db.prepare(
    `INSERT INTO replays
       (id, account_id, run_id, mode, difficulty, seed, map_choice,
        summary_json, result_json, created_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    accountId,
    runId,
    mode,
    difficulty,
    seed,
    mapChoice,
    summary,
    result,
    createdAt,
    finishedAt
  );
}

// 只保留结算时间最新的 limit 局；同一时间戳按 id 兜底排序，保证结果确定。
export function trimReplays(accountId, limit = REPLAY_LIMIT) {
  const capped = Math.max(0, Math.floor(Number(limit) || 0));
  db.prepare(
    `DELETE FROM replays
      WHERE account_id = ?
        AND id NOT IN (
          SELECT id FROM replays
           WHERE account_id = ?
           ORDER BY finished_at DESC, id DESC
           LIMIT ?
        )`
  ).run(accountId, accountId, capped);
  return db
    .prepare('SELECT COUNT(*) AS c FROM replays WHERE account_id = ?')
    .get(accountId).c;
}

export function listReplays(accountId, limit = REPLAY_LIMIT) {
  return db
    .prepare(
      `SELECT * FROM replays
        WHERE account_id = ?
        ORDER BY finished_at DESC, id DESC
        LIMIT ?`
    )
    .all(accountId, Math.max(0, Math.floor(Number(limit) || 0)))
    .map(hydrateReplay);
}

// 归属条件写进 SQL：他人的回放与不存在的回放返回同一种 null。
export function findReplay(accountId, id) {
  return hydrateReplay(
    db
      .prepare('SELECT * FROM replays WHERE account_id = ? AND id = ?')
      .get(accountId, id) || null
  );
}

export function countReplays(accountId) {
  return db.prepare('SELECT COUNT(*) AS c FROM replays WHERE account_id = ?').get(accountId).c;
}
