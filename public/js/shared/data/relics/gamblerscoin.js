// 遗物：赌徒金币（稀有）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'gamblerscoin',
  faction: 'neutral',
  name: '赌徒金币',
  rarity: 'rare',
  desc: '攻击有 12% 概率造成双倍伤害，每波结束额外获得当前金币 3% 的利息',
  mods: {
    crit: 0.12,
    interest: 0.03
  }
};
