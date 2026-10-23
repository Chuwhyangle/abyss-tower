// 远征仓储：runs 表的全部 SQL 只在这里出现，供领域服务调用。
import { db } from './index.mjs';

export function abandonActiveRuns(accountId, finishedAt) {
  db.prepare(
    `UPDATE runs SET status = 'abandoned', finished_at = ? WHERE account_id = ? AND status = 'active'`
  ).run(finishedAt, accountId);
}

export function insertRun({
  id,
  accountId,
  mode,
  boardKey,
  difficulty,
  seed,
  day,
  contentVersion,
  relics,
  ruleset = '{}',
  createdAt,
}) {
  db.prepare(
    `INSERT INTO runs
       (id, account_id, mode, board_key, difficulty, seed, day, content_version,
        ruleset_json, waves_served, cleared_waves, map_choice, relics, offers,
        rerolls_used, status, result_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, -1, ?, '{}', 0, 'active', '{}', ?)`
  ).run(
    id, accountId, mode, boardKey, difficulty, seed, day, contentVersion, ruleset, relics, createdAt
  );
}

export function findRun(id) {
  return db.prepare('SELECT * FROM runs WHERE id = ?').get(id) || null;
}

export function findActiveRun(accountId) {
  return (
    db
      .prepare(
        "SELECT * FROM runs WHERE account_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1"
      )
      .get(accountId) || null
  );
}

export function setMapChoice(id, index) {
  db.prepare('UPDATE runs SET map_choice = ? WHERE id = ?').run(index, id);
}

export function setWavesServed(id, wavesServed) {
  db.prepare('UPDATE runs SET waves_served = ? WHERE id = ?').run(wavesServed, id);
}

export function setClearedWaves(id, clearedWaves) {
  db.prepare('UPDATE runs SET cleared_waves = ? WHERE id = ?').run(clearedWaves, id);
}

export function setOffers(id, offers) {
  db.prepare('UPDATE runs SET offers = ? WHERE id = ?').run(offers, id);
}

export function setOffersAndRerolls(id, offers, rerollsUsed) {
  db.prepare('UPDATE runs SET offers = ?, rerolls_used = ? WHERE id = ?').run(
    offers,
    rerollsUsed,
    id
  );
}

export function setRelics(id, relics) {
  db.prepare('UPDATE runs SET relics = ? WHERE id = ?').run(relics, id);
}

export function settleRun(
  id,
  { victory, score, waveReached, kills, durationMs, result, finishedAt }
) {
  db.prepare(
    `UPDATE runs SET status = 'finished', victory = ?, score = ?, wave_reached = ?,
       kills = ?, duration_ms = ?, result_json = ?, finished_at = ? WHERE id = ?`
  ).run(victory ? 1 : 0, score, waveReached, kills, durationMs, result, finishedAt, id);
}

export function markAbandoned(id, finishedAt) {
  db.prepare(`UPDATE runs SET status = 'abandoned', finished_at = ? WHERE id = ?`).run(
    finishedAt,
    id
  );
}

// 参与过每日挑战的日期：开局即计入，与结算次数互不影响。
export function participationDays(accountId) {
  return db
    .prepare(`SELECT DISTINCT day FROM runs WHERE account_id = ? AND mode = 'daily'`)
    .all(accountId)
    .map((row) => row.day);
}

export function countFinishedDailyRuns(accountId, day) {
  return db
    .prepare(
      `SELECT COUNT(*) AS c FROM runs WHERE account_id = ? AND mode = 'daily' AND day = ? AND status = 'finished'`
    )
    .get(accountId, day).c;
}
