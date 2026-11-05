// 遗物：淬毒护符（普通）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'venomfang',
  faction: 'venom',
  name: '淬毒护符',
  rarity: 'common',
  desc: '毒雾塔伤害 +18%',
  mods: {
    dmg: {
      poison: 0.18
    }
  },
  behaviors: {
    'Ⅱ': [
      {
        id: 'venomfang-spread-2',
        kind: 'poisonHitSpread',
        towerType: 'poison',
        radius: 0.8,
        targets: 1,
        dpsMul: 0.3
      }
    ],
    'Ⅲ': [
      {
        id: 'venomfang-kill-spread-3',
        kind: 'poisonKillSpread',
        towerType: 'poison',
        radius: 1.5,
        hops: 3
      }
    ]
  }
};
