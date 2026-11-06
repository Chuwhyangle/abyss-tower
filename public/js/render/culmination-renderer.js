// 高潮演出渲染层（AC-017）：漏怪 / 清波 / 首领死亡的屏幕空间演出。
//
// 边界（docs/PHASE_FEEL_ART.md §3.6 / §3.8）：
//   - 只读 `game.culminations`（按 seq 增量消费），不 import 模拟层 / 随机源，
//     不出现未播种随机、不写回 game 的任何字段；
//   - 三段画法互不相同：漏怪 = 红色边框 + 基地同心环 + 上方横幅；
//     清波 = 金色横扫 + 居中横幅；首领死亡 = 白闪 + 多层扩散环 + 首领名横幅；
//   - reduced-motion / 关闭震屏时只取消脉冲、扫光、扩散环与慢动作，
//     横幅、色块与静态边框照常绘制（非运动反馈不降级）；
//   - 文案由外部注入的 `text(key, params)` 解析（渲染层不直接依赖 i18n 模块），
//     缺注入时只画色块与边框，不抛错。

import { registerRenderer } from './registry.js';
import { TILE } from '../shared/data.js';
import { culminationPlan } from '../shared/culmination.js';

const T = TILE;
const PI2 = Math.PI * 2;
// 同屏最多保留的演出数：低频事件，超出时丢最旧的（新事件优先级更高）。
const MAX_ACTIVE = 6;
const FADE_IN = 0.12;
const FADE_OUT = 0.35;

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

// 横幅排版是「画法」而非玩法数值：三种 kind 的锚点/字号刻意不同，避免观感同质。
const BANNER_LAYOUT = Object.freeze({
  leak: Object.freeze({ y: 0.2, title: 22, detail: 12, plate: 0.44 }),
  waveClear: Object.freeze({ y: 0.42, title: 28, detail: 13, plate: 0.52 }),
  bossKill: Object.freeze({ y: 0.34, title: 34, detail: 14, plate: 0.58 }),
});

export class CulminationRenderer {
  constructor(game, { width = null, height = null, text = null, settings = {}, reducedMotion = false } = {}) {
    this.game = game;
    this.W = width || (game?.map?.cols || 1) * T;
    this.H = height || (game?.map?.rows || 1) * T;
    this.text = typeof text === 'function' ? text : null;
    this.settings = settings || {};
    this.reducedMotion = reducedMotion === true;
    this.seenSeq = 0;
    this.active = [];
    // 只读观测计数（浏览器验收读取）：每 kind 的产生数与实际绘制数、降级数与未知 kind 跳过数。
    this.stats = {
      leak: 0,
      waveClear: 0,
      bossKill: 0,
      drawn: { leak: 0, waveClear: 0, bossKill: 0 },
      drawnTotal: 0,
      reducedFallbacks: 0,
      skipped: 0,
    };
  }

  configure({ width, height, text } = {}) {
    if (Number.isFinite(width) && width > 0) this.W = width;
    if (Number.isFinite(height) && height > 0) this.H = height;
    if (text !== undefined) this.text = typeof text === 'function' ? text : null;
  }

  // 设置转发：关闭震屏时已生成的演出立即按降级重新出计划（横幅不消失）。
  setSettings(settings = {}) {
    this.settings = settings || {};
    this._replan();
  }

  setReducedMotion(reduced = false) {
    this.reducedMotion = reduced === true;
    this._replan();
  }

  // 降级口径：reduced-motion 或关闭震屏任一成立（与规格模块的 signature 一致）。
  _planOptions() {
    return { reducedMotion: this.reducedMotion, shake: this.settings?.shake !== false };
  }

  _replan() {
    for (const show of this.active) {
      const next = culminationPlan(show.kind, this._planOptions());
      if (next) show.plan = next;
    }
  }

  // 所有进行中的演出取最小 timeScale；无演出时为 1（不改变常态视觉节奏）。
  timeScale() {
    if (!this.active.length) return 1;
    let scale = 1;
    for (const show of this.active) {
      const value = Number(show.plan?.motion?.timeScale);
      if (Number.isFinite(value) && value < scale) scale = Math.max(0.05, value);
    }
    return scale;
  }

  // 消费新事件并按 duration 过期；返回本帧仍在播放的演出数。
  update(game = this.game, dt = 0) {
    if (game && game !== this.game) this.game = game;
    this._consume();
    if (!this.active.length) return 0;
    const delta = Number.isFinite(dt) && dt > 0 ? dt : 0;
    const alive = [];
    for (const show of this.active) {
      show.age += delta;
      if (show.age < show.plan.duration) alive.push(show);
    }
    this.active = alive;
    return this.active.length;
  }

