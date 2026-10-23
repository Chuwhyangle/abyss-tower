// 遗物定义、等级与抽取逻辑。
import { RNG } from '../rng.js';
import { TOWERS } from './towers.js';
import { capEffect, effectText, roundEffect } from '../effects.js';

export const RARITY = {
  common: { id: 'common', name: '普通', color: '#9fb0c3', weight: 58 },
  rare: { id: 'rare', name: '稀有', color: '#5bc8ff', weight: 30 },
  epic: { id: 'epic', name: '史诗', color: '#c88bff', weight: 12 },
};

// mods 键说明：
// dmg:{towerId: 加成}  dmgAll  fireRate  range  splash  slow  slowDur
// chain  dot  goldMul  killGold  interest  crit  armorPierce  costMul
// frostDmgBonus  lowHpDmg  projSpeed  bossDmg  baseHp
// set：可选套装标签，取值见 effects.js 的 RELIC_SET_BONUSES；同套装按不同遗物计件。
export const RELICS = [
  { id: 'sharp', name: '锐利箭簇', rarity: 'common', set: 'hunter', desc: '弩塔伤害 +25%', mods: { dmg: { arrow: 0.25 } } },
  { id: 'quickdraw', name: '急速装填', rarity: 'common', desc: '所有防御塔攻击速度 +12%', mods: { fireRate: 0.12 } },
  { id: 'eagle', name: '鹰眼徽记', rarity: 'common', set: 'hunter', desc: '所有防御塔射程 +1 格', mods: { range: 1 } },
  { id: 'bounty', name: '赏金猎人', rarity: 'common', set: 'hunter', desc: '每次击杀额外获得 2 金币', mods: { killGold: 2 } },
  { id: 'thrifty', name: '精打细算', rarity: 'common', set: 'guild', desc: '防御塔建造与升级费用 -8%', mods: { costMul: -0.08 } },
  { id: 'crystal', name: '生命结晶', rarity: 'common', desc: '立即恢复并提高 5 点基地生命', mods: { baseHp: 5 } },
  { id: 'velocity', name: '弹道加速', rarity: 'common', set: 'hunter', desc: '投射物速度 +50%，全体伤害 +6%', mods: { projSpeed: 0.5, dmgAll: 0.06 } },
  { id: 'frostglint', name: '霜纹刻印', rarity: 'common', set: 'frost', desc: '霜塔伤害 +18%', mods: { dmg: { frost: 0.18 } } },
  { id: 'venomfang', name: '淬毒护符', rarity: 'common', desc: '毒雾塔伤害 +18%', mods: { dmg: { poison: 0.18 } } },
  { id: 'sparkplug', name: '火花塞', rarity: 'common', desc: '电弧塔伤害 +15%', mods: { dmg: { arc: 0.15 } } },
  { id: 'steadyaim', name: '稳定瞄准', rarity: 'common', set: 'hunter', desc: '所有防御塔射程 +0.6 格', mods: { range: 0.6 } },
  { id: 'coinpurse', name: '鼓胀钱袋', rarity: 'common', set: 'guild', desc: '每次击杀额外获得 1 金币', mods: { killGold: 1 } },
  { id: 'sandbag', name: '沙袋工事', rarity: 'common', desc: '立即恢复并提高 3 点基地生命', mods: { baseHp: 3 } },
  { id: 'frostedge', name: '霜刃磨石', rarity: 'common', set: 'frost', desc: '霜塔伤害 +10%，减速强度 +5%', mods: { dmg: { frost: 0.1 }, slow: 0.05 } },
  { id: 'venomvial', name: '毒液小瓶', rarity: 'common', desc: '毒雾塔伤害 +10%，毒伤 +10%', mods: { dmg: { poison: 0.1 }, dot: 0.1 } },
  { id: 'spareparts', name: '备用零件', rarity: 'common', set: 'guild', desc: '建造与升级费用 -5%，每次击杀额外获得 1 金币', mods: { costMul: -0.05, killGold: 1 } },
  { id: 'scouthorn', name: '侦察号角', rarity: 'common', desc: '所有防御塔射程 +0.4 格，攻击速度 +5%', mods: { range: 0.4, fireRate: 0.05 } },
  { id: 'bloodpact', name: '血誓木牌', rarity: 'common', desc: '基地生命低于 40% 时全体伤害 +12%，暴击率 +5%', mods: { lowHpDmg: 0.12, crit: 0.05 } },

  { id: 'powder', name: '火药桶', rarity: 'rare', desc: '炮台伤害 +20%，溅射范围 +35%', mods: { dmg: { cannon: 0.2 }, splash: 0.35 } },
  { id: 'frostheart', name: '极寒之心', rarity: 'rare', set: 'frost', desc: '减速效果 +15%，持续时间 +30%', mods: { slow: 0.15, slowDur: 0.3 } },
  { id: 'static', name: '静电过载', rarity: 'rare', desc: '电弧塔伤害 +25%，连锁 +1 个目标', mods: { dmg: { arc: 0.25 }, chain: 1 } },
  { id: 'toxin', name: '毒性催化', rarity: 'rare', desc: '毒伤 +45%', mods: { dot: 0.45 } },
  { id: 'usury', name: '利滚利', rarity: 'rare', set: 'guild', desc: '每波结束获得当前金币 5% 的利息', mods: { interest: 0.05 } },
  { id: 'pierce', name: '破甲弹头', rarity: 'rare', desc: '无视 50% 护甲', mods: { armorPierce: 0.5 } },
  { id: 'crit', name: '致命一击', rarity: 'rare', set: 'hunter', desc: '攻击有 20% 概率造成双倍伤害', mods: { crit: 0.2 } },
  { id: 'bosslayer', name: '泰坦杀手', rarity: 'rare', desc: '对首领伤害 +50%', mods: { bossDmg: 0.5 } },
  { id: 'alchemy', name: '炼金秘方', rarity: 'rare', desc: '毒雾塔伤害 +25%，毒伤 +30%', mods: { dmg: { poison: 0.25 }, dot: 0.3 } },
  { id: 'siege', name: '攻城配重', rarity: 'rare', desc: '炮台伤害 +30%，射程 +0.6 格', mods: { dmg: { cannon: 0.3 }, range: 0.6 } },
  { id: 'cartel', name: '黑市商会', rarity: 'rare', set: 'guild', desc: '所有金币收入 +15%，建造与升级费用 -5%', mods: { goldMul: 0.15, costMul: -0.05 } },
  { id: 'auroraveil', name: '极光帷幕', rarity: 'rare', set: 'frost', desc: '被减速的敌人受到的所有伤害 +10%，减速持续 +20%', mods: { frostDmgBonus: 0.1, slowDur: 0.2 } },
  { id: 'skyfall', name: '天火共鸣', rarity: 'rare', desc: '溅射范围 +25%，全体伤害 +5%', mods: { splash: 0.25, dmgAll: 0.05 } },
  { id: 'gamblerscoin', name: '赌徒金币', rarity: 'rare', desc: '攻击有 12% 概率造成双倍伤害，每波结束额外获得当前金币 3% 的利息', mods: { crit: 0.12, interest: 0.03 } },

  { id: 'warlord', name: '战争领主', rarity: 'epic', desc: '所有防御塔伤害 +18%', mods: { dmgAll: 0.18 } },
  { id: 'warhorn', name: '战争号角', rarity: 'epic', desc: '所有防御塔攻击速度 +25%', mods: { fireRate: 0.25 } },
  { id: 'frostbite', name: '寒霜易伤', rarity: 'epic', set: 'frost', desc: '被减速的敌人受到的所有伤害 +20%', mods: { frostDmgBonus: 0.2 } },
  { id: 'laststand', name: '背水一战', rarity: 'epic', desc: '基地生命低于 40% 时，全体伤害 +35%', mods: { lowHpDmg: 0.35 } },
  { id: 'greed', name: '贪婪之神', rarity: 'epic', set: 'guild', desc: '所有金币收入 +30%', mods: { goldMul: 0.3 } },
  { id: 'bastion', name: '钢铁壁垒', rarity: 'epic', desc: '立即恢复并提高 10 点基地生命', mods: { baseHp: 10 } },
  { id: 'eclipsehour', name: '蚀时印记', rarity: 'epic', desc: '所有防御塔攻击速度 +18%，射程 +0.5 格', mods: { fireRate: 0.18, range: 0.5 } },
  { id: 'bloodtide', name: '血潮契约', rarity: 'epic', desc: '基地生命低于 40% 时全体伤害 +30%，每次击杀额外获得 2 金币', mods: { lowHpDmg: 0.3, killGold: 2 } },
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
