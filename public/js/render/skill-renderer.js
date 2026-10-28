// 主动技能表现层门面：时间同步、状态判定、纹理预烘焙与四层绘制编排。
//
// 绘制职责按层拆到 ./skill-*.js，方法集合挂回同一原型——对外仍是同一个 SkillRenderer、同一套方法签名。
//
// 时间语义：
//   - 玩法状态（冻结/灼烧/过载）一律用模拟时间 game.time 判定；
//   - 氛围动画（帘幕漂移、粒子相位）用渲染真实时间；
//   - 技能演出设最短真实时长（极光 2.4s / 终章 2.8s），3× 速度下也看得清。
//
// 性能：
//   - 粒子池 + 上限（full 180 / standard 120 / minimal 48），见 skill-particles.js；
//   - 全屏色层、极光帘幕、星空、光柱、焦痕全部预烘焙，绘制时只 drawImage；
//   - 不使用 ctx.filter / shadowBlur / getImageData，也不在每帧创建渐变。
import { TILE, SKILLS, SKILL_ORDER, skillStats } from '../shared/data.js';
import { RNG } from '../shared/rng.js';
import {
  AURORA_RE,
  CHRONO_RE,
  METEOR_RE,
  MIN_REAL_SECONDS,
  clamp01,
  mixHex,
  qualityProfile,
  rgba,
} from './skill-data.js';
import { skillWarningMethods, warningProfile } from './skill-warnings.js';
import { skillDrawMethods } from './skill-draw.js';
import { skillParticleMethods } from './skill-particles.js';

const T = TILE;

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
}

// 各层绘制与粒子池以方法集合形式挂在同一原型上，对外仍是同一个 SkillRenderer 实例与同一套方法签名。
Object.assign(SkillRenderer.prototype, skillWarningMethods, skillDrawMethods, skillParticleMethods);
