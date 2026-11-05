// 遗物注册表：70 件遗物定义、等级缩放与确定性抽取；服务端与浏览器共用。
// 定义按件拆分在 ./ 下的 <relic-id>.js，本文件一次性 import 全部并按固定顺序组装。
// 后续新增遗物 = 新增自己的文件 + DEFINITIONS 追加 1 行，不再改本文件。
// mods 键说明与条件型键（lowHpDmg / richDmg / emptySlotDmg）见 shared/effects.js 的 EFFECT_REGISTRY。
import { RNG } from '../../rng.js';
import { TOWERS } from '../towers.js';
import { capEffect, effectText, roundEffect } from '../../effects.js';

import sharp from './sharp.js';
import quickdraw from './quickdraw.js';
import eagle from './eagle.js';
import bounty from './bounty.js';
import thrifty from './thrifty.js';
import crystal from './crystal.js';
import velocity from './velocity.js';
import frostglint from './frostglint.js';
import venomfang from './venomfang.js';
import sparkplug from './sparkplug.js';
import steadyaim from './steadyaim.js';
import coinpurse from './coinpurse.js';
import sandbag from './sandbag.js';
import frostedge from './frostedge.js';
import venomvial from './venomvial.js';
import spareparts from './spareparts.js';
import scouthorn from './scouthorn.js';
import bloodpact from './bloodpact.js';
import bloodstake from './bloodstake.js';
import highroller from './highroller.js';
import moonwell from './moonwell.js';
import embertrace from './embertrace.js';
import desperado from './desperado.js';
import goldencoffer from './goldencoffer.js';
import openfield from './openfield.js';
import harvestsickle from './harvestsickle.js';
import emberclock from './emberclock.js';
import frostlattice from './frostlattice.js';
import gambitseal from './gambitseal.js';
import powder from './powder.js';
import frostheart from './frostheart.js';
import staticRelic from './static.js';
import toxin from './toxin.js';
import usury from './usury.js';
import pierce from './pierce.js';
import crit from './crit.js';
import bosslayer from './bosslayer.js';
import alchemy from './alchemy.js';
import siege from './siege.js';
import cartel from './cartel.js';
import auroraveil from './auroraveil.js';
import skyfall from './skyfall.js';
import gamblerscoin from './gamblerscoin.js';
import adrenaline from './adrenaline.js';
import martyr from './martyr.js';
import cometcore from './cometcore.js';
import warchest from './warchest.js';
import lastbreath from './lastbreath.js';
import bloodybanner from './bloodybanner.js';
import lightsentry from './lightsentry.js';
import bloodmoney from './bloodmoney.js';
import tideglass from './tideglass.js';
import metronome from './metronome.js';
import starcycle from './starcycle.js';
import moonlitvault from './moonlitvault.js';
import warlord from './warlord.js';
import warhorn from './warhorn.js';
import frostbite from './frostbite.js';
import laststand from './laststand.js';
import greed from './greed.js';
import bastion from './bastion.js';
import eclipsehour from './eclipsehour.js';
import bloodtide from './bloodtide.js';
import doomclock from './doomclock.js';
import stasislens from './stasislens.js';
import starforge from './starforge.js';
import midasthrone from './midasthrone.js';
import palaceguard from './palaceguard.js';
import eternalhourglass from './eternalhourglass.js';
import stormpulse from './stormpulse.js';

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

// 固定顺序：同 seed 抽卡与信物三选一都依赖它保持稳定（顺序即原 RELICS 数组序，不得重排）。
const DEFINITIONS = [
  sharp,
  quickdraw,
  eagle,
  bounty,
  thrifty,
  crystal,
  velocity,
  frostglint,
  venomfang,
  sparkplug,
  steadyaim,
  coinpurse,
  sandbag,
  frostedge,
  venomvial,
  spareparts,
  scouthorn,
  bloodpact,
  bloodstake,
  highroller,
  moonwell,
  embertrace,
  desperado,
  goldencoffer,
  openfield,
  harvestsickle,
  emberclock,
  frostlattice,
  gambitseal,
  powder,
  frostheart,
  staticRelic,
  toxin,
  usury,
  pierce,
  crit,
  bosslayer,
  alchemy,
  siege,
  cartel,
  auroraveil,
  skyfall,
  gamblerscoin,
  adrenaline,
  martyr,
  cometcore,
  warchest,
  lastbreath,
  bloodybanner,
  lightsentry,
  bloodmoney,
  tideglass,
  metronome,
  starcycle,
  moonlitvault,
  warlord,
  warhorn,
  frostbite,
  laststand,
  greed,
  bastion,
  eclipsehour,
  bloodtide,
  doomclock,
  stasislens,
  starforge,
  midasthrone,
  palaceguard,
  eternalhourglass,
  stormpulse,
];

export const RELICS = DEFINITIONS;
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

// 遗物等级行为词条（P1-9）：Ⅱ/Ⅲ 级解锁的机制型效果（非纯数值），数据驱动、sim 按等级消费。
// 每条词条自描述 { id, kind, towerType, ...params }：kind 决定 sim 结算点，params 是纯数据。
// Ⅱ 级词条在 Ⅲ 级仍生效（按等级累积补挂）；无 behaviors 字段的遗物返回空数组。
export function relicBehaviorsAtLevel(relicOrId, level = 1) {
  const relic = typeof relicOrId === 'string' ? RELIC_BY_ID[relicOrId] : relicOrId;
  if (!relic || !relic.behaviors) return [];
  const lv = clampLevel(level);
  const out = [];
  if (lv >= 2) out.push(...(relic.behaviors['Ⅱ'] || []));
  if (lv >= 3) out.push(...(relic.behaviors['Ⅲ'] || []));
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

