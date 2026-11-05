// 效果注册表：遗物 mod 键的唯一声明处。
// 每个键在这里声明单件上限（cap）、汇总上限（globalCap）、文案（text）与平衡权重
// （balanceWeight），并可挂载聚合钩子（apply）与命中条件（hitCondition）。
// 未在此声明的键在读取时一律明确报错，不会被 sim 静默忽略。
// 键的定义按领域拆分在 ./effects/ 下（base/skill/periodic），本文件按固定顺序合并，
// 顺序即原 EFFECT_REGISTRY 键序，globalModCaps 与 hitBonuses 都据此派生，不得重排。
import makeBaseEffects from './effects/base.js';
import makeSkillEffects from './effects/skill.js';
import makePeriodicEffects from './effects/periodic.js';

const pct = (value) => `${Math.round(value * 100)}%`;

// ---------- 条件型效果的上下文 ----------
// 条件增伤只读取本局状态快照：快照与判定都是纯函数，不修改 sim、不消耗随机数，
// 因此可以在单测里直接构造快照，也不会影响固定种子结算的 RNG 顺序。
export const CONDITION_THRESHOLDS = Object.freeze({
  lowHpRatio: 0.4, // 基地生命低于上限的 40%
  richGold: 400, // 金币储备达到 400
  emptySlots: 8, // 可建造格中至少剩 8 个空位
});

export function countEmptyBuildableSlots(sim) {
  const buildable = sim?.map?.buildable;
  if (!Array.isArray(buildable)) return 0;
  let total = 0;
  for (const row of buildable) {
    if (!Array.isArray(row)) continue;
    for (const cell of row) if (cell) total++;
  }
  return Math.max(0, total - (sim.towers?.length || 0));
}

export function conditionSnapshot(sim) {
  const maxHp = Number(sim?.maxBaseHp) || 0;
  const hp = Number(sim?.baseHp) || 0;
  return Object.freeze({
    // 上限缺失时视为满血，条件不触发。
    hpRatio: maxHp > 0 ? Math.max(0, hp) / maxHp : 1,
    gold: Number(sim?.gold) || 0,
    emptySlots: countEmptyBuildableSlots(sim),
  });
}

export function isLowHpState(context) {
  return context.hpRatio < CONDITION_THRESHOLDS.lowHpRatio;
}

export function isRichState(context) {
  return context.gold >= CONDITION_THRESHOLDS.richGold;
}

export function hasEmptySlots(context) {
  return context.emptySlots >= CONDITION_THRESHOLDS.emptySlots;
}

// 按领域拆分片段并合并：base（伤害/攻速/经济/条件增伤等）→ skill（技能系）→ periodic（回合型）。
// 键序与合并前的 EFFECT_REGISTRY 完全一致（base 22 + skill 2 + periodic 6 = 30 键）。
export const EFFECT_REGISTRY = {
  ...makeBaseEffects({ pct, CONDITION_THRESHOLDS, isLowHpState, isRichState, hasEmptySlots, conditionSnapshot }),
  ...makeSkillEffects({ pct }),
  ...makePeriodicEffects({ pct, healBase }),
};

function healBase(sim, value) {
  const before = sim.baseHp;
  sim.baseHp = Math.min(sim.maxBaseHp, sim.baseHp + value);
  if (sim.baseHp > before) {
    sim.addEffect?.({ kind: 'heal', x: sim.map.base.x, y: sim.map.base.y, ttl: 0.8 });
  }
}

// 遗物套装：按“不同遗物”计件（重复获得同一遗物只提升等级，不重复计数），
// 达到 2/4 件阈值时追加一组效果。加成只引用已注册的 mod 键，
// 因此自动沿用该键的单件上限、全局上限与文案。
export const RELIC_SET_BONUSES = {
  hunter: {
    name: '猎手同盟',
    tiers: [
      { pieces: 2, mods: { fireRate: 0.06 } },
      { pieces: 4, mods: { crit: 0.08 } },
    ],
  },
  frost: {
    name: '霜寒契约',
    tiers: [
      { pieces: 2, mods: { slow: 0.05 } },
      { pieces: 4, mods: { frostDmgBonus: 0.1 } },
    ],
  },
  guild: {
    name: '商道同盟',
    tiers: [
      { pieces: 2, mods: { killGold: 1 } },
      { pieces: 4, mods: { goldMul: 0.1 } },
    ],
  },
  gambit: {
    name: '孤注同盟',
    tiers: [
      { pieces: 2, mods: { lowHpDmg: 0.06 } },
      { pieces: 4, mods: { crit: 0.06 } },
    ],
  },
  synergy: {
    name: '星轨共鸣',
    tiers: [
      { pieces: 2, mods: { fireRate: 0.05 } },
      { pieces: 4, mods: { dot: 0.12 } },
    ],
  },
  reserve: {
    name: '蓄势同盟',
    tiers: [
      { pieces: 2, mods: { richDmg: 0.03 } },
      { pieces: 4, mods: { emptySlotDmg: 0.05 } },
    ],
  },
};

function getRelicSet(setId) {
  const set = RELIC_SET_BONUSES[setId];
  if (!set) throw new Error(`未注册的遗物套装: ${setId}（请先在 RELIC_SET_BONUSES 中声明）`);
  return set;
}

