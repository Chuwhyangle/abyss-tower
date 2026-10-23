// 主动技能表现层：独立于 sim.effects 的四层绘制（L0 背景 / L1 地面 / L2 世界 / L3 屏幕）。
//
// 时间语义：
//   - 玩法状态（冻结/灼烧/过载）一律用模拟时间 game.time 判定；
//   - 氛围动画（帘幕漂移、粒子相位）用渲染真实时间；
//   - 技能演出设最短真实时长（极光 2.4s / 终章 2.8s），3× 速度下也看得清。
//
// 性能：
//   - 粒子池 + 上限（full 180 / standard 120 / minimal 48）；
//   - 全屏色层、极光帘幕、星空、光柱、焦痕全部预烘焙，绘制时只 drawImage；
//   - 不使用 ctx.filter / shadowBlur / getImageData，也不在每帧创建渐变。
import { TILE, SKILLS, SKILL_ORDER, skillStats } from '../shared/data.js';
import { RNG } from '../shared/rng.js';

const T = TILE;

// 粒子上限显式声明；画质档位在此之上决定各表现层开关。
export const QUALITY_CAPS = { minimal: 48, standard: 120, full: 180 };

// 画质档位：粒子预算与表现开关。低配只保留预警与命中闪光（玩法信息），
// 光晕、余韵、氛围粒子、横幅一律关闭。
export const SKILL_QUALITY_PROFILES = {
  minimal: { particles: QUALITY_CAPS.minimal, glow: false, afterglow: false, ambient: false, banner: false, tint: 0.34 },
  standard: { particles: QUALITY_CAPS.standard, glow: true, afterglow: true, ambient: true, banner: true, tint: 0.5 },
  full: { particles: QUALITY_CAPS.full, glow: true, afterglow: true, ambient: true, banner: true, tint: 0.62 },
};

const DEFAULT_QUALITY_PROFILE = SKILL_QUALITY_PROFILES.standard;

export function qualityProfile(tier) {
  return SKILL_QUALITY_PROFILES[tier] || DEFAULT_QUALITY_PROFILE;
}

// 前摇预警：地面标记 + 倒计时环。cast = 渲染层在释放瞬间起搏；
// event = 沿用模拟层的 meteorWarn 事件（逐落点、位置精确）。
export const SKILL_WARNING_PROFILES = {
  aurora: { source: 'cast', shape: 'hex', ttl: 0.85, radius: 3.2, dash: [8, 6], fill: 0.1, spin: 0.5, ring: true },
  meteor: { source: 'event', shape: 'ring', ttl: 0.55, radius: 1.8, dash: [6, 5], fill: 0.12, spin: 0, ring: true },
  chrono: { source: 'cast', shape: 'star', ttl: 1, radius: 4.4, dash: [10, 8], fill: 0.08, spin: -0.4, ring: true },
};

const DEFAULT_WARNING_PROFILE = {
  source: 'cast',
  shape: 'ring',
  ttl: 0.7,
  radius: 2.2,
  dash: [6, 6],
  fill: 0.08,
  spin: 0,
  ring: true,
};

export function warningProfile(id) {
  return SKILL_WARNING_PROFILES[id] || DEFAULT_WARNING_PROFILE;
}

// 倒计时环比例：剩余时间 / 总时长，1 → 0；非法输入回退 0（不画环）。
export function warningCountdown(remaining, duration) {
  const total = Number(duration);
  const left = Number(remaining);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(left)) return 0;
  return clamp01(left / total);
}

// 演出最短真实时长：不受 3× 模拟速度影响。
const MIN_REAL_SECONDS = { aurora: 2.4, meteor: 1.8, chrono: 2.8 };

const AURORA_RE = /aurora|frost|ice|freeze|shatter|crystal|curtain|snow|slow|chill/i;
const METEOR_RE = /meteor|ember|scorch|starburst|fire|burn|impact|blaze/i;
const CHRONO_RE = /chrono|time|stasis|nova|star|clock|overdrive|bubble|echo/i;

const clamp01 = (v) => Math.max(0, Math.min(1, v));

function parseHex(hex) {
  const value = String(hex || '#ffffff').replace('#', '');
  return {
    r: parseInt(value.slice(0, 2), 16) || 0,
    g: parseInt(value.slice(2, 4), 16) || 0,
    b: parseInt(value.slice(4, 6), 16) || 0,
  };
}

function toHex({ r, g, b }) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

// 技能主色向地图 accent 偏移，避免与地面/路径撞色。
function mixHex(a, b, amount) {
  const left = parseHex(a);
  const right = parseHex(b);
  return toHex({
    r: left.r + (right.r - left.r) * amount,
    g: left.g + (right.g - left.g) * amount,
    b: left.b + (right.b - left.b) * amount,
  });
}

