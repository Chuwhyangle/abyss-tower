// 特效表现层静态数据：事件配置表、kind → 事件映射、画质档位、变体视图与粒子预算换算。
//
// 纯常量与纯函数（只依赖 shared 的纯表），供 effect-pool / effect-draw / effect-renderer 共用。
import { TILE } from '../shared/data.js';
import { IMPACT_CLASSES } from '../shared/impact-class-feedback.js';

const T = TILE;

// 增益金（= Palette.semanticColor('buff')）；数据模块不得 import 调色板，一致性由测试锁死。
const BUFF_ACCENT = '#ffd36b';

export const BOSS_KILL_RADIUS = 0.5;

// 类别层事件（AC-030）：配色/形态/时长/环半径取自类别表的唯一来源，
// 这里只声明档位粒子数；低档也必须 ≥ 1 颗，任何档位都保留核心闪白 + 类别色环。
function classEventSpec(cls, { particles, lowParticles }) {
  const vfx = IMPACT_CLASSES[cls].vfx;
  return {
    color: vfx.color,
    accent: vfx.accent,
    shape: vfx.shape,
    duration: vfx.duration,
    particles,
    ring: vfx.ring,
    spin: vfx.spin,
    glow: 0.45,
    size: 2.8,
    rise: 6,
    key: true,
    tiers: {
      low: { particles: lowParticles },
      high: { particles },
    },
  };
}

// 单一事件配置表：颜色、时长、粒子、光晕、尺寸都只在这里声明，渲染分支不再散落魔法数。
// key 事件在所有画质档位都保留；非关键事件（进化）只在完整画质出现。
// tiers 只覆盖预算类字段（粒子/光晕/细节层），颜色与时长保持档位无关。
export const EFFECT_EVENTS = {
  kill: {
    color: '#efe6d8',
    accent: BUFF_ACCENT,
    shape: 'shards',
    duration: 0.3,
    particles: 8,
    ring: 0.55,
    spin: 0.4,
    glow: 0.35,
    puffs: 3,
    size: 3.6,
    rise: 6,
    key: true,
    tiers: {
      low: { particles: 4, puffs: 1 },
      high: { particles: 8, puffs: 3, extras: true },
    },
  },
  bossKill: {
    color: '#ff7ad9',
    accent: '#ffe9a8',
    shape: 'burst',
    duration: 0.45,
    particles: 20,
    ring: 1.35,
    spin: 0.12,
    glow: 0.8,
    puffs: 5,
    size: 4.6,
    rise: 6,
    key: true,
    tiers: {
      low: { particles: 6, puffs: 2 },
      high: { particles: 20, puffs: 5, extras: true },
    },
  },
  baseHit: {
    color: '#ff4c4c',
    accent: '#ffb0b0',
    shape: 'shockwave',
    duration: 0.5,
    particles: 10,
    ring: 1.6,
    spin: 0,
    glow: 0.65,
    puffs: 0,
    radius: 12,
    spread: 28,
    size: 2.6,
    key: true,
    tiers: {
      low: { particles: 5 },
      high: { particles: 10, extras: true },
    },
  },
  // 类别层：首领命中 / 破盾 / 护甲吸收，形状与配色与类别表一致，三者在低档仍各留 ≥1 颗粒子。
  bossHit: classEventSpec('bossHit', { particles: 10, lowParticles: 3 }),
  shieldBreak: classEventSpec('shieldBreak', { particles: 14, lowParticles: 4 }),
  armorAbsorb: classEventSpec('armor', { particles: 8, lowParticles: 2 }),
  towerDisable: {
    color: '#ff8a6b',
    accent: '#ffd7c2',
    shape: 'static',
    duration: 0.6,
    particles: 3,
    ring: 22 / T,
    spin: 0,
    glow: 0.4,
    puffs: 0,
    core: 5,
    flick: 26,
    dash: [4, 6],
    lineWidth: 1.6,
    key: true,
    tiers: {
      low: { particles: 2, glow: 0.25 },
      high: { particles: 3, extras: true },
    },
  },
  evolve: {
    color: '#8be9fd',
    accent: '#ffffff',
    shape: 'spiral',
    duration: 0.5,
    particles: 16,
    ring: 1.1,
    spin: 0.9,
    glow: 0.7,
    puffs: 2,
    size: 2.2,
    rise: 14,
    key: false,
    tiers: {
      low: { particles: 0, puffs: 0 },
      high: { particles: 16, puffs: 2, extras: true },
    },
  },
};

// 模拟侧 addEffect 的全部 kind → 事件名；死亡按体型分流到 kill / bossKill。
export const EFFECT_KIND_EVENTS = {
  ring: 'ring',
  spark: 'spark',
  bolt: 'bolt',
  muzzle: 'muzzle',
  spawn: 'spawn',
  death: 'kill',
  heal: 'heal',
  place: 'place',
  poison: 'poison',
  leak: 'baseHit',
  towerDisable: 'towerDisable',
  evolve: 'evolve',
  // 类别层：addEffect 传的 kind 既可以是事件键，也可以是类别名（armor → armorAbsorb）。
  armor: 'armorAbsorb',
};

