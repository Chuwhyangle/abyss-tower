// 主海克斯：独塔为王。全场仅 1 座塔，但这座塔可升到 10 级。
// 数值：建造费 ×0.70；基础 3 级之后额外 7 次升级（120/180/260/360/480/620/800，受遗物 costMul 影响）；
// 第 4 级起每级伤害 +12%、射程 +7%、攻速 +6%、溅射 +6%（与基础等级、已选进化乘算）。
// 三条进化拆到 3/6/9 级逐级三选一（选完三条到 9 级）；10 级解锁该塔独属的被动触发大招。
import { TOWERS } from '../data.js';

const MAX_LEVEL = 10;
const BUILD_COST_MUL = 0.7;
// 4→10 级共 7 次额外升级的费用；模拟层随后统一套用 costMul 与下限。
const EXTRA_UPGRADE_COSTS = Object.freeze([120, 180, 260, 360, 480, 620, 800]);
// 每级额外成长：与基础等级、已选进化系数依次相乘。
// 溅射成长只对带 splash 的塔（炮台/震荡）生效，其余塔 splash 为 0、乘成长仍为 0。
const LEVEL_GROWTH = Object.freeze({ dmg: 0.12, range: 0.07, rate: 0.06, splash: 0.06 });

// 进化选择等级（0 起索引）：3 / 6 / 9 级各三选一一条，选完三条到 9 级。
const EVOLUTION_TIERS = Object.freeze([2, 5, 8]);
// 大招解锁等级 = 10 级（索引 9）。
const ULTIMATE_LEVEL = MAX_LEVEL - 1;
// 覆盖脉冲解锁等级 = 4 级（索引 3，第一条进化之后）：非 AOE 塔靠它提前获得「同时命中数」，
// 否则单塔在前中期漏怪、攒不到钱、到不了 10 级（feat-one-tower-balance 的覆盖极化根因）。
// 常驻 passive 仍只在大招 10 级解锁，脉冲覆盖单独提前，保证身份与强度节奏分离。
const PULSE_UNLOCK_LEVEL = 3;

