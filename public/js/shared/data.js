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
    hpMul: 0.85,
    countMul: 0.87,
    speedMul: 0.96,
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
    hpMul: 1.10,
    countMul: 1.04,
    speedMul: 1.01,
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
    hpMul: 1.34,
    countMul: 1.12,
    speedMul: 1.05,
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

// ---------- 主动技能（玩家） ----------
// 每级数值直接列出，服务端/客户端/渲染层共用同一份真源。
// 10 级：效果为 1 级的 2 倍、冷却为 0.5 倍；攻击速度/射程这类乘法因子固定。
export const SKILL_LEVEL_COSTS = [10, 15, 20, 30, 45, 65, 90, 120, 220]; // 1→2 … 9→10

export const SKILLS = {
  aurora: {
    id: 'aurora',
    name: '霜月·极光',
    role: 'control',
    color: '#7cd4f5',
    unlock: 'default',
    desc: '极光帘幕扫过战场，冻结并减速全场敌人。',
    bossFactor: 0.4,
    milestones: {
      4: { id: 'frostTrace', name: '霜纹', desc: '解冻碎晶有 25% 概率波及 0.8 格内另一名敌人（50% 伤害）。' },
      7: { id: 'eclipse', name: '月蚀', desc: '释放时场上敌人 ≥12，冻结延长 0.3 秒。' },
      10: { id: 'auroraFinale', name: '极光终章', desc: '冻结期间被击杀的敌人爆成冰晶（1 格内 4% 最大生命 + 20% 减速 2 秒）。' },
    },
    levels: [
      { freeze: 0.9, vuln: 0.12, slow: 0.35, slowDur: 4, shatter: 0.06, cd: 40 },
      { freeze: 1.0, vuln: 0.133, slow: 0.389, slowDur: 4, shatter: 0.0667, cd: 37.8 },
      { freeze: 1.1, vuln: 0.147, slow: 0.428, slowDur: 4, shatter: 0.0733, cd: 35.6 },
      { freeze: 1.2, vuln: 0.16, slow: 0.467, slowDur: 4, shatter: 0.08, cd: 33.3 },
      { freeze: 1.3, vuln: 0.173, slow: 0.506, slowDur: 4, shatter: 0.0867, cd: 31.1 },
      { freeze: 1.4, vuln: 0.187, slow: 0.544, slowDur: 4, shatter: 0.0933, cd: 28.9 },
      { freeze: 1.5, vuln: 0.2, slow: 0.583, slowDur: 4, shatter: 0.1, cd: 26.7 },
      { freeze: 1.6, vuln: 0.213, slow: 0.622, slowDur: 4, shatter: 0.1067, cd: 24.4 },
      { freeze: 1.7, vuln: 0.227, slow: 0.661, slowDur: 4, shatter: 0.1133, cd: 22.2 },
      { freeze: 1.8, vuln: 0.24, slow: 0.7, slowDur: 4, shatter: 0.12, cd: 20 },
    ],
  },
  meteor: {
    id: 'meteor',
    name: '星陨·天火',
    role: 'burst',
    color: '#ffb066',
    unlock: 'win_roam',
    desc: '锁定最密集的敌群，召唤流星雨。',
    bossFactor: 0.3,
    milestones: {
      4: { id: 'starTrack', name: '星轨', desc: '优先锁定未被灼烧的群落。' },
      7: { id: 'fireflow', name: '流火', desc: '单次命中 ≥10 名敌人时额外落 1 颗陨星。' },
      10: { id: 'meteorFinale', name: '天火终章', desc: '命中已灼烧目标触发余烬连锁（35% 伤害，最多 4 个）。' },
    },
    levels: [
      { meteors: 3, dmgPct: 0.3, burnPct: 0.12, radius: 1.8, cd: 45 },
      { meteors: 3, dmgPct: 0.333, burnPct: 0.133, radius: 1.844, cd: 42.5 },
      { meteors: 4, dmgPct: 0.367, burnPct: 0.147, radius: 1.889, cd: 40 },
      { meteors: 4, dmgPct: 0.4, burnPct: 0.16, radius: 1.933, cd: 37.5 },
      { meteors: 4, dmgPct: 0.433, burnPct: 0.173, radius: 1.978, cd: 35 },
      { meteors: 5, dmgPct: 0.467, burnPct: 0.187, radius: 2.022, cd: 32.5 },
      { meteors: 5, dmgPct: 0.5, burnPct: 0.2, radius: 2.067, cd: 30 },
      { meteors: 5, dmgPct: 0.533, burnPct: 0.213, radius: 2.111, cd: 27.5 },
      { meteors: 6, dmgPct: 0.567, burnPct: 0.227, radius: 2.156, cd: 25 },
      { meteors: 6, dmgPct: 0.6, burnPct: 0.24, radius: 2.2, cd: 22.5 },
    ],
  },
  chrono: {
    id: 'chrono',
    name: '时之终章·星海回响',
    role: 'ultimate',
    color: '#b48cff',
    unlock: 'win_standard',
    desc: '时间停滞，星海降临，所有防御塔过载。',
    bossFactor: 0.5,
    milestones: {
      4: { id: 'stasis', name: '迟滞', desc: '时停期间防御塔攻速额外 +20%。' },
      7: { id: 'echo', name: '回声', desc: '星痕易伤持续时间 +3 秒。' },
      10: { id: 'finale', name: '终章', desc: '时停期间每击杀 1 名敌人，时停 +0.1 秒（最多 +1 秒）。' },
    },
    levels: [
      { stop: 1.5, overdrive: 4, atkSpeed: 0.6, range: 1, novaPct: 0.12, vuln: 0.15, vulnDur: 6, cd: 75 },
      { stop: 1.667, overdrive: 4.444, atkSpeed: 0.6, range: 1, novaPct: 0.133, vuln: 0.15, vulnDur: 6, cd: 70.8 },
      { stop: 1.833, overdrive: 4.889, atkSpeed: 0.6, range: 1, novaPct: 0.147, vuln: 0.15, vulnDur: 6, cd: 66.7 },
      { stop: 2, overdrive: 5.333, atkSpeed: 0.6, range: 1, novaPct: 0.16, vuln: 0.15, vulnDur: 6, cd: 62.5 },
      { stop: 2.167, overdrive: 5.778, atkSpeed: 0.6, range: 1, novaPct: 0.173, vuln: 0.15, vulnDur: 6, cd: 58.3 },
      { stop: 2.333, overdrive: 6.222, atkSpeed: 0.6, range: 1, novaPct: 0.187, vuln: 0.15, vulnDur: 6, cd: 54.2 },
      { stop: 2.5, overdrive: 6.667, atkSpeed: 0.6, range: 1, novaPct: 0.2, vuln: 0.15, vulnDur: 9, cd: 50 },
      { stop: 2.667, overdrive: 7.111, atkSpeed: 0.6, range: 1, novaPct: 0.213, vuln: 0.15, vulnDur: 9, cd: 45.8 },
      { stop: 2.833, overdrive: 7.556, atkSpeed: 0.6, range: 1, novaPct: 0.227, vuln: 0.15, vulnDur: 9, cd: 41.7 },
      { stop: 3, overdrive: 8, atkSpeed: 0.6, range: 1, novaPct: 0.24, vuln: 0.15, vulnDur: 9, cd: 37.5 },
    ],
  },
};

