// 遗物：末日时钟（史诗）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'doomclock',
  faction: 'warden',
  name: '末日时钟',
  rarity: 'epic',
  set: 'gambit',
  desc: '基地生命低于 40% 时全体伤害 +20%，暴击率 +10%',
  mods: {
    lowHpDmg: 0.2,
    crit: 0.1
  }
};
