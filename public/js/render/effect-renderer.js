// 特效绘制：环形冲击、火花、闪电、枪口、生成、死亡、治疗、放置、中毒、漏怪。
// 画质分档只影响表现（粒子数/光晕/每帧预算），不读取也不修改模拟状态。
// 首领系列：蓄力、咆哮、召唤、震击、防御塔停摆。
import { TILE, BOSS_SKILLS } from '../shared/data.js';
import { BALANCE } from '../shared/config.js';
import { IMPACT_CLASSES } from '../shared/impact-class-feedback.js';
import { Palette, SKILL_WARNING_STYLE } from './palette.js';
import {
  IMPACT_POOL_CAPACITY,
  ImpactVfxPool,
  drawImpactFallback,
  drawImpactShape,
  impactBudget,
  impactPlan,
  impactVariant,
} from './impact-vfx.js';

const T = TILE;
const PI2 = Math.PI * 2;

// 首领体型（ENEMIES.boss.r = 0.58）与普通怪（≤0.42）的分界，用于从死亡特效还原事件。
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
    accent: Palette.semanticColor('buff'),
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

// 纯绘制：只画在传入的上下文上，返回实际画出的线数（0 = 未绘制）。
// rays 只给旧火花（无 weapon）沿用历史的档位缩放；武器命中一律画满，保证可辨识切分。
export function drawSharpHitStar(
  g,
  x,
  y,
  p,
  fade,
  { color = SHARP_HIT_STAR.color, rays = SHARP_HIT_STAR.rays, star = SHARP_HIT_STAR } = {}
) {
  if (!(fade > 0)) return 0;
  const count = Math.max(1, Math.round(rays));
  g.save();
  g.globalAlpha = fade;
  g.strokeStyle = color;
  g.lineWidth = star.width;
  g.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const a = (i / count) * PI2 + star.rotate;
    const inner = star.inner + p * star.innerGrowth;
    const outer = star.base + p * (star.reach + (i % 2) * star.reachAlt);
    g.beginPath();
    g.moveTo(x + Math.cos(a) * inner, y + Math.sin(a) * inner);
    g.lineTo(x + Math.cos(a) * outer, y + Math.sin(a) * outer);
    g.stroke();
  }
  g.fillStyle = Palette.withAlpha(star.color, fade * star.coreAlpha);
  g.beginPath();
  g.arc(x, y, star.coreScale * (1 - p * 0.6), 0, PI2);
  g.fill();
  g.restore();
  return count;
}

// 事件对象上的 weapon 决定命中签名；缺字段（旧事件、非塔来源）返回 null 走通用外观。
function impactFor(effect, profile) {
  const weapon = effect && effect.weapon;
  if (typeof weapon !== 'string' || weapon === '') return null;
  return impactVariant(weapon, profile);
}

// 返回 { p, fade }：p 是已播放进度（可按事件时长提前播完），fade 是剩余生命比例。
// 传入 out 可复用同一对象，避免渲染循环每帧为每个特效新建临时对象。
export function effectProgress(effect, style = null, out = null) {
  const life = Math.max(1e-6, Number(effect?.maxTtl) || Number(effect?.ttl) || 0.3);
  const span = Math.max(1e-6, Math.min(life, style?.duration || life));
  const ttl = Number(effect?.ttl) || 0;
  const clamp01 = (value) => Math.max(0, Math.min(1, value));
  const result = out || { p: 0, fade: 0 };
  result.p = clamp01((life - ttl) / span);
  result.fade = clamp01(ttl / life);
  return result;
}

// 固定容量的粒子槽复用池：只在构造时分配对象，每帧 reset 后重新 acquire。
export class ParticlePool {
  constructor(capacity = 0) {
    this.capacity = clampCount(capacity, Number.MAX_SAFE_INTEGER);
    this.slots = new Array(this.capacity);
    for (let i = 0; i < this.capacity; i++) this.slots[i] = { x: 0, y: 0, size: 0 };
    this.limit = this.capacity;
    this.cursor = 0;
  }

  reset(limit = this.capacity) {
    this.limit = clampCount(limit, this.capacity);
    this.cursor = 0;
    return this;
  }

  acquire() {
    if (this.cursor >= this.limit) return null;
    return this.slots[this.cursor++];
  }

  get active() {
    return this.cursor;
  }
}

