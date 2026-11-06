// 遗物：空庭守卫（史诗）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'palaceguard',
  faction: 'warden',
  name: '空庭守卫',
  rarity: 'epic',
  desc: '可建造空位 ≥ 8 时全体伤害 +24%',
  mods: {
    emptySlotDmg: 0.24
  }
};
