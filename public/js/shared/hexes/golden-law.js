// 主海克斯：黄金律法。HEX-001 只登记数据与 no-op 钩子，数值由 HEX-007 填充。
const hooks = Object.freeze({
  // 开局初始化：HEX-007 增加开局金币。
  onRunInit() {},
  // 击杀结算：HEX-007 提高击杀金币倍率。
  onEnemyKilled(enemy, ctx) {},
  // 波次结束：HEX-007 按当前金币征收 15%。
  onWaveEnd(wave, ctx) {},
  // 出售返还比例：HEX-007 返回 0.35。
  sellRatio(base) {
    return base;
  },
  // 遗物刷新费用：HEX-007 返回半价。
  relicRerollCost(base, count) {
    return base;
  },
});

export default Object.freeze({
  id: 'golden_law',
  name: '黄金律法',
  glyph: '⚖',
  color: '#facc15',
  tags: Object.freeze(['经济', '运营']),
  pitch: '开局 +250 金、击杀金币 +45%',
  desc: '开局 +250 金、击杀金币 +45%，但每波结束烧掉 15% 金币，卖塔只返 35%。',
  downside: '每波结束烧掉 15% 金币，卖塔只返 35%',
  scoreMul: 1.10,
  hooks,
  implemented: false,
});
