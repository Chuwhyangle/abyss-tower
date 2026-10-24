// 主海克斯：虫群战术。铺满全场的廉价小塔，用数量与攻速替代单塔强度。
// 数值：建造/升级费 ×0.45、攻速 ×1.15、单塔伤害 ×0.60、射程 ×0.85；不新增塔数上限。
// 造价走 HEX-005 的 `buildCost` 钩子而不是遗物 costMul：costMul 是「加价系数」且受
// EFFECT_REGISTRY 封顶 -0.2、与遗物加法叠加，无法表达 0.45 的乘法折扣；
// 钩子返回数据表原价的 45%，模拟层再统一套遗物 costMul 与 Math.max(20, ...) 下限。
// 升级费同样经 `upgradeCost` 钩子同步打折（到手价 = 表价 ×0.45 ×(1+costMul)，下限 10）。
// 不影响出售返还比例、遗物与技能，也不改塔数上限（沿用现有规则）。

const BUILD_COST_MUL = 0.45;
const UPGRADE_COST_MUL = 0.45;

// 单塔属性系数：伤害 -40%、射程 -15%、攻速 +15%（乘在 computeTowerStats 的最终属性上）。
const STAT_MUL = Object.freeze({ dmg: 0.6, rate: 1.15, range: 0.85 });

// 只改数值型属性：形状不全的入参（注册表契约单测/工具直调）原样返回，避免 NaN 进模拟层。
function scaleStats(stats) {
  if (!stats) return stats;
  const next = { ...stats };
  for (const key of Object.keys(STAT_MUL)) {
    const value = next[key];
    if (!Number.isFinite(value)) return stats;
    next[key] = value * STAT_MUL[key];
  }
  return next;
}

const hooks = Object.freeze({
  // 建造费 ×0.45（模拟层随后统一套用遗物 costMul 与 Math.max(20, ...) 下限）。
  buildCost(type, base) {
    return base * BUILD_COST_MUL;
  },
  // 升级费同步 ×0.45；扩展等级（base 为 null，由别的海克斯提供）不参与本折扣。
  upgradeCost(tower, base) {
    if (base == null) return base;
    return base * UPGRADE_COST_MUL;
  },
  // 塔属性重算末尾调用：单塔更弱、更短，靠攻速与数量取胜。
  modifyTowerStats(tower, stats, ctx) {
    return scaleStats(stats);
  },
});

export default Object.freeze({
  id: 'swarm',
  name: '虫群战术',
  glyph: '🐜',
  color: '#84cc16',
  tags: Object.freeze(['铺场', '攻速']),
  pitch: '塔便宜 55%、攻速 +15%',
  desc: '塔便宜 55%、攻速 +15%，但单塔伤害 -40%、射程 -15%。',
  downside: '单塔伤害 -40%、射程 -15%',
  scoreMul: 1.05,
  hooks,
  implemented: true,
});
