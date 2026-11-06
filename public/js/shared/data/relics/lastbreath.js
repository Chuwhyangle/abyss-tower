// 遗物：残喘之息（稀有）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'lastbreath',
  faction: 'warden',
  name: '残喘之息',
  rarity: 'rare',
  desc: '基地生命低于 40% 时全体伤害 +16%',
  mods: {
    lowHpDmg: 0.16
  }
};
