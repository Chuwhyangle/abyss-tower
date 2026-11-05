// 遗物：星铸炉心（史诗）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'starforge',
  faction: 'venom',
  name: '星铸炉心',
  rarity: 'epic',
  set: 'synergy',
  desc: '全体伤害 +8%，毒伤 +12%，减速强度 +3%',
  mods: {
    dmgAll: 0.08,
    dot: 0.12,
    slow: 0.03
  }
};
