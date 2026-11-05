// 遗物：背水一战（史诗）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'laststand',
  faction: 'warden',
  name: '背水一战',
  rarity: 'epic',
  desc: '基地生命低于 40% 时，全体伤害 +35%',
  mods: {
    lowHpDmg: 0.35
  }
};
