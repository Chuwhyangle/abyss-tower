// 遗物：血色财富（稀有）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'bloodmoney',
  faction: 'neutral',
  name: '血色财富',
  rarity: 'rare',
  desc: '基地生命低于 40% 时全体伤害 +10%，金币 ≥ 400 时全体伤害 +10%',
  mods: {
    lowHpDmg: 0.1,
    richDmg: 0.1
  }
};