// 每塔大招（docs/TODO.md TODO-3 七塔大招草案，数值为草案，待 balance 调优）。
// 结构：every = 每 N 次攻击触发一次（确定性计数器，不耗 RNG）；
// passive = 10 级常驻特性（由 modifyTowerStats 落到最终塔属性）；
// pulse = 触发当次「大招覆盖脉冲」：全图按 progress 降序 / id 升序取前 K 名敌人，
//   用该塔自己的武器签名结算（非 RNG 路径，不改 sim.js 确定性）；
//   电弧（连锁）与炮台（全图）不接入脉冲，保持身份不稀释；
// 其余键 = 触发大招的规格（由 projectile-system / combat-system 按塔型消费）。
const ULTIMATES = Object.freeze({
  cannon: Object.freeze({
    every: 4,
    fullMap: true,
    // 余波：轰击命中后在目标点对半径内敌人造成二次范围伤害（不参与暴击判定，确定性触发）。
    aftershock: Object.freeze({ radius: 1.6, damageMul: 0.6 }),
  }),
  // 弩塔「连珠齐射」：攻速 +20%；每 3 发全图取前 6 名各 180% 伤害且必暴击。
  arrow: Object.freeze({
    every: 3,
    passive: Object.freeze({ rate: 1.2 }),
    pulse: Object.freeze({ topK: 6, damageMul: 1.8, crit: true }),
  }),
  // 霜塔「寒潮」：减速 +20%；每 3 发全图取前 8 名各吃 320% 寒霜伤害并冻结 0.8 秒（首领减半）。
  frost: Object.freeze({
    every: 3,
    passive: Object.freeze({ slow: 1.2 }),
    pulse: Object.freeze({ topK: 8, damageMul: 3.2, freeze: Object.freeze({ duration: 0.8, bossDuration: 0.4 }) }),
  }),
  // 电弧塔「天罚雷暴」：连锁 +1、跳转 +0.6 格、伤害 ×0.8（独塔连锁略强，轻回调）；每 5 发本次连锁必暴击且跳转 +1.2 格。
  arc: Object.freeze({
    every: 5,
    passive: Object.freeze({ chain: 1, chainRange: 0.6, dmg: 0.8 }),
    chainCrit: true,
    chainRangeBonus: 1.2,
  }),
  // 毒雾塔「疫爆」：毒伤 +30%；每 3 发全图取前 8 名直击 250% 伤害并即时结算当前毒伤（无视护甲）并 1.5 格传播毒。
  poison: Object.freeze({
    every: 3,
    passive: Object.freeze({ dot: 1.3 }),
    pulse: Object.freeze({ topK: 8, damageMul: 2.5, detonate: true }),
    spread: Object.freeze({ radius: 1.5 }),
  }),
  // 战旗「御驾亲征」：光环强化 + 获得自攻（军令箭，复用 bolt 并吃自己光环与等级成长）；
  // 每 3 发全图取前 8 名号令齐射（270%）+ 全塔攻速 +40%（surge，短暂窗口）。
  banner: Object.freeze({
    every: 3,
    passive: Object.freeze({
      buffDmg: 1.5,
      buffRate: 1.5,
      selfAttack: Object.freeze({ dmg: 65, rate: 1.2 }),
    }),
    pulse: Object.freeze({ topK: 8, damageMul: 2.7 }),
    surgeRate: 0.4,
    surgeDuration: 3,
  }),
  // 震荡塔「地裂震啸」：每 3 发以最深入敌人为圆心 8 格震啸（300% 溅射 + 击退 + 减速）。
  // 击退由脉冲 knockbackMul 提供（软锁修复后基础击退不叠加，避免独塔把首领越推越慢）。
  shock: Object.freeze({
    every: 3,
    passive: Object.freeze({ knockback: 1.0 }),
    pulse: Object.freeze({ radius: 8, damageMul: 3.0, knockbackMul: 1.2, slowBonus: 0.1 }),
  }),
  // 狙击塔「夺命收割」：射程 +15%、处决线（对 <30% 血 +40%）；
  // 每 2 发全图取前 6 名处决：260% + 最大生命 6%（首领 2%）。
  sniper: Object.freeze({
    every: 2,
    passive: Object.freeze({
      range: 1.15,
      execute: Object.freeze({ threshold: 0.3, damageMul: 0.4 }),
    }),
    pulse: Object.freeze({ topK: 6, damageMul: 2.6, hpPct: 0.06, bossPct: 0.02 }),
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

// 战旗质变：纯支援塔在独塔模式空转，从建造起即获得自身攻击（军令箭，否则杀不了怪、
// 攒不到钱、到不了 10 级——feat-one-tower-balance 的 manager 裁定 #1）。
// 军令箭基础伤害/攻速吃等级成长（不再用 45 硬覆盖掉等级化 dmg）。
// 与 10 级大招 passive 分离：其余常驻特性仍只在 10 级解锁。
function applySelfAttack(tower, out, growth) {
  const p = ULTIMATES[tower.type]?.passive?.selfAttack;
  if (!p) return;
  out.selfAttack = true;
  out.dmg = p.dmg * (growth?.dmg ?? 1);
  out.rate = p.rate * (growth?.rate ?? 1);
}

// 10 级常驻特性：大招规格的 passive 块落到最终塔属性上。
// 大多只是既有属性的乘法/加法改写；狙击「处决线」需要额外字段，
// 由 combat-system（executeThreshold/executeMul）读取。
// growth 为额外等级的成长乘数（无额外等级时全 1）。
function applyUltimatePassive(tower, out, ctx, growth) {
  const spec = ULTIMATES[tower.type];
  const p = spec?.passive;
  if (!p) return;
  if (p.rate) out.rate *= p.rate;
  if (p.range) out.range *= p.range;
  if (p.dmg) out.dmg *= p.dmg;
  if (p.slow) out.slow *= p.slow;
  if (p.dot) out.dot *= p.dot;
  if (p.knockback) out.knockback *= p.knockback;
  if (p.chain) out.chain = (out.chain || 0) + p.chain;
  if (p.chainRange) out.chainRange = (TOWERS[tower.type]?.chainRange || 0) + p.chainRange;
  if (p.buffDmg) out.buffDmg *= p.buffDmg;
  if (p.buffRate) out.buffRate *= p.buffRate;
  // 战旗号令齐射的攻速 surge：窗口内攻速 ×(1+surgeRate)，到期由 tower-system 清掉并刷新缓存。
  if (spec.surgeRate && ctx?.sim && tower.bannerSurgeUntil > ctx.sim.time) {
    out.rate *= 1 + spec.surgeRate;
  }
  // 狙击处决线：对生命低于阈值的敌人伤害 +mul（combat-system 的 computeHit 读取）。
  if (p.execute) {
    out.executeThreshold = p.execute.threshold;
    out.executeMul = p.execute.damageMul;
  }
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
  // 大招规格：覆盖脉冲塔 4 级提前解锁（PULSE_UNLOCK_LEVEL），电弧/炮台（无 pulse）仍守 10 级大招。
  // 提前解锁只让 fire 路径消费 pulse/chainCrit 等触发键；常驻 passive 仍由
  // modifyTowerStats 按 isUltimateLevel(10 级) 门控，二者节奏分离。
  ultimateSpec(tower) {
    const spec = ULTIMATES[tower.type] || null;
    if (!spec) return null;
    if (spec.pulse) {
      if (tower.level < PULSE_UNLOCK_LEVEL) return null;
    } else if (!isUltimateLevel(tower)) {
      return null;
    }
    return spec;
  },
  // 按额外等级追加成长；进化系数由模拟层按已选 evolutions 应用，这里不再兜底补乘。
  // 10 级大招的「全图索敌」写进 stats.fullMap：射程数值保持有限（渲染层照常画射程圈），
  // 模拟层索敌按 fullMap 放宽到全图。常驻特性随后叠加在大招 passive 块上。
  modifyTowerStats(tower, stats, ctx) {
    const extra = extraTiers(tower);
    const out = { ...stats };
    const growth = { dmg: 1, range: 1, rate: 1, splash: 1 };
    if (extra > 0) {
      growth.dmg = (1 + LEVEL_GROWTH.dmg) ** extra;
      growth.range = (1 + LEVEL_GROWTH.range) ** extra;
      growth.rate = (1 + LEVEL_GROWTH.rate) ** extra;
      growth.splash = (1 + LEVEL_GROWTH.splash) ** extra;
      out.dmg = stats.dmg * growth.dmg;
      out.range = stats.range * growth.range;
      out.rate = stats.rate * growth.rate;
      out.splash = stats.splash * growth.splash;
    }
    applySelfAttack(tower, out, growth);
    if (ULTIMATES[tower.type]?.fullMap && isUltimateLevel(tower)) out.fullMap = true;
    if (isUltimateLevel(tower)) applyUltimatePassive(tower, out, ctx, growth);
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
