// 遗物：火药桶（稀有）。单件定义，注册表按固定顺序在 index.js 组装。
export default {
  id: 'powder',
  faction: 'fire',
  name: '火药桶',
  rarity: 'rare',
  desc: '炮台伤害 +20%，溅射范围 +35%',
  mods: {
    dmg: {
      cannon: 0.2
    },
    splash: 0.35
  }
};
