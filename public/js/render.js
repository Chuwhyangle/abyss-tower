// Canvas 渲染门面：只负责状态（画质/DPR/时间/FPS/受击闪烁）与分层编排，
// 具体绘制由 ./render/ 下职责单一的渲染器完成。
import { TILE } from './shared/data.js';
import { normalizeSettings } from './settings.js';
import { biomePalette } from './render/palette.js';
import { GlowRenderer } from './render/glow-renderer.js';
import { BackgroundRenderer } from './render/background-renderer.js';
import { PortalRenderer } from './render/portal-renderer.js';
import { TowerRenderer } from './render/tower-renderer.js';
import { EnemyRenderer } from './render/enemy-renderer.js';
import { ProjectileRenderer } from './render/projectile-renderer.js';
import { EffectRenderer } from './render/effect-renderer.js';
import { FloaterRenderer } from './render/floater-renderer.js';
import { OverlayRenderer } from './render/overlay-renderer.js';
import { SkillRenderer } from './render/skill-renderer.js';

const T = TILE;

export class Renderer {
  constructor(canvas, game, settings = {}) {
    this.canvas = canvas;
    this.game = game;
    this.ctx = canvas.getContext('2d');
    this.settings = normalizeSettings(settings);
    this.W = game.map.cols * T;
    this.H = game.map.rows * T;
    this.palette = biomePalette(game.map, this.settings);
    this.applyDpr();
    this.time = 0;
    this.fpsFrames = 0;
    this.fpsSince = 0;
    this.fps = 60;
    this.lastBaseHp = null;
    this.hurtFlash = 0;

    // 各层显式持有依赖：共享同一份光晕缓存。
    this.glow = new GlowRenderer();
    this.backgroundRenderer = new BackgroundRenderer(game);
    this.portals = new PortalRenderer(game);
    this.towers = new TowerRenderer(game, { glow: this.glow });
    this.enemies = new EnemyRenderer(game, { glow: this.glow });
    this.projectiles = new ProjectileRenderer(game, { glow: this.glow });
    this.effects = new EffectRenderer(game, { glow: this.glow });
    this.floaters = new FloaterRenderer(game);
    this.overlay = new OverlayRenderer();
    // 技能表现独立成层：L0/L1/L2/L3 由 Renderer 编排，粒子自池化。
    this.skillRenderer = new SkillRenderer(game, {
      width: this.W,
      height: this.H,
      dpr: this.dpr,
      palette: this.palette,
      settings: this.settings,
      glow: this.glow,
    });

    this.bg = this.buildBackground();
    this.hurtOverlay = this.buildHurtOverlay();
  }

  applyDpr() {
    this.dpr = Math.min(this.settings.dpr, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.canvas.style.aspectRatio = `${this.W} / ${this.H}`;
  }

  applySettings(settings) {
    const next = normalizeSettings(settings);
    const needsRebuild =
      next.dpr !== this.settings.dpr ||
      next.decorations !== this.settings.decorations ||
      next.colorBlind !== this.settings.colorBlind ||
      next.highContrast !== this.settings.highContrast;
    this.settings = next;
    if (needsRebuild) {
      this.palette = biomePalette(this.game.map, this.settings);
      this.applyDpr();
      this.bg = this.buildBackground();
    }
    this.skillRenderer?.configure({
      width: this.W,
      height: this.H,
      dpr: this.dpr,
      palette: this.palette,
      settings: this.settings,
      glow: this.glow,
    });
  }

  buildBackground() {
    return this.backgroundRenderer.build({
      width: this.W,
      height: this.H,
      dpr: this.dpr,
      palette: this.palette,
      settings: this.settings,
    });
  }

  buildHurtOverlay() {
    return this.overlay.buildHurtOverlay(this.W, this.H);
  }

  screenToTile(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * this.W;
    const y = ((event.clientY - rect.top) / rect.height) * this.H;
    return { c: Math.floor(x / T), r: Math.floor(y / T) };
  }

  render(dt) {
    this.time += dt;
    const now = performance.now();
    this.fpsFrames++;
    if (!this.fpsSince) this.fpsSince = now;
    if (now - this.fpsSince >= 500) {
      this.fps = (this.fpsFrames * 1000) / (now - this.fpsSince);
      this.fpsFrames = 0;
      this.fpsSince = now;
    }

    const g = this.ctx;
    const game = this.game;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.W, this.H);
    g.save();
    if (this.settings.shake && game.shake > 0.2) {
      g.translate((Math.random() - 0.5) * game.shake, (Math.random() - 0.5) * game.shake);
    }
    g.drawImage(this.bg, 0, 0, this.W, this.H);

    // L0：背景之后（极光帘幕 / 星海 / 冷暖底色）
    this.skillRenderer.renderL0(g, this.time, this.settings);

    this.portals.render(g, this.time, this.settings.glow);
    this.towers.renderRanges(g, this.settings);
    // 前摇预警：射程圈之上、塔与敌人之下，保持路径信息可读。
    this.skillRenderer.renderWarnings(g, this.time, this.settings);
    // L1：塔之前的地面层（焦痕 / 霜裂 / 时间刻度）
    this.skillRenderer.renderL1(g, this.time, this.settings);
    this.towers.render(g, this.time, this.settings);
    this.enemies.render(g, this.time, this.settings);
    this.projectiles.render(g, this.settings);
    this.effects.render(g, this.time, this.settings);
    // L2：敌人与弹道之后（冰壳 / 时间泡 / 光柱 / 流星 / 碎晶）
    this.skillRenderer.renderL2(g, this.time, this.settings);
    this.floaters.render(g);
    this.towers.renderPlacement(g, this.time, this.settings.glow, this.settings);

    g.restore();

    // L3：屏幕空间（色调 / 暗角 / 时间环 / 技能名横幅），在受击警示之前。
    this.skillRenderer.renderL3(g, this.time, this.settings);

    // 基地受击 / 低血警示（屏幕空间，不参与震屏）
    const hpRatio = game.maxBaseHp > 0 ? game.baseHp / game.maxBaseHp : 1;
    if (this.lastBaseHp == null) this.lastBaseHp = game.baseHp;
    if (game.baseHp < this.lastBaseHp) {
      this.hurtFlash = Math.min(1, this.hurtFlash + 0.45 * (this.lastBaseHp - game.baseHp));
    }
    this.lastBaseHp = game.baseHp;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.8);
    const lowPulse =
      game.baseHp > 0 && hpRatio <= 0.35 ? 0.1 + Math.sin(this.time * 3.2) * 0.04 : 0;
    const hurtAlpha = Math.min(0.72, this.hurtFlash * 0.55 + lowPulse);
    if (hurtAlpha > 0.01) {
      this.overlay.drawHurt(g, this.hurtOverlay, this.W, this.H, hurtAlpha);
    }

    if (this.settings.showFps) {
      this.overlay.drawFps(g, this.fps, this.game.enemies.length);
    }
  }

  // 入口视觉状态：整备阶段全部常态；波中仅激活入口高亮，其余变暗。
  // 暴露给验收测试，避免直接读取 Canvas 像素。
  portalStates() {
    return this.portals.states();
  }
}
