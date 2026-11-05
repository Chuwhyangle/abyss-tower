// 遗物：血潮契约（史诗）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'bloodtide',
  faction: 'warden',
  name: '血潮契约',
  rarity: 'epic',
  desc: '基地生命低于 40% 时全体伤害 +30%，每次击杀额外获得 2 金币',
  mods: {
    lowHpDmg: 0.3,
    killGold: 2
  }
};
