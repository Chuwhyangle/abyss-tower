// 最近对局回放摘要仓储：replays 与 replay_weekly 表的全部 SQL 只在这里出现。
// 每账号最多保留 REPLAY_LIMIT 局明细，超出部分按周聚合成统计后删除。
import { db, transaction } from './index.mjs';
import { weekKey } from '../../public/js/shared/scoring.js';

export const REPLAY_LIMIT = 20;
export const WEEKLY_ARCHIVE_LIMIT = 52;

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

function count(value) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

// 只保留结算时间最新的 limit 局明细；更旧的按周聚合成纯统计后删除。
// 聚合写入与明细删除在同一事务里：失败则整体回滚，重跑不会重复计数（幂等）。
// 归属条件始终带在 SQL 上，只处理调用者自己的回放。
export function archiveOld(accountId, limit = REPLAY_LIMIT) {
  const capped = Math.max(0, Math.floor(Number(limit) || 0));
  const rows = db
    .prepare(
      `SELECT id, result_json, finished_at FROM replays
        WHERE account_id = ?
        ORDER BY finished_at DESC, id DESC
        LIMIT -1 OFFSET ?`
    )
    .all(accountId, capped);
  if (rows.length === 0) return { archived: 0, weeks: [] };

  const buckets = new Map();
  for (const row of rows) {
    const result = parseJson(row.result_json, {});
    const week = weekKey(new Date(row.finished_at));
    const bucket = buckets.get(week) || {
      week,
      runs: 0,
      victories: 0,
      scoreSum: 0,
      bestScore: 0,
      killsSum: 0,
      bestWave: 0,
    };
    const score = count(result.score);
    const wave = count(result.waveReached ?? result.waves?.reached);
    bucket.runs += 1;
    if (result.victory) bucket.victories += 1;
    bucket.scoreSum += score;
    if (score > bucket.bestScore) bucket.bestScore = score;
    bucket.killsSum += count(result.kills);
    if (wave > bucket.bestWave) bucket.bestWave = wave;
    buckets.set(week, bucket);
  }

  const now = Date.now();
  const ids = rows.map((row) => row.id);
  transaction(() => {
    const upsert = db.prepare(
      `INSERT INTO replay_weekly
         (account_id, week, runs, victories, score_sum, best_score, kills_sum, best_wave, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id, week) DO UPDATE SET
         runs = runs + excluded.runs,
         victories = victories + excluded.victories,
         score_sum = score_sum + excluded.score_sum,
         best_score = MAX(best_score, excluded.best_score),
         kills_sum = kills_sum + excluded.kills_sum,
         best_wave = MAX(best_wave, excluded.best_wave),
         updated_at = excluded.updated_at`
    );
    for (const bucket of buckets.values()) {
      upsert.run(
        accountId,
        bucket.week,
        bucket.runs,
        bucket.victories,
        bucket.scoreSum,
        bucket.bestScore,
        bucket.killsSum,
        bucket.bestWave,
        now
      );
    }
    const remove = db.prepare('DELETE FROM replays WHERE account_id = ? AND id = ?');
    for (const id of ids) remove.run(accountId, id);
  });

  return { archived: rows.length, weeks: [...buckets.values()] };
}

// 周聚合只含统计值：不含种子、遗物、事件与任何单局定位信息。
export function listWeeklyArchives(accountId, limit = WEEKLY_ARCHIVE_LIMIT) {
  const capped = Math.max(0, Math.floor(Number(limit) || 0));
  return db
    .prepare(
      `SELECT week, runs, victories, score_sum, best_score, kills_sum, best_wave, updated_at
         FROM replay_weekly
        WHERE account_id = ?
        ORDER BY week DESC
        LIMIT ?`
    )
    .all(accountId, capped)
    .map((row) => ({
      week: row.week,
      runs: row.runs,
      victories: row.victories,
      scoreSum: row.score_sum,
      bestScore: row.best_score,
      killsSum: row.kills_sum,
      bestWave: row.best_wave,
      updatedAt: row.updated_at,
    }));
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
