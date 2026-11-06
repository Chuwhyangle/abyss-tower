// 遗物：肾上腺素（稀有）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'adrenaline',
  faction: 'storm',
  name: '肾上腺素',
  rarity: 'rare',
  set: 'gambit',
  desc: '攻击速度 +10%，基地生命低于 40% 时全体伤害 +10%',
  mods: {
    fireRate: 0.1,
    lowHpDmg: 0.1
  }
};
