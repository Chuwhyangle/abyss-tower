// 遗物：旷野火力（普通）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'openfield',
  faction: 'warden',
  name: '旷野火力',
  rarity: 'common',
  set: 'reserve',
  desc: '可建造空位 ≥ 8 时全体伤害 +8%',
  mods: {
    emptySlotDmg: 0.08
  }
};
