// 遗物：稳定瞄准（普通）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'steadyaim',
  faction: 'fire',
  name: '稳定瞄准',
  rarity: 'common',
  set: 'hunter',
  desc: '所有防御塔射程 +0.6 格',
  mods: {
    range: 0.6
  },
  behaviors: {
    'Ⅲ': [
      {
        id: 'steadyaim-pierce-3',
        kind: 'arrowShotPierce',
        towerType: 'arrow',
        every: 6,
        pierce: 2,
        damageMul: 0.6
      }
    ]
  }
};