function rgba(hex, alpha) {
  const { r, g, b } = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export class SkillRenderer {
  constructor(game, { width = 1, height = 1, dpr = 1, palette = null, settings = {}, glow = null } = {}) {
    this.game = game;
    this.W = width;
    this.H = height;
    this.dpr = Math.max(1, Math.min(2, dpr || 1));
    this.palette = palette;
    this.glow = glow;
    this.settings = settings;

    this._lastTime = null;
    this._prevCooldown = null;
    this._seenFx = new WeakSet();
    this.quality = this._tier(settings);
    this.profile = qualityProfile(this.quality);
    this.cap = this.profile.particles;

    // 氛围演出：age/ttl 使用真实秒；id 记录本次演出的技能。
    this._amb = { id: null, age: 0, ttl: 0, maxTtl: 0 };
    // 前摇预警：原地复用，避免每帧新建对象。
    this._warn = { id: null, x: 0, y: 0, age: 0, ttl: 0, maxTtl: 0, profile: null };
    this._castBannerShown = 0;

    this.particles = [];
    this._pool = [];
    this._textures = {};
    this.colors = this._buildColors();
    this._buildTextures();
  }

  // 画质/DPR/调色板变化时由 Renderer 调用；只有真正变化才重烘焙。
  configure({ width, height, dpr, palette, settings, glow } = {}) {
    let dirty = false;
    if (width != null && width !== this.W) {
      this.W = width;
      dirty = true;
    }
    if (height != null && height !== this.H) {
      this.H = height;
      dirty = true;
    }
    if (dpr != null) {
      const next = Math.max(1, Math.min(2, dpr || 1));
      if (next !== this.dpr) {
        this.dpr = next;
        dirty = true;
      }
    }
    if (palette != null) this.palette = palette;
    if (glow !== undefined) this.glow = glow;
    if (settings != null) this.settings = settings;

    const nextQuality = this._tier(this.settings);
    if (nextQuality !== this.quality) {
      this.quality = nextQuality;
      this.profile = qualityProfile(nextQuality);
      this.cap = this.profile.particles;
      this._trimParticles();
      dirty = true;
    }
    const nextColors = this._buildColors();
    if (SKILL_ORDER.some((id) => nextColors[id] !== this.colors[id])) {
      this.colors = nextColors;
      dirty = true;
    }
    if (dirty) this._buildTextures();
  }

  // ---------- 公共绘制入口 ----------

  renderL0(g, time, settings) {
    this._sync(time, settings);
    const id = this._activeId();
    if (!id) return;
    const intensity = this._intensity(id);
    if (intensity <= 0.005) return;

    if (id === 'aurora') this._drawAuroraL0(g, time, intensity);
    else if (id === 'meteor') this._drawMeteorL0(g, time, intensity);
    else if (id === 'chrono') this._drawChronoStarL0(g, time, intensity);
  }

  // 前摇预警入口：在射程圈之后、塔与敌人之前绘制（地面信息，不遮挡 HUD）。
  renderWarnings(g, time, settings) {
    this._sync(time, settings);
    this._drawTelegraph(g, time);
  }

  renderL1(g, time, settings) {
    this._sync(time, settings);
    const id = this._activeId();

    if (id === 'aurora') this._drawAuroraGround(g, time);
    else if (id === 'chrono') this._drawChronoGround(g, time);

    const fx = this.game.skillFx;
    if (Array.isArray(fx)) {
      for (const event of fx) {
        if (event) this._drawGroundFx(g, time, event);
      }
    }
  }

  renderL2(g, time, settings) {
    this._sync(time, settings);
    const id = this._activeId();

    // 状态层：冻结冰壳 / 时间泡、塔的过载光柱（玩法信息，画质只做简化）。
    const now = this.game.time || 0;
    const stasisActive =
      id === 'chrono' && !!this.game.stasis && now < (this.game.stasis.until || 0);
    for (const enemy of this.game.enemies || []) {
      if (enemy.dead) continue;
      if (now < (enemy.freezeUntil || 0)) this._drawFreezeShell(g, time, enemy, id);
      else if (stasisActive) this._drawFreezeShell(g, time, enemy, 'chrono');
    }
    for (const tower of this.game.towers || []) {
      if (now < (tower.skillOverdriveUntil || 0)) this._drawOverdrive(g, time, tower);
    }

    // 事件层：陨星、星爆、碎晶等。
    const fx = this.game.skillFx;
    if (Array.isArray(fx)) {
      for (const event of fx) {
        if (event) this._drawWorldFx(g, time, event, id);
      }
    }

    // 余韵环境粒子。
    this._drawParticles(g);
  }

  renderL3(g, time, settings) {
    this._sync(time, settings);
    const id = this._activeId();
    if (!id) return;
    const intensity = this._intensity(id);
    if (intensity <= 0.005) return;

    const tint = this._textures.tints?.[id];
    if (tint) {
      g.save();
      g.globalAlpha = this.profile.tint * Math.min(1, 0.35 + intensity * 0.65);
      g.drawImage(tint, 0, 0, this.W, this.H);
      g.restore();
    }

    if (this.profile.glow && id === 'chrono') {
      this._drawChronoScreenRing(g, time, intensity);
    }
    this._drawBanner(g);
  }

  // ---------- 同步 / 状态 ----------

  _tier(settings) {
    const decorations = settings?.decorations;
    if (decorations === 'off') return 'minimal';
    if (decorations === 'full') return 'full';
    return 'standard';
  }

  _activeId() {
    const id = this.game.skill?.id;
    return id && SKILLS[id] ? id : null;
  }

  _stats(id) {
    const skill = this.game.skill;
    if (!skill || skill.id !== id) return null;
    return skill.stats || skillStats(id, skill.level || 1);
  }

  _cooldown(skill) {
    const value = skill?.cooldown ?? skill?.cd ?? skill?.cdLeft ?? 0;
    const num = Number(value);
    return Number.isFinite(num) ? Math.max(0, num) : 0;
  }

  _sync(time, settings) {
    if (settings) this.settings = settings;
    // 兜底：即使外层忘记 configure，画质变化也会立即生效。
    const tier = this._tier(this.settings);
    if (tier !== this.quality) {
      this.quality = tier;
      this.profile = qualityProfile(tier);
      this.cap = this.profile.particles;
      this._trimParticles();
      this._buildTextures();
    }
    const dt = this._lastTime == null ? 0 : Math.min(0.1, Math.max(0, time - this._lastTime));
    this._lastTime = time;

    // 冷却从 0 跳回满值 = 刚释放；快照恢复时首次读到的值不触发横幅。
    const skill = this.game.skill;
    if (skill?.id) {
      const cooldown = this._cooldown(skill);
      const stats = this._stats(skill.id);
      const total = Math.max(1, Number(stats?.cd) || 0);
      if (this._prevCooldown != null && cooldown > this._prevCooldown + Math.max(0.75, total * 0.5)) {
        this._triggerCast(skill.id, true);
      }
      this._prevCooldown = cooldown;
    } else {
      this._prevCooldown = null;
    }

    // 新出现的事件也作为“已释放”的兜底信号（sim 字段不完整时仍可见）。
    const fx = this.game.skillFx;
    if (Array.isArray(fx)) {
      for (const event of fx) {
        if (!event || typeof event !== 'object') continue;
        if (this._seenFx.has(event)) continue;
        this._seenFx.add(event);
        const id = this._classify(event) || this._activeId();
        if (id) {
          if (!this._amb.id || this._amb.ttl <= 0.05) this._triggerCast(id, true);
          this._spawnFromEvent(id, event);
        }
      }
    }

    if (this._amb.ttl > 0) {
      this._amb.age += dt;
      this._amb.ttl = Math.max(0, this._amb.ttl - dt);
    }
    if (this._warn.ttl > 0) {
      this._warn.age += dt;
      this._warn.ttl = Math.max(0, this._warn.ttl - dt);
    }
    this._updateParticles(dt);
    this._spawnAmbient(dt);
  }

  _triggerCast(id, hard) {
    const minReal = MIN_REAL_SECONDS[id] || 2;
    if (!hard && this._amb.id === id && this._amb.ttl > minReal * 0.5) return;
    this._amb.id = id;
    this._amb.age = 0;
    this._amb.ttl = minReal;
    this._amb.maxTtl = minReal;
    this._armWarning(id);
  }

  // 起搏前摇预警。流星有模拟层的逐落点预警，这里不重复起搏。
  _armWarning(id) {
    const profile = warningProfile(id);
    if (profile.source !== 'cast') return;
    const map = this.game.map || {};
    const base = map.base;
    const warn = this._warn;
    warn.id = id;
    warn.profile = profile;
    warn.x = (base?.x ?? (Number(map.cols) || 22) / 2) * T;
    warn.y = (base?.y ?? (Number(map.rows) || 12) / 2) * T;
    warn.age = 0;
    warn.ttl = profile.ttl;
    warn.maxTtl = profile.ttl;
  }

  // 演出强度：释放后 1 → 0，同时保留状态期的最低可见度。
  _intensity(id) {
    let value = 0;
    if (this._amb.id === id && this._amb.ttl > 0) {
      value = clamp01(this._amb.ttl / Math.max(0.001, this._amb.maxTtl));
    }
    const now = this.game.time || 0;
    let state = 0;
    if (id === 'aurora') {
      for (const enemy of this.game.enemies || []) {
        if (!enemy.dead && now < (enemy.freezeUntil || 0)) {
          state = 1;
          break;
        }
      }
    } else if (id === 'chrono') {
      if (this.game.stasis && now < (this.game.stasis.until || 0)) state = 1;
      if (!state) {
        for (const tower of this.game.towers || []) {
          if (now < (tower.skillOverdriveUntil || 0)) {
            state = 1;
            break;
          }
        }
      }
    } else if (id === 'meteor') {
      for (const enemy of this.game.enemies || []) {
        if (!enemy.dead && now < (enemy.burnUntil || 0)) {
          state = 1;
          break;
        }
      }
    }
    return Math.max(value, state ? 0.3 : 0);
  }

  _classify(event) {
    const hinted = event.skillId || event.skill || event.id;
    if (hinted && SKILLS[hinted]) return hinted;
    const kind = String(event.kind || '');
    if (METEOR_RE.test(kind)) return 'meteor';
    if (CHRONO_RE.test(kind)) return 'chrono';
    if (AURORA_RE.test(kind)) return 'aurora';
    return null;
  }

  // ---------- 纹理预烘焙 ----------

  _buildColors() {
    const accent = this.palette?.accent || '#7cd4f5';
    const colors = {};
    for (const id of SKILL_ORDER) {
      colors[id] = mixHex(SKILLS[id].color, accent, 0.18);
    }
    return colors;
  }

  _makeCanvas(width, height, scale = 1) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(2, Math.round(width * scale));
    canvas.height = Math.max(2, Math.round(height * scale));
    const g = canvas.getContext('2d');
    g.setTransform(scale, 0, 0, scale, 0, 0);
    return { canvas, g };
  }

  _buildTextures() {
    this._textures = {};
    if (typeof document === 'undefined') return;
    const W = this.W;
    const H = this.H;
    const scale = Math.min(1, this.dpr / 2 + 0.5);

    const tints = {};
    for (const id of SKILL_ORDER) tints[id] = this._buildTint(id, scale);
    this._textures.tints = tints;

    this._textures.curtain = this._buildCurtain(scale);
    this._textures.stars = this._buildStars(scale);
    this._textures.scorch = this._buildScorch();
    this._textures.frost = this._buildFrostPatch();
    this._textures.flash = this._buildFlash();
    this._textures.beams = {};
    for (const id of SKILL_ORDER) this._textures.beams[id] = this._buildBeam(id);

    // 全景尺寸变化时剪掉旧的大纹理引用。
    if (W <= 0 || H <= 0) this._textures = {};
  }

  _buildTint(id, scale) {
    const { canvas, g } = this._makeCanvas(this.W, this.H, scale / 2);
    const w = this.W;
    const h = this.H;
    const color = this.colors[id];
    const linear = g.createLinearGradient(0, 0, 0, h);
    if (id === 'aurora') {
      linear.addColorStop(0, rgba(color, 0.2));
      linear.addColorStop(0.45, rgba('#0b2230', 0.16));
      linear.addColorStop(1, rgba('#dff7ff', 0.05));
    } else if (id === 'meteor') {
      linear.addColorStop(0, rgba('#2a0f05', 0.3));
      linear.addColorStop(0.5, rgba(color, 0.12));
      linear.addColorStop(1, rgba('#120a06', 0.22));
    } else {
      // 终章：冷色 + 压暗，用于模拟去饱和（不使用 ctx.filter）。
      linear.addColorStop(0, rgba('#101a3a', 0.32));
      linear.addColorStop(0.5, rgba(color, 0.1));
      linear.addColorStop(1, rgba('#070a18', 0.36));
    }
    g.fillStyle = linear;
    g.fillRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const vignette = g.createRadialGradient(
      cx,
      cy,
      Math.min(w, h) * 0.22,
      cx,
      cy,
      Math.max(w, h) * 0.68
    );
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(0.7, rgba(id === 'meteor' ? '#1a0802' : '#04070d', 0.16));
    vignette.addColorStop(1, rgba(id === 'chrono' ? '#02030a' : '#03070a', 0.62));
    g.fillStyle = vignette;
    g.fillRect(0, 0, w, h);
    return canvas;
  }

  _buildCurtain(scale) {
    const { canvas, g } = this._makeCanvas(this.W, this.H * 0.85, scale / 2);
    const w = this.W;
    const h = this.H * 0.85;
    const color = this.colors.aurora;
    g.lineCap = 'round';
    for (let band = 0; band < 6; band++) {
      const baseY = h * (0.08 + band * 0.11);
      const amp = 12 + band * 3;
      g.beginPath();
      for (let x = -20; x <= w + 20; x += 16) {
        const y = baseY + Math.sin(x * 0.012 + band * 1.3) * amp;
        if (x === -20) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokeStyle = rgba(color, 0.05 + (band % 3) * 0.035);
      g.lineWidth = 22 + (band % 2) * 12;
      g.stroke();
      g.strokeStyle = rgba('#e8fbff', 0.035 + (band % 2) * 0.02);
      g.lineWidth = 5 + (band % 2) * 2;
      g.stroke();
    }
    return canvas;
  }

  _buildStars(scale) {
    const { canvas, g } = this._makeCanvas(this.W, this.H, scale / 2);
    const rng = new RNG(`${this.game?.seed || 'skill'}:skill:stars`);
    const count = this.quality === 'minimal' ? 0 : this.quality === 'full' ? 96 : 54;
    for (let i = 0; i < count; i++) {
      const x = rng.float() * this.W;
      const y = rng.float() * this.H;
      const size = 0.6 + rng.float() * 1.6;
      g.fillStyle = `rgba(210, 232, 255, ${0.18 + rng.float() * 0.5})`;
      g.beginPath();
      g.arc(x, y, size, 0, Math.PI * 2);
      g.fill();
    }
    // 少量十字星。
    g.strokeStyle = 'rgba(220, 236, 255, 0.4)';
    g.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      const x = rng.float() * this.W;
      const y = rng.float() * this.H;
      const len = 3 + rng.float() * 4;
      g.beginPath();
      g.moveTo(x - len, y);
      g.lineTo(x + len, y);
      g.moveTo(x, y - len);
      g.lineTo(x, y + len);
      g.stroke();
    }
    return canvas;
  }

  _buildScorch() {
    const { canvas, g } = this._makeCanvas(160, 90);
    const grad = g.createRadialGradient(80, 45, 4, 80, 45, 74);
    grad.addColorStop(0, 'rgba(8, 5, 3, 0.82)');
    grad.addColorStop(0.55, 'rgba(22, 12, 6, 0.45)');
    grad.addColorStop(1, 'rgba(22, 12, 6, 0)');
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(80, 45, 74, 42, 0, 0, Math.PI * 2);
    g.fill();
    return canvas;
  }

  _buildFrostPatch() {
    const { canvas, g } = this._makeCanvas(120, 70);
    const grad = g.createRadialGradient(60, 35, 3, 60, 35, 56);
    grad.addColorStop(0, 'rgba(210, 245, 255, 0.42)');
    grad.addColorStop(0.6, 'rgba(150, 225, 255, 0.16)');
    grad.addColorStop(1, 'rgba(140, 220, 255, 0)');
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(60, 35, 56, 30, 0, 0, Math.PI * 2);
    g.fill();
    return canvas;
  }

  // 命中高光：预烘焙一次，命中帧只做一次 drawImage（替代每帧渐变/滤镜）。
  _buildFlash() {
    const { canvas, g } = this._makeCanvas(128, 128);
    const grad = g.createRadialGradient(64, 64, 2, 64, 64, 62);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    grad.addColorStop(0.25, 'rgba(255, 244, 214, 0.55)');
    grad.addColorStop(1, 'rgba(255, 220, 170, 0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return canvas;
  }

  _buildBeam(id) {
    const { canvas, g } = this._makeCanvas(48, 220);
    const color = this.colors[id] || this.colors.chrono;
    const grad = g.createLinearGradient(0, 220, 0, 0);
    grad.addColorStop(0, rgba(color, 0.55));
    grad.addColorStop(0.35, rgba(color, 0.24));
    grad.addColorStop(1, rgba(color, 0));
    g.fillStyle = grad;
    g.fillRect(16, 0, 16, 220);
    const glow = g.createLinearGradient(0, 220, 0, 0);
    glow.addColorStop(0, rgba(color, 0.25));
    glow.addColorStop(1, rgba(color, 0));
    g.fillStyle = glow;
    g.fillRect(6, 0, 36, 220);
    return canvas;
  }

  // ---------- L0 背景 ----------

  _drawAuroraL0(g, time, intensity) {
    const tint = this._textures.tints?.aurora;
    if (tint) {
      g.save();
      g.globalAlpha = 0.55 * intensity;
      g.drawImage(tint, 0, 0, this.W, this.H);
      g.restore();
    }
    if (!this.profile.glow) return;
    const curtain = this._textures.curtain;
    if (!curtain) return;
    const drift = Math.sin(time * 0.12) * this.W * 0.04;
    const pulse = 0.55 + Math.sin(time * 0.5) * 0.12;
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = (this.quality === 'full' ? 0.62 : 0.42) * intensity * pulse;
    // 单张帘幕 + 相位漂移即可，保持整帧全屏叠加 ≤3 次（L0 两张 + L3 一张）。
    g.drawImage(curtain, drift - this.W * 0.04, -this.H * 0.08, this.W * 1.12, this.H * 0.85);
    g.restore();
  }

  _drawMeteorL0(g, time, intensity) {
    const tint = this._textures.tints?.meteor;
    if (!tint) return;
    g.save();
    g.globalAlpha = (this.quality === 'minimal' ? 0.32 : 0.46) * intensity;
    g.drawImage(tint, 0, 0, this.W, this.H);
    g.restore();
  }

  _drawChronoStarL0(g, time, intensity) {
    const tint = this._textures.tints?.chrono;
    if (tint) {
      g.save();
      g.globalAlpha = 0.6 * intensity;
      g.drawImage(tint, 0, 0, this.W, this.H);
      g.restore();
    }
    if (!this.profile.glow) return;
    const stars = this._textures.stars;
    if (!stars) return;
    const offset = (time * 7) % this.W;
    g.save();
    g.globalAlpha = (this.quality === 'full' ? 0.8 : 0.55) * intensity;
    // 单次全屏绘制；视差靠偏移量，不再叠第二层（全屏叠加预算 ≤3）。
    g.drawImage(stars, -offset, 0, this.W, this.H);
    g.restore();
  }

  // ---------- L1 地面 ----------

  _drawAuroraGround(g, time) {
    const now = this.game.time || 0;
    const frost = this._textures.frost;
    if (!frost) return;
    g.save();
    for (const enemy of this.game.enemies || []) {
      if (enemy.dead || now >= (enemy.freezeUntil || 0)) continue;
      const r = (enemy.r || 0.3) * T * 2.4;
      g.globalAlpha = 0.8;
      g.drawImage(frost, enemy.x * T - r, enemy.y * T - r * 0.55, r * 2, r * 1.1);
    }
    g.restore();
  }

  _drawChronoGround(g, time) {
    if (!this.profile.glow) return;
    const game = this.game;
    const cx = ((game.map?.base?.x ?? game.map?.cols / 2) || 0) * T;
    const cy = ((game.map?.base?.y ?? game.map?.rows / 2) || 0) * T;
    const radius = Math.min(this.W, this.H) * 0.34;
    const color = this.colors.chrono;
    const pulse = 0.4 + Math.sin(time * 2.4) * 0.12;
    g.save();
    g.translate(cx, cy);
    g.strokeStyle = rgba(color, pulse);
    g.lineWidth = 1.4;
    g.setLineDash([5, 9]);
    g.lineDashOffset = -time * 16;
    g.beginPath();
    g.arc(0, 0, radius, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    g.strokeStyle = rgba(color, pulse * 0.55);
    g.lineWidth = 1;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2 + time * 0.08;
      const inner = radius - (i % 6 === 0 ? 10 : 5);
      g.beginPath();
      g.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
      g.lineTo(Math.cos(a) * radius, Math.sin(a) * radius);
      g.stroke();
    }
    g.restore();
  }

  // 前摇地面标记 + 倒计时环：只描边与低透明填充，不遮挡路径信息。
  _drawTelegraph(g, time) {
    const warn = this._warn;
    if (!warn.id || warn.ttl <= 0) return;
    const profile = warn.profile || warningProfile(warn.id);
    const color = this.colors[warn.id] || this.colors.aurora;
    const left = warningCountdown(warn.ttl, warn.maxTtl);
    if (left <= 0) return;
    const r = profile.radius * T;
    const alpha = 0.35 + 0.5 * left;

    g.save();
    g.translate(warn.x, warn.y);
    g.globalAlpha = alpha;
    g.strokeStyle = rgba(color, 0.6);
    g.fillStyle = rgba(color, profile.fill);
    g.lineWidth = 1.8;
    g.setLineDash(profile.dash);
    g.lineDashOffset = -time * 14;
    this._traceWarningShape(g, profile.shape, r, time * profile.spin);
    g.fill();
    g.stroke();
    g.setLineDash([]);

    // 倒计时环：剩余比例收缩，越接近命中越短。
    const start = -Math.PI / 2;
    g.strokeStyle = rgba('#f4fbff', 0.72);
    g.lineWidth = 2.4;
    g.beginPath();
    g.arc(0, 0, r * 0.82, start, start + Math.PI * 2 * left);
    g.stroke();

    if (this.profile.glow) {
      // 高配才画内圈刻度；低配只保留预警与命中闪光。
      g.strokeStyle = rgba(color, 0.35);
      g.lineWidth = 1;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + time * 0.8;
        g.beginPath();
        g.moveTo(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62);
        g.lineTo(Math.cos(a) * r * 0.74, Math.sin(a) * r * 0.74);
        g.stroke();
      }
    }
    g.restore();
  }

  _traceWarningShape(g, shape, r, spin) {
    g.beginPath();
    if (shape === 'hex') {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + spin;
        if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
    } else if (shape === 'star') {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + spin;
        const radius = i % 2 === 0 ? r : r * 0.58;
        if (i === 0) g.moveTo(Math.cos(a) * radius, Math.sin(a) * radius);
        else g.lineTo(Math.cos(a) * radius, Math.sin(a) * radius);
      }
    } else {
      g.arc(0, 0, r, 0, Math.PI * 2);
      return;
    }
    g.closePath();
  }

  _drawGroundFx(g, time, event) {
    const id = this._classify(event) || this._activeId();
    if (!id) return;
    const kind = String(event.kind || '').toLowerCase();
    const { x, y, progress, fade } = this._fxBasics(event);
    const r = Math.max(6, (event.r ?? event.radius ?? 1) * T);

    if (id === 'meteor') {
      // 落点预警：`meteorWarn` 期间地面圈 + 倒计时环。玩法信息，minimal 也保留。
      if (/warn|telegraph|mark/.test(kind)) {
        const profile = warningProfile('meteor');
        const left = warningCountdown(event.ttl, event.maxTtl ?? profile.ttl);
        const warnAlpha = 0.16 + fade * 0.22;
        g.save();
        g.fillStyle = rgba(this.colors.meteor, warnAlpha * progress);
        g.beginPath();
        g.arc(x, y, Math.max(2, r * progress), 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = rgba(this.colors.meteor, 0.55 + fade * 0.3);
        g.lineWidth = 1.6;
        g.setLineDash(profile.dash);
        g.lineDashOffset = -time * 18;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
        // 倒计时环：剩余时间越少弧越短，落点更可读。
        const start = -Math.PI / 2;
        g.strokeStyle = rgba('#fff0d8', 0.78);
        g.lineWidth = 2.6;
        g.beginPath();
        g.arc(x, y, r * 0.86, start, start + Math.PI * 2 * left);
        g.stroke();
        g.restore();
      }
      // 落点后的焦痕：余韵，低配关闭。
      if (this.profile.afterglow && (kind === 'meteor' || /scorch/.test(kind))) {
        const scorch = this._textures.scorch;
        if (scorch) {
          g.save();
          g.globalAlpha = Math.min(0.75, fade + 0.15);
          g.drawImage(scorch, x - r * 1.2, y - r * 0.62, r * 2.4, r * 1.24);
          g.restore();
        }
      }
    }

    if (id === 'aurora' && /shatter|crystal|frost|ice/.test(kind) && this.profile.afterglow) {
      const frost = this._textures.frost;
      if (frost) {
        g.save();
        g.globalAlpha = fade * 0.7;
        g.drawImage(frost, x - r * 0.8, y - r * 0.4, r * 1.6, r * 0.8);
        g.restore();
      }
    }
  }

  // ---------- L2 世界 ----------

  _drawFreezeShell(g, time, enemy, id) {
    const x = enemy.x * T;
    const y = enemy.y * T - (enemy.flying ? 12 : 0);
    const r = Math.max(8, (enemy.r || 0.3) * T * 1.22);
    const now = this.game.time || 0;
    const chrono = id === 'chrono';
    const color = chrono ? this.colors.chrono : this.colors.aurora;
    const pulse = 0.5 + Math.sin(time * 5 + (enemy.id || 0)) * 0.5;

    g.save();
    g.translate(x, y);
    if (!this.profile.glow) {
      g.strokeStyle = chrono ? rgba(color, 0.8) : 'rgba(170, 235, 255, 0.85)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(0, 0, r + 2, 0, Math.PI * 2);
      g.stroke();
      g.restore();
      return;
    }

    if (chrono) {
      // 时间泡：双环 + 刻度，`time` 只驱动相位。
      g.strokeStyle = rgba(color, 0.5 + pulse * 0.3);
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(0, 0, r + 3 + pulse * 1.5, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = rgba('#e5dcff', 0.34);
      g.lineWidth = 1;
      g.rotate(time * 0.7);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.beginPath();
        g.moveTo(Math.cos(a) * (r + 1), Math.sin(a) * (r + 1));
        g.lineTo(Math.cos(a) * (r + 5), Math.sin(a) * (r + 5));
        g.stroke();
      }
    } else {
      // 冰壳：六边形外框 + 冰晶尖刺。
      g.strokeStyle = `rgba(190, 242, 255, ${0.55 + pulse * 0.35})`;
      g.lineWidth = 1.6;
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + time * 0.25;
        const px = Math.cos(a) * (r + 1.5);
        const py = Math.sin(a) * (r + 1.5);
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      g.stroke();
      g.fillStyle = `rgba(205, 245, 255, ${0.1 + pulse * 0.12})`;
      g.fill();
      g.fillStyle = 'rgba(225, 250, 255, 0.8)';
      for (let i = 0; i < 3; i++) {
        const a = time * 1.4 + (i / 3) * Math.PI * 2;
        const px = Math.cos(a) * (r + 3);
        const py = Math.sin(a) * (r + 3);
        g.beginPath();
        g.moveTo(px, py - 3);
        g.lineTo(px + 2, py);
        g.lineTo(px, py + 3);
        g.lineTo(px - 2, py);
        g.closePath();
        g.fill();
      }
    }

    // 冻结易伤：碎裂高光。
    if (now < (enemy.freezeVulnUntil || 0)) {
      g.strokeStyle = `rgba(255, 236, 170, ${0.35 + pulse * 0.3})`;
      g.lineWidth = 1;
      g.beginPath();
      g.arc(0, 0, r * (1.35 + pulse * 0.1), 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
  }

  _drawOverdrive(g, time, tower) {
    const id = this._activeId() || 'chrono';
    const beam = this._textures.beams?.[id] || this._textures.beams?.chrono;
    const x = tower.x * T;
    const y = tower.y * T;
    const pulse = 0.7 + Math.sin(time * 7 + (tower.id || 0)) * 0.3;
    const color = this.colors[id] || this.colors.chrono;

    g.save();
    g.strokeStyle = rgba(color, 0.6 + pulse * 0.25);
    g.lineWidth = 1.6;
    g.beginPath();
    g.arc(x, y, 18 + pulse * 3, 0, Math.PI * 2);
    g.stroke();

    if (beam && this.profile.glow) {
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.55 + pulse * 0.2;
      g.drawImage(beam, x - 26, y - 150, 52, 150);
      g.globalCompositeOperation = 'source-over';
    } else {
      g.strokeStyle = rgba(color, 0.4 + pulse * 0.2);
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x, y - 80);
      g.stroke();
    }
    g.restore();
  }

  _fxBasics(event) {
    const maxTtl = Math.max(0.001, Number(event.maxTtl ?? event.ttl ?? 1));
    const ttl = Math.max(0, Number(event.ttl ?? 0));
    const progress = clamp01(1 - ttl / maxTtl);
    const fade = clamp01(ttl / maxTtl);
    const base = this.game.map?.base || { x: this.game.map?.cols / 2 || 0, y: this.game.map?.rows / 2 || 0 };
    return {
      x: (event.x ?? base.x) * T,
      y: (event.y ?? base.y) * T,
      progress,
      fade,
      maxTtl,
      ttl,
    };
  }

  // 命中高光：所有画质都保留（玩法反馈），余韵才随档位裁剪。
  _drawHitFlash(g, x, y, r, alpha) {
    const flash = this._textures.flash;
    if (!flash || alpha <= 0.01) return;
    const d = Math.max(16, r * 2.6);
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = Math.min(0.9, alpha);
    g.drawImage(flash, x - d / 2, y - d / 2, d, d);
    g.restore();
  }

  _drawWorldFx(g, time, event, activeId) {
    const id = this._classify(event) || activeId;
    if (!id) return;
    const kind = String(event.kind || '').toLowerCase();
    const { x, y, progress, fade } = this._fxBasics(event);
    const r = Math.max(8, (event.r ?? event.radius ?? 1) * T);
    const color = this.colors[id] || this.colors.aurora;

    // 命中瞬间高光与余韵分离：预警/持续型事件不闪，命中事件在生命周期前 45% 闪一次。
    if (!/warn|telegraph|mark|stasis/.test(kind) && progress < 0.45) {
      this._drawHitFlash(g, x, y, r, 1 - progress / 0.45);
    }

    if (id === 'meteor') {
      // 预警阶段：流星本体向落点下坠 + 拖尾（meteorWarn 的 ttl 正好是预警时长）。
      if (/warn|fall|trail|blaze/.test(kind) && progress < 0.96) {
        const fall = (1 - progress) * Math.min(320, this.H * 0.5);
        const headY = y - fall;
        g.save();
        g.globalCompositeOperation = 'lighter';
        // 拖尾用两段实色描边，避免每帧新建渐变。
        g.strokeStyle = rgba(color, 0.28);
        g.lineWidth = 6;
        g.beginPath();
        g.moveTo(x, headY - 70);
        g.lineTo(x, headY);
        g.stroke();
        g.strokeStyle = rgba(color, 0.75);
        g.lineWidth = 2.4;
        g.beginPath();
        g.moveTo(x, headY - 46);
        g.lineTo(x, headY);
        g.stroke();
        g.fillStyle = rgba('#fff2d8', 0.9);
        g.beginPath();
        g.arc(x, headY, 4 + fade * 2, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
      // 落点瞬间：星爆冲击环（`meteor` 是命中事件，不再重复画下坠）。
      if (progress > 0.2 && !/ember|warn/.test(kind)) {
        const p = (progress - 0.2) / 0.8;
        g.save();
        g.strokeStyle = rgba(color, (1 - p) * 0.9);
        g.lineWidth = 2.4 * (1 - p) + 0.6;
        g.beginPath();
        g.arc(x, y, r * (0.25 + p * 0.95), 0, Math.PI * 2);
        g.stroke();
        g.strokeStyle = rgba('#ffe0a8', (1 - p) * 0.55);
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(x, y, r * (0.1 + p * 0.7), 0, Math.PI * 2);
        g.stroke();
        g.restore();
      }
    } else if (id === 'aurora') {
      // 碎晶：径向冰晶与扩散环。
      const radius = (event.r0 ?? 0.1) * T + ((event.r1 ?? event.r ?? 1) * T - (event.r0 ?? 0.1) * T) * progress;
      g.save();
      g.strokeStyle = rgba(color, fade * 0.75);
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(x, y, Math.max(3, radius), 0, Math.PI * 2);
      g.stroke();
      if (this.profile.afterglow) {
        g.fillStyle = rgba('#d8f6ff', fade * 0.85);
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2 + progress * 1.4;
          const dist = Math.max(4, radius);
          const px = x + Math.cos(a) * dist;
          const py = y + Math.sin(a) * dist;
          const s = 2 + (1 - progress) * 3;
          g.beginPath();
          g.moveTo(px, py - s);
          g.lineTo(px + s * 0.7, py);
          g.lineTo(px, py + s);
          g.lineTo(px - s * 0.7, py);
          g.closePath();
          g.fill();
        }
      }
      g.restore();
    } else if (id === 'chrono') {
      if (/stasis/.test(kind)) {
        // 时停穹顶：整个持续期间保持，不做一次性扩散。
        const pulse = 0.45 + Math.sin(time * 4) * 0.15;
        g.save();
        g.fillStyle = rgba(color, 0.05 + fade * 0.05);
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = rgba(color, 0.3 + pulse * 0.4 * fade);
        g.lineWidth = 2;
        g.setLineDash([10, 8]);
        g.lineDashOffset = time * 22;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
        g.restore();
        return;
      }
      // 星辉 / 时间涟漪。
      const r0 = (event.r0 ?? 0.2) * T;
      const r1 = (event.r1 ?? event.r ?? 2.2) * T;
      const radius = r0 + (r1 - r0) * (1 - Math.pow(1 - progress, 2));
      g.save();
      g.strokeStyle = rgba(color, fade * 0.85);
      g.lineWidth = 1.8;
      g.beginPath();
      g.arc(x, y, Math.max(3, radius), 0, Math.PI * 2);
      g.stroke();
      if (this.profile.afterglow) {
        g.strokeStyle = rgba('#efe8ff', fade * 0.45);
        g.lineWidth = 1;
        g.beginPath();
        g.arc(x, y, Math.max(3, radius * 0.72), 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = rgba('#f3ecff', fade * 0.8);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 - progress * 1.2;
          const px = x + Math.cos(a) * radius * 0.8;
          const py = y + Math.sin(a) * radius * 0.8;
          g.beginPath();
          g.arc(px, py, 1.6, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.restore();
    } else {
      // 未知事件：通用扩散环，保证新事件至少有反馈。
      g.save();
      g.strokeStyle = rgba(color, fade * 0.7);
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(x, y, Math.max(4, r * progress), 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
  }

  // ---------- L3 屏幕 ----------

  _drawChronoScreenRing(g, time, intensity) {
    const cx = this.W / 2;
    const cy = this.H / 2;
    const radius = Math.min(this.W, this.H) * 0.47;
    const color = this.colors.chrono;
    g.save();
    g.globalAlpha = intensity * 0.7;
    g.strokeStyle = rgba(color, 0.4);
    g.lineWidth = 1.2;
    g.beginPath();
    g.arc(cx, cy, radius, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = rgba('#e9e2ff', 0.3);
    g.lineWidth = 1;
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2 + time * 0.06;
      const inner = radius - (i % 3 === 0 ? 12 : 6);
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      g.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
      g.stroke();
    }
    g.restore();
  }

  _drawBanner(g) {
    if (!this.profile.banner) return;
    const amb = this._amb;
    if (!amb.id || amb.age > 1.7) return;
    const def = SKILLS[amb.id];
    if (!def) return;
    const fadeIn = clamp01(amb.age / 0.16);
    const fadeOut = clamp01((1.7 - amb.age) / 0.5);
    const alpha = Math.min(fadeIn, fadeOut);
    const color = this.colors[amb.id] || def.color;
    const level = this.game.skill?.level || 1;
    const y = this.H * 0.17;
    g.save();
    g.globalAlpha = alpha;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.font = '800 26px "Noto Sans SC", "DejaVu Sans", sans-serif';
    g.strokeStyle = 'rgba(4, 8, 12, 0.68)';
    g.lineWidth = 5;
    g.strokeText(def.name, this.W / 2, y);
    g.fillStyle = color;
    g.fillText(def.name, this.W / 2, y);
    g.font = '600 12px "DejaVu Sans Mono", ui-monospace, monospace';
    g.fillStyle = rgba('#e8f4ff', 0.7 * alpha);
    g.fillText(`Lv.${level}`, this.W / 2, y + 24);
    g.restore();
  }

  // ---------- 粒子池 ----------

  _obtain() {
    return this._pool.pop() || {};
  }

  _release(particle) {
    if (this._pool.length < 256) this._pool.push(particle);
  }

  _trimParticles() {
    while (this.particles.length > this.cap) {
      this._release(this.particles.pop());
    }
  }

  _spawn(kind, x, y, options = {}) {
    if (this.particles.length >= this.cap) return null;
    const particle = this._obtain();
    particle.kind = kind;
    particle.x = x;
    particle.y = y;
    particle.vx = options.vx || 0;
    particle.vy = options.vy || 0;
    particle.ttl = options.ttl || 0.6;
    particle.maxTtl = particle.ttl;
    particle.size = options.size || 2;
    particle.rot = options.rot || 0;
    particle.vr = options.vr || 0;
    particle.color = options.color || '#ffffff';
    this.particles.push(particle);
    return particle;
  }

  _updateParticles(dt) {
    if (!dt || !this.particles.length) return;
    let write = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.ttl -= dt;
      if (p.ttl <= 0) {
        this._release(p);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.kind === 'ember') p.vy -= 6 * dt;
      if (p.kind === 'snow') p.vy = Math.min(p.vy + 3 * dt, 20);
      if (p.kind === 'star') p.vy -= 1.5 * dt;
      this.particles[write++] = p;
    }
    this.particles.length = write;
  }

  _drawParticles(g) {
    if (!this.particles.length) return;
    g.save();
    for (const p of this.particles) {
      const alpha = clamp01(p.ttl / Math.max(0.001, p.maxTtl));
      const x = p.x * T;
      const y = p.y * T;
      g.globalAlpha = alpha;
      if (p.kind === 'ember') {
        g.fillStyle = p.color;
        g.beginPath();
        g.arc(x, y, p.size * (0.6 + alpha * 0.4), 0, Math.PI * 2);
        g.fill();
      } else if (p.kind === 'snow') {
        g.fillStyle = p.color;
        g.save();
        g.translate(x, y);
        g.rotate(p.rot);
        g.fillRect(-p.size * 0.5, -p.size * 0.5, p.size, p.size);
        g.restore();
      } else if (p.kind === 'star') {
        g.strokeStyle = p.color;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x - p.size, y);
        g.lineTo(x + p.size, y);
        g.moveTo(x, y - p.size);
        g.lineTo(x, y + p.size);
        g.stroke();
      } else {
        // shard / spark
        g.save();
        g.translate(x, y);
        g.rotate(p.rot);
        g.fillStyle = p.color;
        g.beginPath();
        g.moveTo(0, -p.size);
        g.lineTo(p.size * 0.55, 0);
        g.lineTo(0, p.size);
        g.lineTo(-p.size * 0.55, 0);
        g.closePath();
        g.fill();
        g.restore();
      }
    }
    g.restore();
  }

  _spawnAmbient(dt) {
    const id = this._activeId();
    if (!id || !this.profile.ambient || !dt) return;
    const intensity = this._intensity(id);
    if (intensity <= 0.02) return;
    const rate = this.quality === 'full' ? 16 : 9;
    const candidates = rate * dt * intensity;
    let count = Math.floor(candidates);
    if (Math.random() < candidates - count) count++;
    if (this.particles.length + count > this.cap) return;
    const cols = Math.max(1, this.game.map?.cols || 1);
    const rows = Math.max(1, this.game.map?.rows || 1);
    if (id === 'aurora') {
      for (let i = 0; i < count; i++) {
        this._spawn('snow', Math.random() * cols, Math.random() * rows * 0.8, {
          vx: 0.3 + Math.random() * 0.6,
          vy: 0.6 + Math.random() * 0.8,
          ttl: 1.2 + Math.random() * 1.2,
          size: 1.2 + Math.random() * 1.8,
          rot: Math.random() * Math.PI,
          vr: 1,
          color: 'rgba(214, 246, 255, 0.85)',
        });
      }
    } else if (id === 'meteor') {
      for (let i = 0; i < count; i++) {
        this._spawn('ember', Math.random() * cols, rows * (0.35 + Math.random() * 0.6), {
          vx: (Math.random() - 0.5) * 0.8,
          vy: -0.4 - Math.random() * 0.8,
          ttl: 0.7 + Math.random() * 0.9,
          size: 1.1 + Math.random() * 1.6,
          color: Math.random() > 0.4 ? 'rgba(255, 190, 110, 0.9)' : 'rgba(255, 120, 60, 0.8)',
        });
      }
    } else {
      for (let i = 0; i < count; i++) {
        this._spawn('star', Math.random() * cols, Math.random() * rows, {
          vx: 0.15,
          vy: -0.1 - Math.random() * 0.2,
          ttl: 1 + Math.random() * 1.4,
          size: 1.2 + Math.random() * 1.8,
          color: 'rgba(226, 216, 255, 0.85)',
        });
      }
    }
  }

  _spawnFromEvent(id, event) {
    if (!this.profile.afterglow || this.particles.length >= this.cap) return;
    const kind = String(event.kind || '').toLowerCase();
    const x = event.x ?? this.game.map?.base?.x ?? 0;
    const y = event.y ?? this.game.map?.base?.y ?? 0;
    if (id === 'meteor') {
      const count = this.quality === 'full' ? 10 : 6;
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const speed = 1.2 + Math.random() * 3.2;
        this._spawn('ember', x, y, {
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed * 0.6 - 1,
          ttl: 0.4 + Math.random() * 0.7,
          size: 1.4 + Math.random() * 2.2,
          color: Math.random() > 0.5 ? 'rgba(255, 206, 130, 0.95)' : 'rgba(255, 128, 62, 0.9)',
        });
      }
    } else if (id === 'aurora' || /shatter|crystal|ice|frost/.test(kind)) {
      const count = this.quality === 'full' ? 9 : 5;
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const speed = 1.4 + Math.random() * 2.6;
        this._spawn('shard', x, y, {
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed * 0.7,
          ttl: 0.5 + Math.random() * 0.7,
          size: 1.8 + Math.random() * 2.6,
          rot: a,
          vr: (Math.random() - 0.5) * 6,
          color: 'rgba(214, 246, 255, 0.9)',
        });
      }
    } else {
      const count = this.quality === 'full' ? 7 : 4;
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const speed = 0.8 + Math.random() * 2;
        this._spawn('star', x, y, {
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed * 0.7,
          ttl: 0.6 + Math.random() * 0.8,
          size: 1.4 + Math.random() * 2,
          color: 'rgba(232, 222, 255, 0.9)',
        });
      }
    }
  }
}
