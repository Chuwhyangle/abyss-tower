// 遗物：霜晶格栅（普通）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'frostlattice',
  faction: 'frost',
  name: '霜晶格栅',
  rarity: 'common',
  set: 'frost',
  desc: '霜塔伤害 +12%，减速强度 +3%',
  mods: {
    dmg: {
      frost: 0.12
    },
    slow: 0.03
  }
};
