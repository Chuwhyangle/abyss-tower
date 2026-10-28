// 视觉分层与传送门表现：纯函数预算边界、生物群系分层定义、低配/高配绘制差异，
// 以及"画质不改变战斗结果"的同种子回归。渲染层只读模拟状态。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  BACKGROUND_LAYERS,
  BIOME_SCENES,
  ambientParticleBudget,
  biomeScene,
  decorExclusion,
} from '../public/js/render/background-renderer.js';
import {
  PORTAL_PROFILES,
  PORTAL_SPARK_CAP,
  PortalRenderer,
  portalChargeLevel,
  portalProfile,
  portalSparkCount,
} from '../public/js/render/portal-renderer.js';
import { biomePalette } from '../public/js/render/palette.js';
import {
  ENEMY_ANIM_VARIANTS,
  HIT_HIGHLIGHT,
  drawHitHighlight,
  hitHighlightAlpha,
} from '../public/js/render/enemy-renderer.js';
import { SHARP_HIT_STAR, drawSharpHitStar } from '../public/js/render/effect-renderer.js';
import { resolveMotionBudget } from '../public/js/render/camera-feedback.js';
import { RgbaImage, fillRect } from '../scripts/lib/png.mjs';
import {
  deltaE,
  differenceStats,
  luma,
  parseCssColor,
  pixelHash,
  silhouetteCoverage,
} from '../scripts/lib/visual-metrics.mjs';
import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';

const BACKGROUND_SRC = fs.readFileSync(
  new URL('../public/js/render/background-renderer.js', import.meta.url),
  'utf8'
);
const PORTAL_SRC = fs.readFileSync(
  new URL('../public/js/render/portal-renderer.js', import.meta.url),
  'utf8'
);

const ARCHETYPES = ['canyon', 'twin', 'triple', 'ring', 'cross'];
const PALETTE_KEYS = [
  'grass1', 'grass2', 'grid', 'pathEdge', 'path', 'pathInner',
  'pathLine', 'tuft', 'rock', 'rockEdge', 'accent', 'ambient',
];

test('每个生物群系都有调色板与完整分层定义', () => {
  assert.deepEqual([...BACKGROUND_LAYERS], ['far', 'mist', 'ground', 'decor', 'particles']);
  for (const archetype of ARCHETYPES) {
    const palette = biomePalette({ archetype });
    for (const key of PALETTE_KEYS) {
      assert.ok(palette[key], `${archetype}.palette.${key} 缺失`);
    }

    const scene = biomeScene({ archetype });
    assert.equal(scene, BIOME_SCENES[archetype], `${archetype} 分层定义未注册`);
    for (const layer of BACKGROUND_LAYERS) {
      assert.ok(scene[layer], `${archetype}.${layer} 分层缺失`);
    }
    assert.ok(scene.far.bands >= 2, `${archetype}.far.bands 至少两层`);
    assert.ok(scene.far.alpha > 0 && scene.far.alpha < 0.2, `${archetype}.far.alpha 低对比度`);
    assert.ok(scene.mist.patches > 0 && scene.mist.alpha > 0);
    assert.ok(scene.particles.max > 0 && scene.particles.size > 0);
    assert.ok(scene.decor.prop, `${archetype}.decor.prop 缺失`);
    assert.equal(typeof scene.ground.moss, 'number');
  }

  // 未知/缺失原型回退 canyon，渲染永不因地图数据缺字段而中断。
  assert.equal(biomeScene({ archetype: 'unknown' }), BIOME_SCENES.canyon);
  assert.equal(biomeScene(null), BIOME_SCENES.canyon);
  assert.equal(biomeScene({}), BIOME_SCENES.canyon);
});

