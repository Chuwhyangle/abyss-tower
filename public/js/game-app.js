// 浏览器运行时：固定步长模拟、按画质限帧渲染、HUD 节流、性能指标与后台暂停。
import { Renderer } from './render.js';
import { CameraFeedback, composeCameraTransform } from './render/camera-feedback.js';
import { detectReducedMotion } from './render/transition.js';
import { weatherFor } from './render/background-renderer.js';
import { audio } from './audio.js';
import { normalizeSettings } from './settings.js';
import { IMPACT_CLASSES, classFloaterText, classifyImpactClasses } from './shared/impact-class-feedback.js';

const STEP = 1 / 60;
const MAX_FRAME_MS_SAMPLES = 1200;
const MOTION_QUERY = '(prefers-reduced-motion: reduce)';

// 命中类别消费端：逐帧把 sim.impactEvents 里新增的事件转成类别飘字 + 类别特效。
// 只读事件数组；按对象身份去重（环形缓冲裁掉旧事件后既不重复也不抛错）；
// 飘字/特效各自走 sim.addFloater / sim.addEffect 既有的档位门控，不新增设置项、不消耗 RNG。
export class ImpactFeedbackConsumer {
  constructor(sim) {
    this.sim = sim;
    this._seen = new WeakSet();
    // 只读观测计数（浏览器验收与单测读取）。
    this.stats = { consumed: 0, produced: 0, classes: Object.create(null) };
  }

  // 消费一批事件，返回本批命中的类别条数（同一事件第二次喂入返回 0）。
  consume(events = []) {
    const sim = this.sim;
    if (!sim || !Array.isArray(events) || events.length === 0) return 0;
    let produced = 0;
    for (const event of events) {
      if (!event || typeof event !== 'object') continue;
      if (this._seen.has(event)) continue;
      this._seen.add(event);
      this.stats.consumed += 1;
      for (const cls of classifyImpactClasses(event)) {
        this._emit(event, cls);
        produced += 1;
        this.stats.produced += 1;
        this.stats.classes[cls] = (this.stats.classes[cls] || 0) + 1;
      }
    }
    return produced;
  }

  // 单条类别表现：类别飘字（含后缀，key 档可见）+ 类别特效（形状按类别区分）。
  // 飘字起点按类别 lift 抬离武器层数字那一行，避免「-5 甲」与「25」叠成「-525 甲」。
  _emit(event, cls) {
    const sim = this.sim;
    const meta = IMPACT_CLASSES[cls];
    const text = classFloaterText(event, cls);
    if (text) {
      sim.addFloater(event.x, event.y - meta.floater.lift, text, meta.floater.color, meta.floater.big, {
        key: true,
        layer: meta.floater.layer,
      });
    }
    sim.addEffect({ kind: meta.event, x: event.x, y: event.y, ttl: meta.vfx.duration });
  }
}

export class GameApp {
  constructor(sim, canvas, { onHud, settings } = {}) {
    this.sim = sim;
    this.canvas = canvas;
    this.onHud = onHud;
    this.settings = normalizeSettings(settings);
    this.renderer = new Renderer(canvas, sim, this.settings);
    // 镜头反馈：只作用于表现；reduced-motion / 关闭震屏时运动分量为 0，保留命中闪光。
    this.reducedMotion = detectReducedMotion(globalThis.document);
    // 演出层与镜头共用同一份 reduced-motion 判定（系统偏好变更时两处一起刷新）。
    this.renderer.setReducedMotion(this.reducedMotion);
    this.feedback = new CameraFeedback({
      settings: this.settings,
      reducedMotion: this.reducedMotion,
      seed: sim.seed ?? 1,
      viewport: { width: sim.map?.cols || 1, height: sim.map?.rows || 1 },
    });
    // 命中类别层：与镜头反馈共用事件源，但只产出类别飘字/特效，互不改写对方状态。
    this.impactFeedback = new ImpactFeedbackConsumer(sim);
    this.speed = 1;
    this.paused = false;
    this.running = false;
    this.acc = 0;
    this.last = 0;
    this.lastRenderAt = 0;
    this._hudTimer = 0;
    this._lastSkillCast = sim.skillCastCount || 0;
    this._lastMood = null;
    this._lastBossVariant = null;
    this._bossHpRatio = 1;
    this._resetMetrics();

    sim.setVisualQuality({
      effects: this.settings.decorations,
      floaters: this.settings.floaters,
    });
    sim.opts.onSound = (name) => audio.play(name);
    // 最低画质（关闭装饰）同时关掉环境音层；环境音开关独立于音乐/音效。
    audio.setAmbienceEnabled(this.settings.decorations !== 'off');

    this._onVisibility = () => {
      // 回到前台不补算后台时间；保留手动暂停/整理状态。
      this.last = performance.now();
      this.acc = 0;
      this.lastRenderAt = 0;
    };
    document.addEventListener('visibilitychange', this._onVisibility);

    // 系统级 reduced-motion 变更即时刷新运动预算，不需要重开对局。
    this._onMotionPreference = (event) => {
      this.reducedMotion = event?.matches === true;
      this.feedback.setSettings(this.settings, { reducedMotion: this.reducedMotion });
      this.renderer.setReducedMotion(this.reducedMotion);
    };
    this._motionQuery =
      typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia(MOTION_QUERY) : null;
    this._motionQuery?.addEventListener?.('change', this._onMotionPreference);
  }

