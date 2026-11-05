// 遗物定义、等级与抽取逻辑。
// 教义（doctrine，§6.2）的五条塔专精数据与 applyDoctrine 在 shared/doctrines.js；
// 本文件只维护遗物归属与抽取，不承载教义行为。
import { RNG } from '../rng.js';
import { TOWERS } from './towers.js';
import { capEffect, effectText, roundEffect } from '../effects.js';

export const RARITY = {
  common: { id: 'common', name: '普通', color: '#9fb0c3', weight: 58 },
  rare: { id: 'rare', name: '稀有', color: '#5bc8ff', weight: 30 },
  epic: { id: 'epic', name: '史诗', color: '#c88bff', weight: 12 },
};

// 按模式调整遗物稀有度抽取权重（纯数据）。普通模式沿用 RARITY 原值，保持既有序列；
// 无尽模式是长局，提高稀有/史诗占比，让后期三选一更有价值。
// gambler 是赌徒之骰的「完全随机」档：三档稀有度权重相等，等价于在全部可抽遗物里均匀抽取。
export const MODE_RARITY_WEIGHTS = Object.freeze({
  normal: Object.freeze({
    common: RARITY.common.weight,
    rare: RARITY.rare.weight,
    epic: RARITY.epic.weight,
  }),
  endless: Object.freeze({ common: 46, rare: 34, epic: 20 }),
  gambler: Object.freeze({ common: 1, rare: 1, epic: 1 }),
  // 爬塔精英节点（P0-6）：高风险高收益，稀有/史诗占比显著抬升（高稀有遗物概率提升）。
  elite: Object.freeze({ common: 30, rare: 42, epic: 28 }),
});

export function rarityWeightForMode(rarity, mode = 'normal') {
  const weights = MODE_RARITY_WEIGHTS[mode] || MODE_RARITY_WEIGHTS.normal;
  return weights[rarity] ?? RARITY[rarity].weight;
}

