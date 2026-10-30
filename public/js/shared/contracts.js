// 契约卡（§5）：五条契约的确定性候选生成与代价/收益即时结算。
// 纯数据 + 纯函数：无 DOM、无 Math.random、不 import sim/render，前后端共用。
// 依赖方向：contracts.js -> data/relics.js、factions.js，不反向，无循环。
// 种子流（§9）：契约 ${seed}:contract:${wave}，不触碰 combatRng。
import { RNG } from './rng.js';
import {
  RELICS,
  RELIC_MAX_LEVEL,
  normalizeRelicStates,
} from './data/relics.js';
import { FACTION_ORDER } from './factions.js';

// 契约 id 清单（§5.2）：导出名与冻结表 §8.1 逐符号对齐。
export const CONTRACT_IDS = ['blood', 'debt', 'poverty', 'sloth', 'burn'];

// 契约出现波次（§5.1）：9 / 14 / 19 / 24。
export const CONTRACT_WAVES = [9, 14, 19, 24];

// 每局最多接受次数（§5.1）。
export const CONTRACT_MAX_PER_RUN = 2;

// 稀有度排序：common < rare < epic；「稀有以上」= rare/epic。
function rarityRank(rarity) {
  if (rarity === 'epic') return 2;
  if (rarity === 'rare') return 1;
  return 0;
}

// 五条契约定义（§5.2）。cost/benefit 为结构化条款数组，名称与描述文案走 i18n
// 的 contract.<id>.name / contract.<id>.desc；chip.scope 决定「本波/本局」标注。
export const CONTRACTS = Object.freeze({
  blood: Object.freeze({
    id: 'blood',
    nameKey: 'contract.blood.name',
    descKey: 'contract.blood.desc',
    needsFaction: true,
    cost: Object.freeze([Object.freeze({ kind: 'maxHp', amount: 2 })]),
    benefit: Object.freeze([Object.freeze({ kind: 'factionRelic', minRarity: 'rare' })]),
    chip: Object.freeze({ scope: 'run' }),
  }),
  debt: Object.freeze({
    id: 'debt',
    nameKey: 'contract.debt.name',
    descKey: 'contract.debt.desc',
    needsFaction: false,
    cost: Object.freeze([
      Object.freeze({ kind: 'goldPct', pct: 0.35, minKeep: 60 }),
      Object.freeze({ kind: 'rerolls', amount: 1 }),
    ]),
    benefit: Object.freeze([Object.freeze({ kind: 'epicRelic' })]),
    chip: Object.freeze({ scope: 'run' }),
  }),
  poverty: Object.freeze({
    id: 'poverty',
    nameKey: 'contract.poverty.name',
    descKey: 'contract.poverty.desc',
    needsFaction: true,
    cost: Object.freeze([Object.freeze({ kind: 'nextOfferCount', count: 2 })]),
    benefit: Object.freeze([Object.freeze({ kind: 'bonusPoints', amount: 2 })]),
    chip: Object.freeze({ scope: 'wave' }),
  }),
  sloth: Object.freeze({
    id: 'sloth',
    nameKey: 'contract.sloth.name',
    descKey: 'contract.sloth.desc',
    needsFaction: false,
    cost: Object.freeze([Object.freeze({ kind: 'nextWaveFireRate', pct: 0.12 })]),
    benefit: Object.freeze([
      Object.freeze({ kind: 'gold', amount: 150 }),
      Object.freeze({ kind: 'hp', amount: 2 }),
    ]),
    chip: Object.freeze({ scope: 'wave' }),
  }),
  burn: Object.freeze({
    id: 'burn',
    nameKey: 'contract.burn.name',
    descKey: 'contract.burn.desc',
    needsFaction: true,
    cost: Object.freeze([Object.freeze({ kind: 'burnRelic' })]),
    benefit: Object.freeze([Object.freeze({ kind: 'bonusPoints', amount: 3 })]),
    chip: Object.freeze({ scope: 'run' }),
  }),
});

export function isContractWave(wave) {
  return CONTRACT_WAVES.includes(Number(wave));
}

