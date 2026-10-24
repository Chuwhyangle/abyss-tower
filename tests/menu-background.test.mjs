// 大厅动态背景：画质预算、启停生命周期、音乐色调与日期主题；全部为纯函数/假画布验证。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MENU_BG_ID,
  MENU_PARALLAX_LAYERS,
  MENU_PARTICLE_CAP,
  MENU_TINT_ALPHA_MAX,
  MUSIC_TINTS,
  MenuBackground,
  createMenuCanvas,
  decorateMenuCanvas,
  menuBackgroundBudget,
  menuTheme,
  musicTint,
  seasonOf,
} from '../public/js/render/menu-background.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const LOW = { fps: 30, dpr: 1, decorations: 'light' };
const HIGH = { fps: 60, dpr: 2, decorations: 'full' };

function fakeCanvas() {
  const calls = { clearRect: 0, fillRect: 0, arc: 0, gradients: 0 };
  const ctx = {
    canvas: null,
    fillStyle: '',
    globalAlpha: 1,
    save() {},
    restore() {},
    scale() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    fill() {},
    arc() { calls.arc += 1; },
    clearRect() { calls.clearRect += 1; },
    fillRect() { calls.fillRect += 1; },
    createLinearGradient() {
      calls.gradients += 1;
      return { addColorStop() {} };
    },
  };
  const canvas = {
    id: '',
    width: 800,
    height: 600,
    clientWidth: 800,
    clientHeight: 600,
    style: {},
    setAttribute(name, value) { this[name] = value; },
    getContext(kind) { return kind === '2d' ? ctx : null; },
  };
  ctx.canvas = canvas;
  return { canvas, ctx, calls };
}

function fakeFrames() {
  let nextId = 0;
  const queue = new Map();
  return {
    raf(cb) {
      nextId += 1;
      queue.set(nextId, cb);
      return nextId;
    },
    caf(id) {
      queue.delete(id);
    },
    get pending() {
      return queue.size;
    },
    flush(now) {
      const entries = [...queue.values()];
      queue.clear();
      for (const cb of entries) cb(now);
    },
  };
}

function mount(settings = HIGH, mood = 'menu') {
  const { canvas, ctx, calls } = fakeCanvas();
  const frames = fakeFrames();
  const bg = new MenuBackground({
    canvas,
    settings,
    mood,
    raf: (cb) => frames.raf(cb),
    caf: (id) => frames.caf(id),
    now: () => 0,
  });
  return { bg, canvas, ctx, calls, frames };
}

test('画质预算：低配与关闭档零粒子，仅高配吃满上限', () => {
  const low = menuBackgroundBudget(LOW);
  assert.equal(low.particles, 0, '低配必须零粒子');
  assert.equal(low.parallaxLayers, MENU_PARALLAX_LAYERS);

  const high = menuBackgroundBudget(HIGH);
  assert.equal(high.particles, MENU_PARTICLE_CAP);
  assert.ok(high.particles <= MENU_PARTICLE_CAP);
  assert.equal(high.fps, 60);

  const off = menuBackgroundBudget({ ...HIGH, decorations: 'off' });
  assert.equal(off.particles, 0);
  assert.equal(off.parallaxLayers, MENU_PARALLAX_LAYERS);

  // 未知/缺失档位回退低配，绝不意外开启粒子。
  assert.equal(menuBackgroundBudget({}).particles, 0);
  assert.equal(menuBackgroundBudget({ decorations: 'ultra' }).particles, 0);
});

test('减弱动效：零粒子且不启动动画循环', () => {
  const budget = menuBackgroundBudget(HIGH, { reduceMotion: true });
  assert.equal(budget.particles, 0);
  assert.equal(budget.parallaxLayers, 0);
  assert.equal(budget.animate, false);

  const { bg, frames } = mount(HIGH);
  const reduced = new MenuBackground({
    canvas: bg.canvas,
    settings: HIGH,
    reduceMotion: true,
    raf: (cb) => frames.raf(cb),
    caf: (id) => frames.caf(id),
  });
  reduced.start();
  assert.equal(reduced.running, false);
  assert.equal(frames.pending, 0);
});

test('粒子池随画质切换：高配有粒子、低配立刻归零且不再绘制粒子', () => {
  const { bg, calls } = mount(HIGH);
  assert.equal(bg.particles.length, MENU_PARTICLE_CAP);

  bg.start();
  bg.render(0.016);
  assert.equal(calls.arc, MENU_PARTICLE_CAP, '高配一帧应绘制全部粒子');

  bg.updateSettings(LOW);
  assert.equal(bg.particles.length, 0, '切到低配应清空粒子池');
  calls.arc = 0;
  bg.render(0.016);
  assert.equal(calls.arc, 0, '低配帧不得出现粒子');
});

test('切到战斗：stop 取消动画帧、清空画布且不再有残留绘制', () => {
  const { bg, calls, frames } = mount(HIGH);
  bg.start();
  assert.equal(bg.running, true);
  assert.equal(frames.pending, 1);

  frames.flush(0);
  const drawsWhileMenu = calls.clearRect;
  assert.ok(drawsWhileMenu > 0, '大厅内应持续绘制');
  assert.equal(frames.pending, 1, '每帧结束后重新排下一帧');

  bg.stop();
  assert.equal(bg.running, false);
  assert.equal(frames.pending, 0, 'stop 必须取消已排队的动画帧');
  assert.ok(calls.clearRect > drawsWhileMenu, 'stop 后应清空画布，避免残留画面');

  const afterStop = calls.clearRect;
  frames.flush(5000);
  bg.render(0.016);
  assert.equal(calls.clearRect, afterStop, '停止后不得再绘制任何一帧');
});

