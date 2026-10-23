// 浏览器运行时：固定步长模拟、按画质限帧渲染、HUD 节流、性能指标与后台暂停。
import { Renderer } from './render.js';
import { audio } from './audio.js';
import { normalizeSettings } from './settings.js';

const STEP = 1 / 60;
const MAX_FRAME_MS_SAMPLES = 1200;

export class GameApp {
  constructor(sim, canvas, { onHud, settings } = {}) {
    this.sim = sim;
    this.canvas = canvas;
    this.onHud = onHud;
    this.settings = normalizeSettings(settings);
    this.renderer = new Renderer(canvas, sim, this.settings);
    this.speed = 1;
    this.paused = false;
    this.running = false;
    this.acc = 0;
    this.last = 0;
    this.lastRenderAt = 0;
    this._hudTimer = 0;
    this._lastSkillCast = sim.skillCastCount || 0;
    this._lastMood = null;
    this._resetMetrics();

    sim.setVisualQuality({
      effects: this.settings.decorations,
      floaters: this.settings.floaters,
    });
    sim.opts.onSound = (name) => audio.play(name);

    this._onVisibility = () => {
      // 回到前台不补算后台时间；保留手动暂停/整理状态。
      this.last = performance.now();
      this.acc = 0;
      this.lastRenderAt = 0;
    };
    document.addEventListener('visibilitychange', this._onVisibility);
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
    const simStarted = performance.now();
    if (!paused && sim.phase === 'wave') {
      this.acc += raw * this.speed;
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
    sim.updateVisuals(raw);
    m.simMs += performance.now() - simStarted;

    // 30 FPS 只限制绘制次数，模拟仍按固定 60Hz 步长推进。
    const renderInterval = 1000 / this.settings.fps;
    if (!this.lastRenderAt || now - this.lastRenderAt >= renderInterval - 2) {
      const renderStarted = performance.now();
      this.renderer.render(raw);
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
    const mood = waveDef && (waveDef.boss || waveDef.finalBoss) ? 'boss' : 'battle';
    if (mood !== this._lastMood) {
      this._lastMood = mood;
      audio.startMusic(mood);
    }
    // 波次越高音乐电平略微上浮；非战斗阶段回到基准，避免结束后仍持续紧张。
    audio.setMusicIntensity(sim.phase === 'wave' ? sim.wave : 0);
  }

  applySettings(settings) {
    this.settings = normalizeSettings(settings);
    this.renderer.applySettings(this.settings);
    this.sim.setVisualQuality({
      effects: this.settings.decorations,
      floaters: this.settings.floaters,
    });
    this.lastRenderAt = 0;
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
