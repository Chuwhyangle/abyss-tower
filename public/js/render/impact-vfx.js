// 武器命中签名：8 种塔各自的命中形态、颜色与粒子预算（渲染层纯数据 + 纯函数）。
//
// 边界：
//   - 不 import 模拟层、不引入随机数：命中表现只读事件对象上的字段，绝不影响战斗结果。
//   - 低/高两档视图在模块加载时一次性算好并冻结，渲染循环只做查表，不新建对象。
//   - 命中层粒子走固定容量的 ImpactVfxPool：每帧总预算有上限，耗尽时降级而不是整块消失。
import { TILE } from '../shared/data/constants.js';

const T = TILE;
const PI2 = Math.PI * 2;

// 8 种形态两两不同：任意两种武器至少在形状/颜色/粒子参数上有可辨识差异。
export const IMPACT_SHAPES = Object.freeze([
  'needle',
  'burst',
  'crystal',
  'arc',
  'motes',
  'aura',
  'wave',
  'lance',
]);

// 与 TOWER_ORDER 完全一致的 8 个武器键 + fallback（未知来源的兜底签名）。
// color/accent/shape 是辨识度来源，particles/spread/duration/size/ring/spin 是形态参数（ring 以格为单位）。
export const IMPACT_VFX = Object.freeze({
  arrow: Object.freeze({
    color: '#8fe0a8',
    accent: '#d8ffe3',
    shape: 'needle',
    particles: 6,
    spread: 0.35,
    duration: 0.12,
    size: 1.5,
    ring: 0.26,
    spin: 0.2,
  }),
  cannon: Object.freeze({
    color: '#f0a35e',
    accent: '#ffe2bd',
    shape: 'burst',
    particles: 10,
    spread: 0.9,
    duration: 0.22,
    size: 2.8,
    ring: 0.62,
    spin: 0.04,
  }),
  frost: Object.freeze({
    color: '#7cd4f5',
    accent: '#d9f2ff',
    shape: 'crystal',
    particles: 7,
    spread: 0.6,
    duration: 0.14,
    size: 2.1,
    ring: 0.32,
    spin: 0.3,
  }),
  arc: Object.freeze({
    color: '#b48cff',
    accent: '#e8dcff',
    shape: 'arc',
    particles: 9,
    spread: 0.75,
    duration: 0.17,
    size: 2.3,
    ring: 0.4,
    spin: 0.45,
  }),
  poison: Object.freeze({
    color: '#9adf6a',
    accent: '#d9f7bb',
    shape: 'motes',
    particles: 12,
    spread: 1.15,
    duration: 0.15,
    size: 1.9,
    ring: 0.44,
    spin: 0.12,
  }),
  banner: Object.freeze({
    color: '#f5c451',
    accent: '#ffe9a8',
    shape: 'aura',
    particles: 4,
    spread: 6.283,
    duration: 0.5,
    size: 2.6,
    ring: 1.15,
    spin: 0.6,
  }),
  shock: Object.freeze({
    color: '#6fe3c8',
    accent: '#ccfff4',
    shape: 'wave',
    particles: 8,
    spread: 0.85,
    duration: 0.2,
    size: 3,
    ring: 0.72,
    spin: 0.08,
  }),
  sniper: Object.freeze({
    color: '#8fb8ff',
    accent: '#dbe8ff',
    shape: 'lance',
    particles: 5,
    spread: 0.18,
    duration: 0.13,
    size: 2,
    ring: 0.24,
    spin: 0.5,
  }),
  fallback: Object.freeze({
    color: '#ffe4b0',
    accent: '#ffffff',
    shape: 'burst',
    particles: 6,
    spread: 0.6,
    duration: 0.15,
    size: 1.7,
    ring: 0.3,
    spin: 0.35,
  }),
});

// 两档的画质参数与 EFFECT_PROFILES 对齐（tests/impact-vfx.test.mjs 会逐值比对，防止漂移）。
export const IMPACT_TIER_LIMITS = Object.freeze({
  low: Object.freeze({ particleScale: 0.45, maxParticles: 6 }),
  high: Object.freeze({ particleScale: 1, maxParticles: 24 }),
});

// 命中层每帧粒子总预算：低配 32、高配 128，且任何时候不超过 profile.poolBudget。
export const IMPACT_BUDGETS = Object.freeze({ low: 32, high: 128 });

export const IMPACT_POOL_CAPACITY = IMPACT_BUDGETS.high;

