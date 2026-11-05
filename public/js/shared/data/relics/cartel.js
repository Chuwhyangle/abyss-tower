// 遗物：黑市商会（稀有）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'cartel',
  faction: 'neutral',
  name: '黑市商会',
  rarity: 'rare',
  set: 'guild',
  desc: '所有金币收入 +15%，建造与升级费用 -5%',
  mods: {
    goldMul: 0.15,
    costMul: -0.05
  }
};