export const SKILL_ORDER = ['aurora', 'meteor', 'chrono'];

export function skillStats(id, level = 1) {
  const def = SKILLS[id];
  if (!def) return null;
  const lv = Math.max(1, Math.min(def.levels.length, Math.floor(Number(level) || 1)));
  return def.levels[lv - 1];
}

export function skillUpgradeCost(level) {
  const lv = Math.floor(Number(level) || 1);
  if (lv < 1 || lv >= SKILLS.aurora.levels.length) return null;
  return SKILL_LEVEL_COSTS[lv - 1];
}

export function skillUnlockText(id) {
  const def = SKILLS[id];
  if (!def) return '';
  if (def.unlock === 'default') return '初始拥有';
  if (def.unlock === 'win_roam') return '首次通关「漫游」';
  if (def.unlock === 'win_standard') return '首次通关「远征」';
  return '';
}

export function isSkillUnlocked(id, profile) {
  const def = SKILLS[id];
  if (!def) return false;
  if (def.unlock === 'default') return true;
  const wins = profile?.stats?.byDifficulty || {};
  if (def.unlock === 'win_roam') return (wins.roam?.wins || 0) > 0;
  if (def.unlock === 'win_standard') return (wins.standard?.wins || 0) > 0;
  return false;
}

// 首领技能：名称/颜色/预警半径由服务端与渲染层共用。
export const BOSS_SKILLS = {
  roar: { id: 'roar', name: '深渊咆哮', color: '#ff8a6b', radiusKey: 'bossRoarRadius', unlockWave: 5 },
  summon: { id: 'summon', name: '裂隙召唤', color: '#e2609e', unlockWave: 10 },
  slam: { id: 'slam', name: '地脉震击', color: '#ffb066', radiusKey: 'bossSlamRadius', unlockWave: 15 },
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

// ---------- 遗物等级 ----------

export const RELIC_MAX_LEVEL = 3;
export const RELIC_LEVEL_LABELS = ['Ⅰ', 'Ⅱ', 'Ⅲ'];
const RELIC_LEVEL_FACTORS = [1, 1.6, 2.2];

// 单件遗物等级上限（避免多次叠加后计算量/数值失控）。
const PER_RELIC_CAPS = {
  dmgType: 2.0,
  dmgAll: 1.0,
  fireRate: 0.6,
  range: 2.0,
  splash: 0.8,
  slow: 0.35,
  slowDur: 0.8,
  chain: 2,
  dot: 1.0,
  goldMul: 0.6,
  killGold: 6,
  interest: 0.12,
  crit: 0.4,
  armorPierce: 0.8,
  costMul: -0.2,
  frostDmgBonus: 0.4,
  lowHpDmg: 0.7,
  projSpeed: 1.0,
  bossDmg: 1.0,
  baseHp: 20,
};

// 多件遗物汇总后的全局上限（在 Simulation.recomputeMods 中应用）。
export const GLOBAL_MOD_CAPS = {
  dmgType: 2.5,
  dmgAll: 1.5,
  fireRate: 0.6,
  range: 2.2,
  splash: 0.9,
  slow: 0.35,
  slowDur: 0.9,
  chain: 2,
  dot: 1.2,
  goldMul: 0.7,
  killGold: 8,
  interest: 0.15,
  crit: 0.45,
  armorPierce: 0.85,
  costMul: -0.2,
  frostDmgBonus: 0.45,
  lowHpDmg: 0.8,
  projSpeed: 1.2,
  bossDmg: 1.2,
  baseHp: 30,
};

function clampLevel(level) {
  return Math.max(1, Math.min(RELIC_MAX_LEVEL, Math.floor(Number(level) || 1)));
}

function roundMod(key, value) {
  if (key === 'chain' || key === 'killGold' || key === 'baseHp') return Math.round(value);
  return Math.round(value * 1000) / 1000;
}

function capMod(key, value) {
  if (key === 'costMul') return Math.max(value, PER_RELIC_CAPS.costMul);
  return Math.min(value, PER_RELIC_CAPS[key] ?? Infinity);
}

// 某件遗物在指定等级的修正值；基础 mods 视为 Ⅰ 级。
export function relicModsAtLevel(relicOrId, level = 1) {
  const relic = typeof relicOrId === 'string' ? RELIC_BY_ID[relicOrId] : relicOrId;
  if (!relic) return {};
  const lv = clampLevel(level);
  const factor = RELIC_LEVEL_FACTORS[lv - 1];
  const out = {};
  for (const [key, raw] of Object.entries(relic.mods || {})) {
    if (key === 'dmg') {
      const dmg = {};
      for (const [type, amount] of Object.entries(raw)) {
        dmg[type] = capMod('dmgType', roundMod('dmg', amount * factor));
      }
      out.dmg = dmg;
    } else if (typeof raw === 'number') {
      out[key] = capMod(key, roundMod(key, raw * factor));
    }
  }
  return out;
}

export function normalizeRelicState(item) {
  if (!item) return null;
  if (typeof item === 'string') {
    return RELIC_BY_ID[item] ? { id: item, level: 1 } : null;
  }
  const id = item.id || item.relicId;
  if (!RELIC_BY_ID[id]) return null;
  return { id, level: clampLevel(item.toLevel ?? item.level ?? 1) };
}

export function normalizeRelicStates(list) {
  const seen = new Map();
  for (const item of list || []) {
    const state = normalizeRelicState(item);
    if (!state) continue;
    seen.set(state.id, Math.max(seen.get(state.id) || 1, state.level));
  }
  return [...seen.entries()].map(([id, level]) => ({ id, level }));
}

export function relicLevelOf(states, id) {
  const found = (states || []).find((item) => item.id === id);
  return found ? clampLevel(found.level) : 0;
}

// 生成卡片上的效果文案，用于"当前 → 升级后"的展示。
export function relicEffectText(relicOrId, level = 1) {
  const mods = relicModsAtLevel(relicOrId, level);
  const parts = [];
  const pct = (value) => `${Math.round(value * 100)}%`;
  for (const [key, value] of Object.entries(mods)) {
    if (key === 'dmg') {
      for (const [type, amount] of Object.entries(value)) {
        if (amount > 0) parts.push(`${TOWERS[type].name}伤害 +${pct(amount)}`);
      }
    } else if (key === 'dmgAll') {
      parts.push(`全体伤害 +${pct(value)}`);
    } else if (key === 'fireRate') {
      parts.push(`攻击速度 +${pct(value)}`);
    } else if (key === 'range') {
      parts.push(`射程 +${Number(value.toFixed(1))} 格`);
    } else if (key === 'splash') {
      parts.push(`溅射范围 +${pct(value)}`);
    } else if (key === 'slow') {
      parts.push(`减速强度 +${pct(value)}`);
    } else if (key === 'slowDur') {
      parts.push(`减速持续 +${pct(value)}`);
    } else if (key === 'chain') {
      parts.push(`连锁 +${value} 个目标`);
    } else if (key === 'dot') {
      parts.push(`毒伤 +${pct(value)}`);
    } else if (key === 'goldMul') {
      parts.push(`金币收入 +${pct(value)}`);
    } else if (key === 'killGold') {
      parts.push(`击杀金币 +${value}`);
    } else if (key === 'interest') {
      parts.push(`波末利息 +${pct(value)}`);
    } else if (key === 'crit') {
      parts.push(`暴击率 +${pct(value)}`);
    } else if (key === 'armorPierce') {
      parts.push(`无视护甲 +${pct(value)}`);
    } else if (key === 'costMul') {
      parts.push(`建造/升级费用 ${value < 0 ? '-' : '+'}${pct(Math.abs(value))}`);
    } else if (key === 'frostDmgBonus') {
      parts.push(`减速目标受伤 +${pct(value)}`);
    } else if (key === 'lowHpDmg') {
      parts.push(`基地低血时伤害 +${pct(value)}`);
    } else if (key === 'projSpeed') {
      parts.push(`投射物速度 +${pct(value)}`);
    } else if (key === 'bossDmg') {
      parts.push(`对首领伤害 +${pct(value)}`);
    } else if (key === 'baseHp') {
      parts.push(`基地生命 +${value}（立即）`);
    }
  }
  return parts.join('，');
}

export function fallbackOffers(wave = 1) {
  const w = Math.max(1, Math.floor(wave));
  return [
    { kind: 'gold', amount: 30 + w * 4 },
    { kind: 'repair', amount: 1 + Math.floor(w / 10) },
    { kind: 'gold', amount: 60 + w * 8 },
    { kind: 'repair', amount: 2 + Math.floor(w / 12) },
  ];
}

// 抽取遗物选项：可包含未拥有遗物（新获得）或已有遗物（升级），满级退出。
// 候选不足时用金币/修复补位，保证始终能完成选择。
export function rollRelicOffers(seedKey, relicStates = [], count = 3, wave = 1) {
  const rng = new RNG(seedKey);
  const states = normalizeRelicStates(relicStates);
  const levels = new Map(states.map((state) => [state.id, state.level]));
  const pool = RELICS.filter((relic) => (levels.get(relic.id) || 0) < RELIC_MAX_LEVEL);
  const offers = [];

  while (offers.length < count && pool.length) {
    const relic = rng.weighted(pool, (item) => RARITY[item.rarity].weight);
    const fromLevel = levels.get(relic.id) || 0;
    offers.push({
      kind: 'relic',
      id: relic.id,
      fromLevel,
      toLevel: fromLevel + 1,
    });
    pool.splice(pool.indexOf(relic), 1);
  }

  const fallbacks = rng.shuffle(fallbackOffers(wave));
  let fallbackIndex = 0;
  while (offers.length < count) {
    const fallback = fallbacks[fallbackIndex % fallbacks.length];
    const round = Math.floor(fallbackIndex / fallbacks.length);
    offers.push({
      kind: fallback.kind,
      amount: fallback.amount + round * (fallback.kind === 'gold' ? 20 : 1),
    });
    fallbackIndex++;
  }
  return offers;
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
