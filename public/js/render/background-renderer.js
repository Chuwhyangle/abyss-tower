// 静态背景烘焙：草地、网格、路径、岩石、生物群系地表道具、氛围光点与暗角。
// 只在构造/画质变更时执行，结果是一张离屏 canvas。
import { TILE } from '../shared/data.js';
import { RNG } from '../shared/rng.js';
import { Palette } from './palette.js';

const T = TILE;

// 背景分层顺序（绘制从远到近）。背景只在构造/画质变更时烘焙一次，不进入每帧循环。
export const BACKGROUND_LAYERS = Object.freeze(['far', 'mist', 'ground', 'decor', 'particles']);

// 每个生物群系一套分层定义；颜色仍来自 palette.js，这里只声明层次与预算。
export const BIOME_SCENES = Object.freeze({
  canyon: Object.freeze({
    motif: 'mesa',
    far: Object.freeze({ bands: 3, alpha: 0.05, tilt: 0.18 }),
    mist: Object.freeze({ patches: 4, alpha: 0.035, size: 0.2 }),
    ground: Object.freeze({ moss: 0.12 }),
    decor: Object.freeze({ prop: 'bones', density: 0.55 }),
    particles: Object.freeze({ max: 64, drift: 0.6, size: 2.2 }),
  }),
  twin: Object.freeze({
    motif: 'wetland',
    far: Object.freeze({ bands: 4, alpha: 0.055, tilt: 0.12 }),
    mist: Object.freeze({ patches: 6, alpha: 0.05, size: 0.26 }),
    ground: Object.freeze({ moss: 0.2 }),
    decor: Object.freeze({ prop: 'reed', density: 0.6 }),
    particles: Object.freeze({ max: 72, drift: 0.8, size: 2.4 }),
  }),
  triple: Object.freeze({
    motif: 'rift',
    far: Object.freeze({ bands: 3, alpha: 0.06, tilt: 0.24 }),
    mist: Object.freeze({ patches: 3, alpha: 0.03, size: 0.18 }),
    ground: Object.freeze({ moss: 0.06 }),
    decor: Object.freeze({ prop: 'crack', density: 0.6 }),
    particles: Object.freeze({ max: 58, drift: 0.45, size: 2 }),
  }),
  ring: Object.freeze({
    motif: 'runes',
    far: Object.freeze({ bands: 4, alpha: 0.05, tilt: 0.08 }),
    mist: Object.freeze({ patches: 5, alpha: 0.04, size: 0.24 }),
    ground: Object.freeze({ moss: 0.1 }),
    decor: Object.freeze({ prop: 'rune', density: 0.5 }),
    particles: Object.freeze({ max: 68, drift: 0.7, size: 2.2 }),
  }),
  cross: Object.freeze({
    motif: 'ruins',
    far: Object.freeze({ bands: 3, alpha: 0.045, tilt: 0.2 }),
    mist: Object.freeze({ patches: 4, alpha: 0.032, size: 0.22 }),
    ground: Object.freeze({ moss: 0.08 }),
    decor: Object.freeze({ prop: 'pillar', density: 0.55 }),
    particles: Object.freeze({ max: 60, drift: 0.55, size: 2.1 }),
  }),
  // 第六套：风蚀石林（折返长廊）。冷蓝灰基调，与既有五套的绿/青/红/紫/金明确区分。
  switchback: Object.freeze({
    motif: 'highland',
    far: Object.freeze({ bands: 4, alpha: 0.05, tilt: 0.14 }),
    mist: Object.freeze({ patches: 3, alpha: 0.028, size: 0.2 }),
    ground: Object.freeze({ moss: 0.14 }),
    decor: Object.freeze({ prop: 'slab', density: 0.58 }),
    particles: Object.freeze({ max: 66, drift: 0.5, size: 2.3 }),
    transition: Object.freeze({ bands: 2, alpha: 0.045, spread: 1.7 }),
  }),
});

