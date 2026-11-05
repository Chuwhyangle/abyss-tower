// 遗物：赏金猎人（普通）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'bounty',
  faction: 'neutral',
  name: '赏金猎人',
  rarity: 'common',
  set: 'hunter',
  desc: '每次击杀额外获得 2 金币',
  mods: {
    killGold: 2
  }
};
