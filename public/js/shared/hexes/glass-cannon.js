// 主海克斯：玻璃大炮。HEX-001 只登记数据与 no-op 钩子，数值由 HEX-004 填充。
const hooks = Object.freeze({
  // 开局初始化：HEX-004 写入伤害/攻速 mod 与塔生命上限。
  onRunInit() {},
  // 塔属性重算末尾调用：原样返回 stats 表示当前无效果。
  modifyTowerStats(tower, stats, ctx) {
    return stats;
  },
  // 漏怪：HEX-004 对漏怪 lane 上最近的塔造成伤害。
  onLeak(enemy, ctx) {},
});

export default Object.freeze({
  id: 'glass_cannon',
  name: '玻璃大炮',
  glyph: '💥',
  color: '#ff5a5f',
  tags: Object.freeze(['输出', '高风险']),
  pitch: '全塔伤害 +70%',
  desc: '塔伤害 +70%，但每座塔只有 5 点生命且无法提升；漏怪会伤塔。',
  downside: '每座塔只有 5 点生命且无法提升，漏怪会伤塔',
  scoreMul: 1.15,
  hooks,
  implemented: false,
});
