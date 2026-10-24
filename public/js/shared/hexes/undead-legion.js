// 主海克斯：亡者军团。HEX-001 只登记数据与 no-op 钩子，数值由 HEX-009 填充。
const hooks = Object.freeze({
  // 击杀结算：HEX-009 按概率召唤骷髅并压低击杀金币。
  onEnemyKilled(enemy, ctx) {},
});

export default Object.freeze({
  id: 'undead_legion',
  name: '亡者军团',
  glyph: '💀',
  color: '#22d3ee',
  tags: Object.freeze(['召唤', '滚雪球']),
  pitch: '击杀有 20% 概率召唤骷髅',
  desc: '击杀有 20% 概率召唤骷髅，但击杀金币 -55%。',
  downside: '击杀金币 -55%',
  scoreMul: 1.15,
  hooks,
  implemented: false,
});