// 独立种子流（§9）：${seed}:contract:${wave}。
export function contractSeed(seed, wave) {
  return `${seed}:contract:${wave}`;
}

// 局内契约记录（§5.3）：{ id, wave, scope, untilWave }；非法/未知 id 剔除。
export function normalizeContractRecords(records) {
  const out = [];
  for (const record of Array.isArray(records) ? records : []) {
    if (!record || !CONTRACTS[record.id]) continue;
    const wave = Math.max(0, Math.floor(Number(record.wave) || 0));
    const scope = CONTRACTS[record.id].chip.scope;
    const untilWave =
      scope === 'wave' ? Math.max(1, Math.floor(Number(record.untilWave) || wave + 1)) : null;
    out.push({ id: record.id, wave, scope, untilWave });
  }
  return out;
}

// 派系 bonusPoints 覆盖层（§2.2/§5.2）：仅五个非中立派系出键，单派系钳到 0..3。
export function normalizeBonusPoints(points) {
  const out = {};
  if (!points || typeof points !== 'object') return out;
  for (const faction of FACTION_ORDER) {
    out[faction] = Math.max(0, Math.min(3, Math.floor(Number(points[faction]) || 0)));
  }
  return out;
}

// 焚契是否可选：必须存在一件未满级已拥有遗物。
function isEligible(id, ownedStates) {
  if (id !== 'burn') return true;
  return ownedStates.some((state) => state.level < RELIC_MAX_LEVEL);
}

// 已拥有遗物里未满级的一件；none 时返回 null。
function nonMaxedOwned(ownedStates) {
  return ownedStates.find((state) => state.level < RELIC_MAX_LEVEL) || null;
}

// 解析一条契约的确定性目标（目标派系 / 授予遗物 / 焚毁遗物）。
// 调用前已保证 isEligible；rng 消费顺序固定，同一输入完全可复现。
function resolveTargets(id, rng, ownedStates) {
  const levels = new Map(ownedStates.map((state) => [state.id, state.level]));
  const notMaxed = (relic) => (levels.get(relic.id) || 0) < RELIC_MAX_LEVEL;

  if (id === 'blood') {
    const factions = FACTION_ORDER.filter((faction) =>
      RELICS.some(
        (relic) => relic.faction === faction && rarityRank(relic.rarity) >= 1 && notMaxed(relic)
      )
    );
    const faction = rng.pick(factions.length ? factions : FACTION_ORDER);
    let pool = RELICS.filter(
      (relic) => relic.faction === faction && rarityRank(relic.rarity) >= 1 && notMaxed(relic)
    );
    // 极端空窗兜底：该派系稀有以上全部满级时退回该派系任意未满级遗物。
    if (!pool.length) pool = RELICS.filter((relic) => relic.faction === faction && notMaxed(relic));
    const relic = rng.pick(pool);
    return { faction, grantRelicId: relic?.id ?? null, burnRelicId: null };
  }

  if (id === 'debt') {
    let pool = RELICS.filter((relic) => relic.rarity === 'epic' && notMaxed(relic));
    if (!pool.length) pool = RELICS.filter((relic) => rarityRank(relic.rarity) >= 1 && notMaxed(relic));
    const relic = rng.pick(pool);
    return { faction: null, grantRelicId: relic?.id ?? null, burnRelicId: null };
  }

  if (id === 'poverty') {
    return { faction: rng.pick(FACTION_ORDER), grantRelicId: null, burnRelicId: null };
  }

  if (id === 'sloth') {
    return { faction: null, grantRelicId: null, burnRelicId: null };
  }

  // burn
  const target = nonMaxedOwned(ownedStates);
  return { faction: rng.pick(FACTION_ORDER), grantRelicId: null, burnRelicId: target?.id ?? null };
}