test('环境粒子预算：低配降级、off 归零、永不超过场景上限', () => {
  assert.equal(ambientParticleBudget('off', 64), 0);
  assert.equal(ambientParticleBudget('full', 64), 64);
  assert.equal(ambientParticleBudget('light', 64), Math.round(64 * 0.35));
  assert.equal(ambientParticleBudget(undefined, 64), Math.round(64 * 0.35));
  assert.ok(ambientParticleBudget('light', 64) < ambientParticleBudget('full', 64));

  // 边界值：0/负数/NaN/小数/极小上限
  assert.equal(ambientParticleBudget('full', 0), 0);
  assert.equal(ambientParticleBudget('full', -10), 0);
  assert.equal(ambientParticleBudget('full', NaN), 0);
  assert.equal(ambientParticleBudget('full', Number.POSITIVE_INFINITY), 0);
  assert.equal(ambientParticleBudget('full', 3.9), 3);
  assert.equal(ambientParticleBudget('light', 1), 1);
  assert.equal(ambientParticleBudget('off', -1), 0);

  for (const scene of Object.values(BIOME_SCENES)) {
    assert.ok(ambientParticleBudget('full', scene.particles.max) <= scene.particles.max);
  }
});

test('装饰排除区：路径格及其 8 邻域不放置地表道具', () => {
  const map = generateMap('render-visuals-decor');
  const excluded = decorExclusion(map);
  assert.ok(map.pathCells.length > 0, '地图应有路径格');
  for (const cell of map.pathCells) {
    assert.ok(excluded.has(cell.c * map.rows + cell.r), '路径格未被排除');
  }
  const target = map.pathCells[0];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const c = target.c + dc;
      const r = target.r + dr;
      if (c >= 0 && c < map.cols && r >= 0 && r < map.rows) {
        assert.ok(excluded.has(c * map.rows + r), `路径邻格 (${c},${r}) 未被排除`);
      }
    }
  }
});

test('传送门画质档位：低配光晕/环数/粒子均少于高配且不超上限', () => {
  assert.equal(portalProfile(true), PORTAL_PROFILES.high);
  assert.equal(portalProfile(false), PORTAL_PROFILES.low);
  assert.equal(portalProfile(undefined), PORTAL_PROFILES.low);

  const low = portalProfile(false);
  const high = portalProfile(true);
  assert.equal(low.halo, false);
  assert.equal(high.halo, true);
  assert.ok(low.haloRadius < high.haloRadius);
  assert.ok(low.rings < high.rings);
  assert.ok(low.trail < high.trail);
  assert.ok(portalSparkCount(low) < portalSparkCount(high));
  assert.ok(portalSparkCount(high) <= PORTAL_SPARK_CAP);

  assert.equal(portalSparkCount(undefined), 0);
  assert.equal(portalSparkCount({ sparks: -5 }), 0);
  assert.equal(portalSparkCount({ sparks: NaN }), 0);
  assert.equal(portalSparkCount({ sparks: 99 }), PORTAL_SPARK_CAP);
  assert.equal(portalSparkCount({ sparks: 2.9 }), 2);
});

test('充能预警强度：整备呼吸、波中满格、其余熄灭', () => {
  assert.equal(portalChargeLevel('wave', 0), 1);
  assert.equal(portalChargeLevel('wave', 99), 1);
  assert.equal(portalChargeLevel('over', 1), 0);
  assert.equal(portalChargeLevel(undefined, 1), 0);
  assert.equal(portalChargeLevel('prep', NaN), 0.55);

  for (const time of [0, 0.3, 0.7, 1.2, 2.4, 5]) {
    const level = portalChargeLevel('prep', time);
    assert.ok(level >= 0.37 && level <= 0.73, `充能强度越界：${level}`);
  }
  assert.equal(portalChargeLevel('prep', 0.6), portalChargeLevel('prep', 0.6), '必须确定性');
});

function makeCtx() {
  const counts = { arc: 0, lineTo: 0, fill: 0, stroke: 0, fillText: 0, setLineDash: 0 };
  const gradient = { addColorStop() {} };
  const ctx = {
    counts,
    globalAlpha: 1,
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() { counts.lineTo++; },
    arc() { counts.arc++; },
    ellipse() {},
    fill() { counts.fill++; },
    stroke() { counts.stroke++; },
    fillText() { counts.fillText++; },
    setLineDash() { counts.setLineDash++; },
    createRadialGradient() { return gradient; },
    createLinearGradient() { return gradient; },
  };
  return ctx;
}