  _consume() {
    const list = this.game?.culminations;
    if (!Array.isArray(list) || list.length === 0) return 0;
    let added = 0;
    for (const event of list) {
      if (!event || typeof event !== 'object') continue;
      const seq = Number(event.seq);
      if (!Number.isFinite(seq) || seq <= this.seenSeq) continue;
      this.seenSeq = seq;
      const plan = culminationPlan(event.kind, this._planOptions());
      if (!plan) {
        // 未知 kind：跳过并计数，不抛错（旧快照/未来事件都走这条）。
        this.stats.skipped += 1;
        continue;
      }
      this.active.push({ seq, kind: plan.kind, plan, meta: { ...event }, age: 0 });
      this.stats[plan.kind] = (this.stats[plan.kind] || 0) + 1;
      if (!Number.isFinite(this.stats.drawn[plan.kind])) this.stats.drawn[plan.kind] = 0;
      if (plan.motion.mode === 'reduced') this.stats.reducedFallbacks += 1;
      added += 1;
    }
    if (this.active.length > MAX_ACTIVE) {
      this.active.splice(0, this.active.length - MAX_ACTIVE);
    }
    return added;
  }

  // 绘制所有进行中的演出；返回本帧绘制出的横幅数。
  render(g) {
    if (!g || this.active.length === 0) return 0;
    let drawn = 0;
    for (const show of this.active) {
      if (this._drawShow(g, show)) {
        drawn += 1;
        this.stats.drawn[show.kind] += 1;
        this.stats.drawnTotal += 1;
      }
    }
    return drawn;
  }

  _drawShow(g, show) {
    const plan = show.plan;
    const duration = Math.max(1e-6, plan.duration);
    const progress = clamp01(show.age / duration);
    const alpha = Math.min(clamp01((show.age + 0.03) / FADE_IN), clamp01((1 - progress) / FADE_OUT));
    if (alpha <= 0) return false;
    const ctx = {
      alpha,
      progress,
      motion: plan.motion.pulse === true,
      flashFade: clamp01(1 - show.age / Math.max(1e-6, plan.flash.duration)),
    };
    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    if (plan.kind === 'leak') this._drawLeak(g, show, ctx);
    else if (plan.kind === 'waveClear') this._drawWaveClear(g, show, ctx);
    else if (plan.kind === 'bossKill') this._drawBossKill(g, show, ctx);
    this._drawBanner(g, show, ctx);
    g.restore();
    return true;
  }

  // ---------- 漏怪：红色静态边框 + 基地同心环 ----------

  _drawLeak(g, show, ctx) {
    const plan = show.plan;
    this._flashWash(g, plan, ctx, 0.5);
    // 静态边框：非运动反馈，降级时保留。
    const inset = 5;
    g.globalAlpha = ctx.alpha * 0.8;
    g.strokeStyle = plan.accent;
    g.lineWidth = 3;
    g.strokeRect(inset, inset, this.W - inset * 2, this.H - inset * 2);
    if (ctx.motion) {
      const base = this.game?.map?.base;
      const cx = Number.isFinite(base?.x) ? base.x * T : this.W * 0.8;
      const cy = Number.isFinite(base?.y) ? base.y * T : this.H * 0.5;
      const rings = Math.max(1, plan.pulse.rings | 0);
      for (let i = 0; i < rings; i++) {
        const q = clamp01(ctx.progress * 1.4 - i * 0.18);
        if (q <= 0) continue;
        const radius = 8 + q * T * 2.6;
        g.globalAlpha = (1 - q) * ctx.alpha * 0.7;
        g.strokeStyle = plan.pulse.color;
        g.lineWidth = 3 - q * 1.4;
        g.beginPath();
        g.arc(cx, cy, radius, 0, PI2);
        g.stroke();
      }
    }
    g.globalAlpha = 1;
  }

  // ---------- 清波：金色横扫 + 居中横幅 ----------

