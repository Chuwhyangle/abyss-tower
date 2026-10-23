// 防御塔定义与等级数值。
export const TOWERS = {
  arrow: {
    id: 'arrow',
    name: '弩塔',
    glyph: '➤',
    color: '#8fe0a8',
    desc: '高射速单体攻击，前期主力。可攻击空中单位。',
    cost: 70,
    levels: [
      { dmg: 13, rate: 1.15, range: 3.2, cost: 0 },
      { dmg: 22, rate: 1.3, range: 3.45, cost: 80 },
      { dmg: 38, rate: 1.5, range: 3.7, cost: 150 },
    ],
    proj: { kind: 'bolt', speed: 17 },
  },
  cannon: {
    id: 'cannon',
    name: '炮台',
    glyph: '◉',
    color: '#f0a35e',
    desc: '范围溅射，伤害高但射速慢，无法锁定空中单位。',
    cost: 110,
    groundOnly: true,
    levels: [
      { dmg: 30, rate: 0.55, range: 2.9, splash: 0.95, cost: 0 },
      { dmg: 52, rate: 0.6, range: 3.1, splash: 1.12, cost: 120 },
      { dmg: 86, rate: 0.66, range: 3.3, splash: 1.3, cost: 210 },
    ],
    proj: { kind: 'shell', speed: 9.5 },
  },
  frost: {
    id: 'frost',
    name: '霜塔',
    glyph: '❄',
    color: '#7cd4f5',
    desc: '减速目标，为其他防御塔创造输出时间。',
    cost: 85,
    levels: [
      { dmg: 7, rate: 1.35, range: 2.75, slow: 0.35, slowDur: 1.4, cost: 0 },
      { dmg: 12, rate: 1.5, range: 2.95, slow: 0.42, slowDur: 1.6, cost: 95 },
      { dmg: 20, rate: 1.65, range: 3.15, slow: 0.5, slowDur: 1.85, cost: 175 },
    ],
    proj: { kind: 'frost', speed: 13 },
  },
  arc: {
    id: 'arc',
    name: '电弧塔',
    glyph: '⚡',
    color: '#b48cff',
    desc: '连锁闪电，无视护甲。擅长清理密集的敌群。',
    cost: 150,
    unlock: 'tower_arc',
    levels: [
      { dmg: 20, rate: 0.8, range: 3.0, chain: 3, cost: 0 },
      { dmg: 34, rate: 0.9, range: 3.2, chain: 4, cost: 160 },
      { dmg: 56, rate: 1.0, range: 3.4, chain: 5, cost: 260 },
    ],
    proj: { kind: 'arc' },
    ignoreArmor: true,
    chainRange: 2.3,
  },
  poison: {
    id: 'poison',
    name: '毒雾塔',
    glyph: '☣',
    color: '#9adf6a',
    desc: '附加持续毒伤，毒伤无视护甲。对高血量单位效果显著。',
    cost: 120,
    unlock: 'tower_poison',
    levels: [
      { dmg: 6, rate: 1.2, range: 2.9, dot: 9, dotDur: 3.2, cost: 0 },
      { dmg: 10, rate: 1.3, range: 3.05, dot: 16, dotDur: 3.4, cost: 125 },
      { dmg: 16, rate: 1.4, range: 3.2, dot: 27, dotDur: 3.6, cost: 220 },
    ],
    proj: { kind: 'poison', speed: 11 },
  },
  banner: {
    id: 'banner',
    name: '战旗塔',
    glyph: '⚑',
    color: '#f5c451',
    desc: '不参与攻击。为光环范围内的其他防御塔提供伤害与攻速加成。',
    cost: 95,
    support: true,
    unlock: 'tower_banner',
    levels: [
      { dmg: 0, rate: 0, range: 2.6, buffDmg: 0.12, buffRate: 0.08, cost: 0 },
      { dmg: 0, rate: 0, range: 2.8, buffDmg: 0.18, buffRate: 0.12, cost: 110 },
      { dmg: 0, rate: 0, range: 3.0, buffDmg: 0.25, buffRate: 0.16, cost: 190 },
    ],
  },
  shock: {
    id: 'shock',
    name: '震荡塔',
    glyph: '◎',
    color: '#6fe3c8',
    desc: '短射程震荡波，命中范围内的敌人并造成减速与小幅度击退。',
    cost: 125,
    unlock: 'tower_shock',
    levels: [
      { dmg: 9, rate: 1.1, range: 2.2, splash: 0.9, slow: 0.3, slowDur: 1.0, knockback: 0.22, cost: 0 },
      { dmg: 15, rate: 1.2, range: 2.35, splash: 1.05, slow: 0.36, slowDur: 1.15, knockback: 0.3, cost: 115 },
      { dmg: 24, rate: 1.3, range: 2.5, splash: 1.2, slow: 0.42, slowDur: 1.3, knockback: 0.4, cost: 200 },
    ],
    proj: { kind: 'shock', speed: 12 },
  },
  sniper: {
    id: 'sniper',
    name: '狙击塔',
    glyph: '⌖',
    color: '#8fb8ff',
    desc: '超远射程单体狙击，射速慢但单发伤害极高，可攻击空中单位。',
    cost: 145,
    unlock: 'tower_sniper',
    levels: [
      { dmg: 55, rate: 0.38, range: 5.4, cost: 0 },
      { dmg: 92, rate: 0.42, range: 5.8, cost: 150 },
      { dmg: 150, rate: 0.46, range: 6.2, cost: 250 },
    ],
    proj: { kind: 'bolt', speed: 26 },
  },
};

export const TOWER_ORDER = ['arrow', 'cannon', 'frost', 'arc', 'poison', 'banner', 'shock', 'sniper'];

// 某座塔在指定等级下的有效属性（未叠加遗物）。
export function towerLevelStats(type, level = 0) {
  const def = TOWERS[type];
  const lv = def.levels[Math.min(level, def.levels.length - 1)];
  return { ...lv, maxLevel: def.levels.length };
}

export function towerUpgradeCost(type, level) {
  const def = TOWERS[type];
  if (level >= def.levels.length - 1) return null;
  return def.levels[level + 1].cost;
}
