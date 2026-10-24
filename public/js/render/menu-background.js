// 大厅动态背景：程序化视差层 + 粒子池，按画质预算开关，音乐氛围切换时轻微调色。
// 只做表现，不读取模拟状态，也不加载任何外部素材。
import { RNG } from '../shared/rng.js';
import { dayKey } from '../shared/scoring.js';

export const MENU_BG_ID = 'menu-background';

// 粒子上限：高配才启用；低配（decorations: light）与关闭档一律零粒子。
export const MENU_PARTICLE_CAP = 56;
export const MENU_PARALLAX_LAYERS = 3;
export const MENU_BASE_FPS = 30;

// 画布永远垫在标题页内容之下，并且不接收指针事件，按钮与文字保持可点可读。
export const MENU_BG_STYLE = Object.freeze({
  position: 'absolute',
  inset: '0',
  width: '100%',
  height: '100%',
  display: 'block',
  pointerEvents: 'none',
  zIndex: '0',
});

// 季节主题：与当日日期联动，同一天永远得到同一套配色与粒子种子。
export const SEASON_THEMES = Object.freeze({
  spring: Object.freeze({ id: 'spring', sky: '#0a1512', deep: '#0e201a', accent: '#63e0b8' }),
  summer: Object.freeze({ id: 'summer', sky: '#0a1418', deep: '#0d1f28', accent: '#5ad0ff' }),
  autumn: Object.freeze({ id: 'autumn', sky: '#150f0b', deep: '#1f150f', accent: '#ffb869' }),
  winter: Object.freeze({ id: 'winter', sky: '#0b1018', deep: '#111a26', accent: '#93b8ff' }),
});

// 音乐氛围到色调的映射：alpha 很低，只做「轻微色调变化」。
export const MUSIC_TINTS = Object.freeze({
  menu: Object.freeze({ hue: 168, alpha: 0.1 }),
  battle: Object.freeze({ hue: 12, alpha: 0.12 }),
  boss: Object.freeze({ hue: 282, alpha: 0.14 }),
  none: Object.freeze({ hue: 210, alpha: 0.06 }),
});

export const MENU_TINT_ALPHA_MAX = 0.18;

export function seasonOf(date = new Date()) {
  const valid = date instanceof Date && !Number.isNaN(date.getTime());
  const month = valid ? date.getMonth() : 11;
  if (month >= 2 && month <= 4) return 'spring';
  if (month >= 5 && month <= 7) return 'summer';
  if (month >= 8 && month <= 10) return 'autumn';
  return 'winter';
}

// 当日主题：季节配色 + 日期种子；非法日期回退冬季，保证永远有稳定主题。
export function menuTheme(date = new Date()) {
  const valid = date instanceof Date && !Number.isNaN(date.getTime());
  const season = seasonOf(date);
  return Object.freeze({
    ...SEASON_THEMES[season],
    season,
    day: valid ? dayKey(date) : 'fallback',
    seed: `menu:${season}:${valid ? dayKey(date) : 'fallback'}`,
  });
}

export function musicTint(mood) {
  return MUSIC_TINTS[mood] || MUSIC_TINTS.none;
}

// 画质预算：低配零粒子、off 零粒子、reduce-motion 全停；高配才吃满粒子上限。
export function menuBackgroundBudget(settings = {}, { reduceMotion = false } = {}) {
  const decorations = ['off', 'light', 'full'].includes(settings?.decorations)
    ? settings.decorations
    : 'light';
  const fps = settings?.fps === 60 ? 60 : MENU_BASE_FPS;
  const particles = reduceMotion || decorations !== 'full' ? 0 : MENU_PARTICLE_CAP;
  const parallaxLayers = reduceMotion ? 0 : MENU_PARALLAX_LAYERS;
  return {
    decorations,
    fps,
    frameMs: 1000 / fps,
    particles,
    parallaxLayers,
    animate: particles > 0 || parallaxLayers > 0,
  };
}