// mods 键说明：
// dmg:{towerId: 加成}  dmgAll  fireRate  range  splash  slow  slowDur
// chain  dot  goldMul  killGold  interest  crit  armorPierce  costMul
// frostDmgBonus  lowHpDmg  richDmg  emptySlotDmg  projSpeed  bossDmg  baseHp
// 条件型键（lowHpDmg / richDmg / emptySlotDmg）在 effects.js 中读取本局状态快照判定。
// set：可选套装标签，取值见 effects.js 的 RELIC_SET_BONUSES；同套装按不同遗物计件。
export const RELICS = [
  { id: 'sharp', faction: 'fire', name: '锐利箭簇', rarity: 'common', set: 'hunter', desc: '弩塔伤害 +25%', mods: { dmg: { arrow: 0.25 } } },
  { id: 'quickdraw', faction: 'storm', name: '急速装填', rarity: 'common', desc: '所有防御塔攻击速度 +12%', mods: { fireRate: 0.12 } },
  { id: 'eagle', faction: 'fire', name: '鹰眼徽记', rarity: 'common', set: 'hunter', desc: '所有防御塔射程 +1 格', mods: { range: 1 } },
  { id: 'bounty', faction: 'neutral', name: '赏金猎人', rarity: 'common', set: 'hunter', desc: '每次击杀额外获得 2 金币', mods: { killGold: 2 } },
  { id: 'thrifty', faction: 'neutral', name: '精打细算', rarity: 'common', set: 'guild', desc: '防御塔建造与升级费用 -8%', mods: { costMul: -0.08 } },
  { id: 'crystal', faction: 'warden', name: '生命结晶', rarity: 'common', desc: '立即恢复并提高 5 点基地生命', mods: { baseHp: 5 } },
  { id: 'velocity', faction: 'fire', name: '弹道加速', rarity: 'common', set: 'hunter', desc: '投射物速度 +50%，全体伤害 +6%', mods: { projSpeed: 0.5, dmgAll: 0.06 } },
  { id: 'frostglint', faction: 'frost', name: '霜纹刻印', rarity: 'common', set: 'frost', desc: '霜塔伤害 +18%', mods: { dmg: { frost: 0.18 } } },
  { id: 'venomfang', faction: 'venom', name: '淬毒护符', rarity: 'common', desc: '毒雾塔伤害 +18%', mods: { dmg: { poison: 0.18 } } },
  { id: 'sparkplug', faction: 'storm', name: '火花塞', rarity: 'common', desc: '电弧塔伤害 +15%', mods: { dmg: { arc: 0.15 } } },
  { id: 'steadyaim', faction: 'fire', name: '稳定瞄准', rarity: 'common', set: 'hunter', desc: '所有防御塔射程 +0.6 格', mods: { range: 0.6 } },
  { id: 'coinpurse', faction: 'neutral', name: '鼓胀钱袋', rarity: 'common', set: 'guild', desc: '每次击杀额外获得 1 金币', mods: { killGold: 1 } },
  { id: 'sandbag', faction: 'warden', name: '沙袋工事', rarity: 'common', desc: '立即恢复并提高 3 点基地生命', mods: { baseHp: 3 } },
  { id: 'frostedge', faction: 'frost', name: '霜刃磨石', rarity: 'common', set: 'frost', desc: '霜塔伤害 +10%，减速强度 +5%', mods: { dmg: { frost: 0.1 }, slow: 0.05 } },
  { id: 'venomvial', faction: 'venom', name: '毒液小瓶', rarity: 'common', desc: '毒雾塔伤害 +10%，毒伤 +10%', mods: { dmg: { poison: 0.1 }, dot: 0.1 } },
  { id: 'spareparts', faction: 'neutral', name: '备用零件', rarity: 'common', set: 'guild', desc: '建造与升级费用 -5%，每次击杀额外获得 1 金币', mods: { costMul: -0.05, killGold: 1 } },
  { id: 'scouthorn', faction: 'storm', name: '侦察号角', rarity: 'common', desc: '所有防御塔射程 +0.4 格，攻击速度 +5%', mods: { range: 0.4, fireRate: 0.05 } },
  { id: 'bloodpact', faction: 'warden', name: '血誓木牌', rarity: 'common', desc: '基地生命低于 40% 时全体伤害 +12%，暴击率 +5%', mods: { lowHpDmg: 0.12, crit: 0.05 } },
  { id: 'bloodstake', faction: 'warden', name: '血脉赌注', rarity: 'common', set: 'gambit', desc: '基地生命低于 40% 时全体伤害 +8%', mods: { lowHpDmg: 0.08 } },
  { id: 'highroller', faction: 'neutral', name: '孤注一掷', rarity: 'common', set: 'gambit', desc: '基地生命低于 40% 时全体伤害 +6%，每次击杀额外获得 1 金币', mods: { lowHpDmg: 0.06, killGold: 1 } },
  { id: 'moonwell', faction: 'frost', name: '月井之泉', rarity: 'common', set: 'synergy', desc: '减速强度 +4%，减速持续 +10%', mods: { slow: 0.04, slowDur: 0.1 } },
  { id: 'embertrace', faction: 'venom', name: '余烬星痕', rarity: 'common', set: 'synergy', desc: '毒伤 +10%，溅射范围 +5%', mods: { dot: 0.1, splash: 0.05 } },
  { id: 'desperado', faction: 'warden', name: '亡命之徒', rarity: 'common', set: 'reserve', desc: '基地生命低于 40% 时全体伤害 +10%', mods: { lowHpDmg: 0.1 } },
  { id: 'goldencoffer', faction: 'neutral', name: '黄金宝库', rarity: 'common', set: 'reserve', desc: '金币 ≥ 400 时全体伤害 +7%', mods: { richDmg: 0.07 } },
  { id: 'openfield', faction: 'warden', name: '旷野火力', rarity: 'common', set: 'reserve', desc: '可建造空位 ≥ 8 时全体伤害 +8%', mods: { emptySlotDmg: 0.08 } },
  { id: 'harvestsickle', faction: 'neutral', name: '收割镰刀', rarity: 'common', desc: '每 2 波结束时获得 6 金币', mods: { waveGold2: 6 } },
  { id: 'emberclock', faction: 'warden', name: '余烬节拍', rarity: 'common', desc: '每 3 波结束时恢复 1 点基地生命', mods: { waveHeal3: 1 } },
  { id: 'frostlattice', faction: 'frost', name: '霜晶格栅', rarity: 'common', set: 'frost', desc: '霜塔伤害 +12%，减速强度 +3%', mods: { dmg: { frost: 0.12 }, slow: 0.03 } },
  { id: 'gambitseal', faction: 'warden', name: '赌誓封印', rarity: 'common', set: 'gambit', desc: '基地生命低于 40% 时全体伤害 +9%', mods: { lowHpDmg: 0.09 } },

  { id: 'powder', faction: 'fire', name: '火药桶', rarity: 'rare', desc: '炮台伤害 +20%，溅射范围 +35%', mods: { dmg: { cannon: 0.2 }, splash: 0.35 } },
  { id: 'frostheart', faction: 'frost', name: '极寒之心', rarity: 'rare', set: 'frost', desc: '减速效果 +15%，持续时间 +30%', mods: { slow: 0.15, slowDur: 0.3 } },
  { id: 'static', faction: 'storm', name: '静电过载', rarity: 'rare', desc: '电弧塔伤害 +25%，连锁 +1 个目标', mods: { dmg: { arc: 0.25 }, chain: 1 } },
  { id: 'toxin', faction: 'venom', name: '毒性催化', rarity: 'rare', desc: '毒伤 +45%', mods: { dot: 0.45 } },
  { id: 'usury', faction: 'neutral', name: '利滚利', rarity: 'rare', set: 'guild', desc: '每波结束获得当前金币 5% 的利息', mods: { interest: 0.05 } },
  { id: 'pierce', faction: 'fire', name: '破甲弹头', rarity: 'rare', desc: '无视 50% 护甲', mods: { armorPierce: 0.5 } },
  { id: 'crit', faction: 'fire', name: '致命一击', rarity: 'rare', set: 'hunter', desc: '攻击有 20% 概率造成双倍伤害', mods: { crit: 0.2 } },
  { id: 'bosslayer', faction: 'fire', name: '泰坦杀手', rarity: 'rare', desc: '对首领伤害 +50%', mods: { bossDmg: 0.5 } },
  { id: 'alchemy', faction: 'venom', name: '炼金秘方', rarity: 'rare', desc: '毒雾塔伤害 +25%，毒伤 +30%', mods: { dmg: { poison: 0.25 }, dot: 0.3 } },
  { id: 'siege', faction: 'fire', name: '攻城配重', rarity: 'rare', desc: '炮台伤害 +30%，射程 +0.6 格', mods: { dmg: { cannon: 0.3 }, range: 0.6 } },
  { id: 'cartel', faction: 'neutral', name: '黑市商会', rarity: 'rare', set: 'guild', desc: '所有金币收入 +15%，建造与升级费用 -5%', mods: { goldMul: 0.15, costMul: -0.05 } },
  { id: 'auroraveil', faction: 'frost', name: '极光帷幕', rarity: 'rare', set: 'frost', desc: '被减速的敌人受到的所有伤害 +10%，减速持续 +20%', mods: { frostDmgBonus: 0.1, slowDur: 0.2 } },
  { id: 'skyfall', faction: 'fire', name: '天火共鸣', rarity: 'rare', desc: '溅射范围 +25%，全体伤害 +5%', mods: { splash: 0.25, dmgAll: 0.05 } },
  { id: 'gamblerscoin', faction: 'neutral', name: '赌徒金币', rarity: 'rare', desc: '攻击有 12% 概率造成双倍伤害，每波结束额外获得当前金币 3% 的利息', mods: { crit: 0.12, interest: 0.03 } },
  { id: 'adrenaline', faction: 'storm', name: '肾上腺素', rarity: 'rare', set: 'gambit', desc: '攻击速度 +10%，基地生命低于 40% 时全体伤害 +10%', mods: { fireRate: 0.1, lowHpDmg: 0.1 } },
  { id: 'martyr', faction: 'warden', name: '殉道誓约', rarity: 'rare', set: 'gambit', desc: '基地生命低于 40% 时全体伤害 +12%，暴击率 +6%', mods: { lowHpDmg: 0.12, crit: 0.06 } },
  { id: 'cometcore', faction: 'venom', name: '彗星核心', rarity: 'rare', set: 'synergy', desc: '毒伤 +20%，溅射范围 +12%', mods: { dot: 0.2, splash: 0.12 } },
  { id: 'warchest', faction: 'neutral', name: '战争金库', rarity: 'rare', set: 'reserve', desc: '金币 ≥ 400 时全体伤害 +13%', mods: { richDmg: 0.13 } },
  { id: 'lastbreath', faction: 'warden', name: '残喘之息', rarity: 'rare', desc: '基地生命低于 40% 时全体伤害 +16%', mods: { lowHpDmg: 0.16 } },
  { id: 'bloodybanner', faction: 'warden', name: '血色战旗', rarity: 'rare', desc: '基地生命低于 40% 时全体伤害 +17%', mods: { lowHpDmg: 0.17 } },
  { id: 'lightsentry', faction: 'warden', name: '轻装哨戒', rarity: 'rare', desc: '可建造空位 ≥ 8 时全体伤害 +14%', mods: { emptySlotDmg: 0.14 } },
  { id: 'bloodmoney', faction: 'neutral', name: '血色财富', rarity: 'rare', desc: '基地生命低于 40% 时全体伤害 +10%，金币 ≥ 400 时全体伤害 +10%', mods: { lowHpDmg: 0.1, richDmg: 0.1 } },
  { id: 'tideglass', faction: 'neutral', name: '潮汐沙漏', rarity: 'rare', desc: '每 3 波结束时获得 14 金币', mods: { waveGold3: 14 } },
  { id: 'metronome', faction: 'warden', name: '战律节拍', rarity: 'rare', desc: '每 4 波结束时恢复 2 点基地生命', mods: { waveHeal4: 2 } },
  { id: 'starcycle', faction: 'warden', name: '星轨轮转', rarity: 'rare', set: 'synergy', desc: '每 5 波结束时恢复 3 点基地生命', mods: { waveHeal5: 3 } },
  { id: 'moonlitvault', faction: 'neutral', name: '月影金库', rarity: 'rare', desc: '每 5 波结束时获得 18 金币', mods: { waveGold5: 18 } },

  { id: 'warlord', faction: 'fire', name: '战争领主', rarity: 'epic', desc: '所有防御塔伤害 +18%', mods: { dmgAll: 0.18 } },
  { id: 'warhorn', faction: 'storm', name: '战争号角', rarity: 'epic', desc: '所有防御塔攻击速度 +25%', mods: { fireRate: 0.25 } },
  { id: 'frostbite', faction: 'frost', name: '寒霜易伤', rarity: 'epic', set: 'frost', desc: '被减速的敌人受到的所有伤害 +20%', mods: { frostDmgBonus: 0.2 } },
  { id: 'laststand', faction: 'warden', name: '背水一战', rarity: 'epic', desc: '基地生命低于 40% 时，全体伤害 +35%', mods: { lowHpDmg: 0.35 } },
  { id: 'greed', faction: 'neutral', name: '贪婪之神', rarity: 'epic', set: 'guild', desc: '所有金币收入 +30%', mods: { goldMul: 0.3 } },
  { id: 'bastion', faction: 'warden', name: '钢铁壁垒', rarity: 'epic', desc: '立即恢复并提高 10 点基地生命', mods: { baseHp: 10 } },
  { id: 'eclipsehour', faction: 'storm', name: '蚀时印记', rarity: 'epic', desc: '所有防御塔攻击速度 +18%，射程 +0.5 格', mods: { fireRate: 0.18, range: 0.5 } },
  { id: 'bloodtide', faction: 'warden', name: '血潮契约', rarity: 'epic', desc: '基地生命低于 40% 时全体伤害 +30%，每次击杀额外获得 2 金币', mods: { lowHpDmg: 0.3, killGold: 2 } },
  { id: 'doomclock', faction: 'warden', name: '末日时钟', rarity: 'epic', set: 'gambit', desc: '基地生命低于 40% 时全体伤害 +20%，暴击率 +10%', mods: { lowHpDmg: 0.2, crit: 0.1 } },
  { id: 'stasislens', faction: 'frost', name: '凝时棱镜', rarity: 'epic', set: 'synergy', desc: '攻击速度 +12%，射程 +0.4 格，减速持续 +15%', mods: { fireRate: 0.12, range: 0.4, slowDur: 0.15 } },
  { id: 'starforge', faction: 'venom', name: '星铸炉心', rarity: 'epic', set: 'synergy', desc: '全体伤害 +8%，毒伤 +12%，减速强度 +3%', mods: { dmgAll: 0.08, dot: 0.12, slow: 0.03 } },
  { id: 'midasthrone', faction: 'neutral', name: '迈达斯王座', rarity: 'epic', set: 'reserve', desc: '金币 ≥ 400 时全体伤害 +22%', mods: { richDmg: 0.22 } },
  { id: 'palaceguard', faction: 'warden', name: '空庭守卫', rarity: 'epic', desc: '可建造空位 ≥ 8 时全体伤害 +24%', mods: { emptySlotDmg: 0.24 } },
  { id: 'eternalhourglass', faction: 'neutral', name: '永恒沙漏', rarity: 'epic', desc: '每 5 波结束时获得 35 金币', mods: { waveGold5: 35 } },
  { id: 'stormpulse', faction: 'storm', name: '雷暴脉冲', rarity: 'epic', desc: '所有防御塔伤害 +10%，攻击速度 +10%', mods: { dmgAll: 0.1, fireRate: 0.1 } },
];

