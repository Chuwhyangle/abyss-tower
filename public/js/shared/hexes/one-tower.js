// 主海克斯：独塔为王。全场仅 1 座塔，但这座塔可升到 10 级。
// 数值：建造费 ×0.70；基础 3 级之后额外 7 次升级（120/180/260/360/480/620/800，受遗物 costMul 影响）；
// 第 4 级起每级伤害 +12%、射程 +4%、攻速 +6%（与基础等级、已选进化乘算）。
// 三条进化拆到 3/6/9 级逐级三选一（选完三条到 9 级）；10 级解锁该塔独属的被动触发大招。
import { TOWERS } from '../data.js';

const MAX_LEVEL = 10;
const BUILD_COST_MUL = 0.7;
// 4→10 级共 7 次额外升级的费用；模拟层随后统一套用 costMul 与下限。
const EXTRA_UPGRADE_COSTS = Object.freeze([120, 180, 260, 360, 480, 620, 800]);
// 每级额外成长：与基础等级、已选进化系数依次相乘。
const LEVEL_GROWTH = Object.freeze({ dmg: 0.12, range: 0.04, rate: 0.06 });

// 进化选择等级（0 起索引）：3 / 6 / 9 级各三选一一条，选完三条到 9 级。
const EVOLUTION_TIERS = Object.freeze([2, 5, 8]);
// 大招解锁等级 = 10 级（索引 9）。
const ULTIMATE_LEVEL = MAX_LEVEL - 1;

// 每塔大招：本任务先落地炮台参考实现（全图索敌 + 每 4 下轰击带余波），
// 其余 7 塔大招由后续任务填（草案表见 docs/TODO.md TODO-3）。数值为草案，待 balance 调优。
const ULTIMATES = Object.freeze({
  cannon: Object.freeze({
    every: 4,
    fullMap: true,
    // 余波：轰击命中后在目标点对半径内敌人造成二次范围伤害（不参与暴击判定，确定性触发）。
    aftershock: Object.freeze({ radius: 1.6, damageMul: 0.6 }),
  }),
});

function baseLevelCount(tower) {
  return TOWERS[tower.type]?.levels?.length || 1;
}

// tower.level 是 0 起的等级索引：基础等级之上的每一级算一次额外成长。
function extraTiers(tower) {
  return Math.max(0, tower.level - (baseLevelCount(tower) - 1));
}

function isUltimateLevel(tower) {
  return tower.level >= ULTIMATE_LEVEL;
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

// 按已到达的 3/6/9 级层数确定该选了几条（上限为进化总数，即 3）。
function targetEvolutionCount(tower) {
  const tiers = EVOLUTION_TIERS.filter((level) => tower.level >= level).length;
  return Math.min(tiers, evolutionEntries(tower).length);
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
  // 3/6/9 逐级选：只要已选数量还没到「当前等级应选」的数量，就仍可进入三选一。
  canEvolve(tower, base) {
    return appliedEvolutionIds(tower).length < targetEvolutionCount(tower);
  },
  // 三选一选项 = 尚未选过的进化；到达更高层数时补弹剩余项。
  allowedEvolutions(tower, base) {
    const applied = new Set(appliedEvolutionIds(tower));
    return base.filter((entry) => !applied.has(entry.id));
  },
  // 大招规格：10 级解锁；未定义大招的塔返回 null（仅靠逐级进化，无被动大招）。
  ultimateSpec(tower) {
    if (!isUltimateLevel(tower)) return null;
    return ULTIMATES[tower.type] || null;
  },
  // 按额外等级追加成长；进化系数由模拟层按已选 evolutions 应用，这里不再兜底补乘。
  // 10 级大招的「全图索敌」写进 stats.fullMap：射程数值保持有限（渲染层照常画射程圈），
  // 模拟层索敌按 fullMap 放宽到全图。
  modifyTowerStats(tower, stats, ctx) {
    const extra = extraTiers(tower);
    const out = { ...stats };
    if (extra > 0) {
      const growth = {
        dmg: (1 + LEVEL_GROWTH.dmg) ** extra,
        range: (1 + LEVEL_GROWTH.range) ** extra,
        rate: (1 + LEVEL_GROWTH.rate) ** extra,
      };
      out.dmg = stats.dmg * growth.dmg;
      out.range = stats.range * growth.range;
      out.rate = stats.rate * growth.rate;
    }
    if (ULTIMATES[tower.type]?.fullMap && isUltimateLevel(tower)) out.fullMap = true;
    return out;
  },
});

export default Object.freeze({
  id: 'one_tower',
  name: '独塔为王',
  glyph: '🗼',
  color: '#c084fc',
  tags: Object.freeze(['成长', '精铺']),
  pitch: '单塔升至 10 级，逐级选进化并解锁大招',
  desc: '只能建 1 座塔，但它能升到 10 级，逐级选进化并解锁独属大招。',
  downside: '全场只能建 1 座塔',
  scoreMul: 1.20,
  hooks,
  implemented: true,
});
