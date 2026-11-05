// 遗物：血脉赌注（普通）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'bloodstake',
  faction: 'warden',
  name: '血脉赌注',
  rarity: 'common',
  set: 'gambit',
  desc: '基地生命低于 40% 时全体伤害 +8%',
  mods: {
    lowHpDmg: 0.08
  }
};
