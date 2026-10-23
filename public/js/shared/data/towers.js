// 防御塔定义与等级数值。
// evolutions：满级后的二选一分支，纯数据。mods 的键必须来自现有属性，
// 值为乘法系数（1 = 不变），由模拟层统一应用，不引入新机制。
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
    evolutions: [
      {
        id: 'arrow-longbow',
        name: '远弓',
        desc: '换装长弓，射程与单发伤害大幅提升，射速略慢。',
        color: '#b6ffcf',
        mods: { dmg: 1.45, range: 1.25, rate: 0.9 },
      },
      {
        id: 'arrow-rapid',
        name: '连弩',
        desc: '连锁供弹，射速大幅提升，单发伤害略降。',
        color: '#7fe0c0',
        mods: { rate: 1.5, dmg: 0.85 },
      },
    ],
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
    evolutions: [
      {
        id: 'cannon-siege',
        name: '攻城炮',
        desc: '重装攻城弹，伤害与溅射范围提升，射速略慢。',
        color: '#ffb066',
        mods: { dmg: 1.5, splash: 1.3, rate: 0.85 },
      },
      {
        id: 'cannon-barrage',
        name: '连轰',
        desc: '自动装填，射速提升，溅射范围略有扩大。',
        color: '#ffcf8a',
        mods: { rate: 1.45, splash: 1.15, dmg: 0.8 },
      },
    ],
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
    evolutions: [
      {
        id: 'frost-deepfreeze',
        name: '深寒',
        desc: '极寒领域，减速更强、持续更久。',
        color: '#a8e6ff',
        mods: { slow: 1.4, slowDur: 1.35, dmg: 1.1 },
      },
      {
        id: 'frost-icelance',
        name: '冰矛',
        desc: '凝冰为矛，伤害翻倍、射程提升，减速略减。',
        color: '#6fb7d8',
        mods: { dmg: 2.1, range: 1.15, slow: 0.85 },
      },
    ],
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
    evolutions: [
      {
        id: 'arc-storm',
        name: '雷暴',
        desc: '电弧分裂，连锁目标更多，伤害小幅提升。',
        color: '#d0b0ff',
        mods: { chain: 1.6, dmg: 1.15 },
      },
      {
        id: 'arc-overload',
        name: '超载',
        desc: '单次放电能量集中，伤害大幅提升，射程与连锁略减。',
        color: '#8f7bff',
        mods: { dmg: 1.7, range: 0.9, chain: 0.8 },
      },
    ],
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
    evolutions: [
      {
        id: 'poison-virulent',
        name: '剧毒',
        desc: '毒素浓缩，持续伤害与持续时间大幅提升。',
        color: '#b8f07a',
        mods: { dot: 1.8, dotDur: 1.2 },
      },
      {
        id: 'poison-blight',
        name: '疫雾',
        desc: '毒雾扩散，射程与直击伤害提升，毒性略减。',
        color: '#6fbf5a',
        mods: { range: 1.3, dmg: 1.3, dot: 0.9 },
      },
    ],
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
    evolutions: [
      {
        id: 'banner-horn',
        name: '号角',
        desc: '号角长鸣，光环的增伤与攻速加成大幅提升。',
        color: '#ffd36b',
        mods: { buffDmg: 1.5, buffRate: 1.2 },
      },
      {
        id: 'banner-standard',
        name: '军旗',
        desc: '大旗招展，光环覆盖范围扩大，增伤提升、攻速略减。',
        color: '#ffb347',
        mods: { range: 1.35, buffDmg: 1.2, buffRate: 0.9 },
      },
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
    evolutions: [
      {
        id: 'shock-quake',
        name: '裂地',
        desc: '震荡波转为地面冲击，击退与溅射范围提升。',
        color: '#8ff5df',
        mods: { knockback: 1.8, splash: 1.3, dmg: 1.2 },
      },
      {
        id: 'shock-glacier',
        name: '冰震',
        desc: '冲击波带起寒霜，减速更强、持续更久、范围更大。',
        color: '#4fd0c0',
        mods: { slow: 1.45, slowDur: 1.4, range: 1.1 },
      },
    ],
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
    evolutions: [
      {
        id: 'sniper-piercer',
        name: '破甲',
        desc: '重弹穿甲，单发伤害大幅提升，射速略慢。',
        color: '#b8d0ff',
        mods: { dmg: 1.6, rate: 0.85 },
      },
      {
        id: 'sniper-marksman',
        name: '速射',
        desc: '快速上膛，射速大幅提升，射程更远、单发伤害略降。',
        color: '#7fa0ff',
        mods: { rate: 1.5, dmg: 0.78, range: 1.05 },
      },
    ],
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