// 已生效的套装档位（按阈值升序）；件数不足 2 时返回空数组。
export function relicSetTierBonuses(setId, pieces) {
  const count = Math.max(0, Math.floor(Number(pieces) || 0));
  return getRelicSet(setId).tiers.filter((tier) => count >= tier.pieces);
}

// 只读查询：效果键的周期声明；非回合型返回 null。图鉴等只读界面用它展示触发周期。
export function effectPeriodicInfo(key) {
  const entry = getEffect(key);
  return entry.periodic
    ? { period: entry.periodic.period, timing: entry.periodic.timing }
    : null;
}

// 只读查询：套装最高档位件数，作为图鉴进度的分母（当前套装均为 4）。
export function relicSetMaxPieces(setId) {
  return Math.max(0, ...getRelicSet(setId).tiers.map((tier) => tier.pieces));
}

// 套装加成文案，例如「猎手同盟 2 件：攻击速度 +6%」；多档用；分隔。
export function relicSetBonusText(setId, pieces) {
  const set = getRelicSet(setId);
  return relicSetTierBonuses(setId, pieces)
    .map((tier) => {
      const parts = Object.entries(tier.mods).map(([key, value]) => effectText(key, value));
      return `${set.name} ${tier.pieces} 件：${parts.join('，')}`;
    })
    .join('；');
}

// 命中条件按注册表顺序应用：bossDmg 在 lowHpDmg 之前，与重构前的乘法顺序一致。
export function getEffect(key) {
  const entry = EFFECT_REGISTRY[key];
  if (!entry) throw new Error(`未注册的 mod 键: ${key}（请先在 EFFECT_REGISTRY 中声明）`);
  return entry;
}

export function roundEffect(key, value) {
  const entry = getEffect(key);
  return entry.integer ? Math.round(value) : Math.round(value * 1000) / 1000;
}

export function capEffect(key, value) {
  const { cap, capMode = 'min' } = getEffect(key);
  return capMode === 'max' ? Math.max(value, cap) : Math.min(value, cap);
}

export function effectText(key, value, context) {
  return getEffect(key).text(value, context);
}

export function effectBalanceWeight(key) {
  return getEffect(key).balanceWeight;
}

// 初始聚合状态：所有已声明键都从 0 开始（dmg 为按塔型展开的对象）。
export function createMods() {
  const mods = {};
  for (const [key, entry] of Object.entries(EFFECT_REGISTRY)) {
    mods[key] = entry.nested ? {} : 0;
  }
  return mods;
}

export function applyEffect(mods, key, value) {
  const entry = getEffect(key);
  if (entry.apply) {
    entry.apply(mods, value);
    return;
  }
  if (typeof mods[key] === 'number' && typeof value === 'number') mods[key] += value;
}

export function clampMods(mods) {
  for (const [key, entry] of Object.entries(EFFECT_REGISTRY)) {
    if (entry.nested) {
      for (const type of Object.keys(mods[key] || {})) {
        mods[key][type] = capToGlobal(entry, mods[key][type]);
      }
    } else if (typeof mods[key] === 'number') {
      mods[key] = capToGlobal(entry, mods[key]);
    }
  }
  return mods;
}

function capToGlobal(entry, value) {
  return entry.capMode === 'max'
    ? Math.max(value, entry.globalCap)
    : Math.min(value, entry.globalCap);
}

export function effectValue(mods, key) {
  getEffect(key);
  return mods[key];
}

// 命中时按注册表顺序返回依次生效的条件增伤倍率（不含暴击，暴击消耗 RNG）。
// context 由调用方按需传入；缺省时现场生成一份快照，判定本身仍然是纯函数。
export function hitBonuses(sim, enemy, context) {
  const state = context || conditionSnapshot(sim);
  const bonuses = [];
  for (const [key, entry] of Object.entries(EFFECT_REGISTRY)) {
    if (!entry.hitCondition) continue;
    const value = sim.mods[key];
    if (!value) continue;
    if (entry.hitCondition(sim, enemy, state)) bonuses.push(value);
  }
  return bonuses;
}

// 回合型效果：返回当前波次结束时应触发的 [{key, value, period}]。
// 周期由注册表声明，未到周期（含第 0 波）不触发；顺序沿用注册表顺序，保证确定性。
export function periodicWaveEffects(mods, wave) {
  const current = Math.floor(Number(wave) || 0);
  const effects = [];
  for (const [key, entry] of Object.entries(EFFECT_REGISTRY)) {
    if (!entry.periodic || entry.periodic.timing !== 'waveEnd') continue;
    const value = mods[key];
    if (!value) continue;
    const { period } = entry.periodic;
    if (current < period || current % period !== 0) continue;
    effects.push({ key, value, period });
  }
  return effects;
}

// 在波次结束时结算回合型效果。只读写本局状态，不消耗随机数。
export function applyPeriodicWaveEffects(sim, wave) {
  const applied = periodicWaveEffects(sim.mods, wave);
  for (const effect of applied) {
    const entry = getEffect(effect.key);
    if (typeof entry.applyPeriodic !== 'function') continue;
    entry.applyPeriodic(sim, effect.value);
  }
  return applied;
}

// 由注册表派生的全局上限（保持旧 GLOBAL_MOD_CAPS 的键名与顺序）。
export function globalModCaps() {
  const caps = { dmgType: EFFECT_REGISTRY.dmg.globalCap };
  for (const [key, entry] of Object.entries(EFFECT_REGISTRY)) {
    if (key === 'dmg') continue;
    caps[key] = entry.globalCap;
  }
  return caps;
}
