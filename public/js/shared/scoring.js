// 结算公式与每日挑战派生：前后端共用；服务端为准，客户端只用于本地预览。
import { MAX_WAVE, getDifficulty } from './data.js';
import { candidatePlan } from './mapgen.js';

export const VICTORY_BONUS = 10000;
export const VICTORY_CORES = 25;
// 无尽模式独立倍率：榜单独立，分数略高于同波次普通局。
export const ENDLESS_SCORE_MUL = 1.25;
// 速死刷核保护：清波不足 5 波不给任何星核。
export const MIN_CORES_WAVES = 5;

export const CAPS = {
  killsPerWave: 600,
  killsFlat: 50,
  goldPerWave: 1200,
  goldFlat: 600,
  baseHp: 120,
};

export function isVictory(waveReached, wavesServed = waveReached) {
  return waveReached >= MAX_WAVE && wavesServed >= MAX_WAVE;
}

export function computeRawScore({ waveReached, kills, goldLeft, baseHp, victory }) {
  return (
    Math.floor(waveReached) * 1000 +
    Math.floor(kills) * 8 +
    Math.floor(goldLeft) * 2 +
    Math.floor(baseHp) * 150 +
    (victory ? VICTORY_BONUS : 0)
  );
}

export function computeOutcome({
  waveReached,
  wavesServed = waveReached,
  kills,
  goldLeft,
  baseHp,
  difficulty = 'standard',
  scoreMul = 1,
  mode = 'normal',
}) {
  const diff = getDifficulty(difficulty);
  const endless = mode === 'endless';
  // 无尽模式没有通关结算：第 30 波后继续挑战，直到基地被摧毁。
  const victory = endless ? false : isVictory(waveReached, wavesServed);
  const rawScore = computeRawScore({ waveReached, kills, goldLeft, baseHp, victory });
  const score = Math.round(
    rawScore * diff.scoreMul * scoreMul * (endless ? ENDLESS_SCORE_MUL : 1)
  );
  const waves = Math.floor(waveReached);
  const cores =
    waves < MIN_CORES_WAVES
      ? 0
      : Math.round(
          (waves * 2 + Math.floor(rawScore / 2500) + (victory ? VICTORY_CORES : 0)) *
            diff.coresMul
        );
  return { victory, rawScore, score, cores };
}

// ---------- 每日挑战：日期、种子与词缀组合 ----------

export const DAILY_MODIFIER_COUNT = 3;

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

// 服务器本地时区的日期键（YYYY-MM-DD）；每日次数、榜单与种子统一使用。
export function dayKey(date = new Date()) {
  const y = String(date.getFullYear()).padStart(4, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isDayKey(value) {
  if (typeof value !== 'string' || !DAY_KEY_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
  );
}

// 日期键按 UTC 正午以外的纯日历运算平移，避免时区偏移影响跨天。
export function shiftDay(day, delta) {
  if (!isDayKey(day)) throw new TypeError(`非法日期：${day}`);
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

export function dailySeed(day) {
  if (!isDayKey(day)) throw new TypeError(`非法日期：${day}`);
  return `daily-${day}`;
}

// 当日种子固定；词缀取该种子三张候选地图的词缀排列，与地图完全一致。
export function dailyChallenge(day = dayKey()) {
  const seed = dailySeed(day);
  const { modifierPool } = candidatePlan(seed, DAILY_MODIFIER_COUNT);
  const modifiers = modifierPool.slice(0, DAILY_MODIFIER_COUNT).map((modifier) => ({
    id: modifier.id,
    name: modifier.name,
    desc: modifier.desc,
    color: modifier.color,
  }));
  return { day, seed, modifiers };
}

// ---------- 本周挑战：ISO 周键、种子与周词缀 ----------

export const WEEKLY_MODIFIER_COUNT = 1;
export const WEEKLY_SKILL_LEVEL = 5;

const WEEK_KEY_RE = /^\d{4}-W\d{2}$/;

// ISO 8601 周：周一为一周开始，周四决定所属年份；日期按本地日历取日。
function isoWeekOf(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const isoYear = date.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86400000 + 1) / 7);
  return { isoYear, week };
}

function isoWeeksInYear(year) {
  // 12-28 必然落在该年最后一个 ISO 周内。
  return isoWeekOf(year, 12, 28).week;
}

// 服务器本地时区的 ISO 周键（YYYY-Www）；周挑战的种子、榜单与次数统一使用。
export function weekKey(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError(`非法日期：${date}`);
  }
  const { isoYear, week } = isoWeekOf(date.getFullYear(), date.getMonth() + 1, date.getDate());
  return `${String(isoYear).padStart(4, '0')}-W${String(week).padStart(2, '0')}`;
}

export function isWeekKey(value) {
  if (typeof value !== 'string' || !WEEK_KEY_RE.test(value)) return false;
  const [yearPart, weekPart] = value.split('-W');
  const week = Number(weekPart);
  return week >= 1 && week <= isoWeeksInYear(Number(yearPart));
}

export function weeklySeed(week) {
  if (!isWeekKey(week)) throw new TypeError(`非法周：${week}`);
  return `weekly-${week}`;
}

// 每周固定规则集：周词缀取候选计划首张地图的词缀，与开局候选保持一致。
export function weeklyChallenge(date = new Date()) {
  const week = weekKey(date);
  const seed = weeklySeed(week);
  const { modifierPool } = candidatePlan(seed, 3);
  const modifiers = modifierPool.slice(0, WEEKLY_MODIFIER_COUNT).map((modifier) => ({
    id: modifier.id,
    name: modifier.name,
    desc: modifier.desc,
    color: modifier.color,
  }));
  return {
    week,
    seed,
    modifiers,
    rules: { towers: 'all', skillLevel: WEEKLY_SKILL_LEVEL, maxRerolls: 1 },
  };
}

// 最近若干天的每日挑战派生：按日期从新到旧排列，词缀只保留 id，便于历史面板复用。
export function recentDailyChallenges(today = dayKey(), days = 14) {
  if (!isDayKey(today)) throw new TypeError(`非法日期：${today}`);
  const count = Number.isFinite(Number(days)) ? Math.max(0, Math.floor(Number(days))) : 14;
  return Array.from({ length: count }, (_, offset) => {
    const day = shiftDay(today, -offset);
    const { seed, modifiers } = dailyChallenge(day);
    return { day, seed, modifiers: modifiers.map((modifier) => modifier.id) };
  });
}

// 连续参与天数：从今天（今天未参与则从昨天）向前数连续出现的日期。
export function dailyStreak(days, today = dayKey()) {
  const played = new Set((days || []).filter(isDayKey));
  if (!isDayKey(today)) throw new TypeError(`非法日期：${today}`);
  let cursor = played.has(today) ? today : shiftDay(today, -1);
  let streak = 0;
  while (played.has(cursor)) {
    streak += 1;
    cursor = shiftDay(cursor, -1);
  }
  return streak;
}

export function clampFinishPayload(body, wavesServed) {
  const toInt = (value, min, max) => {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
  };
  const waveReached = toInt(body.waveReached, 0, wavesServed);
  return {
    waveReached,
    kills: toInt(body.kills, 0, waveReached * CAPS.killsPerWave + CAPS.killsFlat),
    goldLeft: toInt(body.goldLeft, 0, waveReached * CAPS.goldPerWave + CAPS.goldFlat),
    baseHp: toInt(body.baseHp, 0, CAPS.baseHp),
  };
}