// 画布装饰：绝对定位垫底、不拦截点击、对读屏隐藏；创建与复用都走同一套样式。
export function decorateMenuCanvas(canvas) {
  if (!canvas) return canvas;
  if (canvas.id !== MENU_BG_ID) canvas.id = MENU_BG_ID;
  if (canvas.style) Object.assign(canvas.style, MENU_BG_STYLE);
  canvas.setAttribute?.('aria-hidden', 'true');
  canvas.setAttribute?.('role', 'presentation');
  canvas.tabIndex = -1;
  return canvas;
}

// 把画布插到标题页第一个子节点：DOM 顺序保证 .title-glow 与 .title-inner 都盖在它上面。
export function createMenuCanvas(container, doc = globalThis.document) {
  if (!container || typeof doc?.createElement !== 'function') return null;
  const canvas = decorateMenuCanvas(doc.createElement('canvas'));
  container.insertBefore(canvas, container.firstChild || null);
  return canvas;
}

export class MenuBackground {
  constructor({
    canvas = null,
    settings = {},
    theme = menuTheme(),
    mood = 'menu',
    raf = (cb) => globalThis.requestAnimationFrame(cb),
    caf = (id) => globalThis.cancelAnimationFrame(id),
    now = () => globalThis.performance?.now?.() ?? Date.now(),
    reduceMotion = false,
  } = {}) {
    this.canvas = canvas;
    this.ctx = canvas?.getContext?.('2d') || null;
    this.settings = settings;
    this.reduceMotion = reduceMotion;
    this.budget = menuBackgroundBudget(settings, { reduceMotion });
    this.theme = theme;
    this.raf = raf;
    this.caf = caf;
    this.now = now;
    this.running = false;
    this.frameId = null;
    this.lastAt = null;
    this.elapsed = 0;
    this.width = 0;
    this.height = 0;
    this.dpr = settings?.dpr === 2 ? 2 : 1;
    this.mood = mood;
    this.tint = { ...musicTint(mood) };
    this.targetTint = { ...musicTint(mood) };
    this.particles = [];
    this._seedParticles();
    decorateMenuCanvas(canvas);
  }

  _seedParticles() {
    const count = this.budget.particles;
    if (!count) {
      this.particles = [];
      return;
    }
    const rng = new RNG(this.theme?.seed || 'menu');
    this.particles = Array.from({ length: count }, () => ({
      x: rng.float(),
      y: rng.float(),
      r: 0.6 + rng.float() * 1.8,
      speed: 0.006 + rng.float() * 0.02,
      drift: (rng.float() - 0.5) * 0.02,
      phase: rng.float() * Math.PI * 2,
      alpha: 0.12 + rng.float() * 0.28,
    }));
  }

  updateSettings(settings = {}) {
    const previous = this.budget;
    this.settings = settings;
    this.dpr = settings?.dpr === 2 ? 2 : 1;
    this.budget = menuBackgroundBudget(settings, { reduceMotion: this.reduceMotion });
    if (this.budget.particles !== previous.particles) this._seedParticles();
    if (!this.budget.animate) this.stop();
    return this;
  }

  setTheme(theme) {
    if (!theme || theme.seed === this.theme?.seed) return this;
    this.theme = theme;
    if (this.budget.particles) this._seedParticles();
    return this;
  }

  // 只改目标色；渲染时缓慢插值过去，避免切换瞬间闪一下。
  setMusicMood(mood) {
    this.mood = mood;
    this.targetTint = { ...musicTint(mood) };
    return this;
  }

  start() {
    if (this.running || !this.canvas || !this.ctx) return this;
    if (!this.budget.animate) return this;
    this.running = true;
    this.lastAt = null;
    this._schedule();
    return this;
  }

  stop() {
    this.running = false;
    if (this.frameId != null) {
      this.caf(this.frameId);
      this.frameId = null;
    }
    this._clear();
    return this;
  }

  _schedule() {
    this.frameId = this.raf((stamp) => this._frame(stamp));
  }