export const RELIC_BY_ID = Object.fromEntries(RELICS.map((r) => [r.id, r]));

// ---------- 遗物等级 ----------

export const RELIC_MAX_LEVEL = 3;
export const RELIC_LEVEL_LABELS = ['Ⅰ', 'Ⅱ', 'Ⅲ'];
const RELIC_LEVEL_FACTORS = [1, 1.6, 2.2];

function clampLevel(level) {
  return Math.max(1, Math.min(RELIC_MAX_LEVEL, Math.floor(Number(level) || 1)));
}

// 某件遗物在指定等级的修正值；基础 mods 视为 Ⅰ 级。
// 键的合法性与单件上限都来自效果注册表，未注册的键会直接报错。
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
        dmg[type] = capEffect('dmg', roundEffect('dmg', amount * factor));
      }
      out.dmg = dmg;
    } else if (typeof raw === 'number') {
      out[key] = capEffect(key, roundEffect(key, raw * factor));
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

// 生成卡片上的效果文案，用于"当前 → 升级后"的展示。文案统一由效果注册表提供。
export function relicEffectText(relicOrId, level = 1) {
  const mods = relicModsAtLevel(relicOrId, level);
  const parts = [];
  for (const [key, value] of Object.entries(mods)) {
    if (key === 'dmg') {
      for (const [type, amount] of Object.entries(value)) {
        if (amount > 0) parts.push(effectText('dmg', amount, { towerName: TOWERS[type].name }));
      }
    } else {
      parts.push(effectText(key, value));
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
export function rollRelicOffers(seedKey, relicStates = [], count = 3, wave = 1, mode = 'normal') {
  const rng = new RNG(seedKey);
  const states = normalizeRelicStates(relicStates);
  const levels = new Map(states.map((state) => [state.id, state.level]));
  const pool = RELICS.filter((relic) => (levels.get(relic.id) || 0) < RELIC_MAX_LEVEL);
  const offers = [];

  // 第 3 波起保底一张升级卡：已拥有且未满级的遗物中必有一件成为首个 offer。
  // 仅当确实存在可升级遗物时生效；不生效时不做任何 RNG 调用，保持既有抽取序列逐字不变。
  const upgradable = states.filter((state) => state.level < RELIC_MAX_LEVEL);
  if (wave >= 3 && upgradable.length > 0) {
    const target = rng.pick(upgradable);
    offers.push({
      kind: 'relic',
      id: target.id,
      fromLevel: target.level,
      toLevel: target.level + 1,
    });
    const idx = pool.findIndex((relic) => relic.id === target.id);
    if (idx >= 0) pool.splice(idx, 1);
  }

  while (offers.length < count && pool.length) {
    const relic = rng.weighted(pool, (item) => rarityWeightForMode(item.rarity, mode));
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

// 信物三选一（§2.5/§8.1）：3 张来自三个不同派系的入门遗物（普通、Ⅰ 级新卡），不含中立。
// 派系规模只影响「信物」的选择面，稀有度不做加权——开局只给入门卡。
// 独立种子流 ${seed}:starter:${mode}（§9）；同一 (seedKey, mode) 可复现。
// 注意：本模块不得 import factions.js（会形成 relics → factions → data → relics 循环）。
const STARTER_FACTIONS = ['fire', 'frost', 'venom', 'storm', 'warden'];

export function rollStarterOffers(seedKey, mode = 'normal') {
  const rng = new RNG(seedKey);
  const byFaction = new Map();
  for (const relic of RELICS) {
    const faction = relic.faction;
    if (!faction || faction === 'neutral' || relic.rarity !== 'common') continue;
    if (!byFaction.has(faction)) byFaction.set(faction, []);
    byFaction.get(faction).push(relic);
  }
  const factions = STARTER_FACTIONS.filter((faction) => (byFaction.get(faction) || []).length > 0);
  const chosen = rng.shuffle(factions).slice(0, 3);
  return chosen.map((faction) => {
    const relic = rng.pick(byFaction.get(faction));
    return { kind: 'relic', id: relic.id, fromLevel: 0, toLevel: 1 };
  });
}

// 首领核心（bossCore，§4）：五类候选与即时效果实现位于 shared/boss-core.js（§8.1 的 cores 模块），
// 本模块不新增导出面（data-split 断言 relics 单一职责）；「搜寻」候选与上方信物三选一同池，
// 只从五个非中立派系中抽取，不包含 neutral。

// 契约卡（contract，§5）：五条契约的候选生成与代价/收益结算实现位于 shared/contracts.js
// （§8.1 的 contracts 模块），本模块同样不新增导出面；契约只在 9/14/19/24 波替换一张遗物卡，
// 抽取走独立种子流 ${seed}:contract:${wave}，不触碰 combatRng。

// 觉醒（awakening，§7）：四条 Ⅲ 级遗物行为词条数据与 applyAwakening 位于 shared/awakenings.js
// （§8.1 的 awakenings 模块），本模块同样不新增导出面；觉醒把行为词条挂到已拥有 Ⅲ 级遗物上、
// 不消耗原遗物，首领核心的觉醒候选入口由 boss-core.js 提供（AC-057）。
