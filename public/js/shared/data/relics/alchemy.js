// 遗物：炼金秘方（稀有）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'alchemy',
  faction: 'venom',
  name: '炼金秘方',
  rarity: 'rare',
  desc: '毒雾塔伤害 +25%，毒伤 +30%',
  mods: {
    dmg: {
      poison: 0.25
    },
    dot: 0.3
  }
};
