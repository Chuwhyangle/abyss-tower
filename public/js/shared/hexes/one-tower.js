// 主海克斯：独塔为王。全场仅 1 座塔，但这座塔可升到 10 级并兼得全部三条进化。
// 数值：建造费 ×0.70；基础 3 级之后额外 7 次升级（120/180/260/360/480/620/800，受遗物 costMul 影响）；
// 第 4 级起每级伤害 +12%、射程 +4%、攻速 +6%（与基础等级、进化乘算）。
import { TOWERS } from '../data.js';

const MAX_LEVEL = 10;
const BUILD_COST_MUL = 0.7;
// 4→10 级共 7 次额外升级的费用；模拟层随后统一套用 costMul 与下限。
const EXTRA_UPGRADE_COSTS = Object.freeze([120, 180, 260, 360, 480, 620, 800]);
// 每级额外成长：与基础等级、进化系数依次相乘。
const LEVEL_GROWTH = Object.freeze({ dmg: 0.12, range: 0.04, rate: 0.06 });

function baseLevelCount(tower) {
  return TOWERS[tower.type]?.levels?.length || 1;
}

// tower.level 是 0 起的等级索引：基础等级之上的每一级算一次额外成长。
function extraTiers(tower) {
  return Math.max(0, tower.level - (baseLevelCount(tower) - 1));
}

function isMaxLevel(tower) {
  return tower.level >= MAX_LEVEL - 1;
}

function evolutionEntries(tower) {
  return TOWERS[tower.type]?.evolutions || [];
}

// 已记入塔上的进化：evolutions 是完整列表，evolution 仅为旧字段兼容。
function appliedEvolutionIds(tower) {
  if (Array.isArray(tower.evolutions)) return tower.evolutions.filter((id) => typeof id === 'string');
  if (typeof tower.evolution === 'string') return [tower.evolution];
  return [];
}

// 满级自动兼得三条进化：模拟层只按 tower.evolutions 应用系数，
// 因此这里只补乘「尚未记入」的分支，已选分支不会重复乘算。
function missingEvolutionMul(tower) {
  const applied = new Set(appliedEvolutionIds(tower));
  const mul = { dmg: 1, range: 1, rate: 1 };
  for (const entry of evolutionEntries(tower)) {
    if (applied.has(entry.id)) continue;
    for (const key of Object.keys(mul)) {
      mul[key] *= entry.mods?.[key] ?? 1;
    }
  }
  return mul;
}

const hooks = Object.freeze({
  // 建造：全场只允许 1 座塔。以模拟层的 towers 为准（读档重建的塔同样计入）。
  canBuild(type, c, r, ctx) {
    const sim = ctx?.sim;
    if (!sim || !Array.isArray(sim.towers)) return true;
    return sim.towers.length === 0;
  },
  // 建造费 ×0.70（模拟层随后统一套用遗物 costMul 与下限）。
  buildCost(type, base) {
    return base * BUILD_COST_MUL;
  },
  // 等级上限：基础 3 级 + 7 次额外升级 = 10。
  towerMaxLevel(tower, base) {
    return Math.max(base, MAX_LEVEL);
  },
  // 升级费用：数据表内沿用表价；扩展等级按 7 次曲线给价，到顶返回 null。
  upgradeCost(tower, base) {
    if (base != null) return base;
    const index = tower.level + 1 - baseLevelCount(tower);
    if (index < 0 || index >= EXTRA_UPGRADE_COSTS.length) return null;
    return EXTRA_UPGRADE_COSTS[index];
  },
  // 满级时三条进化都允许（正常流程在 onTowerUpgraded 已自动全部记入，这里保留兜底）。
  allowedEvolutions(tower, base) {
    return base;
  },
  // 升到 10 级的那一刻自动兼得全部进化，后续 canEvolve 为 false，不再弹三选一。
  onTowerUpgraded(tower) {
    if (!isMaxLevel(tower)) return;
    const ids = evolutionEntries(tower).map((entry) => entry.id);
    if (!ids.length) return;
    tower.evolutions = ids;
    tower.evolution = ids[0];
  },
  // 按额外等级追加成长；满级时补上未记入的进化系数（读档/预览等未走升级钩子的路径）。
  modifyTowerStats(tower, stats, ctx) {
    const extra = extraTiers(tower);
    if (extra <= 0) return stats;
    const growth = {
      dmg: (1 + LEVEL_GROWTH.dmg) ** extra,
      range: (1 + LEVEL_GROWTH.range) ** extra,
      rate: (1 + LEVEL_GROWTH.rate) ** extra,
    };
    const evo = isMaxLevel(tower) ? missingEvolutionMul(tower) : { dmg: 1, range: 1, rate: 1 };
    return {
      ...stats,
      dmg: stats.dmg * growth.dmg * evo.dmg,
      range: stats.range * growth.range * evo.range,
      rate: stats.rate * growth.rate * evo.rate,
    };
  },
});

export default Object.freeze({
  id: 'one_tower',
  name: '独塔为王',
  glyph: '🗼',
  color: '#c084fc',
  tags: Object.freeze(['成长', '精铺']),
  pitch: '单塔升至 10 级并兼得全部进化',
  desc: '只能建 1 座塔，但它能升到 10 级并兼得全部进化。',
  downside: '全场只能建 1 座塔',
  scoreMul: 1.20,
  hooks,
  implemented: true,
});
