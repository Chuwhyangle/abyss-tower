// 主海克斯：独塔为王。HEX-001 只登记数据与 no-op 钩子，数值由 HEX-005 填充。
const hooks = Object.freeze({
  // 建造校验：HEX-005 限制全场最多 1 座塔。
  canBuild(type, c, r, ctx) {
    return true;
  },
  // 等级上限：HEX-005 返回 10。
  towerMaxLevel(tower, base) {
    return base;
  },
  // 升级费用：HEX-005 提供扩展等级曲线。
  upgradeCost(tower, base) {
    return base;
  },
  // 可用进化：HEX-005 在满级时返回全部三条进化。
  allowedEvolutions(tower, base) {
    return base;
  },
  // 塔属性重算末尾调用：HEX-005 按额外等级追加属性。
  modifyTowerStats(tower, stats, ctx) {
    return stats;
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
  implemented: false,
});