export function biomeScene(map) {
  return BIOME_SCENES[map?.archetype] || BIOME_SCENES.canyon;
}

export const SIXTH_BIOME = 'switchback';

// 区域过渡默认规格：区域边界处一条低透明度渐变带；场景可覆盖或关闭（bands: 0）。
export const REGION_TRANSITION = Object.freeze({ bands: 1, alpha: 0.05, spread: 1.8 });

export function sceneTransition(scene) {
  return scene?.transition || REGION_TRANSITION;
}

// 过渡带：只在 full 画质生成，位置按地图列数均分；透明度上限保证路径与塔位对比度。
export function regionTransitionBands(map, scene, decorations = 'full') {
  if (decorations !== 'full') return [];
  const spec = sceneTransition(scene);
  const cols = Math.floor(Number(map?.cols) || 0);
  const bands = Math.floor(Number(spec.bands) || 0);
  if (cols < 6 || bands <= 0) return [];
  const out = [];
  for (let i = 1; i <= bands; i++) {
    out.push({ x: (cols * i) / (bands + 1), spread: spec.spread, alpha: spec.alpha });
  }
  return out;
}

// 第六套群系的调色板作为覆盖层内联在渲染层，避免改动 palette.js 的既有五套定义。
export const BIOME_PALETTE_OVERRIDES = Object.freeze({
  switchback: Object.freeze({
    grass1: '#1b2231', grass2: '#161d29', grid: 'rgba(140, 170, 230, 0.05)',
    pathEdge: '#141926', path: '#283041', pathInner: '#39445a',
    pathLine: 'rgba(180, 205, 255, 0.22)', tuft: '130, 155, 200',
    rock: '#47536b', rockEdge: '#71819e', accent: '#93b8ff', ambient: 'rgba(140, 175, 255, ',
  }),
});

export function biomeVisualPalette(map, base) {
  const override = BIOME_PALETTE_OVERRIDES[map?.archetype];
  return override ? Object.freeze({ ...base, ...override }) : base;
}

// 环境粒子预算：低配约为高配的 35%，off 为 0，未知档位回退低配；数量永不超过场景上限。
export function ambientParticleBudget(decorations, maxCount) {
  const cap = Number.isFinite(maxCount) ? Math.floor(maxCount) : 0;
  if (cap <= 0 || decorations === 'off') return 0;
  if (decorations === 'full') return cap;
  return Math.max(1, Math.round(cap * 0.35));
}

// 天气层：雨/雾/流星雨。天气与时段只由地图词缀/种子派生，不新增模拟状态。
export const WEATHER_TYPES = Object.freeze({
  rain: Object.freeze({
    id: 'rain', name: '降雨', max: 64, size: 2.2, speed: 1.2, drift: 0.9,
    angle: 0.32, alpha: 0.22, color: '#9fc7ff',
  }),
  fog: Object.freeze({
    id: 'fog', name: '浓雾', max: 10, size: 3.2, speed: 0.15, drift: 0.3,
    angle: 0, alpha: 0.06, color: '#cfd8e3',
  }),
  meteor: Object.freeze({
    id: 'meteor', name: '流星雨', max: 14, size: 2.6, speed: 1.8, drift: 0.6,
    angle: -0.85, alpha: 0.26, color: '#ffd9a0',
  }),
});
export const WEATHER_IDS = Object.freeze(Object.keys(WEATHER_TYPES));

// 词缀 → 天气/时段：显式映射优先，其余按种子稳定派生。
const WEATHER_BY_MODIFIER = Object.freeze({
  mist: 'fog', dusk: 'fog', starlit: 'meteor', swift: 'rain', surge: 'rain', rift: 'meteor',
});
const PHASE_BY_MODIFIER = Object.freeze({
  mist: 'dawn', dusk: 'dusk', starlit: 'night', rift: 'dusk', surge: 'day',
});

