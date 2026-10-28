// 排行榜基线反作弊：规则集中定义，按运营数据调整即可；不追求强反作弊，只拦明显异常。
// 纯函数模块：不碰数据库，结算与查询层都只读取这里的判定结果。
import { CAPS, ENDLESS_SCORE_MUL, computeRawScore } from '../../public/js/shared/scoring.js';
import { DIFFICULTIES } from '../../public/js/shared/data.js';

const MIN_DIFFICULTY_SCORE_MUL = Math.min(
  ...Object.values(DIFFICULTIES).map((item) => item.scoreMul)
);
const MAX_DIFFICULTY_SCORE_MUL = Math.max(
  ...Object.values(DIFFICULTIES).map((item) => item.scoreMul)
);
// 地图倍率由 mapgen 钳制在 [0.9, 1.25]；无尽模式额外乘 ENDLESS_SCORE_MUL。
const MIN_MAP_SCORE_MUL = 0.9;
const MAX_MAP_SCORE_MUL = 1.25;

export const LEADERBOARD_GUARD = {
  // 3 分钟内打到 20 波以上：正常对局不可能，直接拒绝入榜。
  highWave: 20,
  minDurationMsForHighWave: 3 * 60 * 1000,
  // 单波击杀理论上限，与结算钳制共用同一组常量。
  killsPerWave: CAPS.killsPerWave,
  killsFlat: CAPS.killsFlat,
  // 理论分数上下界：由计分公式乘以可能的难度/地图/模式倍率推导。
  minScoreMul: MIN_DIFFICULTY_SCORE_MUL * MIN_MAP_SCORE_MUL,
  maxScoreMul: MAX_DIFFICULTY_SCORE_MUL * MAX_MAP_SCORE_MUL * ENDLESS_SCORE_MUL,
};

function toCount(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// 入榜前校验：先拦截明显不可能的成绩，再钳制越界击杀并标记可疑分。
// scoreMul 为模式额外倍率（变异挑战），同时放宽理论上限与下限，避免合法成绩被误判。
export function validateLeaderboardEntry(entry = {}, { scoreMul = 1 } = {}) {
  const wave = toCount(entry.wave);
  const kills = toCount(entry.kills);
  const durationMs = Math.max(0, Number(entry.durationMs) || 0);
  const score = Math.max(0, Number(entry.score) || 0);
  const rules = LEADERBOARD_GUARD;

  if (wave >= rules.highWave && durationMs < rules.minDurationMsForHighWave) {
    return {
      accepted: false,
      suspect: false,
      flags: ['duration_too_short'],
      reason: 'duration_too_short',
      wave,
      kills,
      score,
    };
  }

  const flags = [];
  const maxKills = wave * rules.killsPerWave + rules.killsFlat;
  const clampedKills = Math.min(kills, maxKills);
  if (kills > maxKills) flags.push('kills_clamped');

  const maxGold = wave * CAPS.goldPerWave + CAPS.goldFlat;
  const rawCeiling = computeRawScore({
    waveReached: wave,
    kills: clampedKills,
    goldLeft: maxGold,
    baseHp: CAPS.baseHp,
    victory: true,
  });
  const rawFloor = computeRawScore({
    waveReached: wave,
    kills: clampedKills,
    goldLeft: 0,
    baseHp: 0,
    victory: false,
  });
  const extraMul = Number.isFinite(scoreMul) && scoreMul > 0 ? scoreMul : 1;
  const scoreCeiling = Math.ceil(rawCeiling * rules.maxScoreMul * extraMul);
  const scoreFloor = Math.floor(rawFloor * rules.minScoreMul * extraMul);
  if (score > scoreCeiling) flags.push('score_too_high');
  else if (score < scoreFloor) flags.push('score_too_low');

  return {
    accepted: true,
    suspect: flags.length > 0,
    flags,
    reason: flags[0] || null,
    wave,
    kills: clampedKills,
    score,
  };
}
