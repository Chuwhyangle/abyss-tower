// 主海克斯：虫群战术。HEX-001 只登记数据与 no-op 钩子，数值由 HEX-006 填充。
const hooks = Object.freeze({
  // 开局初始化：HEX-006 写入建造成本折扣。
  onRunInit() {},
  // 塔属性重算末尾调用：HEX-006 调整伤害/攻速/射程。
  modifyTowerStats(tower, stats, ctx) {
    return stats;
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
  implemented: false,
});
