// 波次生成：由服务端下发，种子 + 波数决定，客户端无法挑波。
import { RNG } from './rng.js';
import { MAX_WAVE, getDifficulty } from './data.js';
import { BALANCE } from './config.js';

const POOL = [
  { type: 'grunt', weight: 5.0, countMult: 1.0, minWave: 1, interval: 0.62 },
  { type: 'runner', weight: 3.2, countMult: 1.05, minWave: 2, interval: 0.42 },
  { type: 'swarm', weight: 2.6, countMult: 2.2, minWave: 3, interval: 0.28 },
  { type: 'tank', weight: 2.1, countMult: 0.5, minWave: 4, interval: 1.15 },
  { type: 'flyer', weight: 2.3, countMult: 0.8, minWave: 6, interval: 0.7 },
  { type: 'healer', weight: 1.2, countMult: 0.38, minWave: 8, interval: 1.5 },
];

export function generateWave(seed, wave, difficulty = 'standard') {
  const index = Math.max(1, Math.min(MAX_WAVE, Math.floor(wave)));
  const diff = getDifficulty(difficulty);
  const rng = new RNG(`${seed}:wave:${index}`);
  const isFinal = index === MAX_WAVE;
  const hpMul =
    Math.pow(BALANCE.hpGrowth, index - 1) * diff.hpMul * (isFinal ? BALANCE.finalBossMul : 1);
  const speedMul = (1 + index * BALANCE.speedGrowth) * diff.speedMul;
  const isBoss = index % 5 === 0;
  const groups = [];

  if (isBoss) {
    const bosses = isFinal ? 1 : 1 + Math.floor(index / 15);
    groups.push({ type: 'boss', count: bosses, interval: 3.0, delay: 0.4 });
    groups.push({ type: 'grunt', count: 6 + Math.round(index * 0.8), interval: 0.5, delay: 1.6 });
    if (index >= 15) {
      groups.push({ type: 'flyer', count: 4 + Math.floor(index / 3), interval: 0.8, delay: 6 });
    }
    if (index >= 25) {
      groups.push({ type: 'tank', count: 2 + Math.floor(index / 10), interval: 1.6, delay: 9 });
    }
  } else {
    const pool = POOL.filter((e) => index >= e.minWave);
    const wanted = Math.min(pool.length, 2 + (index >= 10 ? 1 : 0) + (rng.float() < 0.35 ? 1 : 0));
    const chosen = [];
    while (chosen.length < wanted && pool.length) {
      const pick = rng.weighted(pool, (e) => e.weight);
      chosen.push(pick);
      pool.splice(pool.indexOf(pick), 1);
    }

    const budget =
      BALANCE.budgetBase +
      index * BALANCE.budgetPerWave +
      Math.max(0, index - BALANCE.budgetLateStart) * BALANCE.budgetLateBoost;
    const share = budget / Math.max(1, chosen.length);
    chosen.forEach((entry, i) => {
      const count = Math.max(1, Math.round(share * entry.countMult * (0.85 + rng.float() * 0.3)));
      groups.push({
        type: entry.type,
        count,
        interval: entry.interval,
        delay: 0.3 + i * (1.6 + rng.float() * 1.2),
      });
    });
  }

  // 难度数量倍率统一作用在所有群组上；首领至少保留 1 个。
  for (const group of groups) {
    group.count = Math.max(1, Math.round(group.count * diff.countMul));
  }
  let totalCount = groups.reduce((sum, g) => sum + g.count, 0);
  while (totalCount > BALANCE.maxCount) {
    const largest = groups.reduce((a, b) => (a.count > b.count ? a : b));
    if (largest.count <= 1) break;
    largest.count -= 1;
    totalCount -= 1;
  }

  groups.sort((a, b) => a.delay - b.delay);
  const reward = BALANCE.waveRewardBase + index * BALANCE.waveRewardPerWave;

  return {
    index,
    difficulty: diff.id,
    groups,
    hpMul: round3(hpMul),
    speedMul: round3(speedMul),
    countMul: diff.countMul,
    reward,
    boss: isBoss,
    finalBoss: isFinal,
    totalCount,
    label: isFinal ? '最终首领' : isBoss ? '首领波次' : `第 ${index} 波`,
  };
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}
