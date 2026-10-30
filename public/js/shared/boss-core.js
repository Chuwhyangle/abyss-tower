// 首领核心（§4）：五类核心候选的确定性生成与即时效果结算。
// 纯数据 + 纯函数：无 DOM、无 Math.random、不 import sim/render，前后端共用。
// 依赖方向：boss-core.js -> data/relics.js（RELIC_BY_ID 等），不反向，无循环。
import { RNG } from './rng.js';
import {
  RELICS,
  RELIC_BY_ID,
  RELIC_MAX_LEVEL,
  normalizeRelicStates,
} from './data/relics.js';

// 固定首领波：清波即发放（§4.1）。
export const CORE_WAVES = [5, 10, 15, 20, 25];

// 五类核心（§4.2）。
export const CORE_KINDS = ['upgrade', 'search', 'awakening', 'doctrine', 'supply'];

// 教义 id 清单（§6.2）：词条内容由 AC-059 落地，此处仅用于核心候选的确定性引用。
export const DOCTRINE_IDS = ['arc', 'bolt', 'cannon', 'frost', 'poison'];

// 非中立派系池：搜寻候选从这五个派系里抽（§4.2，与 relics.js 的信物三选一同口径）。
const SEARCH_FACTIONS = ['fire', 'frost', 'venom', 'storm', 'warden'];

// 五类核心的元信息：id + 可用波次/上限（名称文案走 i18n 的 bossCore.kind.*）。
export const BOSS_CORES = Object.freeze({
  upgrade: Object.freeze({ id: 'upgrade', targetMax: RELIC_MAX_LEVEL }),
  search: Object.freeze({ id: 'search', minWave: 5 }),
  awakening: Object.freeze({ id: 'awakening', minWave: 10 }),
  doctrine: Object.freeze({ id: 'doctrine', minWave: 10, maxPerRun: 2 }),
  supply: Object.freeze({ id: 'supply', waveOnly: 5 }),
});

// 补给选项的固定载荷（§4.2）。
export const SUPPLY_OPTIONS = Object.freeze([
  Object.freeze({ type: 'maxHp', amount: 2 }),
  Object.freeze({ type: 'gold', amount: 80 }),
  Object.freeze({ type: 'reroll', amount: 1 }),
]);

export function isBossCoreWave(wave) {
  return CORE_WAVES.includes(Number(wave));
}

// 独立种子流（§9）：核心 ${seed}:core:${wave}；不触碰 combatRng。
export function bossCoreSeed(seed, wave) {
  return `${seed}:core:${wave}`;
}

// 搜寻子抽取的独立种子流（§9）：${seed}:core:${wave}:search。
export function bossCoreSearchSeed(seed, wave) {
  return `${seed}:core:${wave}:search`;
}

// 升阶候选：全部未满级遗物（§4.2）。
function upgradeOptions(states) {
  return states
    .filter((state) => state.level < RELIC_MAX_LEVEL)
    .map((state) => ({ id: state.id, fromLevel: state.level, toLevel: state.level + 1 }));
}

// 搜寻候选：先选非中立派系，再从该派系抽 3 件遗物（15 波起可出现史诗）。
function searchOffer(seed, wave, levels) {
  const rng = new RNG(bossCoreSearchSeed(seed, wave));
  const eligible = RELICS.filter((relic) => {
    if (!SEARCH_FACTIONS.includes(relic.faction)) return false;
    if (relic.rarity === 'epic' && wave < 15) return false;
    if ((levels.get(relic.id) || 0) >= RELIC_MAX_LEVEL) return false;
    return true;
  });
  const factions = SEARCH_FACTIONS.filter((faction) => eligible.some((relic) => relic.faction === faction));
  const faction = rng.pick(factions);
  if (!faction) return { kind: 'search', faction: null, options: [] };
  const options = rng
    .shuffle(eligible.filter((relic) => relic.faction === faction))
    .slice(0, 3)
    .map((relic) => ({ id: relic.id, toLevel: Math.min(RELIC_MAX_LEVEL, (levels.get(relic.id) || 0) + 1) }));
  return { kind: 'search', faction, options };
}

// 觉醒候选：已拥有 Ⅲ 级遗物各一条引用；awakeningId 由 AC-060 落地（§7.2）。
function awakeningOffer(states) {
  return {
    kind: 'awakening',
    options: states
      .filter((state) => state.level >= RELIC_MAX_LEVEL)
      .map((state) => ({ relicId: state.id, awakeningId: null })),
  };
}

// 教义候选：从 3 条未选教义中选 1（§4.2）；词条内容由 AC-059 落地（§6）。
function doctrineOffer(seed, wave, taken) {
  const rng = new RNG(`${bossCoreSeed(seed, wave)}:doctrine`);
  const pool = DOCTRINE_IDS.filter((id) => !(taken || []).includes(id));
  const options = rng
    .shuffle(pool.length ? pool : DOCTRINE_IDS)
    .slice(0, 3)
    .map((doctrineId) => ({ doctrineId }));
  return { kind: 'doctrine', options };
}

function buildBossCoreOffer(kind, { seed, wave, states, doctrineTaken }) {
  if (kind === 'upgrade') {
    return { kind: 'upgrade', targetMax: RELIC_MAX_LEVEL, options: upgradeOptions(states) };
  }
  if (kind === 'search') {
    const levels = new Map(states.map((state) => [state.id, state.level]));
    return searchOffer(seed, wave, levels);
  }
  if (kind === 'supply') {
    return { kind: 'supply', options: SUPPLY_OPTIONS.map((option) => ({ ...option })) };
  }
  if (kind === 'awakening') return awakeningOffer(states);
  if (kind === 'doctrine') return doctrineOffer(seed, wave, doctrineTaken);
  return { kind, options: [] };
}