export class EffectRenderer {
  constructor(game, { glow }) {
    this.game = game;
    this.glow = glow;
    // 池容量固定为高配上限，低配只通过每帧 poolBudget 收缩，不重建池。
    this.pool = new ParticlePool(EFFECT_PROFILES.high.poolBudget);
    // 命中层独立预算：与死亡/漏怪粒子分开计，36 敌混战时也不会互相挤掉。
    this.impactPool = new ImpactVfxPool(IMPACT_POOL_CAPACITY);
    this._progress = { p: 0, fade: 0 };
    this._impactPlan = { degraded: false, count: 0 };
    // 只读观测计数（与 ProjectileRenderer.drawn / drawCalls 同性质，供测试与性能记录读取）。
    this.impactDrawn = Object.create(null);
    // 类别层绘制计数：按事件键累计，浏览器验收读取三类各绘制 ≥1 次。
    this.classDrawn = Object.create(null);
    this.impactDegraded = 0;
    this.impactPeak = 0;
    this.auraPulses = 0;
  }

  render(g, time, settings) {
    const profile = effectProfile(settings);
    const glow = !!(settings && settings.glow);
    const halo = glow && profile.halo;
    const t = time;
    this.pool.reset(profile.poolBudget);
    this.impactPool.reset(impactBudget(profile));
    if (this.glow && typeof this.glow.configure === 'function') this.glow.configure(settings);

    let drawn = 0;
    for (const effect of this.game.effects) {
      if (drawn >= profile.frameBudget) break;

      const event = classifyEffect(effect);
      // 只有登记在事件表里的 kind 才按事件时长推进；其余分支沿用自身 ttl。
      const style = EFFECT_EVENTS[event] ? eventVariant(event, profile) : null;
      // 低配只保留关键事件，进化等细节层不占用绘制预算。
      if (style && !style.enabled) continue;
      drawn++;

      const { p, fade } = effectProgress(effect, style, this._progress);
      const x = effect.x * T;
      const y = effect.y * T;
      const color = effect.color || Palette.semanticColor('buff');

      if (effect.kind === 'ring') {
        // 带 weapon 的溅射命中（炮台/震荡塔）按武器 accent 与线宽拉开差异；
        // 无 weapon 的旧事件保持既有通用外观。
        const impact = impactFor(effect, profile);
        const radius = (effect.r0 + (effect.r1 - effect.r0) * p) * T;
        const weight = impact ? Math.max(0.9, impact.size * 0.55) : 1;
        if (impact) this.impactDrawn[effect.weapon] = (this.impactDrawn[effect.weapon] || 0) + 1;
        g.save();
        if (glow) g.globalCompositeOperation = 'lighter';
        if (halo && p < 0.45) {
          this.glow.draw(g, impact ? impact.accent : color, x, y, radius * 0.75, 0.42 * (1 - p / 0.45));
        }
        g.globalAlpha = fade * 0.95;
        g.strokeStyle = impact ? impact.accent : color;
        g.lineWidth = (0.8 + 3 * (1 - p)) * weight;
        g.beginPath();
        g.arc(x, y, radius, 0, PI2);
        g.stroke();
        g.globalAlpha = fade * 0.4;
        g.strokeStyle = impact ? impact.color : color;
        g.lineWidth = 1.1 * weight;
        g.beginPath();
        g.arc(x, y, radius * 0.74, 0, PI2);
        g.stroke();
        g.restore();
      } else if (effect.kind === 'spark') {
        const weapon = typeof effect.weapon === 'string' ? effect.weapon : '';
        const variant = weapon ? impactVariant(weapon, profile) : null;
        if (variant) {
          // 武器签名命中：粒子从命中层并发池取，预算耗尽时降级为「核心闪白 + 武器色环」。
          const plan = impactPlan(this.impactPool, variant, this._impactPlan);
          this.impactDrawn[effect.weapon] = (this.impactDrawn[effect.weapon] || 0) + 1;
          g.save();
          if (glow) g.globalCompositeOperation = 'lighter';
          g.globalAlpha = fade;
          g.lineCap = 'round';
          g.strokeStyle = variant.color;
          g.fillStyle = variant.accent;
          g.lineWidth = 1.7;
          drawImpactShape(g, variant, x, y, p, fade, plan.count);
          if (plan.degraded) {
            this.impactDegraded++;
            drawImpactFallback(g, variant, x, y, p, fade);
          }
          // 锐利层叠在最上：武器色语言 + 白色星芒，命中在任何预算状态下都有可辨识切分。
          drawSharpHitStar(g, x, y, p, fade, { color: variant.accent });
          g.restore();
        } else {
          // 无 weapon 的旧火花：武器形态缺省，仍保留同一套锐利星芒，
          // 线数沿用历史的档位缩放（与低配预算单调的既有契约一致）。
          g.save();
          if (glow) g.globalCompositeOperation = 'lighter';
          drawSharpHitStar(g, x, y, p, fade, { color, rays: scaledCount(SHARP_HIT_STAR.rays, profile) });
          g.restore();
        }
      } else if (effect.kind === 'bolt') {
        // 电弧签名：链闪固定归属电弧塔，用其 accent 与线宽区别于通用闪电。
        const impact = impactFor(effect, profile);
        if (impact) this.impactDrawn[effect.weapon] = (this.impactDrawn[effect.weapon] || 0) + 1;
        g.save();
        if (halo) {
          g.globalCompositeOperation = 'lighter';
          g.globalAlpha = (1 - p) * 0.28;
          g.strokeStyle = impact ? impact.accent : color;
          g.lineWidth = 7;
          this.strokeBolt(g, effect.points, x, y);
          g.globalAlpha = (1 - p) * 0.5;
          g.lineWidth = 3.5;
          this.strokeBolt(g, effect.points, x, y);
          g.globalCompositeOperation = 'source-over';
        }
        g.globalAlpha = 1 - p * 0.85;
        g.strokeStyle = impact ? impact.accent : '#f6f0ff';
        g.lineWidth = impact ? 1.6 + impact.size * 0.18 : 1.6;
        this.strokeBolt(g, effect.points, x, y);
        g.restore();
      } else if (effect.kind === 'muzzle') {
        g.save();
        g.translate(x, y);
        g.rotate(effect.angle);
        if (glow) g.globalCompositeOperation = 'lighter';
        g.globalAlpha = fade;
        g.fillStyle = Palette.withAlpha(color, 0.55);
        g.beginPath();
        g.moveTo(0, -4.5);
        g.lineTo(18, -1.6);
        g.lineTo(18, 1.6);
        g.lineTo(0, 4.5);
        g.closePath();
        g.fill();
        g.fillStyle = Palette.withAlpha('#ffffff', fade * 0.8);
        g.beginPath();
        g.arc(2, 0, 2.6, 0, PI2);
        g.fill();
        g.globalAlpha = fade * 0.22;
        g.fillStyle = '#c9c2b4';
        g.beginPath();
        g.arc(6 + p * 8, Math.sin(p * 5) * 2, 3 + p * 3.5, 0, PI2);
        g.fill();
        g.restore();
      } else if (effect.kind === 'spawn') {
        g.save();
        if (glow) g.globalCompositeOperation = 'lighter';
        const rr = 8 + p * 22;
        g.globalAlpha = fade * 0.85;
        g.strokeStyle = color;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(x, y, rr, 0, PI2);
        g.stroke();
        if (profile.halo) {
          g.globalAlpha = fade * 0.5;
          g.setLineDash([4, 6]);
          g.lineWidth = 1.4;
          g.beginPath();
          g.arc(x, y, rr * 0.66, t * 2, t * 2 + PI2);
          g.stroke();
          g.setLineDash([]);
        }
        g.globalAlpha = fade * 0.35;
        g.beginPath();
        g.ellipse(x, y + 8, rr * 0.9, rr * 0.34, 0, 0, PI2);
        g.stroke();
        g.restore();
      } else if (effect.kind === 'death') {
        const entry = style || eventVariant('kill', profile);
        const boss = event === 'bossKill';
        const skin = boss ? entry.color : color;
        const shards = entry.particles;
        const radius = Number(effect.r) || 0.3;
        g.save();
        g.globalAlpha = fade * 0.9;
        for (let i = 0; i < shards; i++) {
          const slot = this.pool.acquire();
          if (!slot) break;
          const a = (i / Math.max(1, shards)) * PI2 + entry.spin;
          const dist = p * (radius + entry.ring) * T;
          slot.size = Math.max(0.8, entry.size * (1 - p));
          slot.x = x + Math.cos(a) * dist;
          slot.y = y + Math.sin(a) * dist - p * entry.rise;
          g.fillStyle = i % 3 === 0 ? entry.accent : skin;
          g.beginPath();
          g.arc(slot.x, slot.y, slot.size, 0, PI2);
          g.fill();
        }
        const puffs = entry.puffs;
        g.globalAlpha = fade * 0.14;
        g.fillStyle = '#0c0a10';
        for (let i = 0; i < puffs; i++) {
          const a = (i / Math.max(1, puffs)) * PI2 + p;
          g.beginPath();
          g.arc(x + Math.cos(a) * p * 10, y - p * 8 - i, 7 + p * 9, 0, PI2);
          g.fill();
        }
        if (boss && entry.extras) {
          // 高配才画首领死亡的额外扩散光环，低配用颜色和粒子量拉开辨识度。
          g.globalAlpha = fade * 0.55;
          g.strokeStyle = entry.accent;
          g.lineWidth = 2;
          g.beginPath();
          g.arc(x, y, p * entry.ring * T, 0, PI2);
          g.stroke();
        }
        if (halo) {
          g.globalCompositeOperation = 'lighter';
          const glowRadius = p * (radius + 0.9) * T;
          this.glow.draw(g, boss ? entry.accent : skin, x, y, glowRadius, fade * entry.glow);
        }
        g.restore();
      } else if (effect.kind === 'heal') {
        const crosses = scaledCount(2, profile);
        g.save();
        if (glow) g.globalCompositeOperation = 'lighter';
        g.strokeStyle = '#7cf0b8';
        g.lineWidth = 2.2;
        g.lineCap = 'round';
        for (let i = 0; i < crosses; i++) {
          const rise = p * 22 + i * 9;
          const s = 4.5 - i * 1.2;
          const hx = x + (i === 0 ? 0 : 6);
          const hy = y - rise;
          g.globalAlpha = fade * (i === 0 ? 0.95 : 0.5);
          g.beginPath();
          g.moveTo(hx - s, hy);
          g.lineTo(hx + s, hy);
          g.moveTo(hx, hy - s);
          g.lineTo(hx, hy + s);
          g.stroke();
        }
        g.restore();
      } else if (effect.kind === 'place') {
        const spokes = scaledCount(4, profile);
        g.save();
        if (glow) g.globalCompositeOperation = 'lighter';
        const rr = 6 + p * 22;
        g.globalAlpha = fade * 0.85;
        g.strokeStyle = color;
        g.lineWidth = 2.2;
        g.beginPath();
        g.arc(x, y, rr, 0, PI2);
        g.stroke();
        g.globalAlpha = fade * 0.7;
        g.lineWidth = 1.6;
        for (let i = 0; i < spokes; i++) {
          const a = (i / spokes) * PI2 + p * 1.6;
          g.beginPath();
          g.moveTo(x + Math.cos(a) * (rr + 3), y + Math.sin(a) * (rr + 3));
          g.lineTo(x + Math.cos(a) * (rr + 8), y + Math.sin(a) * (rr + 8));
          g.stroke();
        }
        g.globalAlpha = fade * 0.3;
        const beam = g.createLinearGradient(x, y - 26, x, y + 4);
        beam.addColorStop(0, Palette.withAlpha(color, 0));
        beam.addColorStop(0.7, Palette.withAlpha(color, 0.55));
        beam.addColorStop(1, Palette.withAlpha(color, 0));
        g.fillStyle = beam;
        g.fillRect(x - 3, y - 26, 6, 30);
        g.restore();
      } else if (effect.kind === 'poison') {
        const motes = scaledCount(3, profile);
        g.save();
        if (glow) g.globalCompositeOperation = 'lighter';
        for (let i = 0; i < motes; i++) {
          const ph = (p + i * 0.3) % 1;
          g.globalAlpha = fade * (1 - ph) * 0.75;
          g.fillStyle = '#9adf6a';
          g.beginPath();
          g.arc(x + Math.sin(ph * 8 + i) * 5, y - ph * 16, 2.4 * (1 - ph * 0.55), 0, PI2);
          g.fill();
        }
        g.restore();
      } else if (effect.kind === 'leak') {
        const entry = style || eventVariant('baseHit', profile);
        const rr = entry.radius + p * entry.spread;
        g.save();
        if (halo) this.glow.draw(g, entry.color, x, y, rr, fade * entry.glow);
        g.globalAlpha = fade * 0.75;
        g.strokeStyle = entry.color;
        g.lineWidth = 2.4;
        g.beginPath();
        g.arc(x, y, rr, 0, PI2);
        g.stroke();
        // 红色冲击粒子向外扩散，和普通命中火花区分开。
        const bits = entry.particles;
        g.globalAlpha = fade * 0.8;
        for (let i = 0; i < bits; i++) {
          const slot = this.pool.acquire();
          if (!slot) break;
          const a = (i / Math.max(1, bits)) * PI2 + entry.spin;
          const dist = p * entry.ring * T;
          slot.size = Math.max(0.7, entry.size * (1 - p));
          slot.x = x + Math.cos(a) * dist;
          slot.y = y + Math.sin(a) * dist;
          g.fillStyle = i % 2 === 0 ? entry.accent : entry.color;
          g.beginPath();
          g.arc(slot.x, slot.y, slot.size, 0, PI2);
          g.fill();
        }
        g.restore();
      } else if (effect.kind === 'bossCast') {
        // 蓄力：收缩的能量环 + 向心火花 + 旋转符文，随 progress 增强。
        // 预警配色/线宽/虚线走与玩家技能相同的语义规范（首领技能均为危险）。
        const skill = BOSS_SKILLS[effect.skill];
        const castColor = Palette.semanticColor(effect.skill, settings);
        const R = (skill?.radiusKey ? BALANCE[skill.radiusKey] || 2.5 : 2.2) * T;
        g.save();
        if (glow) g.globalCompositeOperation = 'lighter';
        g.globalAlpha = 0.3 + p * 0.55;
        g.strokeStyle = castColor;
        g.lineWidth = SKILL_WARNING_STYLE.lineWidth;
        g.beginPath();
        g.arc(x, y, R * (0.55 - p * 0.35), 0, Math.PI * 2);
        g.stroke();

        g.save();
        g.translate(x, y);
        g.rotate(t * 2);
        g.setLineDash(SKILL_WARNING_STYLE.dash);
        g.beginPath();
        g.arc(0, 0, R * 0.3, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
        g.restore();

        g.lineWidth = 1.6;
        g.lineCap = 'round';
        for (let i = 0; i < 8; i++) {
          const ang = (i / 8) * Math.PI * 2 + t * 0.7;
          const outer = R * (0.42 - p * 0.26);
          const inner = Math.max(2, outer - 10 - p * 6);
          g.beginPath();
          g.moveTo(x + Math.cos(ang) * outer, y + Math.sin(ang) * outer);
          g.lineTo(x + Math.cos(ang) * inner, y + Math.sin(ang) * inner);
          g.stroke();
        }
        if (glow) this.glow.draw(g, castColor, x, y, R * 0.5, 0.15 + p * 0.25);
        g.restore();
      } else if (effect.kind === 'bossRoar') {
        // 咆哮：扩散冲击波 + 声波刻度。
        const R = (effect.r || 2) * T;
        const rr = R * Math.min(1, p * 1.15);
        g.save();
        if (glow) g.globalCompositeOperation = 'lighter';
        if (glow && p < 0.5) this.glow.draw(g, color, x, y, rr * 0.8, 0.35 * (1 - p / 0.5));
        g.globalAlpha = fade * 0.95;
        g.strokeStyle = color;
        g.lineWidth = 1.5 + 4 * (1 - p);
        g.beginPath();
        g.arc(x, y, rr, 0, Math.PI * 2);
        g.stroke();

        g.globalAlpha = fade * 0.45;
        g.lineWidth = 1.3;
        g.beginPath();
        g.arc(x, y, rr * 0.7, 0, Math.PI * 2);
        g.stroke();

        g.globalAlpha = fade * 0.6;
        g.lineWidth = 2;
        g.lineCap = 'round';
        for (let i = 0; i < 10; i++) {
          const ang = (i / 10) * Math.PI * 2 + p * 0.4;
          const tip = rr + 7 + (i % 2) * 3;
          g.beginPath();
          g.moveTo(x + Math.cos(ang) * (rr + 2), y + Math.sin(ang) * (rr + 2));
          g.lineTo(x + Math.cos(ang) * tip, y + Math.sin(ang) * tip);
          g.stroke();
        }
        g.restore();
      } else if (effect.kind === 'bossSummon') {
        // 召唤：旋转裂隙圈 + 上升光点 + 中心裂缝。
        const R = 0.9 * T;
        const rr = R * (0.6 + p * 0.5);
        g.save();
        if (glow) g.globalCompositeOperation = 'lighter';
        g.translate(x, y);
        g.rotate(t * 1.8);
        g.globalAlpha = fade;
        g.strokeStyle = color;
        g.lineWidth = 2;
        g.setLineDash([6, 5]);
        g.beginPath();
        g.arc(0, 0, rr, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
        g.globalAlpha = fade * 0.5;
        g.beginPath();
        g.arc(0, 0, rr * 0.6, 0, Math.PI * 2);
        g.stroke();
        g.restore();

        g.save();
        if (glow) g.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 7; i++) {
          const ph = (p * 1.6 + i * 0.17) % 1;
          g.globalAlpha = fade * (1 - ph) * 0.8;
          g.fillStyle = i % 2 ? color : '#ffd7ef';
          g.beginPath();
          g.arc(x + Math.cos(i * 1.3) * R * 0.8, y - ph * 26, 1.6 + (1 - ph) * 1.4, 0, Math.PI * 2);
          g.fill();
        }
        g.globalAlpha = fade * 0.55;
        g.strokeStyle = color;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x - 8, y + 4);
        g.lineTo(x, y - 14 - p * 6);
        g.lineTo(x + 8, y + 4);
        g.stroke();
        g.restore();
      } else if (effect.kind === 'bossSlam') {
        // 震击：重型扩散环 + 地裂 + 碎石。
        const R = (effect.r || 2.5) * T;
        const rr = R * Math.min(1, p * 1.1);
        g.save();
        if (glow) g.globalCompositeOperation = 'lighter';
        if (glow && p < 0.55) this.glow.draw(g, color, x, y, rr, 0.45 * (1 - p / 0.55));
        g.globalAlpha = fade * 0.95;
        g.strokeStyle = color;
        g.lineWidth = 2 + 5 * (1 - p);
        g.beginPath();
        g.arc(x, y, rr, 0, Math.PI * 2);
        g.stroke();

        g.globalAlpha = fade * 0.5;
        g.lineWidth = 1.4;
        g.beginPath();
        g.arc(x, y, rr * 0.55, 0, Math.PI * 2);
        g.stroke();

        g.globalAlpha = fade * 0.7;
        g.lineWidth = 2;
        for (let i = 0; i < 8; i++) {
          const ang = (i / 8) * Math.PI * 2 + 0.3;
          const r0 = rr * 0.35;
          const r1 = rr * (0.85 + (i % 3) * 0.1);
          g.beginPath();
          g.moveTo(x + Math.cos(ang) * r0, y + Math.sin(ang) * r0);
          g.lineTo(x + Math.cos(ang + 0.1) * (r0 + r1) * 0.5, y + Math.sin(ang + 0.1) * (r0 + r1) * 0.5);
          g.lineTo(x + Math.cos(ang) * r1, y + Math.sin(ang) * r1);
          g.stroke();
        }

        g.globalAlpha = fade * 0.8;
        for (let i = 0; i < 9; i++) {
          const ang = (i / 9) * Math.PI * 2 + 0.5;
          const dist = rr * (0.5 + p * 0.5);
          g.fillStyle = i % 3 === 0 ? '#efe6d8' : color;
          g.beginPath();
          g.arc(
            x + Math.cos(ang) * dist,
            y + Math.sin(ang) * dist - p * 7,
            Math.max(0.8, 3 * (1 - p)),
            0,
            Math.PI * 2
          );
          g.fill();
        }
        g.restore();
      } else if (event === 'bossHit' || event === 'shieldBreak' || event === 'armorAbsorb') {
        // 命中类别层：核心闪白 + 类别色环是任何档位的保底层，粒子按档位裁剪。
        const entry = style || eventVariant(event, profile);
        this.classDrawn[event] = (this.classDrawn[event] || 0) + 1;
        this.drawClassImpact(g, entry, event, x, y, p, fade, halo);
      } else if (effect.kind === 'towerDisable') {
        // 停摆：短路环 + 闪烁电弧（持续整个停摆时长），参数全部来自事件表。
        const entry = style || eventVariant('towerDisable', profile);
        const flick = 0.55 + 0.45 * Math.sin(t * entry.flick + 1.3);
        const rr = entry.ring * T;
        g.save();
        if (glow) g.globalCompositeOperation = 'lighter';
        g.globalAlpha = fade * (0.45 + 0.35 * flick);
        g.strokeStyle = color;
        g.lineWidth = entry.lineWidth;
        g.setLineDash(entry.dash);
        g.lineDashOffset = t * 30;
        g.beginPath();
        g.arc(x, y, rr, 0, PI2);
        g.stroke();
        g.setLineDash([]);

        g.globalAlpha = fade * (0.5 + 0.5 * flick);
        g.lineWidth = 1.5;
        g.lineCap = 'round';
        for (let i = 0; i < entry.particles; i++) {
          const a0 = t * 3 + (i / Math.max(1, entry.particles)) * PI2;
          const jitter = Math.sin(t * 17 + i * 2.1) * 3;
          g.beginPath();
          g.moveTo(x + Math.cos(a0) * (rr - 4), y + Math.sin(a0) * (rr - 4));
          g.lineTo(x + Math.cos(a0 + 0.25) * (rr + 3) + jitter, y + Math.sin(a0 + 0.25) * (rr + 3));
          g.lineTo(x + Math.cos(a0 + 0.5) * (rr - 2), y + Math.sin(a0 + 0.5) * (rr - 2) - jitter);
          g.stroke();
        }

        g.globalAlpha = fade * 0.35 * flick;
        g.fillStyle = color;
        g.beginPath();
        g.arc(x, y, entry.core + flick * 2, 0, PI2);
        g.fill();
        if (entry.extras && halo) this.glow.draw(g, entry.accent, x, y, rr, fade * entry.glow);
        g.restore();
      } else if (effect.kind === 'evolve') {
        // 进化：螺旋上升的粒子 + 扩散环，高配专属细节层。
        const entry = style || eventVariant('evolve', profile);
        const rr = entry.ring * T * (0.45 + p * 0.55);
        g.save();
        if (glow) g.globalCompositeOperation = 'lighter';
        if (halo) this.glow.draw(g, entry.accent, x, y, rr, fade * entry.glow);
        g.globalAlpha = fade * 0.85;
        g.strokeStyle = entry.color;
        g.lineWidth = 2.2;
        g.beginPath();
        g.arc(x, y, rr, 0, PI2);
        g.stroke();
        for (let i = 0; i < entry.particles; i++) {
          const slot = this.pool.acquire();
          if (!slot) break;
          const a = (i / Math.max(1, entry.particles)) * PI2 + entry.spin * t;
          const dist = rr * (0.35 + (i % 3) * 0.2);
          slot.size = Math.max(0.8, entry.size * (1 - p * 0.6));
          slot.x = x + Math.cos(a) * dist;
          slot.y = y + Math.sin(a) * dist - p * entry.rise;
          g.fillStyle = i % 2 === 0 ? entry.accent : entry.color;
          g.beginPath();
          g.arc(slot.x, slot.y, slot.size, 0, PI2);
          g.fill();
        }
        g.restore();
      }
    }

    // 命中层实测峰值：本帧命中粒子槽占用数（测试与性能记录读取）。
    if (this.impactPool.active > this.impactPeak) this.impactPeak = this.impactPool.active;
    // 战旗签名：光环脉冲是纯渲染层表现，不产生模拟事件。
    this.renderAuraPulses(g, t, profile);
  }

