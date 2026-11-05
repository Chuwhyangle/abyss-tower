// 遗物：血色战旗（稀有）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'bloodybanner',
  faction: 'warden',
  name: '血色战旗',
  rarity: 'rare',
  desc: '基地生命低于 40% 时全体伤害 +17%',
  mods: {
    lowHpDmg: 0.17
  }
};
