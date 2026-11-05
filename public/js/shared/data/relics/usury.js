// 遗物：利滚利（稀有）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'usury',
  faction: 'neutral',
  name: '利滚利',
  rarity: 'rare',
  set: 'guild',
  desc: '每波结束获得当前金币 5% 的利息',
  mods: {
    interest: 0.05
  }
};
