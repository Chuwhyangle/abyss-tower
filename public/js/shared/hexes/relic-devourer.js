// 主海克斯：遗物吞噬者。HEX-001 只登记数据与 no-op 钩子，数值由 HEX-008 填充。
const hooks = Object.freeze({
  // 开局初始化：HEX-008 提高基地生命上限。
  onRunInit() {},
  // 获得遗物：HEX-008 扣减基地生命上限并 clamp 当前生命。
  onRelicGained(relic, ctx) {},
  // 遗物候选数量：HEX-008 返回 4。
  relicOfferCount(base) {
    return base;
  },
  // 遗物刷新费用：HEX-008 返回 0（免费）。
  relicRerollCost(base, count) {
    return base;
  },
  // 遗物刷新次数加成：HEX-008 返回 base + 2。
  relicRerollBonus(base) {
    return base;
  },
});

export default Object.freeze({
  id: 'relic_devourer',
  name: '遗物吞噬者',
  glyph: '🕳',
  color: '#a855f7',
  tags: Object.freeze(['遗物', '贪婪']),
  pitch: '遗物四选一、刷新免费 +2 次',
  desc: '遗物四选一、刷新免费 +2 次，但每拿一件遗物基地生命上限 -1。',
  downside: '每拿一件遗物基地生命上限 -1',
  scoreMul: 1.10,
  hooks,
  implemented: false,
});
