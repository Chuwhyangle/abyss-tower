// 波次生成：由服务端下发，种子 + 波数决定，客户端无法挑波。
import { RNG } from './rng.js';
import { MAX_WAVE, getDifficulty } from './data.js';
import {
  BOSS_VARIANT_ROTATION,
  ENDLESS_BOSS_AFFIXES,
  ENDLESS_BOSS_AFFIX_INTERVAL,
  ENDLESS_BOSS_AFFIX_ROTATION,
} from './data/enemies.js';
import {
  ENDLESS_POST_60,
  ENDLESS_AFFIX_INTERVAL,
  ENDLESS_AFFIX_MAX_LAYERS,
  ENDLESS_AFFIXES,
  ENDLESS_ELITE_ENEMIES,
  ENDLESS_BOSS_CYCLE_INTERVAL,
  ENDLESS_BOSS_CYCLE_MAX,
  ENDLESS_BOSS_CYCLE_HP_GROWTH,
} from './data/endless.js';
import { BALANCE } from './config.js';
import { BASELINE_ENEMIES, chapterForWave, normalizeTheme } from './chapters.js';

// 首领变体：每 5 波轮换一次；波次本身就是种子的一部分，所以同种子必然同变体。
export function selectBossVariant(wave) {
  const bossIndex = Math.max(1, Math.floor(Math.max(1, Math.floor(wave)) / 5));
  return BOSS_VARIANT_ROTATION[(bossIndex - 1) % BOSS_VARIANT_ROTATION.length];
}

// 无尽模式深渊首领词条：每 10 波按轮换顺序叠一层，单类层数由词条自身的 maxStacks 封顶。
// 非首领波与普通模式返回 null，调用方据此完全跳过词条逻辑。
export function selectBossAffixes(wave) {
  const index = Math.max(1, Math.floor(wave));
  if (index % 5 !== 0) return null;
  const layers = Math.min(
    ENDLESS_BOSS_AFFIX_ROTATION.reduce(
      (sum, id) => sum + ENDLESS_BOSS_AFFIXES[id].maxStacks,
      0
    ),
    Math.floor(index / ENDLESS_BOSS_AFFIX_INTERVAL)
  );
  if (layers <= 0) return null;
  const affixes = {};
  for (let i = 0; i < layers; i++) {
    const id = ENDLESS_BOSS_AFFIX_ROTATION[i % ENDLESS_BOSS_AFFIX_ROTATION.length];
    const cap = ENDLESS_BOSS_AFFIXES[id].maxStacks;
    affixes[id] = Math.min(cap, (affixes[id] || 0) + 1);
  }
  return affixes;
}

// 无尽周期：第 1 周期 = 61–70 波，第 2 周期 = 71–80 波，以此类推；≤60 波返回 0。
export function endlessCycleFor(index) {
  return Math.max(0, Math.floor((index - 1) / ENDLESS_AFFIX_INTERVAL) - 5);
}

// 无尽词缀：每层用独立派生 seed 随机挑选，逐层叠加，返回累计倍率与展示文本。
// 绝不消耗 generateWave 的主 rng（改用 `${seed}:endless:affix:${layer}`），同种子可复现。
export function selectEndlessAffixes(seed, layers) {
  if (!Number.isInteger(layers) || layers <= 0) return null;
  const stacks = {};
  let hpMul = 1;
  let speedMul = 1;
  let goldMul = 1;
  let eliteBoost = 0;
  for (let layer = 1; layer <= layers; layer++) {
    const rng = new RNG(`${seed}:endless:affix:${layer}`);
    const affix = rng.pick(ENDLESS_AFFIXES);
    stacks[affix.id] = (stacks[affix.id] || 0) + 1;
    hpMul *= affix.hpMul;
    speedMul *= affix.speedMul;
    goldMul *= affix.goldMul;
    eliteBoost += affix.elite;
  }
  const text = ENDLESS_AFFIXES.filter((a) => stacks[a.id])
    .map((a) => `${a.name}×${stacks[a.id]}`)
    .join('·');
  return { stacks, hpMul, speedMul, goldMul, eliteBoost, text };
}

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
  { type: 'wraith', weight: 1.4, countMult: 0.55, minWave: 10, interval: 0.8 },
  { type: 'golem', weight: 1.0, countMult: 0.3, minWave: 14, interval: 1.7 },
  { type: 'skywing', weight: 1.2, countMult: 0.5, minWave: 6, interval: 0.7 },
  { type: 'bastion', weight: 1.0, countMult: 0.35, minWave: 11, interval: 1.4 },
  { type: 'mender', weight: 0.9, countMult: 0.3, minWave: 13, interval: 1.5 },
  { type: 'bomber', weight: 1.3, countMult: 0.8, minWave: 16, interval: 0.5 },
  { type: 'stalker', weight: 1.1, countMult: 0.5, minWave: 21, interval: 0.7 },
  { type: 'riftcaller', weight: 0.8, countMult: 0.25, minWave: 26, interval: 1.6 },
  { type: 'shieldbreaker', weight: 1.0, countMult: 0.45, minWave: 28, interval: 0.9 },
];