// 昼夜色调：全屏低透明度叠加，alpha 上限 0.08，路径与单位轮廓仍然最清晰。
export const DAY_PHASES = Object.freeze({
  dawn: Object.freeze({ id: 'dawn', name: '黎明', color: '255, 190, 140', alpha: 0.05 }),
  day: Object.freeze({ id: 'day', name: '白昼', color: '255, 244, 210', alpha: 0.02 }),
  dusk: Object.freeze({ id: 'dusk', name: '黄昏', color: '255, 150, 110', alpha: 0.07 }),
  night: Object.freeze({ id: 'night', name: '夜晚', color: '70, 100, 170', alpha: 0.08 }),
});
export const DAY_PHASE_IDS = Object.freeze(Object.keys(DAY_PHASES));

export function modifierIdOf(mapMeta) {
  const modifier = mapMeta?.modifier;
  return (typeof modifier === 'string' ? modifier : modifier?.id) || null;
}

// 同种子完全确定：词缀优先，未知/缺省时用独立 RNG 派生，不触碰背景烘焙的 RNG 序列。
export function weatherFor(mapMeta, seed) {
  const id = modifierIdOf(mapMeta);
  if (id && WEATHER_BY_MODIFIER[id]) return WEATHER_BY_MODIFIER[id];
  const rng = new RNG(`${seed ?? 'weather'}:weather`);
  return WEATHER_IDS[rng.int(WEATHER_IDS.length)];
}

export function timeOfDayFor(mapMeta, seed) {
  const id = modifierIdOf(mapMeta);
  if (id && PHASE_BY_MODIFIER[id]) return PHASE_BY_MODIFIER[id];
  const rng = new RNG(`${seed ?? 'weather'}:phase`);
  return DAY_PHASE_IDS[rng.int(DAY_PHASE_IDS.length)];
}

// 天气粒子预算：off 为 0（低配可完全关闭），light 约 40%，full 到场景上限。
export function weatherParticleBudget(decorations, maxCount) {
  const cap = Number.isFinite(maxCount) ? Math.floor(maxCount) : 0;
  if (cap <= 0 || decorations === 'off') return 0;
  if (decorations === 'full') return cap;
  return Math.max(1, Math.round(cap * 0.4));
}

// 一次烘焙所需的完整天气规格：调用方只传地图元数据/种子，不接触模拟状态。
export function weatherLayer(mapMeta, seed, decorations = 'full') {
  const weather = weatherFor(mapMeta, seed);
  const phase = timeOfDayFor(mapMeta, seed);
  return {
    weather,
    phase,
    tint: DAY_PHASES[phase],
    particles: weatherParticleBudget(decorations, WEATHER_TYPES[weather].max),
  };
}

// 装饰排除区：路径格及其一圈相邻格不放置地表道具，保证路线与塔位清晰。
export function decorExclusion(map) {
  const excluded = new Set();
  const rows = map.rows;
  for (const cell of map.pathCells || []) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const c = cell.c + dc;
        const r = cell.r + dr;
        if (c >= 0 && c < map.cols && r >= 0 && r < rows) excluded.add(c * rows + r);
      }
    }
  }
  return excluded;
}

export class BackgroundRenderer {
  constructor(game) {
    this.game = game;
  }