  // 命中类别特效：同一分支内按 shape 区分形态（burst / hexring / shards）。
  // 核心闪白 + 类别色环与档位无关（低档/粒子耗尽的保底层）；粒子取自共用池，池满时静默降级。
  drawClassImpact(g, entry, event, x, y, p, fade, halo) {
    const rr = entry.ring * T * (0.3 + p * 0.8);
    g.save();
    if (halo) g.globalCompositeOperation = 'lighter';
    if (halo) this.glow.draw(g, entry.accent, x, y, rr * 1.05, fade * entry.glow);

    g.globalAlpha = fade * 0.95;
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(x, y, Math.max(0.6, (1 - p) * 3.4), 0, PI2);
    g.fill();

    g.globalAlpha = fade * 0.85;
    g.strokeStyle = entry.color;
    g.lineWidth = 1.6 + 2.6 * (1 - p);
    if (event === 'shieldBreak') {
      // 破盾：六边环，和圆形冲击/死亡环拉开形状差异。
      g.beginPath();
      for (let i = 0; i <= 6; i++) {
        const a = (i / 6) * PI2 + entry.spin;
        const px = x + Math.cos(a) * rr;
        const py = y + Math.sin(a) * rr;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.stroke();
    } else if (event === 'armorAbsorb') {
      // 护甲吸收：向内收拢的三段弧，表现「被吃掉」而不是爆发。
      g.lineWidth = 1.4 + 2 * (1 - p);
      for (let i = 0; i < 3; i++) {
        const a0 = (i / 3) * PI2 + entry.spin + p * 0.6;
        g.beginPath();
        g.arc(x, y, rr * (1 - p * 0.35), a0, a0 + 0.7);
        g.stroke();
      }
    } else {
      // 首领命中：双环 + 放射尖刺（高配 8 根、低配 4 根），是轻量命中层而非死亡演出。
      g.beginPath();
      g.arc(x, y, rr, 0, PI2);
      g.stroke();
      g.globalAlpha = fade * 0.5;
      g.beginPath();
      g.arc(x, y, rr * 0.62, 0, PI2);
      g.stroke();
      const spikes = entry.extras ? 8 : 4;
      g.globalAlpha = fade * 0.8;
      g.lineWidth = 1.6;
      g.lineCap = 'round';
      for (let i = 0; i < spikes; i++) {
        const a = (i / spikes) * PI2 + entry.spin;
        const inner = rr * 0.72;
        const outer = rr * (1.05 + (i % 2) * 0.18);
        g.beginPath();
        g.moveTo(x + Math.cos(a) * inner, y + Math.sin(a) * inner);
        g.lineTo(x + Math.cos(a) * outer, y + Math.sin(a) * outer);
        g.stroke();
      }
    }

    // 粒子方向按类别：破盾外扩、护甲内收、首领命中由内向外；任何档位至少 1 颗。
    g.globalAlpha = fade * 0.85;
    for (let i = 0; i < entry.particles; i++) {
      const slot = this.pool.acquire();
      if (!slot) break;
      const a = (i / Math.max(1, entry.particles)) * PI2 + entry.spin;
      const dist = event === 'armorAbsorb' ? rr * (1 - p * 0.8) : rr * (0.4 + p * 0.8);
      slot.size = Math.max(0.8, entry.size * (1 - p * 0.55));
      slot.x = x + Math.cos(a) * dist;
      slot.y = y + Math.sin(a) * dist;
      g.fillStyle = i % 2 === 0 ? entry.accent : entry.color;
      g.beginPath();
      g.arc(slot.x, slot.y, slot.size, 0, PI2);
      g.fill();
    }
    g.restore();
  }

  // 战旗光环脉冲：按 (time * 0.6) % 1 的相位从塔心向外扩散，标记支援塔的作用范围。
  // 只读 game.towers，不新增模拟事件、不消耗命中层粒子预算。
  renderAuraPulses(g, time, profile) {
    const towers = this.game && this.game.towers;
    if (!Array.isArray(towers) || towers.length === 0) return 0;
    const variant = impactVariant('banner', profile);
    const phase = (time * 0.6) % 1;
    let drawn = 0;
    for (const tower of towers) {
      const isBanner = !!tower && tower.type === 'banner';
      if (!isBanner) continue;
      const range = Number(tower.range ?? tower.stats?.range);
      const cx = tower.x * T;
      const cy = tower.y * T;
      const reach = (Number.isFinite(range) && range > 0 ? range : 2.6) * T;
      const radius = reach * (0.25 + phase * 0.7);
      g.save();
      g.globalAlpha = (1 - phase) * 0.22;
      g.strokeStyle = variant.accent;
      g.lineWidth = 1.6 + (1 - phase);
      g.beginPath();
      g.arc(cx, cy, radius, 0, PI2);
      g.stroke();
      g.globalAlpha = (1 - phase) * 0.1;
      g.strokeStyle = variant.color;
      g.lineWidth = 1;
      g.beginPath();
      g.arc(cx, cy, radius * 0.72, 0, PI2);
      g.stroke();
      g.restore();
      drawn++;
    }
    this.auraPulses += drawn;
    return drawn;
  }

  strokeBolt(g, points, offsetX = 0, offsetY = 0) {
    if (!points || points.length < 2) return;
    g.beginPath();
    for (let i = 0; i < points.length; i++) {
      const px = points[i].x * T;
      const py = points[i].y * T;
      if (i === 0) {
        g.moveTo(px, py);
        continue;
      }
      const prev = points[i - 1];
      const ax = prev.x * T;
      const ay = prev.y * T;
      const midX = (ax + px) / 2 + (Math.random() - 0.5) * 12;
      const midY = (ay + py) / 2 + (Math.random() - 0.5) * 12;
      g.lineTo(midX, midY);
      g.lineTo(px, py);
    }
    g.stroke();
  }
}