const TIERS = ['low', 'high'];

const FALLBACK_WEAPON = 'fallback';

// 非负整数钳制：NaN/Infinity/负数 → 0，超出上限 → 上限。
function clampImpactCount(value, cap) {
  const raw = Number.isFinite(value) ? Math.floor(value) : 0;
  const limit = Number.isFinite(cap) ? Math.floor(cap) : 0;
  return Math.max(0, Math.min(raw, Math.max(0, limit)));
}

function tierOf(profile) {
  return profile?.tier === 'low' ? 'low' : 'high';
}

function buildImpactVariant(entry, tier) {
  const limit = IMPACT_TIER_LIMITS[tier];
  // 任何档位至少保留 1 个粒子：低配命中链也不能整块消失。
  const scaled = Math.max(1, Math.round(entry.particles * limit.particleScale));
  return Object.freeze({
    tier,
    color: entry.color,
    accent: entry.accent,
    shape: entry.shape,
    particles: clampImpactCount(scaled, limit.maxParticles),
    spread: entry.spread,
    duration: entry.duration,
    size: entry.size,
    ring: entry.ring,
    spin: entry.spin,
  });
}

// 两档视图：模块加载时预生成并冻结，渲染循环只查表。
export const IMPACT_VARIANTS = Object.freeze(
  Object.fromEntries(
    TIERS.map((tier) => [
      tier,
      Object.freeze(
        Object.fromEntries(
          Object.entries(IMPACT_VFX).map(([weapon, entry]) => [
            weapon,
            buildImpactVariant(entry, tier),
          ])
        )
      ),
    ])
  )
);

// 未知武器回退到 fallback：字段齐全、数值有限，同样受本档上限约束，不抛错。
export function impactVariant(weapon, profile = null) {
  const table = IMPACT_VARIANTS[tierOf(profile)];
  const key = typeof weapon === 'string' ? weapon : '';
  return table[key] || table[FALLBACK_WEAPON];
}

// 命中层每帧粒子总预算：档位上限与 profile.poolBudget 取小。
export function impactBudget(profile = null) {
  const cap = IMPACT_BUDGETS[tierOf(profile)];
  const pool = Number(profile?.poolBudget);
  if (!Number.isFinite(pool)) return cap;
  return clampImpactCount(Math.min(cap, pool), cap);
}

// 固定容量的命中粒子槽复用池：构造时一次性分配，每帧 reset 后重新 acquire。
// 语义与 effect-renderer 的 ParticlePool 一致，但命中层有独立的每帧总预算。
export class ImpactVfxPool {
  constructor(capacity = IMPACT_POOL_CAPACITY) {
    this.capacity = clampImpactCount(capacity, Number.MAX_SAFE_INTEGER);
    this.slots = new Array(this.capacity);
    for (let i = 0; i < this.capacity; i++) this.slots[i] = { x: 0, y: 0, size: 0 };
    this.limit = this.capacity;
    this.cursor = 0;
  }

  reset(limit = this.capacity) {
    this.limit = clampImpactCount(limit, this.capacity);
    this.cursor = 0;
    return this;
  }

  acquire() {
    if (this.cursor >= this.limit) return null;
    return this.slots[this.cursor++];
  }

  // 为单次命中预留 count 个槽，返回实际拿到的数量（0 = 本帧命中层预算已耗尽）。
  reserve(count) {
    const need = clampImpactCount(count, this.capacity);
    let taken = 0;
    while (taken < need && this.cursor < this.limit) {
      this.cursor++;
      taken++;
    }
    return taken;
  }

  get active() {
    return this.cursor;
  }
}

// 命中绘制计划：向并发池预留粒子槽，返回复用对象 { degraded, count }。
// degraded 表示本帧命中层预算不足以画满该武器的粒子数（含完全耗尽），
// 调用方此时改画「核心闪白 + 武器色环」，命中表现不会整块消失。
export function impactPlan(pool, variant, out = null) {
  const plan = out || { degraded: false, count: 0 };
  const need = clampImpactCount(variant?.particles, pool?.capacity ?? IMPACT_POOL_CAPACITY);
  plan.count = pool ? pool.reserve(need) : 0;
  plan.degraded = plan.count === 0 || plan.count < need;
  return plan;
}

// ---------- 形态绘制（纯函数：只画在传入的 2D 上下文上） ----------