  _resetMetrics() {
    this.metrics = {
      startedAt: performance.now(),
      frames: 0,
      renders: 0,
      simSteps: 0,
      simMs: 0,
      renderMs: 0,
      hudMs: 0,
      hudCalls: 0,
      slowFrames: 0,
      frameIntervals: [],
      renderIntervals: [],
    };
  }

  start() {
    this.running = true;
    this.last = performance.now();
    this.emitHud();
    this.raf = requestAnimationFrame((now) => this.tick(now));
  }

  destroy() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    document.removeEventListener('visibilitychange', this._onVisibility);
    this._motionQuery?.removeEventListener?.('change', this._onMotionPreference);
    this.renderer?.dispose?.();
    audio.stopAmbience();
  }

  // 浏览器验收经既有 window.__rtd 读取精灵管线状态（不新增全局名）。
  get sprites() {
    return this.renderer?.sprites || null;
  }

  tick(now) {
    if (!this.running) return;
    if (document.hidden) {
      this.last = now;
      this.raf = requestAnimationFrame((next) => this.tick(next));
      return;
    }

    const raw = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const m = this.metrics;
    m.frames++;
    const frameMs = raw * 1000;
    m.frameIntervals.push(frameMs);
    if (m.frameIntervals.length > MAX_FRAME_MS_SAMPLES) m.frameIntervals.shift();
    if (frameMs > 50) m.slowFrames++;

    const sim = this.sim;
    const paused = this.paused || sim.paused;
    // 镜头反馈先按真实时间推进：冻结期 timeScale 只放慢步进，渲染与衰减照常。
    const frame = this.feedback.update(raw);
    const simStarted = performance.now();
    if (!paused && sim.phase === 'wave') {
      this.acc += raw * this.speed * frame.timeScale;
      let steps = 0;
      while (this.acc >= STEP && steps < 24) {
        sim.update(STEP);
        this.acc -= STEP;
        steps++;
        m.simSteps++;
        if (sim.phase !== 'wave') break;
      }
      if (steps >= 24) this.acc = 0;
    }
    // 只读消费本帧新增的结构化命中事件（对象身份去重，不要求事件带序号）。
    this.feedback.consume(sim.impactEvents || []);
    this.impactFeedback.consume(sim.impactEvents || []);
    // 命中音效层：同一事件源，限流/压缩只作用于表现，不改变模拟与结算。
    audio.followCombatImpacts(sim, performance.now());
    // 慢动作只缩放视觉 dt（特效/飘字衰减与演出播放），模拟步进仍按固定步长推进；
    // reduced-motion / 关闭震屏时演出层恒返回 1，视觉节奏与常态一致。
    const visualTimeScale = Number(this.renderer?.visualTimeScale);
    const visualDt =
      Number.isFinite(visualTimeScale) && visualTimeScale > 0 ? raw * visualTimeScale : raw;
    sim.updateVisuals(visualDt);
    m.simMs += performance.now() - simStarted;

    // 渲染层只接收算好的镜头变换：旧 game.shake（漏怪/首领死亡等无命中事件的来源）
    // 与命中冲量在这里合成，抖动来自 CameraFeedback 的播种序列。
    const camera = composeCameraTransform({
      feedback: frame,
      budget: this.feedback.budget,
      legacyShake: sim.shake > 0.2 ? sim.shake : 0,
      jitter: () => this.feedback.nextRandom(),
    });

    // 30 FPS 只限制绘制次数，模拟仍按固定 60Hz 步长推进。
    const renderInterval = 1000 / this.settings.fps;
    if (!this.lastRenderAt || now - this.lastRenderAt >= renderInterval - 2) {
      const renderStarted = performance.now();
      this.renderer.render(raw, camera);
      m.renderMs += performance.now() - renderStarted;
      if (this.lastRenderAt) {
        m.renderIntervals.push(now - this.lastRenderAt);
        if (m.renderIntervals.length > MAX_FRAME_MS_SAMPLES) m.renderIntervals.shift();
      }
      this.lastRenderAt = now;
      m.renders++;
    }

    this._hudTimer += raw;
    if (this._hudTimer >= 0.1) {
      this._hudTimer = 0;
      this.syncAudio();
      const hudStarted = performance.now();
      this.emitHud();
      m.hudMs += performance.now() - hudStarted;
      m.hudCalls++;
    }

    this.raf = requestAnimationFrame((next) => this.tick(next));
  }

  // 音乐随战斗阶段切换（首领波 → boss，其余 → battle），技能释放补一发音效。
  // 与 HUD 共用 0.1s 节流，避免每帧查询模拟状态。
  syncAudio() {
    const sim = this.sim;
    if (sim.skillCastCount !== this._lastSkillCast) {
      this._lastSkillCast = sim.skillCastCount;
      if (sim.skill) audio.play(`skill_${sim.skill.id}`);
    }
    const waveDef = sim.phase === 'wave' ? sim.waveDef : null;
    const bossWave = !!(waveDef && (waveDef.boss || waveDef.finalBoss));
    const mood = bossWave ? 'boss' : 'battle';
    if (mood !== this._lastMood) {
      this._lastMood = mood;
      audio.startMusic(mood);
    }
    if (bossWave) {
      const variant = waveDef.bossVariant || null;
      if (variant !== this._lastBossVariant) {
        this._lastBossVariant = variant;
        this._bossHpRatio = 1;
      }
      // 首领阵亡后保留最后一阶段的强度层，避免结算前突然回落。
      const boss = sim.enemies.find((enemy) => enemy.boss && !enemy.dead);
      if (boss) this._bossHpRatio = boss.hp / Math.max(1, boss.maxHp);
      audio.setBossContext(variant, this._bossHpRatio);
    } else {
      this._lastBossVariant = null;
      this._bossHpRatio = 1;
    }
    // 波次越高音乐电平略微上浮；非战斗阶段回到基准，避免结束后仍持续紧张。
    audio.setMusicIntensity(sim.phase === 'wave' ? sim.wave : 0);
    // 环境音层跟随地图群系与天气；同一组合重复请求会直接短路。
    const mapMeta = sim.mapMeta || {};
    audio.startAmbience(mapMeta, weatherFor(mapMeta, sim.seed));
  }

  applySettings(settings) {
    this.settings = normalizeSettings(settings);
    this.renderer.applySettings(this.settings);
    // 设置护栏即时生效：关闭震屏的下一帧，位移与缩放归零，闪光照常。
    this.feedback.setSettings(this.settings, { reducedMotion: this.reducedMotion });
    this.sim.setVisualQuality({
      effects: this.settings.decorations,
      floaters: this.settings.floaters,
    });
    this.lastRenderAt = 0;
    // 画质切到最低档时关闭环境音层，切回则恢复。
    audio.setAmbienceEnabled(this.settings.decorations !== 'off');
    this.emitHud(true);
  }

  setSpeed(value) {
    if (value === 0) {
      this.paused = !this.paused;
    } else {
      this.paused = false;
      this.speed = value;
    }
    this.emitHud(true);
  }

  setPaused(paused) {
    this.paused = !!paused;
    this.emitHud(true);
  }

  getHud() {
    return {
      ...this.sim.getHud(),
      speed: this.speed,
      paused: this.paused || this.sim.paused,
    };
  }

  emitHud(force = false) {
    if (!this.onHud) return;
    this.onHud(this.getHud(), force);
  }

  getMetricsSummary() {
    const m = this.metrics;
    const percentile = (values, p) => {
      if (!values.length) return 0;
      const sorted = [...values].sort((a, b) => a - b);
      const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
      return sorted[index];
    };
    const elapsedSec = Math.max(0.001, (performance.now() - m.startedAt) / 1000);
    return {
      settings: { ...this.settings },
      elapsedSec: Number(elapsedSec.toFixed(2)),
      frames: m.frames,
      renders: m.renders,
      simSteps: m.simSteps,
      fps: Number((m.frames / elapsedSec).toFixed(2)),
      renderFps: Number((m.renders / elapsedSec).toFixed(2)),
      avgSimMs: Number((m.simMs / Math.max(1, m.frames)).toFixed(3)),
      avgRenderMs: Number((m.renderMs / Math.max(1, m.renders)).toFixed(3)),
      avgHudMs: Number((m.hudMs / Math.max(1, m.hudCalls)).toFixed(3)),
      p95FrameMs: Number(percentile(m.frameIntervals, 95).toFixed(2)),
      p99FrameMs: Number(percentile(m.frameIntervals, 99).toFixed(2)),
      p95RenderMs: Number(percentile(m.renderIntervals, 95).toFixed(2)),
      p99RenderMs: Number(percentile(m.renderIntervals, 99).toFixed(2)),
      slowFrames: m.slowFrames,
      entities: {
        enemies: this.sim.enemies.length,
        projectiles: this.sim.projectiles.length,
        towers: this.sim.towers.length,
        effects: this.sim.effects.length,
        floaters: this.sim.floaters.length,
      },
      heap: globalThis.performance?.memory
        ? {
            usedJSHeapSize: globalThis.performance.memory.usedJSHeapSize,
            totalJSHeapSize: globalThis.performance.memory.totalJSHeapSize,
          }
        : null,
    };
  }

  resetMetrics() {
    this._resetMetrics();
  }
}
