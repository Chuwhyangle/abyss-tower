// 游戏静态数据：服务端与浏览器共用，保证数值与抽卡池一致。
import { RNG } from './rng.js';

export const TILE = 48;
export const MAP_COLS = 22;
export const MAP_ROWS = 12;
export const MAX_WAVE = 30;

// 三档难度：只调整参数，不改变 30 波结构。数值为 v0 假设，M2/M4 用模拟与试玩校准。
export const DIFFICULTIES = {
  roam: {
    id: 'roam',
    name: '漫游',
    color: '#6fe0b0',
    desc: '熟悉机制与尝试流派，压力较小。',
    hpMul: 0.94,
    countMul: 0.94,
    speedMul: 0.99,
    goldBonus: 60,
    hpBonus: 5,
    scoreMul: 0.8,
    coresMul: 0.8,
  },
  standard: {
    id: 'standard',
    name: '远征',
    color: '#ffd36b',
    desc: '标准远征，设计基准。',
    hpMul: 1.08,
    countMul: 1.04,
    speedMul: 1.02,
    goldBonus: 0,
    hpBonus: 0,
    scoreMul: 1.0,
    coresMul: 1.0,
  },
  abyss: {
    id: 'abyss',
    name: '深渊',
    color: '#ff6b8a',
    desc: '高压挑战，需要成熟构筑与取舍。',
    hpMul: 1.18,
    countMul: 1.08,
    speedMul: 1.03,
    goldBonus: -20,
    hpBonus: -3,
    scoreMul: 1.5,
    coresMul: 1.3,
  },
};

export const DIFFICULTY_ORDER = ['roam', 'standard', 'abyss'];

export function getDifficulty(id) {
  return DIFFICULTIES[id] || DIFFICULTIES.standard;
}

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
};

export const TOWER_ORDER = ['arrow', 'cannon', 'frost', 'arc', 'poison'];

export const ENEMIES = {
  grunt: {
    id: 'grunt', name: '游魂', hp: 46, speed: 1.45, armor: 0, gold: 6, dmg: 1,
    r: 0.30, color: '#d1717b', shape: 'blob',
  },
  runner: {
    id: 'runner', name: '疾影', hp: 30, speed: 2.65, armor: 0, gold: 5, dmg: 1,
    r: 0.24, color: '#e3b34d', shape: 'dart',
  },
  swarm: {
    id: 'swarm', name: '噬虫', hp: 17, speed: 2.05, armor: 0, gold: 3, dmg: 1,
    r: 0.17, color: '#a97be0', shape: 'bug',
  },
  tank: {
    id: 'tank', name: '石卫', hp: 230, speed: 0.82, armor: 5, gold: 17, dmg: 2,
    r: 0.42, color: '#8893a8', shape: 'hex',
  },
  flyer: {
    id: 'flyer', name: '翼魔', hp: 44, speed: 1.95, armor: 1, gold: 9, dmg: 1,
    r: 0.27, color: '#5fb6ea', shape: 'wing', flying: true,
  },
  healer: {
    id: 'healer', name: '祭司', hp: 95, speed: 1.05, armor: 2, gold: 13, dmg: 1,
    r: 0.32, color: '#66dbaa', shape: 'priest', heal: 0.035, healRange: 2.6,
  },
  boss: {
    id: 'boss', name: '渊主', hp: 900, speed: 0.72, armor: 5, gold: 100, dmg: 3,
    r: 0.58, color: '#e2609e', shape: 'boss', boss: true,
  },
};

export const RARITY = {
  common: { id: 'common', name: '普通', color: '#9fb0c3', weight: 58 },
  rare: { id: 'rare', name: '稀有', color: '#5bc8ff', weight: 30 },
  epic: { id: 'epic', name: '史诗', color: '#c88bff', weight: 12 },
};

