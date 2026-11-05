// 遗物：鼓胀钱袋（普通）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'coinpurse',
  faction: 'neutral',
  name: '鼓胀钱袋',
  rarity: 'common',
  set: 'guild',
  desc: '每次击杀额外获得 1 金币',
  mods: {
    killGold: 1
  }
};