// 契约候选（§5.1/§5.3）：仅在 9/14/19/24 波返回非 null；达到每局 2 次上限返回 null。
// state 只读字段冻结为 accepted/relics（其余为 applyContract 的结算输入）。
// 返回已解析的契约卡：含 kind/id/nameKey/descKey/cost/benefit/chip 与
// faction/grantRelicId/burnRelicId/untilWave；客户端不得自造候选。
export function rollContractOffer(seed, wave, state = {}) {
  const w = Number(wave);
  if (!isContractWave(w)) return null;
  const accepted = Math.max(0, Math.floor(Number(state?.accepted) || 0));
  if (accepted >= CONTRACT_MAX_PER_RUN) return null;

  const ownedStates = normalizeRelicStates(state?.relics || []);
  const eligible = CONTRACT_IDS.filter((id) => isEligible(id, ownedStates));
  if (!eligible.length) return null;

  const rng = new RNG(contractSeed(String(seed), w));
  const id = rng.pick(eligible);
  const def = CONTRACTS[id];
  const targets = resolveTargets(id, rng, ownedStates);

  return {
    kind: 'contract',
    id,
    nameKey: def.nameKey,
    descKey: def.descKey,
    cost: def.cost,
    benefit: def.benefit,
    chip: def.chip,
    faction: targets.faction,
    grantRelicId: targets.grantRelicId,
    burnRelicId: targets.burnRelicId,
    untilWave: def.chip.scope === 'wave' ? w + 1 : null,
  };
}

// 授予遗物（血契/债契）：未拥有则新增 Ⅰ 级，已拥有未满级则 +1，满级不变。
function grantRelic(states, id) {
  if (!id) return states;
  const next = states.map((state) => ({ ...state }));
  const existing = next.find((state) => state.id === id);
  if (existing) {
    if (existing.level < RELIC_MAX_LEVEL) existing.level += 1;
  } else {
    next.push({ id, level: 1 });
  }
  return next;
}

// 焚毁遗物（焚契）：从已拥有遗物中整件移除。
function burnRelic(states, id) {
  if (!id) return states;
  return states.filter((state) => state.id !== id).map((state) => ({ ...state }));
}

// 默认目标（无 RNG 的确定性回退，供只拿 id 的调用方/测试使用）：
// 血契取首个有稀有以上未满级遗物的派系与首个该派系稀有以上遗物；
// 债契取首个未满级史诗；贫契/焚契取第一个派系；焚契焚毁首件未满级已拥有遗物。
function defaultTargets(id, ownedStates) {
  const levels = new Map(ownedStates.map((state) => [state.id, state.level]));
  const notMaxed = (relic) => (levels.get(relic.id) || 0) < RELIC_MAX_LEVEL;
  if (id === 'blood') {
    const faction = FACTION_ORDER.find((f) =>
      RELICS.some((relic) => relic.faction === f && rarityRank(relic.rarity) >= 1 && notMaxed(relic))
    ) ?? FACTION_ORDER[0];
    const relic = RELICS.find(
      (r) => r.faction === faction && rarityRank(r.rarity) >= 1 && notMaxed(r)
    ) ?? RELICS.find((r) => r.faction === faction);
    return { faction, grantRelicId: relic?.id ?? null, burnRelicId: null };
  }
  if (id === 'debt') {
    const relic = RELICS.find((r) => r.rarity === 'epic' && notMaxed(r))
      ?? RELICS.find((r) => rarityRank(r.rarity) >= 1 && notMaxed(r));
    return { faction: null, grantRelicId: relic?.id ?? null, burnRelicId: null };
  }
  if (id === 'poverty' || id === 'burn') {
    return { faction: FACTION_ORDER[0], grantRelicId: null, burnRelicId: nonMaxedOwned(ownedStates)?.id ?? null };
  }
  return { faction: null, grantRelicId: null, burnRelicId: null };
}

function resolveChoice(contractId, ownedStates) {
  if (contractId && typeof contractId === 'object') {
    return {
      id: contractId.id,
      faction: contractId.faction ?? null,
      grantRelicId: contractId.grantRelicId ?? null,
      burnRelicId: contractId.burnRelicId ?? null,
    };
  }
  return { id: contractId, ...defaultTargets(contractId, ownedStates) };
}

