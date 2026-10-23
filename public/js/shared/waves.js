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
  { type: 'shielder', weight: 1.5, countMult: 0.45, minWave: 7, interval: 1.25 },
  { type: 'splitter', weight: 1.5, countMult: 0.55, minWave: 9, interval: 1.0 },
  { type: 'herald', weight: 0.9, countMult: 0.3, minWave: 11, interval: 1.5 },
  { type: 'caster', weight: 1.1, countMult: 0.4, minWave: 13, interval: 1.3 },
];

export function generateWave(seed, wave, difficulty = 'standard', mapMeta = {}) {
  const index = Math.max(1, Math.min(MAX_WAVE, Math.floor(wave)));
  const diff = getDifficulty(difficulty);
  const rng = new RNG(`${seed}:wave:${index}`);
  const modifier = mapMeta.modifier || null;
  const portalCount = Math.max(1, Math.min(3, Math.floor(mapMeta.portalCount || 1)));
  const isFinal = index === MAX_WAVE;
  const hpMul =
    Math.pow(BALANCE.hpGrowth, index - 1) *
    diff.hpMul *
    (isFinal ? BALANCE.finalBossMul : 1) *
    (modifier?.hpMul || 1);
  // 首领使用独立血量曲线：普通敌人的 1.165 曲线到第 30 波会让首领血量失控。
  const bossHpMul = round3(
    Math.pow(BALANCE.bossHpGrowth, index - 1) *
      diff.hpMul *
      (isFinal ? BALANCE.bossFinalMul : 1) *
      (modifier?.hpMul || 1)
  );
  const speedMul =
    (1 + index * BALANCE.speedGrowth) * diff.speedMul * (modifier?.speedMul || 1);
  const isBoss = index % 5 === 0;
  const groups = [];

  if (isBoss) {
    const bosses = isFinal ? 1 : 1 + Math.floor(index / 15);
    groups.push({ type: 'boss', count: bosses, interval: 3.0, delay: 0.4, hpMul: bossHpMul });
    groups.push({ type: 'grunt', count: 6 + Math.round(index * 0.8), interval: 0.5, delay: 1.6 });
    if (index >= 15) {
      groups.push({ type: 'flyer', count: 4 + Math.floor(index / 3), interval: 0.8, delay: 6 });
    }
    if (index >= 25) {
      groups.push({ type: 'tank', count: 2 + Math.floor(index / 10), interval: 1.6, delay: 9 });
    }
    // 后期首领波固定混入机制型敌人，避免只靠数量堆叠。
    if (index >= 20) {
      groups.push({ type: 'shielder', count: 2, interval: 1.5, delay: 11 });
    }
    if (index >= 24) {
      groups.push({ type: 'caster', count: 1, interval: 1.7, delay: 13 });
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
        hpMul,
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

  const allPortals = Array.from({ length: portalCount }, (_, i) => i);
  let activePortals;
  if (portalCount === 1) {
    activePortals = [0];
  } else if (isBoss || index >= 25) {
    activePortals = allPortals;
  } else if (index >= 12) {
    activePortals = rng.shuffle(allPortals).slice(0, Math.min(2, portalCount));
  } else {
    activePortals = [rng.int(portalCount)];
  }
  activePortals = activePortals.slice(
    0,
    Math.max(1, Math.min(activePortals.length, groups.length))
  );
  groups.forEach((group, i) => {
    group.portal = activePortals[i % activePortals.length];
  });

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
    portals: activePortals,
    modifierId: modifier?.id || null,
    label: isFinal ? '最终首领' : isBoss ? '首领波次' : `第 ${index} 波`,
  };
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}
