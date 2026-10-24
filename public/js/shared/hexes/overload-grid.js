// 主海克斯：过载电网。HEX-001 只登记数据与 no-op 钩子，数值由 HEX-013 填充。
const hooks = Object.freeze({
  // 塔属性重算末尾调用：HEX-013 按 4 邻接数量加成攻速/伤害并降低射程。
  modifyTowerStats(tower, stats, ctx) {
    return stats;
  },
});

export default Object.freeze({
  id: 'overload_grid',
  name: '过载电网',
  glyph: '⚡',
  color: '#eab308',
  tags: Object.freeze(['邻接', '阵型']),
  pitch: '相邻塔提供攻速/伤害加成',
  desc: '相邻塔提供攻速/伤害加成，但射程 -20%。',
  downside: '射程 -20%',
  scoreMul: 1.05,
  hooks,
  implemented: false,
});
