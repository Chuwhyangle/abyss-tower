// Canvas 渲染门面：只负责状态（画质/DPR/时间/FPS/受击闪烁）与分层编排，
// 具体绘制由 ./render/ 下职责单一的渲染器完成。
import { TILE } from './shared/data.js';
import { SCENE_SPRITES } from './shared/scene-sprites.js';
import { normalizeSettings } from './settings.js';
import { biomePalette } from './render/palette.js';
import { GlowRenderer } from './render/glow-renderer.js';
import { BackgroundRenderer } from './render/background-renderer.js';
import { PortalRenderer } from './render/portal-renderer.js';
import { TowerRenderer } from './render/tower-renderer.js';
import { EnemyRenderer } from './render/enemy-renderer.js';
import { AllyRenderer } from './render/ally-renderer.js';
import { ProjectileRenderer } from './render/projectile-renderer.js';
import { DestructibleRenderer } from './render/destructible-renderer.js';
import { EffectRenderer } from './render/effect-renderer.js';
import { FloaterRenderer } from './render/floater-renderer.js';
import { OverlayRenderer } from './render/overlay-renderer.js';
import { SkillRenderer } from './render/skill-renderer.js';
import { CulminationRenderer } from './render/culmination-renderer.js';
import { SpritePipeline } from './render/sprite-pipeline.js';
import { detectReducedMotion } from './render/transition.js';
import { t } from './i18n.js';

const T = TILE;

