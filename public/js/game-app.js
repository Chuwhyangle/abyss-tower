// 浏览器运行时：固定步长循环、渲染调度、音效与 HUD 节流。
import { Renderer } from './render.js';
import { audio } from './audio.js';

const STEP = 1 / 60;

export class GameApp {
  constructor(sim, canvas, { onHud } = {}) {
    this.sim = sim;
    this.canvas = canvas;
    this.onHud = onHud;
    this.renderer = new Renderer(canvas, sim);
    this.speed = 1;
    this.paused = false;
    this.running = false;
    this.acc = 0;
    this.last = 0;
    this._hudTimer = 0;

    // 模拟层只发出声音事件，浏览器层负责播放。
    sim.opts.onSound = (name) => audio.play(name);
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
  }

  tick(now) {
    if (!this.running) return;
    const raw = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;

    const sim = this.sim;
    const paused = this.paused || sim.paused;
    if (!paused && sim.phase === 'wave') {
      this.acc += raw * this.speed;
      let steps = 0;
      while (this.acc >= STEP && steps < 24) {
        sim.update(STEP);
        this.acc -= STEP;
        steps++;
        if (sim.phase !== 'wave') break;
      }
      if (steps >= 24) this.acc = 0;
    }

    sim.updateVisuals(raw);
    this.renderer.render(raw);

    this._hudTimer += raw;
    if (this._hudTimer >= 0.1) {
      this._hudTimer = 0;
      this.emitHud();
    }
    this.raf = requestAnimationFrame((next) => this.tick(next));
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
}
