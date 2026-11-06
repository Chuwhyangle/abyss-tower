// 遗物：静电过载（稀有）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'static',
  faction: 'storm',
  name: '静电过载',
  rarity: 'rare',
  desc: '电弧塔伤害 +25%，连锁 +1 个目标',
  mods: {
    dmg: {
      arc: 0.25
    },
    chain: 1
  },
  behaviors: {
    'Ⅱ': [
      {
        id: 'static-zap-2',
        kind: 'arcKillZap',
        towerType: 'arc',
        radius: 1,
        damageMul: 0.4
      }
    ]
  }
};