// 针形：向外放射的细长针，长短交错，弓矢的穿刺感。
function drawNeedles(g, v, x, y, p, fade, count) {
  const len = (6 + p * 12) * (1 + v.spread * 0.4);
  g.strokeStyle = v.color;
  g.lineWidth = 1.4;
  g.lineCap = 'round';
  g.globalAlpha = fade;
  for (let i = 0; i < count; i++) {
    const a = (i / Math.max(1, count)) * PI2 + v.spin;
    const inner = 2.5 + p * 4;
    const outer = inner + len * (i % 2 ? 0.6 : 1);
    g.beginPath();
    g.moveTo(x + Math.cos(a) * inner, y + Math.sin(a) * inner);
    g.lineTo(x + Math.cos(a) * outer, y + Math.sin(a) * outer);
    g.stroke();
  }
}

// 爆裂：粗短辐射 + 一坨扩张的实心核心，炮弹的钝重感。
function drawBurst(g, v, x, y, p, fade, count) {
  g.strokeStyle = v.color;
  g.lineWidth = 2.6 + p * 2.2;
  g.lineCap = 'round';
  g.globalAlpha = fade * 0.95;
  for (let i = 0; i < count; i++) {
    const a = (i / Math.max(1, count)) * PI2 + v.spin;
    const inner = 1.5;
    const outer = 4 + p * (7 + v.size);
    g.beginPath();
    g.moveTo(x + Math.cos(a) * inner, y + Math.sin(a) * inner);
    g.lineTo(x + Math.cos(a) * outer, y + Math.sin(a) * outer);
    g.stroke();
  }
  g.fillStyle = v.accent;
  g.globalAlpha = fade * 0.55;
  g.beginPath();
  g.arc(x, y, v.size * (0.9 + p * 1.6), 0, PI2);
  g.fill();
}

// 晶体：外扩的三角冰片，霜塔的结晶感。
function drawCrystal(g, v, x, y, p, fade, count) {
  g.fillStyle = v.accent;
  g.globalAlpha = fade * 0.9;
  for (let i = 0; i < count; i++) {
    const a = (i / Math.max(1, count)) * PI2 + v.spin;
    const dist = p * (v.ring * T + 8) * (0.6 + (i % 3) * 0.2);
    const px = x + Math.cos(a) * dist;
    const py = y + Math.sin(a) * dist;
    const s = Math.max(1.2, v.size * (1 - p * 0.55));
    g.beginPath();
    g.moveTo(px, py - s);
    g.lineTo(px + Math.cos(a) * s * 0.7, py + Math.sin(a) * s * 0.7);
    g.lineTo(px - Math.cos(a) * s * 0.7, py - Math.sin(a) * s * 0.7);
    g.closePath();
    g.fill();
  }
}

// 电弧：短折线电火花，带正弦抖动（不引入随机数）。
function drawArcSparks(g, v, x, y, p, fade, count) {
  g.strokeStyle = v.accent;
  g.lineWidth = 1.6;
  g.lineCap = 'round';
  g.globalAlpha = fade;
  for (let i = 0; i < count; i++) {
    const a = (i / Math.max(1, count)) * PI2 + v.spin + p * 0.6;
    const reach = 5 + p * (6 + v.ring * T);
    const jitter = Math.sin(i * 7.3 + p * 9) * 3;
    g.beginPath();
    g.moveTo(x + Math.cos(a) * 2, y + Math.sin(a) * 2);
    g.lineTo(
      x + Math.cos(a + 0.25) * reach * 0.55 + jitter,
      y + Math.sin(a + 0.25) * reach * 0.55 - jitter
    );
    g.lineTo(x + Math.cos(a) * reach, y + Math.sin(a) * reach);
    g.stroke();
  }
}

// 毒雾：向上飘散的软点，毒塔的雾团感。
function drawMotes(g, v, x, y, p, fade, count) {
  g.fillStyle = v.color;
  for (let i = 0; i < count; i++) {
    const ph = (p + i * 0.17) % 1;
    const drift = Math.sin(ph * 6 + i * 1.7) * (4 + v.spread * 4);
    g.globalAlpha = fade * (1 - ph) * 0.7;
    g.beginPath();
    g.arc(x + drift, y - ph * (10 + v.size * 3), Math.max(0.9, v.size * (1 - ph * 0.55)), 0, PI2);
    g.fill();
  }
}

