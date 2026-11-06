// 遗物：月井之泉（普通）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'moonwell',
  faction: 'frost',
  name: '月井之泉',
  rarity: 'common',
  set: 'synergy',
  desc: '减速强度 +4%，减速持续 +10%',
  mods: {
    slow: 0.04,
    slowDur: 0.1
  }
};
