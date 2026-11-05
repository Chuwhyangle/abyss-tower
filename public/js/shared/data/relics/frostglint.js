// 遗物：霜纹刻印（普通）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'frostglint',
  faction: 'frost',
  name: '霜纹刻印',
  rarity: 'common',
  set: 'frost',
  desc: '霜塔伤害 +18%',
  mods: {
    dmg: {
      frost: 0.18
    }
  },
  behaviors: {
    'Ⅲ': [
      {
        id: 'frostglint-freeze-3',
        kind: 'frostHitFreeze',
        towerType: 'frost',
        hits: 5,
        duration: 0.5
      }
    ]
  }
};
