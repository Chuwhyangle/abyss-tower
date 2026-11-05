// 遗物：战争金库（稀有）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'warchest',
  faction: 'neutral',
  name: '战争金库',
  rarity: 'rare',
  set: 'reserve',
  desc: '金币 ≥ 400 时全体伤害 +13%',
  mods: {
    richDmg: 0.13
  }
};
