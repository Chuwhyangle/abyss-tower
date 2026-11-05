// 遗物：火花塞（普通）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'sparkplug',
  faction: 'storm',
  name: '火花塞',
  rarity: 'common',
  desc: '电弧塔伤害 +15%',
  mods: {
    dmg: {
      arc: 0.15
    }
  },
  behaviors: {
    'Ⅲ': [
      {
        id: 'sparkplug-zap-3',
        kind: 'arcKillZap',
        towerType: 'arc',
        radius: 1.2,
        damageMul: 0.6
      }
    ]
  }
};