  build({ width, height, dpr, palette, settings }) {
    const game = this.game;
    const map = game.map;
    const bg = document.createElement('canvas');
    bg.width = Math.round(width * dpr);
    bg.height = Math.round(height * dpr);
    const g = bg.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rng = new RNG(game.seed + ':bg');
    const decor = settings.decorations;
    const scene = biomeScene(map);
    const tuftCount = decor === 'off' ? 0 : decor === 'light' ? 90 : 260;
    const pebbleCount = decor === 'off' ? 0 : decor === 'light' ? 60 : 170;
    const chevronStep = decor === 'off' ? Infinity : decor === 'light' ? 4.2 : 2.4;
    const excluded = decorExclusion(map);

    const P = biomeVisualPalette(map, palette);
    g.fillStyle = P.grass2;
    g.fillRect(0, 0, width, height);

    // 草地：色块 + 细微噪声 + 苔藓斑
    for (let r = 0; r < map.rows; r++) {
      for (let c = 0; c < map.cols; c++) {
        g.fillStyle = (c + r) % 2 === 0 ? P.grass1 : P.grass2;
        g.fillRect(c * T, r * T, T, T);
        g.fillStyle = `rgba(255,255,255,${rng.float() * 0.014})`;
        g.fillRect(c * T, r * T, T, T);
        if (rng.float() < scene.ground.moss) {
          g.fillStyle = `rgba(${P.tuft},${0.025 + rng.float() * 0.035})`;
          g.beginPath();
          g.ellipse(
            c * T + rng.range(8, T - 8),
            r * T + rng.range(8, T - 8),
            rng.range(8, 18),
            rng.range(5, 12),
            rng.float() * 3,
            0,
            Math.PI * 2
          );
          g.fill();
        }
      }
    }

    // 远景/雾霭层：低对比度叠在地面之上，路径与装饰随后绘制，保证路线始终最清晰。
    this.drawDepthLayers(g, width, height, P, scene, rng);

    // 区域过渡带：可选的低对比度渐变，随后被网格与路径覆盖，不遮挡路线与塔位。
    this.drawRegionTransitions(g, width, height, P, scene, decor);

    // 细网格
    g.strokeStyle = P.grid;
    g.lineWidth = 1;
    for (let c = 1; c < map.cols; c++) {
      g.beginPath();
      g.moveTo(c * T + 0.5, 0);
      g.lineTo(c * T + 0.5, height);
      g.stroke();
    }
    for (let r = 1; r < map.rows; r++) {
      g.beginPath();
      g.moveTo(0, r * T + 0.5);
      g.lineTo(width, r * T + 0.5);
      g.stroke();
    }

    // 草簇
    for (let i = 0; i < tuftCount; i++) {
      const c = rng.int(map.cols);
      const r = rng.int(map.rows);
      if (!map.buildable[r][c]) continue;
      const x = c * T + rng.range(6, T - 6);
      const y = r * T + rng.range(6, T - 6);
      g.strokeStyle = `rgba(${P.tuft}, ${0.1 + rng.float() * 0.16})`;
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(x, y + 4);
      g.lineTo(x + rng.range(-3, 3), y - rng.range(2, 7));
      g.stroke();
      g.beginPath();
      g.moveTo(x, y + 4);
      g.lineTo(x + rng.range(-4, 4), y - rng.range(1, 5));
      g.stroke();
    }

    // 路径：逐条绘制；共享汇流段会重叠，颜色保持一致
    const lanes = game.lanes.length
      ? game.lanes
      : [{ pts: map.polyline, len: game.pathLen, color: '#5ce2d0' }];
    const strokePath = (pts, w, color) => {
      g.strokeStyle = color;
      g.lineWidth = w;
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.beginPath();
      pts.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
      g.stroke();
    };

    lanes.forEach((lane, laneIndex) => {
      const pts = lane.pts.map((p) => ({ x: p.x * T, y: p.y * T }));
      strokePath(pts, T * 0.94, 'rgba(0,0,0,0.42)');
      strokePath(pts, T * 0.84, P.pathEdge);
      strokePath(pts, T * 0.7, P.path);
      strokePath(pts, T * 0.54, P.pathInner);
      g.save();
      g.globalAlpha = 0.55;
      strokePath(pts, 2.4, P.pathLine);
      g.restore();
      // 多入口时用细线区分路线
      if (lanes.length > 1) {
        g.save();
        g.globalAlpha = 0.3;
        strokePath(pts, 2.2, lane.color);
        g.restore();
      }

      // 路缘石
      if (decor !== 'off') {
        const step = decor === 'light' ? 3.2 : 1.7;
        for (let d = 1; d < lane.len - 0.8; d += step) {
          const p = game.posAt(d, laneIndex);
          const side = rng.float() < 0.5 ? -1 : 1;
          const px = p.x * T + Math.cos(p.angle + Math.PI / 2) * side * T * 0.38;
          const py = p.y * T + Math.sin(p.angle + Math.PI / 2) * side * T * 0.38;
          g.fillStyle = `rgba(${P.tuft},${0.18 + rng.float() * 0.16})`;
          g.beginPath();
          g.ellipse(px, py, rng.range(1.2, 2.8), rng.range(1, 2.2), rng.float() * 3, 0, Math.PI * 2);
          g.fill();
        }
      }

      // 路面碎石
      const pebbles = Math.ceil(pebbleCount / lanes.length);
      for (let i = 0; i < pebbles; i++) {
        const d = rng.float() * lane.len;
        const p = game.posAt(d, laneIndex);
        const ox = rng.range(-0.24, 0.24) * T;
        const oy = rng.range(-0.24, 0.24) * T;
        g.fillStyle = Palette.hexToRgba(P.rockEdge, 0.12 + rng.float() * 0.18);
        g.beginPath();
        g.ellipse(p.x * T + ox, p.y * T + oy, rng.range(1, 3.2), rng.range(0.8, 2.2), rng.float() * 3, 0, Math.PI * 2);
        g.fill();
      }

      // 行进方向箭头
      for (let d = 1.6; d < lane.len - 1; d += chevronStep) {
        const p = game.posAt(d, laneIndex);
        g.save();
        g.translate(p.x * T, p.y * T);
        g.rotate(p.angle);
        g.strokeStyle = 'rgba(196, 168, 126, 0.16)';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(-4, -6);
        g.lineTo(3, 0);
        g.lineTo(-4, 6);
        g.stroke();
        g.restore();
      }
    });

    // 岩石
    for (const rock of map.rocks) {
      const x = (rock.c + 0.5) * T;
      const y = (rock.r + 0.5) * T;
      const s = rock.size * T;
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.beginPath();
      g.ellipse(x, y + s * 0.35, s * 0.9, s * 0.4, 0, 0, Math.PI * 2);
      g.fill();
      g.save();
      g.translate(x, y);
      g.rotate(rock.rot);
      g.fillStyle = P.rock;
      g.strokeStyle = P.rockEdge;
      g.lineWidth = 1.5;
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const rad = s * (i % 2 === 0 ? 1 : 0.78);
        const px = Math.cos(a) * rad;
        const py = Math.sin(a) * rad * 0.85;
        i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
      }
      g.closePath();
      g.fill();
      g.stroke();
      // 苔藓/高光
      g.fillStyle = Palette.hexToRgba(P.accent, 0.14);
      g.beginPath();
      g.ellipse(-s * 0.15, -s * 0.3, s * 0.45, s * 0.2, -0.4, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }

    // 生物群系地表遗迹：不同原型各自的氛围道具
    if (decor !== 'off') this.drawBiomeProps(g, map, P, rng, decor, excluded);

    // 生物群系氛围光点：数量由场景上限与画质档位共同约束（低配约 35%）。
    const motes = ambientParticleBudget(decor, scene.particles.max);
    for (let i = 0; i < motes; i++) {
      const x = rng.float() * width;
      const y = rng.float() * height;
      g.fillStyle = `${P.ambient}${0.035 + rng.float() * 0.06})`;
      g.beginPath();
      g.arc(x, y, rng.range(0.8, scene.particles.size), 0, Math.PI * 2);
      g.fill();
    }

    // 昼夜色调 + 天气层：只读地图元数据/种子；粒子排除路径格，不遮挡路线与敌人轮廓。
    const meta = game.mapMeta || map.meta || {};
    const weatherSeed = game.seed ?? map.seed;
    const weather = weatherLayer(meta, weatherSeed, decor);
    this.drawDayNightTint(g, width, height, weather.tint);
    if (weather.particles > 0) {
      // 独立 RNG：天气粒子的随机序列不改变既有背景烘焙的取数顺序。
      this.drawWeather(g, width, height, map, P, new RNG(`${weatherSeed}:${weather.weather}`), weather, excluded);
    }

    // 边缘暗角
    const vignette = g.createRadialGradient(
      width / 2,
      height / 2,
      Math.min(width, height) * 0.35,
      width / 2,
      height / 2,
      Math.max(width, height) * 0.72
    );
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.5)');
    g.fillStyle = vignette;
    g.fillRect(0, 0, width, height);

