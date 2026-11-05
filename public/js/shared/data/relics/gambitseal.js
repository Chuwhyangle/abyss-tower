// 遗物：赌誓封印（普通）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'gambitseal',
  faction: 'warden',
  name: '赌誓封印',
  rarity: 'common',
  set: 'gambit',
  desc: '基地生命低于 40% 时全体伤害 +9%',
  mods: {
    lowHpDmg: 0.09
  }
};