// 光环：同心扩散环 + 上升光点，战旗塔的支援脉冲。
function drawAura(g, v, x, y, p, fade, count) {
  g.strokeStyle = v.accent;
  g.lineWidth = 1.8;
  g.globalAlpha = fade * (1 - p) * 0.85;
  g.beginPath();
  g.arc(x, y, (0.45 + p * 0.55) * v.ring * T, 0, PI2);
  g.stroke();
  g.globalAlpha = fade * (1 - p) * 0.4;
  g.lineWidth = 1.2;
  g.beginPath();
  g.arc(x, y, (0.2 + p * 0.5) * v.ring * T, 0, PI2);
  g.stroke();
  g.fillStyle = v.color;
  for (let i = 0; i < count; i++) {
    const ph = (p + i * 0.25) % 1;
    g.globalAlpha = fade * (1 - ph) * 0.6;
    g.beginPath();
    g.arc(x + Math.cos(i * 1.9) * v.ring * T * 0.5, y - ph * 14, 1.4 + (1 - ph), 0, PI2);
    g.fill();
  }
}

// 波环：逐层衰减的同心弧 + 刻度，震荡塔的冲击波。
function drawWave(g, v, x, y, p, fade, count) {
  g.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const layer = (p + i * 0.18) % 1;
    g.strokeStyle = i === 0 ? v.accent : v.color;
    g.lineWidth = 2.4 * (1 - layer) + 0.6;
    g.globalAlpha = fade * (1 - layer) * 0.85;
    g.beginPath();
    g.arc(x, y, (0.2 + layer * 0.9) * v.ring * T, -0.6, PI2 - 0.6 - i * 0.3);
    g.stroke();
  }
  g.strokeStyle = v.color;
  g.lineWidth = 1.4;
  for (let i = 0; i < count; i++) {
    const a = (i / Math.max(1, count)) * PI2 + v.spin;
    const r0 = v.ring * T * (0.45 + p * 0.55);
    g.globalAlpha = fade * 0.7;
    g.beginPath();
    g.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
    g.lineTo(x + Math.cos(a) * (r0 + 4), y + Math.sin(a) * (r0 + 4));
    g.stroke();
  }
}

// 枪刺：一道贯穿的长刺 + 细碎火花，狙击塔的穿透感。
function drawLance(g, v, x, y, p, fade, count) {
  const reach = 10 + p * (14 + v.ring * T);
  g.strokeStyle = v.accent;
  g.lineWidth = 2.4 * (1 - p * 0.5);
  g.lineCap = 'round';
  g.globalAlpha = fade;
  g.beginPath();
  g.moveTo(x - reach, y - reach * v.spread);
  g.lineTo(x + reach, y + reach * v.spread);
  g.stroke();
  g.strokeStyle = v.color;
  g.lineWidth = 1.2;
  for (let i = 0; i < count; i++) {
    const a = (i / Math.max(1, count)) * PI2 + v.spin;
    const inner = 3;
    const outer = inner + (5 + p * 8) * (i % 2 ? 0.6 : 1);
    g.beginPath();
    g.moveTo(x + Math.cos(a) * inner, y + Math.sin(a) * inner);
    g.lineTo(x + Math.cos(a) * outer, y + Math.sin(a) * outer);
    g.stroke();
  }
}

const IMPACT_SHAPE_DRAWERS = Object.freeze({
  needle: drawNeedles,
  burst: drawBurst,
  crystal: drawCrystal,
  arc: drawArcSparks,
  motes: drawMotes,
  aura: drawAura,
  wave: drawWave,
  lance: drawLance,
});

// 按 shape 分派绘制；count 是本帧实际拿到的粒子槽数（可能少于 variant.particles）。
export function drawImpactShape(g, variant, x, y, p, fade, count) {
  if (!variant || !(count > 0)) return false;
  const draw = IMPACT_SHAPE_DRAWERS[variant.shape] || drawBurst;
  draw(g, variant, x, y, p, fade, count);
  return true;
}

// 降级表现：核心闪白 + 武器色环。预算耗尽时命中仍有可见反馈。
export function drawImpactFallback(g, variant, x, y, p, fade) {
  const v = variant || IMPACT_VFX.fallback;
  g.globalAlpha = fade * 0.9;
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(x, y, Math.max(1.4, 2.6 * (1 - p * 0.5)), 0, PI2);
  g.fill();
  g.strokeStyle = v.color;
  g.lineWidth = 1.4 + 2.2 * (1 - p);
  g.globalAlpha = fade * 0.8;
  g.beginPath();
  g.arc(x, y, (0.35 + p * 0.65) * v.ring * T, 0, PI2);
  g.stroke();
}