test('传送门状态与渲染：编号/方向/充能齐全，低配绘制量少于高配', () => {
  const map = generateMap('render-visuals-portal');
  const game = {
    map,
    lanes: map.lanes,
    phase: 'prep',
    time: 0.4,
    activePortals: [],
    baseHp: 12,
    maxBaseHp: 20,
  };
  const renderer = new PortalRenderer(game);

  const states = renderer.states(0.4);
  assert.equal(states.length, map.spawns.length);
  states.forEach((state, index) => {
    assert.equal(state.index, index);
    assert.equal(state.label, index + 1);
    assert.equal(state.active, true);
    assert.equal(state.dimmed, false);
    assert.ok(state.charge > 0, '整备阶段应处于充能状态');
  });

  // 状态原地更新：重复调用不新建数组。
  assert.equal(renderer.states(0.5), states);

  game.phase = 'wave';
  game.activePortals = [0];
  const waveStates = renderer.states();
  assert.equal(waveStates[0].active, true);
  assert.equal(waveStates[0].charge, 1);
  if (waveStates.length > 1) {
    assert.equal(waveStates[1].active, false);
    assert.equal(waveStates[1].dimmed, true);
  }

  game.phase = 'prep';
  const lowCtx = makeCtx();
  renderer.render(lowCtx, 0.4, false);
  const highCtx = makeCtx();
  renderer.render(highCtx, 0.4, true);
  assert.ok(lowCtx.counts.arc > 0);
  assert.ok(highCtx.counts.arc > lowCtx.counts.arc, '高配应绘制更多环/粒子');
  assert.ok(highCtx.counts.lineTo > lowCtx.counts.lineTo, '高配方向尾迹更长');
  assert.equal(lowCtx.counts.fillText, map.spawns.length, '每个入口都有编号');
  assert.ok(lowCtx.counts.setLineDash > 0, '整备阶段绘制充能虚线预警');
});