// 首领核心三选一（§4.2 约束）：恰好 3 个 kind 互不重复、每次都含 upgrade；
// wave<10 不出觉醒/教义；wave===5 出补给；wave>=10 觉醒/教义进入候选；同一输入完全可复现。
export function rollBossCoreOffers(seed, wave, relicStates = [], opts = {}) {
  const w = Number(wave);
  const states = normalizeRelicStates(relicStates);
  const hasTier3 = states.some((state) => state.level >= RELIC_MAX_LEVEL);
  const doctrineTaken = Math.max(0, Number(opts.doctrineTaken) || 0);

  const extraPool = ['search'];
  if (w >= 10) {
    if (hasTier3) extraPool.push('awakening');
    if (doctrineTaken < BOSS_CORES.doctrine.maxPerRun) extraPool.push('doctrine');
  }
  if (w === 5) extraPool.push('supply');

  const rng = new RNG(bossCoreSeed(seed, w));
  const extras = rng.shuffle(extraPool);
  const picked = extras.slice(0, 2);
  // 极端空窗（波 >= 10 且觉醒/教义均不可用）时补给兜底，保证恰好 3 选 1（§4.2 的「兜底」角色）。
  while (picked.length < 2) picked.push('supply');

  return ['upgrade', ...picked].map((kind) =>
    buildBossCoreOffer(kind, { seed, wave: w, states, doctrineTaken })
  );
}

// 与冻结表 §8.1 的导出名对齐（cores.js 未来可用此名）。
export const rollCoreOffers = rollBossCoreOffers;

// 首领核心即时效果（§4.3）：升阶/搜寻/补给即时生效，觉醒/教义只记录不可逆选择引用。
// choice: { kind, option }（option 必须来自本次 offers）；relicStates: [{ id, level }]。
// 返回增量对象：relics 为结算后的完整遗物状态；gold/baseHp/maxBaseHp/rerolls 为增量；
// doctrines/awakenings/coreTaken 为待追加记录（事件体由调用方补 wave/seedKey）。
export function applyBossCore(choice, relicStates = []) {
  const kind = choice?.kind ?? null;
  const option = choice?.option ?? null;
  const states = normalizeRelicStates(relicStates);
  const delta = {
    relics: states.map((state) => ({ ...state })),
    gold: 0,
    baseHp: 0,
    maxBaseHp: 0,
    rerolls: 0,
    doctrines: [],
    awakenings: [],
    coreTaken: [],
  };
  if (!kind) return delta;

  const find = (id) => delta.relics.find((state) => state.id === id);
  const setLevel = (id, level) => {
    const next = Math.max(1, Math.min(RELIC_MAX_LEVEL, Math.floor(Number(level) || 1)));
    const existing = find(id);
    if (existing) existing.level = next;
    else delta.relics.push({ id, level: next });
  };

  if (kind === 'upgrade') {
    if (option && RELIC_BY_ID[option.id]) {
      const fromLevel = find(option.id)?.level ?? 0;
      const toLevel = Math.min(RELIC_MAX_LEVEL, Math.max(option.toLevel || 1, fromLevel + 1));
      setLevel(option.id, toLevel);
      delta.coreTaken.push({ kind, choice: { relicId: option.id } });
    } else {
      // 无可升级遗物：补金币 + 修复兜底。
      delta.gold += 60;
      delta.baseHp += 2;
      delta.coreTaken.push({ kind, choice: { fallback: 'supply' } });
    }
    return delta;
  }

  if (kind === 'search') {
    if (option && RELIC_BY_ID[option.id]) {
      const fromLevel = find(option.id)?.level ?? 0;
      const toLevel = Math.min(RELIC_MAX_LEVEL, Math.max(option.toLevel || 1, fromLevel + 1));
      setLevel(option.id, toLevel);
    }
    delta.coreTaken.push({ kind, choice: option ? { relicId: option.id } : null });
    return delta;
  }

  if (kind === 'supply') {
    const type = option?.type;
    const amount = Math.max(0, Math.floor(Number(option?.amount) || 0));
    if (type === 'gold') delta.gold += amount;
    else if (type === 'maxHp') {
      delta.maxBaseHp += amount;
      delta.baseHp += amount;
    } else if (type === 'reroll') delta.rerolls += amount;
    delta.coreTaken.push({ kind, choice: option ? { type, amount } : null });
    return delta;
  }

  if (kind === 'awakening') {
    if (option?.relicId) {
      delta.awakenings.push({ relicId: option.relicId, awakeningId: option.awakeningId ?? null });
    }
    delta.coreTaken.push({
      kind,
      choice: option ? { relicId: option.relicId, awakeningId: option.awakeningId ?? null } : null,
    });
    return delta;
  }

  if (kind === 'doctrine') {
    const doctrineId = option?.doctrineId ?? null;
    if (doctrineId) delta.doctrines.push(String(doctrineId));
    delta.coreTaken.push({ kind, choice: doctrineId ? { doctrineId: String(doctrineId) } : null });
    return delta;
  }

  return delta;
}

// 与冻结表 §8.1 的导出名对齐。
export const applyCore = applyBossCore;
