// 主海克斯：熔火核心。HEX-001 只登记数据与 no-op 钩子，数值由 HEX-010 填充。
const hooks = Object.freeze({
  // 塔属性重算末尾调用：HEX-010 降低攻速。
  modifyTowerStats(tower, stats, ctx) {
    return stats;
  },
  // 命中结算：HEX-010 写入灼烧状态。
  onHit(enemy, tower, damage, ctx) {},
});

export default Object.freeze({
  id: 'molten_core',
  name: '熔火核心',
  glyph: '🔥',
  color: '#fb923c',
  tags: Object.freeze(['持续伤害', '长线']),
  pitch: '攻击附带灼烧',
  desc: '攻击附带灼烧，但攻击间隔 +25%。',
  downside: '攻击间隔 +25%',
  scoreMul: 1.05,
  hooks,
  implemented: false,
});
