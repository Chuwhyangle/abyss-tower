// 效果注册表：遗物 mod 键的唯一声明处。
// 每个键在这里声明单件上限（cap）、汇总上限（globalCap）、文案（text）与平衡权重
// （balanceWeight），并可挂载聚合钩子（apply）与命中条件（hitCondition）。
// 未在此声明的键在读取时一律明确报错，不会被 sim 静默忽略。

const pct = (value) => `${Math.round(value * 100)}%`;

export const EFFECT_REGISTRY = {
  dmg: {
    cap: 2.0,
    globalCap: 2.5,
    text: (value, { towerName }) => `${towerName}伤害 +${pct(value)}`,
    balanceWeight: 10,
    nested: true,
    apply(mods, value) {
      for (const [type, amount] of Object.entries(value)) {
        mods.dmg[type] = (mods.dmg[type] || 0) + amount;
      }
    },
  },
  dmgAll: {
    cap: 1.0,
    globalCap: 1.5,
    text: (value) => `全体伤害 +${pct(value)}`,
    balanceWeight: 14,
  },
  fireRate: {
    cap: 0.6,
    globalCap: 0.6,
    text: (value) => `攻击速度 +${pct(value)}`,
    balanceWeight: 13,
  },
  range: {
    cap: 2.0,
    globalCap: 2.2,
    text: (value) => `射程 +${Number(value.toFixed(1))} 格`,
    balanceWeight: 1.5,
  },
  splash: {
    cap: 0.8,
    globalCap: 0.9,
    text: (value) => `溅射范围 +${pct(value)}`,
    balanceWeight: 6,
  },
  slow: {
    cap: 0.35,
    globalCap: 0.35,
    text: (value) => `减速强度 +${pct(value)}`,
    balanceWeight: 4,
  },
  slowDur: {
    cap: 0.8,
    globalCap: 0.9,
    text: (value) => `减速持续 +${pct(value)}`,
    balanceWeight: 4,
  },
  chain: {
    cap: 2,
    globalCap: 2,
    text: (value) => `连锁 +${value} 个目标`,
    balanceWeight: 3,
    integer: true,
  },
  dot: {
    cap: 1.0,
    globalCap: 1.2,
    text: (value) => `毒伤 +${pct(value)}`,
    balanceWeight: 9,
  },
  goldMul: {
    cap: 0.6,
    globalCap: 0.7,
    text: (value) => `金币收入 +${pct(value)}`,
    balanceWeight: 7,
  },
  killGold: {
    cap: 6,
    globalCap: 8,
    text: (value) => `击杀金币 +${value}`,
    balanceWeight: 1.2,
    integer: true,
  },
  interest: {
    cap: 0.12,
    globalCap: 0.15,
    text: (value) => `波末利息 +${pct(value)}`,
    balanceWeight: 22,
  },
  crit: {
    cap: 0.4,
    globalCap: 0.45,
    text: (value) => `暴击率 +${pct(value)}`,
    balanceWeight: 10,
  },
  armorPierce: {
    cap: 0.8,
    globalCap: 0.85,
    text: (value) => `无视护甲 +${pct(value)}`,
    balanceWeight: 6,
  },
  costMul: {
    cap: -0.2,
    globalCap: -0.2,
    capMode: 'max',
    text: (value) => `建造/升级费用 ${value < 0 ? '-' : '+'}${pct(Math.abs(value))}`,
    balanceWeight: 2,
  },
  frostDmgBonus: {
    cap: 0.4,
    globalCap: 0.45,
    text: (value) => `减速目标受伤 +${pct(value)}`,
    balanceWeight: 2,
  },
  lowHpDmg: {
    cap: 0.7,
    globalCap: 0.8,
    text: (value) => `基地低血时伤害 +${pct(value)}`,
    balanceWeight: 2,
    hitCondition: (sim) => sim.baseHp / sim.maxBaseHp < 0.4,
  },
  projSpeed: {
    cap: 1.0,
    globalCap: 1.2,
    text: (value) => `投射物速度 +${pct(value)}`,
    balanceWeight: 2,
  },
  bossDmg: {
    cap: 1.0,
    globalCap: 1.2,
    text: (value) => `对首领伤害 +${pct(value)}`,
    balanceWeight: 3,
    hitCondition: (sim, enemy) => enemy.boss,
  },
  baseHp: {
    cap: 20,
    globalCap: 30,
    text: (value) => `基地生命 +${value}（立即）`,
    balanceWeight: 0.4,
    integer: true,
  },
};

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
export function hitBonuses(sim, enemy) {
  const bonuses = [];
  for (const [key, entry] of Object.entries(EFFECT_REGISTRY)) {
    if (!entry.hitCondition) continue;
    const value = sim.mods[key];
    if (!value) continue;
    if (entry.hitCondition(sim, enemy)) bonuses.push(value);
  }
  return bonuses;
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