export const EFFECT_PROFILES = {
  low: {
    tier: 'low',
    particleScale: 0.45,
    maxParticles: 6,
    frameBudget: 96,
    poolBudget: 96,
    glow: false,
    halo: false,
  },
  high: {
    tier: 'high',
    particleScale: 1,
    maxParticles: 24,
    frameBudget: 320,
    poolBudget: 256,
    glow: true,
    halo: true,
  },
};

// 事件表现的两档视图：模块加载时一次性算好并冻结，渲染循环只做查表，不新建对象。
const EVENT_TIERS = ['low', 'high'];

function buildVariant(entry, tier) {
  const spec = entry.tiers?.[tier] || {};
  const cap = EFFECT_PROFILES[tier].maxParticles;
  const pick = (value, fallback) => (value === undefined ? fallback : value);
  return Object.freeze({
    tier,
    // 低配只保留关键事件；高配保留完整层次（含进化等细节事件）。
    enabled: tier === 'high' || entry.key !== false,
    color: entry.color,
    accent: entry.accent,
    shape: entry.shape,
    duration: entry.duration,
    particles: clampCount(pick(spec.particles, entry.particles), cap),
    puffs: clampCount(pick(spec.puffs, entry.puffs), cap),
    ring: pick(spec.ring, entry.ring),
    spin: entry.spin,
    glow: pick(spec.glow, entry.glow),
    extras: pick(spec.extras, tier === 'high'),
    size: entry.size,
    rise: entry.rise,
    radius: entry.radius,
    spread: entry.spread,
    core: entry.core,
    flick: entry.flick,
    dash: entry.dash,
    lineWidth: entry.lineWidth,
  });
}

export const EFFECT_VARIANTS = Object.freeze(
  Object.fromEntries(
    EVENT_TIERS.map((tier) => [
      tier,
      Object.freeze(
        Object.fromEntries(
          Object.entries(EFFECT_EVENTS).map(([name, entry]) => [name, buildVariant(entry, tier)])
        )
      ),
    ])
  )
);

const FALLBACK_EVENT = 'kill';

// 未知事件回退到普通击杀：字段齐全、数值有限，不抛错也不会画成全屏。
export function eventVariant(event, profile = EFFECT_PROFILES.high) {
  const table = EFFECT_VARIANTS[profile?.tier === 'low' ? 'low' : 'high'];
  return table[event] || table[FALLBACK_EVENT];
}

// 与 settings.js 的高配预设对齐：完整装饰，或高 DPR + 光晕，才走完整特效。
export function effectProfile(settings = {}) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const high = source.decorations === 'full' || (source.glow === true && Number(source.dpr) >= 2);
  return high ? EFFECT_PROFILES.high : EFFECT_PROFILES.low;
}

// 非负整数钳制：NaN/Infinity/负数 → 0，超出上限 → 上限。
export function clampCount(value, cap) {
  const raw = Number.isFinite(value) ? Math.floor(value) : 0;
  const limit = Number.isFinite(cap) ? Math.floor(cap) : 0;
  return Math.max(0, Math.min(raw, Math.max(0, limit)));
}

export function particleCount(base, profile = EFFECT_PROFILES.high) {
  const scale = Number.isFinite(profile?.particleScale) ? profile.particleScale : 1;
  const requested = Math.round((Number.isFinite(base) ? base : 0) * scale);
  return clampCount(requested, profile?.maxParticles ?? 0);
}

// 至少保留 1 个的装饰数量（环形/火花等不能因低配直接消失）。
export function scaledCount(base, profile = EFFECT_PROFILES.high) {
  return Math.max(1, particleCount(base, profile));
}

export function classifyEffect(effect) {
  const kind = effect?.kind;
  if (kind === 'death') {
    return (Number(effect.r) || 0) >= BOSS_KILL_RADIUS ? 'bossKill' : 'kill';
  }
  return EFFECT_KIND_EVENTS[kind] || kind || 'unknown';
}

// 锐利命中星芒（FEEL-001 观感回归修复）：六向白色放射线 + 核心闪白。
// 这是 3b8e1fd 里「这一下打中了」的可辨识锐利切分；武器形态（impact-vfx）只提供
// 颜色语言与方向感，两者叠加而不是互相替代——所以武器命中在任何画质档都画满 6 条。
// 几何与历史版本一致（长短交错、随进度外扩）。
export const SHARP_HIT_STAR = Object.freeze({
  rays: 6,
  rotate: 0.35,
  inner: 2.5,
  innerGrowth: 3,
  base: 6,
  reach: 9,
  reachAlt: 4,
  width: 1.7,
  coreScale: 2.6,
  coreAlpha: 0.85,
  color: '#ffffff',
});