test('30 FPS 设置下按帧率门槛跳帧，不改变粒子预算', () => {
  const { bg, calls, frames } = mount({ ...LOW, decorations: 'full' });
  bg.start();
  frames.flush(0);
  const first = calls.clearRect;
  frames.flush(16);
  assert.equal(calls.clearRect, first, '16ms 间隔在 30fps 门槛内应跳过');
  frames.flush(40);
  assert.ok(calls.clearRect > first, '超过门槛后应恢复绘制');
});

test('音乐切换只轻微改变色调，并缓慢插值而非瞬跳', () => {
  assert.ok(musicTint('boss').alpha <= MENU_TINT_ALPHA_MAX);
  assert.ok(musicTint('menu').alpha <= MENU_TINT_ALPHA_MAX);
  assert.notEqual(musicTint('menu').hue, musicTint('boss').hue);
  assert.deepEqual(musicTint('unknown-mood'), MUSIC_TINTS.none);

  const { bg } = mount(HIGH, 'menu');
  const before = bg.tint.hue;
  bg.setMusicMood('boss');
  assert.equal(bg.targetTint.hue, MUSIC_TINTS.boss.hue);
  assert.equal(bg.tint.hue, before, '目标色变化不应立刻覆盖当前色');

  bg.start();
  for (let i = 0; i < 40; i += 1) bg.render(0.3);
  assert.ok(Math.abs(bg.tint.hue - MUSIC_TINTS.boss.hue) < 1, '若干帧后应逼近目标色');
  assert.notEqual(bg.tint.hue, MUSIC_TINTS.boss.hue, '插值不应是瞬跳');
});

test('日期主题：同一天稳定、季节可辨、非法日期回退', () => {
  const spring = menuTheme(new Date('2026-04-10T12:00:00'));
  assert.equal(spring.season, 'spring');
  assert.deepEqual(spring, menuTheme(new Date('2026-04-10T22:00:00')));
  assert.equal(menuTheme(new Date('2026-07-10T12:00:00')).season, 'summer');
  assert.equal(menuTheme(new Date('2026-10-10T12:00:00')).season, 'autumn');
  assert.equal(menuTheme(new Date('2026-01-10T12:00:00')).season, 'winter');
  assert.equal(seasonOf(new Date(NaN)), 'winter');

  const nextDay = menuTheme(new Date('2026-04-11T12:00:00'));
  assert.notEqual(spring.seed, nextDay.seed, '每天应有不同的粒子种子');
  const fallback = menuTheme(new Date('invalid'));
  assert.equal(fallback.season, 'winter');
  assert.equal(fallback.day, 'fallback');
});

test('画布垫在内容之下且不拦截点击、不进入读屏', () => {
  const { canvas } = fakeCanvas();
  decorateMenuCanvas(canvas);
  assert.equal(canvas.id, MENU_BG_ID);
  assert.equal(canvas.style.pointerEvents, 'none');
  assert.equal(canvas.style.zIndex, '0');
  assert.equal(canvas.style.position, 'absolute');
  assert.equal(canvas['aria-hidden'], 'true');
  assert.equal(canvas.tabIndex, -1);

  // 插入为第一个子节点：后续的 title-glow / title-inner 自然盖在画布之上。
  const glow = { id: 'glow' };
  const container = {
    firstChild: glow,
    inserted: null,
    insertBefore(node, before) {
      this.inserted = { node, before };
      this.firstChild = node;
    },
  };
  const doc = {
    createElement() {
      return { id: '', style: {}, setAttribute(name, value) { this[name] = value; } };
    },
  };
  const created = createMenuCanvas(container, doc);
  assert.ok(created);
  assert.equal(container.inserted.node, created);
  assert.equal(container.inserted.before, glow);
  assert.equal(container.firstChild, created);
  assert.equal(createMenuCanvas(null, doc), null);
});

test('不引入素材、不读取模拟状态', () => {
  const source = read('public/js/render/menu-background.js');
  assert.doesNotMatch(source, /new\s+Image\b|\.(?:png|jpe?g|webp|gif|mp3|ogg|wav)\b|https?:\/\//i);
  assert.doesNotMatch(source, /\bsim\b/i, '大厅背景不得耦合模拟状态');
  assert.doesNotMatch(source, /from '\.\.\/(?:app|ui)\//, 'render 层只依赖 shared/render');
});

test('UI 门面：标题页启动大厅背景，进入战斗时停止', () => {
  const source = read('public/js/ui.js');
  assert.match(source, /import \{[^}]*MenuBackground[^}]*\} from '\.\/render\/menu-background\.js'/);
  assert.match(source, /showTitle\([^)]*\)\s*\{[\s\S]*?this\.startMenuBackground\(\)/);
  assert.match(source, /showGame\([^)]*\)\s*\{[\s\S]*?this\.stopMenuBackground\(\)/);
});