// 无尽模式曲线硬上限：血量/移速/数量在封顶后不再增长，避免数值爆炸。
export const ENDLESS = {
  maxIndex: 999,        // 波次号硬上限，超过后重复最后一档曲线
  hpCapWave: 40,        // 普通敌人血量曲线封顶波次
  bossHpCapWave: 50,    // 首领血量曲线封顶波次
  speedCap: 2.2,        // 移速倍率硬上限
  rewardCapWave: 60,    // 清波金币增量封顶波次
  maxBosses: 3,         // 首领波同时出现的首领数量上限
};

export function generateWave(seed, wave, difficulty = 'standard', mapMeta = {}, { endless = false, chapters = false } = {}) {
  const rawIndex = Math.max(1, Math.floor(wave));
  const index = endless
    ? Math.min(ENDLESS.maxIndex, rawIndex)
    : Math.max(1, Math.min(MAX_WAVE, rawIndex));
  const diff = getDifficulty(difficulty);
  const rng = new RNG(`${seed}:wave:${index}`);
  const modifier = mapMeta.modifier || null;
  const portalCount = Math.max(1, Math.min(3, Math.floor(mapMeta.portalCount || 1)));
  const isFinal = !endless && index === MAX_WAVE;
  // 章节契约：chapters 开启时读取当前波所属章节；关闭时整段跳过（旧存档/回放字节不变）。
  const chapter = chapters ? chapterForWave(index) : null;
  const theme = chapter ? normalizeTheme(chapter.theme) : null;
  const chapterPool = chapter ? new Set([...BASELINE_ENEMIES, ...chapter.enemyPool]) : null;
  // 无尽模式下曲线只推进到封顶波次，之后保持恒定难度。
  const hpIndex = endless ? Math.min(index, ENDLESS.hpCapWave) : index;
  const bossHpIndex = endless ? Math.min(index, ENDLESS.bossHpCapWave) : index;
  const hpMul =
    Math.pow(BALANCE.hpGrowth, hpIndex - 1) *
    diff.hpMul *
    (isFinal ? BALANCE.finalBossMul : 1) *
    (modifier?.hpMul || 1) *
    (mapMeta.hpMul || 1) *
    (theme?.hpMul ?? 1);
  // 首领使用独立血量曲线：普通敌人的 1.165 曲线到第 30 波会让首领血量失控。
  const bossHpMul = round3(
    Math.pow(BALANCE.bossHpGrowth, bossHpIndex - 1) *
      diff.hpMul *
      (isFinal ? BALANCE.bossFinalMul : 1) *
      (modifier?.hpMul || 1) *
      (mapMeta.hpMul || 1) *
      (theme?.hpMul ?? 1)
  );
  // 无尽 60 波后：每 10 波追加一层 seed 派生的随机「无尽词缀」。词缀独立用派生 seed 挑选，
  // 不动波次 rng；效果乘法叠加在基础曲线之上（血量走各群组 hpMul、移速在封顶前叠加、
  // 金币乘到清波奖励），因此 ≤60 波与普通/每日/爬塔波次逐字节不变。
  const endlessCycle = endless && index > ENDLESS_POST_60 ? endlessCycleFor(index) : 0;
  const endlessAffix = endlessCycle > 0
    ? selectEndlessAffixes(seed, Math.min(endlessCycle, ENDLESS_AFFIX_MAX_LAYERS))
    : null;
  const affixHpMul = endlessAffix?.hpMul ?? 1;
  const affixSpeedMul = endlessAffix?.speedMul ?? 1;
  const affixGoldMul = endlessAffix?.goldMul ?? 1;
  const affixEliteBoost = endlessAffix?.eliteBoost ?? 0;
  const rawSpeedMul =
    (1 + index * BALANCE.speedGrowth) *
    diff.speedMul *
    (modifier?.speedMul || 1) *
    (theme?.speedMul ?? 1) *
    affixSpeedMul;
  const speedMul = endless ? Math.min(ENDLESS.speedCap, rawSpeedMul) : rawSpeedMul;
  const isBoss = index % 5 === 0;
  // 最终波固定狂暴型；chapters 开启时其余首领波用章节变体，关闭时按每 5 波轮换。
  const bossVariant = isBoss
    ? isFinal
      ? 'berserk'
      : chapter
        ? chapter.bossVariant
        : selectBossVariant(index)
    : null;
  // 深渊首领：仅无尽模式的首领波叠加词条，每 10 波一层且层数硬上限。
  const bossAffixes = endless && isBoss ? selectBossAffixes(index) : null;
  const bossAffixText = bossAffixes
    ? ENDLESS_BOSS_AFFIX_ROTATION.filter((id) => bossAffixes[id])
        .map((id) => `${ENDLESS_BOSS_AFFIXES[id].name}×${bossAffixes[id]}`)
        .join('·')
    : '';
  // 首领循环：60 波后每 10 波（70/80/90…）循环出首领，强度随循环数递增并封顶。
  const cycleBoss = endless && isBoss && index % ENDLESS_BOSS_CYCLE_INTERVAL === 0 && index > ENDLESS_POST_60;
  const bossCycle = cycleBoss ? Math.min(endlessCycle, ENDLESS_BOSS_CYCLE_MAX) : 0;
  const bossCycleHpMul = cycleBoss ? Math.pow(ENDLESS_BOSS_CYCLE_HP_GROWTH, bossCycle) : 1;
  // 词缀血量叠到「各群组 hpMul」而非顶层 hpMul：顶层 hpMul 字段保持封顶基线不变
  // （旧断言「血量曲线封顶后不再增长」仍成立），实际生效血量经群组 hpMul 抬升。
  const groupHpMul = hpMul * affixHpMul;
  const bossGroupHpMul = bossHpMul * affixHpMul * bossCycleHpMul;
  const groups = [];

  if (isBoss) {
    const bossCount = isFinal ? 1 : 1 + Math.floor(index / 15);
    const bosses = endless ? Math.min(ENDLESS.maxBosses, bossCount) : bossCount;
    groups.push({ type: 'boss', count: bosses, interval: 3.0, delay: 0.4, hpMul: bossGroupHpMul });
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
    const pool = POOL.filter((e) => index >= e.minWave && (!chapterPool || chapterPool.has(e.type)));
    const wanted = Math.min(pool.length, 2 + (index >= 10 ? 1 : 0) + (rng.float() < 0.35 ? 1 : 0));
    const chosen = [];
    // 无尽 60 波后按词缀的 elite 加成提升精英敌人权重；≤60 波加成恒为 0，权重逐字节不变。
    const eliteWeightMul = 1 + affixEliteBoost;
    while (chosen.length < wanted && pool.length) {
      const pick = rng.weighted(pool, (e) =>
        e.weight * (ENDLESS_ELITE_ENEMIES.has(e.type) ? eliteWeightMul : 1)
      );
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
        hpMul: groupHpMul,
      });
    });
  }

  // 无尽 60 波后：首领波随行小怪也吃词缀血量，避免「首领被抬升、小怪仍按基线」的断层。
  // ≤60 波无词缀，不进入此分支，群组结构与血量逐字节不变。
  if (endlessAffix) {
    for (const group of groups) {
      if (group.type !== 'boss') group.hpMul = groupHpMul;
    }
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

  const rewardIndex = endless ? Math.min(index, ENDLESS.rewardCapWave) : index;
  const reward = Math.round(
    (BALANCE.waveRewardBase + rewardIndex * BALANCE.waveRewardPerWave) * affixGoldMul
  );

  return {
    index,
    difficulty: diff.id,
    groups,
    hpMul: round3(hpMul),
    speedMul: round3(speedMul),
    countMul: diff.countMul,
    reward,
    boss: isBoss,
    bossVariant,
    finalBoss: isFinal,
    totalCount,
    portals: activePortals,
    modifierId: modifier?.id || null,
    ...(endless ? { endless: true } : {}),
    ...(chapters ? { chapterId: chapter?.id ?? null } : {}),
    ...(bossAffixes ? { bossAffixes, bossAffixText } : {}),
    ...(endlessCycle > 0 ? { endlessCycle } : {}),
    ...(endlessAffix ? { endlessAffixes: endlessAffix.stacks, endlessAffixText: endlessAffix.text } : {}),
    ...(cycleBoss ? { cycleBoss: true, bossCycle } : {}),
    label: isFinal
      ? '最终首领'
      : isBoss
        ? (bossAffixes ? `深渊首领·${bossAffixText}` : '首领波次') +
          (cycleBoss ? `·循环${bossCycle}` : '')
        : endlessAffix?.text
          ? `第 ${index} 波 · ${endlessAffix.text}`
          : `第 ${index} 波`,
  };
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}
