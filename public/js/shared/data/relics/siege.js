// 遗物：攻城配重（稀有）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'siege',
  faction: 'fire',
  name: '攻城配重',
  rarity: 'rare',
  desc: '炮台伤害 +30%，射程 +0.6 格',
  mods: {
    dmg: {
      cannon: 0.3
    },
    range: 0.6
  },
  behaviors: {
    'Ⅲ': [
      {
        id: 'siege-burst-3',
        kind: 'cannonKillBurst',
        towerType: 'cannon',
        radius: 1,
        ratio: 0.5
      }
    ]
  }
};