test('源码级：渲染层只读模拟状态，不依赖模拟模块', () => {
  for (const source of [BACKGROUND_SRC, PORTAL_SRC]) {
    assert.doesNotMatch(source, /from\s+'\.\.\/sim\.js'/, '渲染层不得依赖模拟模块');
    assert.doesNotMatch(source, /sim\.(?:update|beginWave|spawnEnemy)\s*\(/, '不得驱动模拟');
    assert.doesNotMatch(
      source,
      /game\.(?:phase|baseHp|maxBaseHp|gold|enemies|towers|projectiles|wave)\s*=(?!=)/,
      '不得写回模拟状态'
    );
  }
  // 背景渲染器只允许创建一个离屏 canvas，不碰 DOM 查询/标记。
  assert.doesNotMatch(BACKGROUND_SRC, /querySelector|innerHTML/);
  assert.doesNotMatch(PORTAL_SRC, /document\.|querySelector|innerHTML/);
});

test('源码级：每帧渲染不新建粒子/状态对象，背景只烘焙一次', () => {
  const renderBody = PORTAL_SRC.slice(PORTAL_SRC.indexOf('  render(g, time, glowOn)'));
  assert.doesNotMatch(renderBody, /\.push\(/, 'render 内不得向数组追加');
  assert.doesNotMatch(renderBody, /new\s+[A-Z]/, 'render 内不得新建对象');
  assert.doesNotMatch(renderBody, /\.map\(|\.filter\(|Array\.from/, 'render 内不得批量分配');
  assert.match(PORTAL_SRC, /this\._states = this\.spawns\.map/, '状态对象只在构造期创建');
  assert.match(PORTAL_SRC, /portalSparkCount\(profile\)/, '粒子数必须经过上限函数');
  assert.match(PORTAL_SRC, /profile\.pulseAmp/, '呼吸脉冲幅度随档位变化');
  assert.match(PORTAL_SRC, /portalChargeLevel/, '充能预警走纯函数');

  assert.match(BACKGROUND_SRC, /ambientParticleBudget\(decor, scene\.particles\.max\)/);
  assert.match(BACKGROUND_SRC, /decorExclusion\(map\)/);
  // 背景在 build() 中烘焙，render.js 只 drawImage 这份离屏 canvas。
  assert.match(BACKGROUND_SRC, /return bg;/);
});

function runSim(quality) {
  const seed = 'render-visuals-determinism';
  const map = generateMap(seed);
  const sim = new Simulation({
    map,
    seed,
    difficulty: 'standard',
    gold: 300,
    baseHp: 20,
    maxBaseHp: 20,
    relics: [],
    towers: [],
    unlockedTowers: ['arrow'],
    onSave: () => {},
    onToast: () => {},
  });
  sim.setVisualQuality({ effects: quality, floaters: quality === 'full' ? 'all' : 'off' });
  const meta = map.meta || {};
  const def = generateWave(seed, 1, 'standard', {
    portalCount: meta.portalCount || 1,
    modifier: meta.modifier || null,
  });
  sim.beginWave(def);
  for (let i = 0; i < 600; i++) {
    sim.update(1 / 60);
    sim.updateVisuals(1 / 60);
  }
  return JSON.stringify({
    gold: Math.floor(sim.gold),
    baseHp: sim.baseHp,
    kills: sim.kills,
    phase: sim.phase,
    wave: sim.wave,
    enemies: sim.enemies.map((e) => [
      e.type,
      Math.round(e.hp * 1e6),
      e.x.toFixed(6),
      e.y.toFixed(6),
    ]),
  });
}

test('同种子同布局：低配/高配战斗状态哈希一致', () => {
  const full = runSim('full');
  const off = runSim('off');
  const light = runSim('light');
  assert.equal(off, full);
  assert.equal(light, full);
});

// ── 命中帧像素指标（Node 侧软件光栅）────────────────────────────────────────
// 浏览器采集（scripts/visual-check.mjs）量的是整帧指标：单只敌人只占 1440×900 的千分之一，
// 判定「锐利层是否还在、剪影有没有被洗掉」必须放大到单敌尺度。这里用最小光栅器把
// 真实的命中绘制函数（drawHitHighlight / drawSharpHitStar）画进 RgbaImage，
// 再复用 scripts/lib/visual-metrics.mjs 的剪影覆盖率与 ΔE 工具。
//
// 端到端记录（2026-10-28，combat 桌面指标帧；采集脚本 /tmp/hit-metrics/measure.mjs 与
// flash-isolate.mjs，跑法 `LANG=zh_CN.UTF-8 node <script> <checkout>`）：
//   3b8e1fd（评审 before，整身闪白 + 旧六芒星）：
//     合成帧剪影覆盖率 0.5989 · 受击层剪影覆盖率 0.5827 · 命中区边缘密度 0.2257 · 全画布 0.0346
//   6cb6e17（修复前 HEAD：整身闪白，武器命中没有星芒）：
//     合成帧剪影覆盖率 0.5987 · 命中区边缘密度 0.2218 · 全画布 0.0347
//   本任务（轮廓高光 + 恢复星芒）：
//     合成帧剪影覆盖率 0.5953 · 受击层剪影覆盖率 0.5832 · 命中区边缘密度 0.2443 · 全画布 0.0355
// 合成帧那 -0.0036 不是剪影被洗：受击层单独量是 0.5832 ≥ 0.5827；差异来自恢复的白星芒落在
// silhouetteCoverage 的 4px 背景采样环里，把局部背景估亮（该指标按包围盒外环估计背景）。
// 命中区边缘密度与全画布边缘密度都高于基线，说明锐利层确实回来了。

const FRAME = 96;
const FRAME_CENTER = FRAME / 2;
const HIT_VR = 24; // 命中帧里敌人的视觉半径（px）
const PATH_BG = [58, 46, 34];
const BODY_COLOR = [226, 96, 158];
const BODY_INNER = [148, 52, 104];

function frameRect() {
  return { x: 0, y: 0, width: FRAME, height: FRAME };
}

function hitBox() {
  const half = HIT_VR * 1.3;
  return { x: FRAME_CENTER - half, y: FRAME_CENTER - half, width: half * 2, height: half * 2 };
}

function setPixel(image, x, y, [r, g, b]) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const i = (y * image.width + x) * 4;
  image.data[i] = Math.round(r);
  image.data[i + 1] = Math.round(g);
  image.data[i + 2] = Math.round(b);
  image.data[i + 3] = 255;
}

function blendPixel(image, x, y, color, alpha) {
  const a = Math.max(0, Math.min(1, alpha * (color[3] ?? 1)));
  if (!(a > 0)) return;
  const [r, g, b] = image.pixel(x, y);
  setPixel(image, x, y, [r + (color[0] - r) * a, g + (color[1] - g) * a, b + (color[2] - b) * a]);
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function eachPixelInBounds(image, shape, fn) {
  const pad = (shape.width || 0) / 2 + 1;
  const radius = shape.type === 'circle' ? shape.r + pad : 0;
  const left = shape.type === 'circle' ? shape.x - radius : shape.bounds.minX - pad;
  const right = shape.type === 'circle' ? shape.x + radius : shape.bounds.maxX + pad;
  const top = shape.type === 'circle' ? shape.y - radius : shape.bounds.minY - pad;
  const bottom = shape.type === 'circle' ? shape.y + radius : shape.bounds.maxY + pad;
  for (let y = Math.max(0, Math.floor(top)); y <= Math.min(image.height - 1, Math.ceil(bottom)); y++) {
    for (let x = Math.max(0, Math.floor(left)); x <= Math.min(image.width - 1, Math.ceil(right)); x++) {
      fn(x, y);
    }
  }
}

function polyBounds(points) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Canvas 2D 的最小子集：整圆填充/描边、折线填充/描边（圆头）、平移、globalAlpha 混合。
// 被测绘制路径只用到这些操作；arc 只支持整圆（部分弧按折线近似）。
function createRasterFrame(width, height, background) {
  const image = new RgbaImage(width, height);
  fillRect(image, 0, 0, width, height, [...background, 255]);
  const stack = [];
  let state = { alpha: 1, lineWidth: 1, strokeStyle: '#ffffff', fillStyle: '#ffffff', tx: 0, ty: 0 };
  let shapes = [];
  let poly = null;

  const toShapePoly = (pts, closed) => {
    const shape = { type: 'poly', points: pts, closed, bounds: polyBounds(pts), width: state.lineWidth };
    return shape;
  };

  const ctx = {
    get globalAlpha() { return state.alpha; },
    set globalAlpha(value) { state.alpha = value; },
    get lineWidth() { return state.lineWidth; },
    set lineWidth(value) { state.lineWidth = value; },
    get strokeStyle() { return state.strokeStyle; },
    set strokeStyle(value) { state.strokeStyle = value; },
    get fillStyle() { return state.fillStyle; },
    set fillStyle(value) { state.fillStyle = value; },
    get lineCap() { return 'round'; },
    set lineCap(_value) {},
    save() { stack.push({ ...state }); },
    restore() { if (stack.length) state = stack.pop(); },
    translate(x, y) { state.tx += x; state.ty += y; },
    beginPath() { shapes = []; poly = null; },
    closePath() { if (poly) { poly.closed = true; poly.bounds = polyBounds(poly.points); } },
    moveTo(x, y) {
      poly = { type: 'poly', points: [[state.tx + x, state.ty + y]], closed: false };
      poly.bounds = polyBounds(poly.points);
      shapes.push(poly);
    },
    lineTo(x, y) {
      if (!poly) return this.moveTo(x, y);
      poly.points.push([state.tx + x, state.ty + y]);
      poly.bounds = polyBounds(poly.points);
    },
    arc(x, y, r, start = 0, end = Math.PI * 2) {
      const span = Math.abs(end - start);
      if (span >= Math.PI * 2 - 1e-6) {
        shapes.push({ type: 'circle', x: state.tx + x, y: state.ty + y, r });
        return;
      }
      const steps = 16;
      const points = [];
      for (let i = 0; i <= steps; i++) {
        const a = start + ((end - start) * i) / steps;
        points.push([state.tx + x + Math.cos(a) * r, state.ty + y + Math.sin(a) * r]);
      }
      const shape = toShapePoly(points, false);
      shapes.push(shape);
      poly = shape;
    },
    stroke() {
      const color = parseCssColor(state.strokeStyle);
      for (const shape of shapes) {
        if (shape.type === 'circle') {
          const half = state.lineWidth / 2;
          eachPixelInBounds(image, { ...shape, width: state.lineWidth }, (px, py) => {
            if (Math.abs(Math.hypot(px + 0.5 - shape.x, py + 0.5 - shape.y) - shape.r) <= half) {
              blendPixel(image, px, py, color, state.alpha);
            }
          });
        } else {
          const points = shape.closed ? [...shape.points, shape.points[0]] : shape.points;
          const half = state.lineWidth / 2;
          eachPixelInBounds(image, { ...shape, width: state.lineWidth }, (px, py) => {
            for (let i = 1; i < points.length; i++) {
              const [ax, ay] = points[i - 1];
              const [bx, by] = points[i];
              if (distanceToSegment(px + 0.5, py + 0.5, ax, ay, bx, by) <= half) {
                blendPixel(image, px, py, color, state.alpha);
                return;
              }
            }
          });
        }
      }
      shapes = [];
      poly = null;
    },
    fill() {
      const color = parseCssColor(state.fillStyle);
      for (const shape of shapes) {
        if (shape.type === 'circle') {
          eachPixelInBounds(image, shape, (px, py) => {
            if (Math.hypot(px + 0.5 - shape.x, py + 0.5 - shape.y) <= shape.r) {
              blendPixel(image, px, py, color, state.alpha);
            }
          });
        } else {
          eachPixelInBounds(image, shape, (px, py) => {
            if (pointInPolygon(px + 0.5, py + 0.5, shape.points)) blendPixel(image, px, py, color, state.alpha);
          });
        }
      }
      shapes = [];
      poly = null;
    },
  };

  return { ctx, image };
}

function css([r, g, b]) {
  return `rgb(${r}, ${g}, ${b})`;
}

// 3b8e1fd 的受击闪白：整身白圆（radius × 1.08、alpha 0.42）。回归基线逐字复刻，勿改。
function drawLegacyHitFlash(ctx, radius, alpha = 0.42) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(0, 0, radius * 1.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

// 命中帧：同一只敌人（主色 + 体内暗部，用来标定「内部层次是否被洗掉」）+ 命中层。
function renderHitFrame({ flash = 'current', fade = 0.8, p = 0.5 } = {}) {
  const { ctx, image } = createRasterFrame(FRAME, FRAME, PATH_BG);
  ctx.translate(FRAME_CENTER, FRAME_CENTER);
  ctx.fillStyle = css(BODY_COLOR);
  ctx.beginPath();
  ctx.arc(0, 0, HIT_VR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = css(BODY_INNER);
  ctx.beginPath();
  ctx.arc(-HIT_VR * 0.12, -HIT_VR * 0.1, HIT_VR * 0.6, 0, Math.PI * 2);
  ctx.fill();
  if (flash === 'legacy') drawLegacyHitFlash(ctx, HIT_VR);
  if (flash === 'current') {
    drawHitHighlight(ctx, {
      radius: HIT_VR,
      alpha: fade,
      scale: ENEMY_ANIM_VARIANTS.full.hitFlash.radius,
    });
  }
  if (flash !== 'none') drawSharpHitStar(ctx, 0, 0, p, fade);
  return image;
}

// 锐利高频边缘：4 邻域最大亮度梯度超过阈值的像素占比（命中区的「切分感」标尺）。
function edgeDensity(image, rect, threshold = 18) {
  const area = image.clippedRect(rect.x, rect.y, rect.width, rect.height);
  let edges = 0;
  let total = 0;
  for (let y = area.y; y < area.y + area.height - 1; y++) {
    for (let x = area.x; x < area.x + area.width - 1; x++) {
      const [r, g, b] = image.pixel(x, y);
      const c = luma([r, g, b]);
      const [r2, g2, b2] = image.pixel(x + 1, y);
      const [r3, g3, b3] = image.pixel(x, y + 1);
      const gradient = Math.max(Math.abs(luma([r2, g2, b2]) - c), Math.abs(luma([r3, g3, b3]) - c));
      total++;
      if (gradient > threshold) edges++;
    }
  }
  return total ? edges / total : 0;
}

// 剪影内部保真：命中帧与未命中帧在内部圆内的平均 ΔE。越大 = 剪影被洗得越狠。
function interiorDeltaE(image, clean, radius = HIT_VR * 0.55) {
  let sum = 0;
  let count = 0;
  for (let y = 0; y < FRAME; y++) {
    for (let x = 0; x < FRAME; x++) {
      if (Math.hypot(x + 0.5 - FRAME_CENTER, y + 0.5 - FRAME_CENTER) > radius) continue;
      const a = image.pixel(x, y).slice(0, 3);
      const b = clean.pixel(x, y).slice(0, 3);
      sum += deltaE(a, b);
      count++;
    }
  }
  return count ? sum / count : 0;
}

test('命中帧：轮廓高光保留剪影，锐利边缘层不低于整身闪白基线', (t) => {
  const clean = renderHitFrame({ flash: 'none' });
  const baseline = renderHitFrame({ flash: 'legacy' }); // 3b8e1fd
  const current = renderHitFrame({ flash: 'current' });
  const box = hitBox();

  const silhouette = {
    baseline: silhouetteCoverage(baseline, [box]).meanCoverage,
    current: silhouetteCoverage(current, [box]).meanCoverage,
  };
  const edges = {
    baseline: edgeDensity(baseline, box),
    current: edgeDensity(current, box),
  };
  const wash = {
    baseline: interiorDeltaE(baseline, clean),
    current: interiorDeltaE(current, clean),
  };
  t.diagnostic(
    `剪影覆盖率 基线=${silhouette.baseline.toFixed(4)} 当前=${silhouette.current.toFixed(4)}；` +
      `锐利边缘密度 基线=${edges.baseline.toFixed(4)} 当前=${edges.current.toFixed(4)}；` +
      `内部 ΔE 基线=${wash.baseline.toFixed(2)} 当前=${wash.current.toFixed(2)}`
  );

  assert.ok(
    silhouette.current >= silhouette.baseline,
    `命中帧剪影覆盖率不得低于基线：${silhouette.current.toFixed(4)} < ${silhouette.baseline.toFixed(4)}`
  );
  assert.ok(
    edges.current >= edges.baseline,
    `命中帧锐利边缘层不得低于基线：${edges.current.toFixed(4)} < ${edges.baseline.toFixed(4)}`
  );
  assert.ok(
    wash.current <= wash.baseline * 0.5,
    `受击不该把剪影内部洗掉：内部 ΔE ${wash.current.toFixed(2)} 应显著低于基线 ${wash.baseline.toFixed(2)}`
  );
});

test('命中高光：强度沿用 0.08s 闪白窗口，窗口外不绘制', () => {
  const full = ENEMY_ANIM_VARIANTS.full;
  // 几何契约：高光能量在边缘（外沿细环在主环之外、主环比内侧环粗），内部只留细环与核。
  assert.ok(HIT_HIGHLIGHT.haloScale > 1, '外沿细环必须落在剪影之外');
  assert.ok(HIT_HIGHLIGHT.innerScale < 1, '内侧细环必须在剪影之内');
  assert.ok(HIT_HIGHLIGHT.rimWidth > HIT_HIGHLIGHT.innerWidth * 2, '高光重心必须在轮廓而不是内部');

  assert.ok(hitHighlightAlpha(1, full) > hitHighlightAlpha(0.5, full), '剩余量越大高光越强');
  assert.ok(hitHighlightAlpha(1, full) > 0);
  // 窗口 = duration × decay = 0.32：衰减到 0.68 以下即不再高光（与旧闪白同一窗口）。
  const cutoff = 1 - Math.min(1, full.hitFlash.duration * full.hitFlash.decay);
  assert.equal(hitHighlightAlpha(cutoff, full), 0, '窗口外的尾段不再高光');
  assert.equal(hitHighlightAlpha(1, ENEMY_ANIM_VARIANTS.off), 0, '关闭档不绘制高光');

  const { ctx } = createRasterFrame(32, 32, PATH_BG);
  assert.equal(drawHitHighlight(ctx, { radius: HIT_VR, alpha: 0 }), false);
  assert.equal(drawHitHighlight(ctx, { radius: 0, alpha: 1 }), false);
  assert.equal(drawHitHighlight(ctx, { radius: HIT_VR, alpha: 0.5 }), true);
});

test('reduced-motion 下命中仍有非运动反馈（固定帧见证 + 源码无运动分支）', (t) => {
  const budget = resolveMotionBudget({ shake: true, decorations: 'full' }, { reducedMotion: true });
  assert.equal(budget.flashScale, 1, '运动降级不得关闭命中高光');

  // 命中层不接运动预算：两种设置下是同一帧（同一份绘制代码、同一几何），
  // 且与未命中帧的差异证明它确实在画面上。
  const hit = renderHitFrame({ flash: 'current' });
  const clean = renderHitFrame({ flash: 'none' });
  const visible = differenceStats(hit, clean, 8, frameRect()).changed;
  t.diagnostic(`reduced-motion 固定帧：命中层改写像素 ${visible} 个（未命中帧 ${FRAME * FRAME} 像素）`);
  assert.ok(visible > 200, `命中层在 reduced-motion 下必须可见，实际改写 ${visible} 像素`);
  assert.notEqual(pixelHash(hit), pixelHash(clean));

  const enemySource = fs.readFileSync(
    new URL('../public/js/render/enemy-renderer.js', import.meta.url),
    'utf8'
  );
  const effectSource = fs.readFileSync(
    new URL('../public/js/render/effect-renderer.js', import.meta.url),
    'utf8'
  );
  const highlightBody = enemySource.slice(
    enemySource.indexOf('export function drawHitHighlight'),
    enemySource.indexOf('export class EnemyRenderer')
  );
  const starBody = effectSource.slice(
    effectSource.indexOf('export function drawSharpHitStar'),
    effectSource.indexOf('// 返回 { p, fade }')
  );
  for (const [name, body] of [['受击高光', highlightBody], ['命中星芒', starBody]]) {
    assert.ok(body.length > 0, `${name}实现缺失`);
    assert.doesNotMatch(body, /reducedMotion|motion|shake/i, `${name}不得因运动降级而关闭`);
  }
});

test('命中星芒：六向锐利线 + 白色核，不随画质削减（识别性保底层）', () => {
  assert.equal(SHARP_HIT_STAR.rays, 6);
  const { ctx, image } = createRasterFrame(FRAME, FRAME, PATH_BG);
  const blank = createRasterFrame(FRAME, FRAME, PATH_BG).image;
  assert.equal(drawSharpHitStar(ctx, FRAME_CENTER, FRAME_CENTER, 0.5, 1), 6, '每颗星 6 条射线');
  const box = { x: FRAME_CENTER - 20, y: FRAME_CENTER - 20, width: 40, height: 40 };
  const painted = differenceStats(image, blank, 8, frameRect()).changed;
  assert.ok(painted > 100, `星芒必须实际落笔（改写 ${painted} 像素）`);
  assert.ok(edgeDensity(image, box) > 0.04, '星芒必须留下锐利高频边缘');
  // 星芒是识别性保底层：绘制签名不带画质档位（档位只作用于武器形态与粒子预算）。
  const source = fs.readFileSync(
    new URL('../public/js/render/effect-renderer.js', import.meta.url),
    'utf8'
  );
  const signature = source.slice(
    source.indexOf('export function drawSharpHitStar'),
    source.indexOf('// 事件对象上的 weapon 决定命中签名')
  );
  assert.doesNotMatch(signature, /profile|tier|particleScale/, '星芒不得随画质档位削减');
  assert.match(source, /drawSharpHitStar\(g, x, y, p, fade, \{ color: variant\.accent \}\)/);
});