// mods 键说明：
// dmg:{towerId: 加成}  dmgAll  fireRate  range  splash  slow  slowDur
// chain  dot  goldMul  killGold  interest  crit  armorPierce  costMul
// frostDmgBonus  lowHpDmg  projSpeed  bossDmg  baseHp
export const RELICS = [
  { id: 'sharp', name: '锐利箭簇', rarity: 'common', desc: '弩塔伤害 +25%', mods: { dmg: { arrow: 0.25 } } },
  { id: 'quickdraw', name: '急速装填', rarity: 'common', desc: '所有防御塔攻击速度 +12%', mods: { fireRate: 0.12 } },
  { id: 'eagle', name: '鹰眼徽记', rarity: 'common', desc: '所有防御塔射程 +1 格', mods: { range: 1 } },
  { id: 'bounty', name: '赏金猎人', rarity: 'common', desc: '每次击杀额外获得 2 金币', mods: { killGold: 2 } },
  { id: 'thrifty', name: '精打细算', rarity: 'common', desc: '防御塔建造与升级费用 -8%', mods: { costMul: -0.08 } },
  { id: 'crystal', name: '生命结晶', rarity: 'common', desc: '立即恢复并提高 5 点基地生命', mods: { baseHp: 5 } },
  { id: 'velocity', name: '弹道加速', rarity: 'common', desc: '投射物速度 +50%，全体伤害 +6%', mods: { projSpeed: 0.5, dmgAll: 0.06 } },

  { id: 'powder', name: '火药桶', rarity: 'rare', desc: '炮台伤害 +20%，溅射范围 +35%', mods: { dmg: { cannon: 0.2 }, splash: 0.35 } },
  { id: 'frostheart', name: '极寒之心', rarity: 'rare', desc: '减速效果 +15%，持续时间 +30%', mods: { slow: 0.15, slowDur: 0.3 } },
  { id: 'static', name: '静电过载', rarity: 'rare', desc: '电弧塔伤害 +25%，连锁 +1 个目标', mods: { dmg: { arc: 0.25 }, chain: 1 } },
  { id: 'toxin', name: '毒性催化', rarity: 'rare', desc: '毒伤 +45%', mods: { dot: 0.45 } },
  { id: 'usury', name: '利滚利', rarity: 'rare', desc: '每波结束获得当前金币 5% 的利息', mods: { interest: 0.05 } },
  { id: 'pierce', name: '破甲弹头', rarity: 'rare', desc: '无视 50% 护甲', mods: { armorPierce: 0.5 } },
  { id: 'crit', name: '致命一击', rarity: 'rare', desc: '攻击有 20% 概率造成双倍伤害', mods: { crit: 0.2 } },
  { id: 'bosslayer', name: '泰坦杀手', rarity: 'rare', desc: '对首领伤害 +50%', mods: { bossDmg: 0.5 } },
  { id: 'alchemy', name: '炼金秘方', rarity: 'rare', desc: '毒雾塔伤害 +25%，毒伤 +30%', mods: { dmg: { poison: 0.25 }, dot: 0.3 } },

  { id: 'warlord', name: '战争领主', rarity: 'epic', desc: '所有防御塔伤害 +18%', mods: { dmgAll: 0.18 } },
  { id: 'warhorn', name: '战争号角', rarity: 'epic', desc: '所有防御塔攻击速度 +25%', mods: { fireRate: 0.25 } },
  { id: 'frostbite', name: '寒霜易伤', rarity: 'epic', desc: '被减速的敌人受到的所有伤害 +20%', mods: { frostDmgBonus: 0.2 } },
  { id: 'laststand', name: '背水一战', rarity: 'epic', desc: '基地生命低于 40% 时，全体伤害 +35%', mods: { lowHpDmg: 0.35 } },
  { id: 'greed', name: '贪婪之神', rarity: 'epic', desc: '所有金币收入 +30%', mods: { goldMul: 0.3 } },
  { id: 'bastion', name: '钢铁壁垒', rarity: 'epic', desc: '立即恢复并提高 10 点基地生命', mods: { baseHp: 10 } },
];

export const RELIC_BY_ID = Object.fromEntries(RELICS.map((r) => [r.id, r]));

// 依据种子抽取遗物：所有权重由 rarity 决定，已拥有的遗物不再出现。
export function rollRelics(seedKey, ownedIds = [], count = 3) {
  const rng = new RNG(seedKey);
  const owned = new Set(ownedIds);
  const pool = RELICS.filter((r) => !owned.has(r.id));
  const picked = [];
  while (picked.length < count && pool.length) {
    const relic = rng.weighted(pool, (r) => RARITY[r.rarity].weight);
    picked.push(relic);
    pool.splice(pool.indexOf(relic), 1);
  }
  return picked;
}

export const UNLOCKS = [
  { id: 'tower_arc', name: '电弧塔', cost: 30, type: 'tower', desc: '解锁可建造的连锁闪电塔，无视护甲。' },
  { id: 'tower_poison', name: '毒雾塔', cost: 30, type: 'tower', desc: '解锁持续毒伤塔，毒伤无视护甲。' },
  { id: 'start_gold', name: '启动资金', cost: 20, type: 'perk', desc: '每局初始金币 +40。' },
  { id: 'start_hp', name: '加固基地', cost: 20, type: 'perk', desc: '每局基地生命 +3。' },
  { id: 'extra_reroll', name: '命运骰子', cost: 15, type: 'perk', desc: '每局遗物刷新次数 +2。' },
  { id: 'start_relic', name: '先见之明', cost: 40, type: 'perk', desc: '开局随机获得一件遗物。' },
];

export const UNLOCK_BY_ID = Object.fromEntries(UNLOCKS.map((u) => [u.id, u]));

export function unlockedTowerIds(unlocks) {
  return TOWER_ORDER.filter((id) => !TOWERS[id].unlock || unlocks.includes(TOWERS[id].unlock));
}

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
