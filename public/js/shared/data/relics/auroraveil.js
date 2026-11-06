// 遗物：极光帷幕（稀有）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'auroraveil',
  faction: 'frost',
  name: '极光帷幕',
  rarity: 'rare',
  set: 'frost',
  desc: '被减速的敌人受到的所有伤害 +10%，减速持续 +20%',
  mods: {
    frostDmgBonus: 0.1,
    slowDur: 0.2
  }
};
