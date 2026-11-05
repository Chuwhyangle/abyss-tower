// 遗物：致命一击（稀有）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'crit',
  faction: 'fire',
  name: '致命一击',
  rarity: 'rare',
  set: 'hunter',
  desc: '攻击有 20% 概率造成双倍伤害',
  mods: {
    crit: 0.2
  }
};
