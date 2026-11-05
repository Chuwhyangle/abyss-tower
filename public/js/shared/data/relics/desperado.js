// 遗物：亡命之徒（普通）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'desperado',
  faction: 'warden',
  name: '亡命之徒',
  rarity: 'common',
  set: 'reserve',
  desc: '基地生命低于 40% 时全体伤害 +10%',
  mods: {
    lowHpDmg: 0.1
  }
};