// 战斗场景的必需精灵集：[0] 背景（铺满画布）、[1] HUD 皮肤（角落徽记）。
// 顺序由 tests/scene-sprites.test.mjs 锁定；缺资源时两处都静默退回既有绘制。
const COMBAT_SCENE_SPRITES = SCENE_SPRITES.combat.required;

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
    // 精灵管线：DPR 由上面的 applyDpr() 唯一决定，管线不自己读 window.devicePixelRatio。
    // 预载是旁路（永不 reject）；缺资源时 draw() 返回 false，实体层继续程序化绘制。
    this.sprites = new SpritePipeline({ dpr: this.dpr });
    if (typeof window !== 'undefined') this.sprites.preload();
    this.time = 0;
    this.fpsFrames = 0;
    this.fpsSince = 0;
    this.fps = 60;
    this.lastBaseHp = null;
    this.hurtFlash = 0;
    // 战斗场景回退状态：背景精灵不可用时置 true，并在画布上留 data-sprite-fallback 标记。
    this.sceneFallback = null;
    // 系统级 reduced-motion：高潮演出与既有镜头震动的共同降级来源。
    this.reducedMotion = detectReducedMotion(typeof window !== 'undefined' ? window.document : null);

    // 各层显式持有依赖：共享同一份光晕缓存。
    this.glow = new GlowRenderer();
    this.backgroundRenderer = new BackgroundRenderer(game);
    this.portals = new PortalRenderer(game);
    // 实体渲染器只接收注入的精灵管线（自己不加载图片）：
    // 有可用帧时用图集贴图替换形体，缺资源时完整回退既有程序化绘制。
    this.towers = new TowerRenderer(game, { glow: this.glow, sprites: this.sprites });
    this.enemies = new EnemyRenderer(game, { glow: this.glow, sprites: this.sprites });
    // 友方单位（海克斯召唤物）：塔之上、敌人之下的独立层。
    this.allyRenderer = new AllyRenderer(game);
    this.projectiles = new ProjectileRenderer(game, { glow: this.glow });
    // 场景可破坏物：地面层，塔之下、范围圈之上（只读 game.destructibles）。
    this.destructibleRenderer = new DestructibleRenderer(game);
    // 这三个渲染器的构造签名被既有测试断言固定为 (game)，精灵管线用 setter 注入。
    this.portals.setSprites(this.sprites);
    this.allyRenderer.setSprites(this.sprites);
    this.destructibleRenderer.setSprites(this.sprites);
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
    // 高潮演出层（漏怪 / 清波 / 首领死亡）：屏幕空间，文案经注入的 t() 解析，
    // 渲染器本身不 import i18n / sim / 随机源。
    this.culmination = new CulminationRenderer(game, {
      width: this.W,
      height: this.H,
      text: (key, params) => t(key, params),
      settings: this.settings,
      reducedMotion: this.reducedMotion,
    });

    this.bg = this.buildBackground();
    this.hurtOverlay = this.buildHurtOverlay();
  }

  applyDpr() {
    this.dpr = Math.min(this.settings.dpr, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.canvas.style.aspectRatio = `${this.W} / ${this.H}`;
    // DPR 的唯一权威在这里：管线只跟随重选变体，不另读 devicePixelRatio。
    this.sprites?.configure({ dpr: this.dpr });
  }

  // 释放精灵管线持有的图片引用；之后管线 draw() 一律返回 false。
  dispose() {
    this.sprites?.dispose();
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
    // 关闭震屏时已生成的演出立即转为静态降级，不等下一次事件。
    this.culmination?.setSettings(this.settings);
  }

  // 系统 prefers-reduced-motion 变更：演出与镜头同源降级。
  setReducedMotion(reduced) {
    this.reducedMotion = reduced === true;
    this.culmination?.setReducedMotion(this.reducedMotion);
  }

  // 高潮演出提供的视觉时间倍率（清波 / 首领慢动作）；无演出时为 1。
  get visualTimeScale() {
    return this.culmination?.timeScale() ?? 1;
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

  // dt：真实帧间隔；camera：已算好的镜头变换（composeCameraTransform 的结果）。
  // 渲染层不取随机数、不读设置决定运动：运动关闭时 camera 已是精确恒等。
  render(dt, camera = null) {
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
    if (camera && (camera.x !== 0 || camera.y !== 0)) g.translate(camera.x, camera.y);
    if (camera && camera.zoom !== 1) {
      // 以命中点为锚做缩放冲击；焦点是格坐标，先换成逻辑像素。
      const fx = camera.focusX * T;
      const fy = camera.focusY * T;
      g.translate(fx, fy);
      g.scale(camera.zoom, camera.zoom);
      g.translate(-fx, -fy);
    }
    // 战斗背景：程序化地形承载玩法信息（路径 / 塔位 / 网格），永远先画且不被替换；
    // 场景背景精灵是一层「只加光」的景观层（全透明底），叠在地形之上每帧一次 drawImage。
    // 缺资源时这一层不画，画面与接入前逐像素一致。
    const [sceneBackgroundId, sceneHudId] = COMBAT_SCENE_SPRITES;
    g.drawImage(this.bg, 0, 0, this.W, this.H);
    const drewScenery = this.sprites.drawRect(g, sceneBackgroundId, 0, 0, this.W, this.H);
    this.setSceneFallback(!drewScenery);

    // L0：背景之后（极光帘幕 / 星海 / 冷暖底色）
    this.skillRenderer.renderL0(g, this.time, this.settings);

    // 传送门与基地：hurtFlash 用上一帧的值（低血/受击帧），不改变本帧的受击检测顺序。
    this.portals.render(g, this.time, this.settings.glow, this.hurtFlash);
    this.towers.renderRanges(g, this.settings);
    // 前摇预警：射程圈之上、塔与敌人之下，保持路径信息可读。
    this.skillRenderer.renderWarnings(g, this.time, this.settings);
    // L1：塔之前的地面层（焦痕 / 霜裂 / 时间刻度）
    this.skillRenderer.renderL1(g, this.time, this.settings);
    // 可破坏物在地面特效之上、塔之下；已拆除的格子画废墟残迹。
    this.destructibleRenderer.render(g, this.time, this.settings);
    this.towers.render(g, this.time, this.settings);
    this.allyRenderer.render(g, this.time, this.settings);
    this.enemies.render(g, this.time, this.settings);
    this.projectiles.render(g, this.settings);
    this.effects.render(g, this.time, this.settings);
    // L2：敌人与弹道之后（冰壳 / 时间泡 / 光柱 / 流星 / 碎晶）
    this.skillRenderer.renderL2(g, this.time, this.settings);
    this.floaters.render(g);
    this.towers.renderPlacement(g, this.time, this.settings.glow, this.settings);
    this.towers.renderMirrorPlacement(g, this.time, this.settings.glow, this.settings);

    g.restore();

    // L3：屏幕空间（色调 / 暗角 / 时间环 / 技能名横幅），在受击警示之前。
    this.skillRenderer.renderL3(g, this.time, this.settings);

    // 战斗 HUD 皮肤：画布右下角的场景徽记；缺资源时不画（HUD 本体仍是 DOM）。
    this.sprites.draw(g, sceneHudId, this.W - 64, this.H - 32, { alpha: 0.9 });

    // 命中闪光 / 致死边缘染色：非运动反馈，reduced-motion 与关闭震屏时照常绘制。
    this.drawHitFlash(g, camera);

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

    // 高潮演出：受击暗角之后、FPS 面板之前。只读 sim.culminations（按 seq 增量），
    // 先推进再绘制；横幅/色块/边框不做运动降级，脉冲/扫光/扩散环受 motion 门控。
    this.culmination.update(game, dt);
    this.culmination.render(g);

    if (this.settings.showFps) {
      this.overlay.drawFps(g, this.fps, this.game.enemies.length);
    }
  }

  // 场景级回退标记：只在状态翻转时写 DOM，避免每帧 setAttribute。
  setSceneFallback(fallback) {
    const next = fallback === true;
    if (this.sceneFallback === next) return;
    this.sceneFallback = next;
    if (!this.canvas?.dataset) return;
    if (next) this.canvas.dataset.spriteFallback = '1';
    else delete this.canvas.dataset.spriteFallback;
  }

  // 命中闪光与致死边缘染色：addition 径向渐变 + 红边框，只吃 camera.flash/lethal，
  // 与位移/缩放无关，因此在运动关闭时仍然可见（非运动反馈不降级）。
  drawHitFlash(g, camera) {
    if (!camera) return;
    const flash = camera.flash;
    if (flash > 0.01) {
      const x = camera.flashX * T;
      const y = camera.flashY * T;
      const radius = Math.max(T * 1.4, 1);
      const gradient = g.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, `rgba(255, 246, 222, ${(0.55 * flash).toFixed(3)})`);
      gradient.addColorStop(0.55, `rgba(255, 214, 150, ${(0.22 * flash).toFixed(3)})`);
      gradient.addColorStop(1, 'rgba(255, 200, 120, 0)');
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = gradient;
      g.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      g.restore();
    }
    if (camera.lethal > 0.02) {
      const width = Math.max(4, Math.round(T * 0.35));
      g.save();
      g.strokeStyle = `rgba(226, 96, 110, ${(0.75 * camera.lethal).toFixed(3)})`;
      g.lineWidth = width;
      g.strokeRect(width / 2, width / 2, this.W - width, this.H - width);
      g.restore();
    }
  }

  // 入口视觉状态：整备阶段全部常态；波中仅激活入口高亮，其余变暗。
  // 暴露给验收测试，避免直接读取 Canvas 像素。
  portalStates() {
    return this.portals.states();
  }
}
