// 游戏接口共用的领域辅助：日期、昵称清洗、每日次数、远征查询、难度负载、每日规则集。
import { db, getRun, hydrateRun } from '../db.mjs';
import { boardKeyFor } from '../db/leaderboard.mjs';
import { DIFFICULTIES, TOWER_ORDER, unlockedTowerIds } from '../../public/js/shared/data.js';

export const DAILY_ATTEMPTS = 3;

// 每日挑战固定规则集（不随账号解锁/难度加成变化）。
export const DAILY_RULESET = 'daily-v2';
export const DAILY_START_GOLD = 260;
export const DAILY_START_HP = 20;
export const DAILY_MAX_REROLLS = 1;
export const DAILY_SKILL_LEVEL = 5;

export { boardKeyFor };

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

// 每日固定 1 次刷新；普通局沿用账号解锁加成。
export function maxRerollsForRun(run, profile) {
  return run?.mode === 'daily' ? DAILY_MAX_REROLLS : maxRerollsFor(profile);
}

// 每日全塔开放；普通局按账号解锁。
export function towersUnlockedForRun(run, profile) {
  return run?.mode === 'daily' ? [...TOWER_ORDER] : unlockedTowerIds(profile.unlocks);
}

// 局内冻结的技能快照（旧局为 null）。
export function skillForRun(run) {
  const skill = run?.ruleset?.skill;
  return skill && skill.id ? skill : null;
}

export function difficultyPayload(difficulty) {
  const diff = DIFFICULTIES[difficulty] || DIFFICULTIES.standard;
  return { ...diff };
}
