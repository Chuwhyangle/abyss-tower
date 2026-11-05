// 遗物：殉道誓约（稀有）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'martyr',
  faction: 'warden',
  name: '殉道誓约',
  rarity: 'rare',
  set: 'gambit',
  desc: '基地生命低于 40% 时全体伤害 +12%，暴击率 +6%',
  mods: {
    lowHpDmg: 0.12,
    crit: 0.06
  }
};
