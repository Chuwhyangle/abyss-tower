// 遗物：备用零件（普通）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'spareparts',
  faction: 'neutral',
  name: '备用零件',
  rarity: 'common',
  set: 'guild',
  desc: '建造与升级费用 -5%，每次击杀额外获得 1 金币',
  mods: {
    costMul: -0.05,
    killGold: 1
  }
};
