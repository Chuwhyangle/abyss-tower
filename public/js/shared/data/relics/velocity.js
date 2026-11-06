// 遗物：弹道加速（普通）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'velocity',
  faction: 'fire',
  name: '弹道加速',
  rarity: 'common',
  set: 'hunter',
  desc: '投射物速度 +50%，全体伤害 +6%',
  mods: {
    projSpeed: 0.5,
    dmgAll: 0.06
  }
};