  _drawWaveClear(g, show, ctx) {
    const plan = show.plan;
    this._flashWash(g, plan, ctx, 0.32);
    // 静态上下描边：降级时也能与漏怪的「红边框」区分开。
    g.globalAlpha = ctx.alpha * 0.7;
    g.fillStyle = plan.accent;
    const bar = Math.max(2, Math.round(this.H * 0.006));
    g.fillRect(0, 0, this.W, bar);
    g.fillRect(0, this.H - bar, this.W, bar);
    if (ctx.motion) {
      // 水平扫光：一条从画面上方扫到下方的金色光带 + 一条更亮的前沿。
      const bandH = this.H * 0.22;
      const top = -bandH + ctx.progress * (this.H + bandH * 2);
      const gradient = g.createLinearGradient(0, top, 0, top + bandH);
      gradient.addColorStop(0, 'rgba(255, 211, 107, 0)');
      gradient.addColorStop(0.5, 'rgba(255, 233, 168, 0.4)');
      gradient.addColorStop(1, 'rgba(255, 211, 107, 0)');
      g.globalAlpha = ctx.alpha;
      g.fillStyle = gradient;
      g.fillRect(0, top, this.W, bandH);
      g.globalAlpha = ctx.alpha * 0.85;
      g.strokeStyle = plan.pulse.color;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(0, top + bandH * 0.5);
      g.lineTo(this.W, top + bandH * 0.5);
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  // ---------- 首领死亡：白闪 + 多层扩散环 ----------

  _drawBossKill(g, show, ctx) {
    const plan = show.plan;
    this._flashWash(g, plan, ctx, 0.6);
    // 静态双重细边框：降级时保留的「首领阵亡」签名。
    g.globalAlpha = ctx.alpha * 0.85;
    g.strokeStyle = plan.accent;
    g.lineWidth = 2;
    g.strokeRect(8, 8, this.W - 16, this.H - 16);
    g.globalAlpha = ctx.alpha * 0.5;
    g.strokeRect(14, 14, this.W - 28, this.H - 28);
    if (ctx.motion) {
      const cx = this.W / 2;
      const cy = this.H / 2;
      const rings = Math.max(1, plan.pulse.rings | 0);
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < rings; i++) {
        const q = clamp01(ctx.progress * 1.6 - i * 0.14);
        if (q <= 0) continue;
        const radius = 12 + q * Math.max(this.W, this.H) * 0.55;
        g.globalAlpha = (1 - q) * ctx.alpha * 0.55;
        g.strokeStyle = plan.pulse.color;
        g.lineWidth = 4 - q * 2.6;
        g.beginPath();
        g.arc(cx, cy, radius, 0, PI2);
        g.stroke();
      }
    }
    g.globalAlpha = 1;
  }

  // 屏幕色块：完整模式随闪光时长衰减，降级模式保持恒定（静态色块，不随动）。
  _flashWash(g, plan, ctx, scale) {
    const peak = Math.max(0, Number(plan.flash.peak) || 0);
    const amount = ctx.motion ? peak * ctx.flashFade * scale : peak * scale;
    if (amount <= 0.01) return;
    g.globalAlpha = amount;
    g.fillStyle = plan.flash.color;
    g.fillRect(0, 0, this.W, this.H);
    g.globalAlpha = 1;
  }

  // ---------- 横幅 ----------

  _drawBanner(g, show, ctx) {
    const plan = show.plan;
    const layout = BANNER_LAYOUT[plan.kind];
    if (!layout) return;
    const cx = this.W / 2;
    const cy = this.H * layout.y;
    const plateW = Math.min(this.W * 0.92, this.W * layout.plate + 220);
    const plateH = layout.title + 30;
    const x = cx - plateW / 2;
    const y = cy - plateH / 2;
    g.globalAlpha = ctx.alpha;
    // 底板：深色半透明 + 两侧强调色条（色块本身即非运动反馈）。
    g.fillStyle = 'rgba(6, 10, 16, 0.72)';
    g.fillRect(x, y, plateW, plateH);
    g.fillStyle = plan.accent;
    g.fillRect(x, y, 4, plateH);
    g.fillRect(x + plateW - 4, y, 4, plateH);
    g.globalAlpha = ctx.alpha * 0.9;
    g.strokeStyle = plan.accent;
    g.lineWidth = 1.5;
    g.strokeRect(x + 0.75, y + 0.75, plateW - 1.5, plateH - 1.5);

    if (!this.text) return;
    const title = String(this.text(plan.bannerKey, show.meta) ?? '');
    const detail = String(this.text(plan.detailKey, show.meta) ?? '');
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.globalAlpha = ctx.alpha;
    g.lineJoin = 'round';
    g.font = `800 ${layout.title}px "Noto Sans SC", "DejaVu Sans", sans-serif`;
    g.strokeStyle = 'rgba(4, 8, 12, 0.7)';
    g.lineWidth = 5;
    g.strokeText(title, cx, cy - (detail ? 7 : 0));
    g.fillStyle = plan.accent;
    g.fillText(title, cx, cy - (detail ? 7 : 0));
    if (detail) {
      g.font = `600 ${layout.detail}px "DejaVu Sans Mono", ui-monospace, monospace`;
      g.fillStyle = 'rgba(232, 244, 255, 0.82)';
      g.fillText(detail, cx, cy + layout.title * 0.55);
    }
    g.globalAlpha = 1;
  }
}

// 自注册到渲染器注册表：render.js 经 id 创建实例，不再逐个静态 import。
registerRenderer('culmination', CulminationRenderer);
