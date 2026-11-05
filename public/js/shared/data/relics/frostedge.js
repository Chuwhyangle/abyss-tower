// 遗物：霜刃磨石（普通）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'frostedge',
  faction: 'frost',
  name: '霜刃磨石',
  rarity: 'common',
  set: 'frost',
  desc: '霜塔伤害 +10%，减速强度 +5%',
  mods: {
    dmg: {
      frost: 0.1
    },
    slow: 0.05
  },
  behaviors: {
    'Ⅱ': [
      {
        id: 'frostedge-freeze-2',
        kind: 'frostHitFreeze',
        towerType: 'frost',
        hits: 6,
        duration: 0.3
      }
    ]
  }
};
