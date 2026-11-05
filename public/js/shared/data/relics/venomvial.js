// 遗物：毒液小瓶（普通）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'venomvial',
  faction: 'venom',
  name: '毒液小瓶',
  rarity: 'common',
  desc: '毒雾塔伤害 +10%，毒伤 +10%',
  mods: {
    dmg: {
      poison: 0.1
    },
    dot: 0.1
  },
  behaviors: {
    'Ⅲ': [
      {
        id: 'venomvial-spread-3',
        kind: 'poisonHitSpread',
        towerType: 'poison',
        radius: 0.8,
        targets: 1,
        dpsMul: 0.5
      }
    ]
  }
};
