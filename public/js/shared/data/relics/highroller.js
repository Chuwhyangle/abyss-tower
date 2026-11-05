// 遗物：孤注一掷（普通）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'highroller',
  faction: 'neutral',
  name: '孤注一掷',
  rarity: 'common',
  set: 'gambit',
  desc: '基地生命低于 40% 时全体伤害 +6%，每次击杀额外获得 1 金币',
  mods: {
    lowHpDmg: 0.06,
    killGold: 1
  }
};