    return bg;
  }

  // 远景山脊 + 雾霭：每层透明度不同，形成静态视差纵深；不覆盖路径与塔位。
  drawDepthLayers(g, width, height, P, scene, rng) {
    const { far, mist } = scene;

    const sky = g.createLinearGradient(0, 0, 0, height * 0.62);
    sky.addColorStop(0, Palette.hexToRgba(P.grass2, Math.min(0.82, 0.5 + far.alpha * 5)));
    sky.addColorStop(1, Palette.hexToRgba(P.grass2, 0));
    g.fillStyle = sky;
    g.fillRect(0, 0, width, height * 0.62);

    const steps = 12;
    for (let band = 0; band < far.bands; band++) {
      const baseY = height * (0.08 + band * 0.11);
      const amp = height * (0.015 + band * 0.007);
      const alpha = far.alpha * (1 - band * 0.16);
      g.fillStyle = Palette.hexToRgba(P.accent, alpha);
      g.beginPath();
      g.moveTo(0, baseY);
      for (let i = 0; i <= steps; i++) {
        const x = (i / steps) * width;
        const y =
          baseY +
          Math.sin(i * 1.7 + band * 2.3 + rng.float() * 0.6) * amp +
          far.tilt * height * 0.015 * (i / steps - 0.5);
        g.lineTo(x, y);
      }
      g.lineTo(width, baseY + height * 0.2);
      g.lineTo(0, baseY + height * 0.2);
      g.closePath();
      g.fill();
    }

    for (let i = 0; i < mist.patches; i++) {
      const x = rng.float() * width;
      const y = height * (0.22 + rng.float() * 0.56);
      const rx = width * mist.size * (0.5 + rng.float() * 0.7);
      const ry = rx * (0.26 + rng.float() * 0.22);
      g.fillStyle = Palette.hexToRgba(P.accent, mist.alpha * (0.6 + rng.float() * 0.8));
      g.beginPath();
      g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      g.fill();
    }
  }

  // 区域过渡带：在区域边界处用低透明度渐变衔接地表氛围，仅高画质绘制。
  drawRegionTransitions(g, width, height, P, scene, decorations) {
    const bands = regionTransitionBands(this.game.map, scene, decorations);
    if (!bands.length) return;
    const cell = width / this.game.map.cols;
    for (const band of bands) {
      const cx = band.x * cell;
      const half = band.spread * cell;
      const grad = g.createLinearGradient(cx - half, 0, cx + half, 0);
      grad.addColorStop(0, Palette.hexToRgba(P.accent, 0));
      grad.addColorStop(0.5, Palette.hexToRgba(P.accent, band.alpha));
      grad.addColorStop(1, Palette.hexToRgba(P.accent, 0));
      g.fillStyle = grad;
      g.fillRect(cx - half, 0, half * 2, height);
    }
  }

  // 昼夜色调：全屏低透明度叠加，路径与单位轮廓对比不被压低。
  drawDayNightTint(g, width, height, phase) {
    const tint = phase || DAY_PHASES.day;
    g.fillStyle = `rgba(${tint.color}, ${tint.alpha})`;
    g.fillRect(0, 0, width, height);
  }

  // 天气粒子：只落在路径/塔位排除区之外，且数量受画质预算约束（off 时不绘制）。
  drawWeather(g, width, height, map, P, rng, spec, excluded) {
    const def = WEATHER_TYPES[spec.weather] || WEATHER_TYPES.rain;
    const count = spec.particles;
    const cols = Math.floor(Number(map?.cols) || 0);
    const rows = Math.floor(Number(map?.rows) || 0);
    if (count <= 0 || cols <= 0 || rows <= 0) return;

    const cellW = width / cols;
    const cellH = height / rows;
    const dropColor = def.color || P.accent;

    for (let i = 0; i < count; i++) {
      const c = rng.int(cols);
      const r = rng.int(rows);
      // 路径及其相邻格不放天气粒子，保证路线与敌人轮廓清晰。
      if (excluded?.has(c * rows + r)) continue;
      const x = (c + rng.float()) * cellW;
      const y = (r + rng.float()) * cellH;

      if (spec.weather === 'fog') {
        const rx = cellW * def.size * (0.5 + rng.float() * 0.6);
        const ry = rx * (0.28 + rng.float() * 0.22);
        g.fillStyle = Palette.hexToRgba(dropColor, def.alpha * (0.5 + rng.float() * 0.5));
        g.beginPath();
        g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
        g.fill();
        continue;
      }

      const length = def.size * (spec.weather === 'meteor' ? 7 : 5);
      const dx = Math.cos(def.angle) * length;
      const dy = Math.sin(def.angle) * length;
      g.strokeStyle = Palette.hexToRgba(dropColor, def.alpha * (0.55 + rng.float() * 0.45));
      g.lineWidth = spec.weather === 'meteor' ? def.size * 0.9 : def.size * 0.55;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + dx, y + dy);
      g.stroke();
    }
    g.lineCap = 'butt';
  }

  // 生物群系地表道具：只画低对比度地贴，塔与单位仍是最清晰的层次。
  drawBiomeProps(g, map, P, rng, decor, excluded) {
    const arch = map.archetype || 'canyon';
    const count = decor === 'light' ? 6 : 14;

    for (let i = 0; i < count; i++) {
      const c = rng.int(map.cols);
      const r = rng.int(map.rows);
      if (!map.buildable?.[r]?.[c]) continue;
      // 路径与其相邻格不放置地贴，避免挡住路线和塔位。
      if (excluded?.has(c * map.rows + r)) continue;
      const x = c * T + rng.range(0.25, 0.75) * T;
      const y = r * T + rng.range(0.25, 0.75) * T;

      if (arch === 'twin') {
        // 潮湿洼地 + 芦苇
        const rx = rng.range(10, 18);
        const ry = rng.range(5, 9);
        g.fillStyle = Palette.hexToRgba(P.accent, 0.09);
        g.beginPath();
        g.ellipse(x, y, rx, ry, rng.float() * 0.6, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = Palette.hexToRgba(P.accent, 0.16);
        g.lineWidth = 1;
        g.stroke();
        g.strokeStyle = Palette.hexToRgba(P.tuft, 0.22);
        g.lineWidth = 1.2;
        for (let j = 0; j < 3; j++) {
          const bx = x + rng.range(-rx * 0.7, rx * 0.7);
          g.beginPath();
          g.moveTo(bx, y + ry * 0.6);
          g.lineTo(bx + rng.range(-2, 2), y - rng.range(6, 12));
          g.stroke();
        }
      } else if (arch === 'triple') {
        // 地裂与余烬
        g.strokeStyle = 'rgba(24, 12, 10, 0.55)';
        g.lineWidth = 2;
        g.beginPath();
        let px = x - rng.range(8, 14);
        let py = y + rng.range(-4, 4);
        g.moveTo(px, py);
        for (let j = 0; j < 4; j++) {
          px += rng.range(5, 9);
          py += rng.range(-5, 5);
          g.lineTo(px, py);
        }
        g.stroke();
        g.strokeStyle = Palette.hexToRgba(P.accent, 0.28);
        g.lineWidth = 1;
        g.stroke();
      } else if (arch === 'ring') {
        // 浮空符文石
        const s = rng.range(4, 7);
        g.fillStyle = 'rgba(10, 8, 18, 0.45)';
        g.beginPath();
        g.ellipse(x, y + s * 0.9, s * 0.9, s * 0.35, 0, 0, Math.PI * 2);
        g.fill();
        g.save();
        g.translate(x, y);
        g.rotate(rng.range(-0.25, 0.25));
        g.fillStyle = Palette.hexToRgba(P.rock, 0.9);
        g.strokeStyle = Palette.hexToRgba(P.rockEdge, 0.7);
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(-s * 0.7, s);
        g.lineTo(-s * 0.5, -s);
        g.lineTo(s * 0.5, -s);
        g.lineTo(s * 0.7, s);
        g.closePath();
        g.fill();
        g.stroke();
        g.strokeStyle = Palette.hexToRgba(P.accent, 0.5);
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(0, -s * 0.1, s * 0.32, 0, Math.PI * 2);
        g.moveTo(-s * 0.32, -s * 0.1);
        g.lineTo(s * 0.32, -s * 0.1);
        g.stroke();
        g.restore();
      } else if (arch === 'cross') {
        // 断柱与碎石
        const h = rng.range(6, 13);
        const w = rng.range(5, 8);
        g.fillStyle = 'rgba(12, 10, 6, 0.35)';
        g.beginPath();
        g.ellipse(x + 2, y + 4, w * 1.1, w * 0.4, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = Palette.hexToRgba(P.rock, 0.85);
        g.strokeStyle = Palette.hexToRgba(P.rockEdge, 0.6);
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x - w / 2, y + 4);
        g.lineTo(x - w / 2, y - h);
        g.lineTo(x - w / 4, y - h + 3);
        g.lineTo(x + w / 4, y - h - 2);
        g.lineTo(x + w / 2, y - h + 2);
        g.lineTo(x + w / 2, y + 4);
        g.closePath();
        g.fill();
        g.stroke();
        g.strokeStyle = 'rgba(0, 0, 0, 0.25)';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x + w * 0.15, y + 3);
        g.lineTo(x + w * 0.15, y - h + 4);
        g.stroke();
      } else if (arch === 'switchback') {
        // 风蚀石柱：斜切层叠薄片 + 风痕
        const h = rng.range(7, 15);
        const w = rng.range(4, 7);
        g.fillStyle = 'rgba(8, 12, 20, 0.35)';
        g.beginPath();
        g.ellipse(x + w * 0.3, y + 4, w * 1.2, w * 0.38, 0, 0, Math.PI * 2);
        g.fill();
        for (let j = 0; j < 3; j++) {
          const yy = y + 3 - (h * j) / 3;
          g.fillStyle = Palette.hexToRgba(P.rock, 0.55 - j * 0.12);
          g.strokeStyle = Palette.hexToRgba(P.rockEdge, 0.45);
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(x - w / 2 + j * 1.2, yy);
          g.lineTo(x + w / 2 + j * 1.2, yy - 2.2);
          g.lineTo(x + w * 0.3 + j * 1.2, yy - h * 0.34);
          g.closePath();
          g.fill();
          g.stroke();
        }
        g.strokeStyle = Palette.hexToRgba(P.accent, 0.3);
        g.lineWidth = 1.4;
        g.beginPath();
        g.moveTo(x - w * 0.4, y + 2);
        g.lineTo(x + w * 0.1, y - h * 0.8);
        g.stroke();
      } else {
        // 骸骨与残骸
        g.strokeStyle = 'rgba(206, 200, 182, 0.24)';
        g.lineWidth = 1.4;
        g.lineCap = 'round';
        for (let j = 0; j < 2; j++) {
          const bx = x + rng.range(-8, 8);
          const by = y + rng.range(-5, 5);
          const a = rng.float() * Math.PI;
          g.beginPath();
          g.moveTo(bx - Math.cos(a) * 6, by - Math.sin(a) * 6);
          g.lineTo(bx + Math.cos(a) * 6, by + Math.sin(a) * 6);
          g.stroke();
        }
        g.fillStyle = 'rgba(206, 200, 182, 0.2)';
        g.beginPath();
        g.arc(x + rng.range(-6, 6), y + rng.range(-4, 4), 2.2, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.lineCap = 'butt';
  }
}