  _frame(stamp) {
    if (!this.running) return;
    this.frameId = null;
    const at = Number.isFinite(stamp) ? stamp : this.now();
    // 30 FPS 设置下，60Hz 的 rAF 只画一半的帧。
    if (this.lastAt != null && at - this.lastAt < this.budget.frameMs - 1) {
      this._schedule();
      return;
    }
    const dt = this.lastAt != null ? Math.min(0.1, (at - this.lastAt) / 1000) : 1 / this.budget.fps;
    this.lastAt = at;
    this.render(dt);
    if (this.running) this._schedule();
  }

  resize() {
    const canvas = this.canvas;
    if (!canvas) return;
    const cssWidth = Math.max(1, Math.round(canvas.clientWidth || canvas.width || 1));
    const cssHeight = Math.max(1, Math.round(canvas.clientHeight || canvas.height || 1));
    const width = Math.round(cssWidth * this.dpr);
    const height = Math.round(cssHeight * this.dpr);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    this.width = cssWidth;
    this.height = cssHeight;
  }

  _clear() {
    if (!this.ctx) return;
    this.ctx.clearRect(0, 0, this.canvas?.width || this.width, this.canvas?.height || this.height);
  }

  render(dt = 1 / this.budget.fps) {
    if (!this.running || !this.ctx) return;
    this.resize();
    if (!this.width || !this.height) return;
    this.elapsed += Math.max(0, dt);
    this._lerpTint(dt);
    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    this._drawSky();
    this._drawParallax();
    this._drawParticles(dt);
    this._drawTint();
    ctx.restore();
  }

  _drawSky() {
    const { ctx, theme } = this;
    const gradient = ctx.createLinearGradient(0, 0, 0, this.height);
    gradient.addColorStop(0, theme.sky);
    gradient.addColorStop(1, theme.deep);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  // 视差层：三条低频山脊，相位随时间缓慢漂移，远层慢、近层快。
  _drawParallax() {
    const { ctx, width, height } = this;
    const layers = this.budget.parallaxLayers;
    for (let i = 0; i < layers; i += 1) {
      const depth = (i + 1) / (layers + 1);
      const offset = (this.elapsed * (6 + i * 10)) % width;
      const baseY = height * (0.55 + depth * 0.28);
      const amp = height * (0.035 + depth * 0.03);
      const step = Math.max(24, width / 12);
      ctx.globalAlpha = 0.05 + depth * 0.05;
      ctx.fillStyle = this.theme.accent;
      ctx.beginPath();
      ctx.moveTo(-width, height);
      for (let x = -width; x <= width * 2; x += step) {
        ctx.lineTo(x, baseY + Math.sin((x + offset) * 0.0025 + i * 1.7) * amp);
      }
      ctx.lineTo(width * 2, height);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  _drawParticles(dt) {
    const { ctx, width, height } = this;
    for (const p of this.particles) {
      p.y -= p.speed * dt;
      p.x += Math.sin(this.elapsed * 0.5 + p.phase) * p.drift * dt;
      if (p.y < -0.05) p.y = 1.05;
      if (p.x < -0.05) p.x = 1.05;
      if (p.x > 1.05) p.x = -0.05;
      ctx.globalAlpha = p.alpha;
      ctx.beginPath();
      ctx.arc(p.x * width, p.y * height, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  _drawTint() {
    const { ctx, tint } = this;
    ctx.globalAlpha = 1;
    ctx.fillStyle = `hsla(${tint.hue.toFixed(1)}, 80%, 60%, ${tint.alpha.toFixed(3)})`;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  // 色相按最短弧插值；alpha 线性逼近。dt 越大收敛越快，但永远不会瞬间跳变。
  _lerpTint(dt) {
    const k = Math.min(1, Math.max(0, dt) * 1.2);
    const delta = ((this.targetTint.hue - this.tint.hue + 540) % 360) - 180;
    this.tint.hue = (this.tint.hue + delta * k + 360) % 360;
    this.tint.alpha += (this.targetTint.alpha - this.tint.alpha) * k;
  }
}
