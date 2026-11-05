// 遗物：凝时棱镜（史诗）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'stasislens',
  faction: 'frost',
  name: '凝时棱镜',
  rarity: 'epic',
  set: 'synergy',
  desc: '攻击速度 +12%，射程 +0.4 格，减速持续 +15%',
  mods: {
    fireRate: 0.12,
    range: 0.4,
    slowDur: 0.15
  }
};