// 契约结算（§5.2/§5.3）：代价先于收益；代价不成立时整卡不可用（返回 ok:false，
// state 为原样回传，不消耗选择）。contractId 可为契约 id 字符串，也可为
// rollContractOffer 解析后的契约卡对象（含 id/faction/grantRelicId/burnRelicId）。
// 返回 { ok, reason, state, event }，其中 state 为结算后的完整状态（含
// accepted/gold/hp/maxHp/rerolls/relics/bonusPoints/contracts/nextOfferCount）。
export function applyContract(state = {}, contractId) {
  const def = CONTRACTS[typeof contractId === 'object' ? contractId?.id : contractId];
  if (!def) return { ok: false, reason: 'unknown', state: null, event: null };

  const owned = normalizeRelicStates(state.relics || []);
  const choice = resolveChoice(contractId, owned);

  const gold = Math.max(0, Number(state.gold) || 0);
  const maxHp = Math.max(1, Math.floor(Number(state.maxHp) || 0));
  const hp = Math.max(1, Math.min(maxHp, Math.floor(Number(state.hp) || 0)));
  const rerolls = Math.max(0, Math.floor(Number(state.rerolls) || 0));
  const bonusPoints = normalizeBonusPoints(state.bonusPoints);
  const contracts = normalizeContractRecords(state.contracts);
  const wave = Math.max(0, Math.floor(Number(state.wave) || 0));

  // 代价先判成立；任一不成立整卡不可用。
  if (def.id === 'debt' && rerolls < 1) {
    return { ok: false, reason: 'unaffordable', state: null, event: null };
  }
  if (def.id === 'burn' && !choice.burnRelicId) {
    return { ok: false, reason: 'unaffordable', state: null, event: null };
  }

  // 代价结算。
  let nextGold = gold;
  let nextHp = hp;
  let nextMaxHp = maxHp;
  let nextRerolls = rerolls;
  let nextOfferCount = Number.isFinite(Number(state.nextOfferCount))
    ? Math.max(0, Math.floor(Number(state.nextOfferCount)))
    : null;

  if (def.id === 'blood') {
    nextMaxHp = Math.max(1, maxHp - 2);
    nextHp = Math.max(1, Math.min(hp - 2, nextMaxHp));
  } else if (def.id === 'debt') {
    nextGold = Math.max(60, Math.floor(gold * 0.65));
    nextRerolls = rerolls - 1;
  } else if (def.id === 'poverty') {
    nextOfferCount = 2;
  }
  // sloth 的攻速代价不进 state（由 contracts 记录按 untilWave 派生），
  // 本处只结收益：+150 金币、+2 生命。

  // 收益结算。
  let nextRelics = owned.map((s) => ({ ...s }));
  let nextBonus = { ...bonusPoints };

  if (def.id === 'blood' || def.id === 'debt') {
    nextRelics = grantRelic(nextRelics, choice.grantRelicId);
  } else if (def.id === 'burn') {
    nextRelics = burnRelic(nextRelics, choice.burnRelicId);
    nextBonus[choice.faction] = Math.max(0, Math.min(3, (nextBonus[choice.faction] || 0) + 3));
  } else if (def.id === 'poverty') {
    nextBonus[choice.faction] = Math.max(0, Math.min(3, (nextBonus[choice.faction] || 0) + 2));
  } else if (def.id === 'sloth') {
    nextGold += 150;
    nextHp = Math.min(maxHp, nextHp + 2);
  }

  const untilWave = def.chip.scope === 'wave' ? wave + 1 : null;
  const record = { id: def.id, wave, scope: def.chip.scope, untilWave };
  const nextState = {
    accepted: Math.max(0, Math.floor(Number(state.accepted) || 0)) + 1,
    gold: nextGold,
    hp: nextHp,
    maxHp: nextMaxHp,
    rerolls: nextRerolls,
    relics: nextRelics,
    bonusPoints: nextBonus,
    contracts: [...contracts, record],
    nextOfferCount: nextOfferCount,
    wave,
  };

  return {
    ok: true,
    reason: null,
    state: nextState,
    event: { type: 'contract_accepted', wave, id: def.id, cost: def.cost, benefit: def.benefit },
  };
}
