// 游戏接口共用的领域辅助：日期、昵称清洗、每日次数、远征查询、难度负载。
import { db, getRun, hydrateRun } from '../db.mjs';
import { DIFFICULTIES } from '../../public/js/shared/data.js';

export const DAILY_ATTEMPTS = 3;

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function cleanName(raw) {
  return String(raw)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 16);
}

export function finishedDailyToday(token) {
  return db
    .prepare(
      `SELECT COUNT(*) AS c FROM runs WHERE account_id = ? AND mode = 'daily' AND day = ? AND status = 'finished'`
    )
    .get(token, today()).c;
}

export function dailyAttemptsLeft(token) {
  return Math.max(0, DAILY_ATTEMPTS - finishedDailyToday(token));
}

export function runForToken(id, token) {
  const run = hydrateRun(getRun(id));
  if (!run || run.token !== token) return null;
  return run;
}

export function maxRerollsFor(profile) {
  return 1 + (profile.unlocks.includes('extra_reroll') ? 2 : 0);
}

export function difficultyPayload(difficulty) {
  const diff = DIFFICULTIES[difficulty] || DIFFICULTIES.standard;
  return { ...diff };
}
