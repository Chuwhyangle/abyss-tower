// 遗物：血誓木牌（普通）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'bloodpact',
  faction: 'warden',
  name: '血誓木牌',
  rarity: 'common',
  desc: '基地生命低于 40% 时全体伤害 +12%，暴击率 +5%',
  mods: {
    lowHpDmg: 0.12,
    crit: 0.05
  }
};
