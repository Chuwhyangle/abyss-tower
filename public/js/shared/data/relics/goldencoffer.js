// 遗物：黄金宝库（普通）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'goldencoffer',
  faction: 'neutral',
  name: '黄金宝库',
  rarity: 'common',
  set: 'reserve',
  desc: '金币 ≥ 400 时全体伤害 +7%',
  mods: {
    richDmg: 0.07
  }
};
