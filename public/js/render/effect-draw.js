// 特效绘制：逐事件分支画法、锐利命中星芒、命中类别层、战旗光环与命中进度换算。
//
// 画法以「方法集合挂回 EffectRenderer 原型」组织（与 skill-draw.js 同一惯例）：
// 同一实例字段、同一方法签名；首领系列见 effect-boss.js，effect-renderer.js 只留编排。
import { TILE } from '../shared/data.js';
import { Palette } from './palette.js';
import { drawImpactFallback, drawImpactShape, impactPlan, impactVariant } from './impact-vfx.js';
import { SHARP_HIT_STAR, eventVariant, scaledCount } from './effect-data.js';

const T = TILE;
const PI2 = Math.PI * 2;

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

export const effectDrawMethods = {
  drawRing(g, fx) {
    const { effect, p, fade, x, y, color, glow, halo, profile } = fx;
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
  },

  drawSpark(g, fx) {
    const { effect, p, fade, x, y, color, glow, profile } = fx;
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
  },

  drawBolt(g, fx) {
    const { effect, p, x, y, color, halo, profile } = fx;
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
  },

  drawMuzzle(g, fx) {
    const { effect, p, fade, x, y, color, glow } = fx;
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
  },

  drawSpawn(g, fx) {
    const { p, fade, x, y, color, glow, halo, profile, t } = fx;
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
  },

  drawDeath(g, fx) {
    const { effect, style, event, p, fade, x, y, color, glow, halo, profile } = fx;
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
  },

  drawHeal(g, fx) {
    const { p, fade, x, y, glow, profile } = fx;
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
  },

  drawPlace(g, fx) {
    const { p, fade, x, y, color, glow, profile } = fx;
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
  },

  drawPoison(g, fx) {
    const { p, fade, x, y, glow, profile } = fx;
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
  },

  drawLeak(g, fx) {
    const { style, p, fade, x, y, color, glow, halo, profile } = fx;
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
  },

  drawClassEvent(g, fx) {
    const { style, event, p, fade, x, y, halo, profile } = fx;
    // 命中类别层：核心闪白 + 类别色环是任何档位的保底层，粒子按档位裁剪。
    const entry = style || eventVariant(event, profile);
    this.classDrawn[event] = (this.classDrawn[event] || 0) + 1;
    this.drawClassImpact(g, entry, event, x, y, p, fade, halo);
  },

  drawTowerDisable(g, fx) {
    const { style, fade, x, y, color, glow, halo, profile, t } = fx;
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
  },

  drawEvolve(g, fx) {
    const { style, p, fade, x, y, color, glow, halo, profile, t } = fx;
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
  },

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
  },

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
  },

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
};
