// 结算公式与每日挑战派生：前后端共用；服务端为准，客户端只用于本地预览。
import { MAX_WAVE, getDifficulty } from './data.js';
import { candidatePlan } from './mapgen.js';

export const VICTORY_BONUS = 10000;
export const VICTORY_CORES = 25;
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
}) {
  const diff = getDifficulty(difficulty);
  const victory = isVictory(waveReached, wavesServed);
  const rawScore = computeRawScore({ waveReached, kills, goldLeft, baseHp, victory });
  const score = Math.round(rawScore * diff.scoreMul * scoreMul);
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
