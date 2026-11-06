// 静态背景烘焙：草地、网格、路径、岩石、生物群系地表道具、氛围光点与暗角。
// 只在构造/画质变更时执行，结果是一张离屏 canvas。
// 数据表在 background-data.js，绘制原语在 background-draw.js，本文件只做烘焙编排与天气派生。
import { registerRenderer } from './registry.js';
import { TILE } from '../shared/data.js';
import { RNG } from '../shared/rng.js';
import { AMBIENCE_TINTS, resolveAmbience } from '../shared/ambience.js';
import {
  WEATHER_IDS,
  WEATHER_TYPES,
  ambientParticleBudget,
  biomeScene,
  biomeVisualPalette,
  decorExclusion,
  weatherParticleBudget,
} from './background-data.js';
import {
  drawBiomeProps,
  drawDayNightTint,
  drawDepthLayers,
  drawRegionTransitions,
  drawWeather,
} from './background-draw.js';
import { Palette } from './palette.js';

const T = TILE;

// 词缀 → 天气/时段：显式映射优先，其余按种子稳定派生。
const WEATHER_BY_MODIFIER = Object.freeze({
  mist: 'fog', dusk: 'fog', starlit: 'meteor', swift: 'rain', surge: 'rain', rift: 'meteor',
});
const PHASE_BY_MODIFIER = Object.freeze({
  mist: 'dawn', dusk: 'dusk', starlit: 'night', rift: 'dusk', surge: 'day',
});

// 昼夜色调：数据定义在 shared/ambience.js 的氛围预设里，这里只做再导出，
// 保持既有导入路径不变。
export const DAY_PHASES = AMBIENCE_TINTS;
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
    drawDepthLayers(g, width, height, P, scene, rng);

    // 区域过渡带：可选的低对比度渐变，随后被网格与路径覆盖，不遮挡路线与塔位。
    drawRegionTransitions(g, map, width, height, P, scene, decor);

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
    if (decor !== 'off') drawBiomeProps(g, map, P, rng, decor, excluded);

    // 氛围预设：群系 × 天气决定色调/粒子；低配只保留色调（粒子清零）。
    const meta = game.mapMeta || map.meta || {};
    const weatherSeed = game.seed ?? map.seed;
    const weather = weatherLayer(meta, weatherSeed, decor);
    const preset = resolveAmbience(map?.archetype, weather.weather, decor);

    // 生物群系氛围光点：高配按场景上限，低配/关闭档位由预设清零。
    const motes =
      preset.quality === 'full' ? ambientParticleBudget(decor, scene.particles.max) : 0;
    for (let i = 0; i < motes; i++) {
      const x = rng.float() * width;
      const y = rng.float() * height;
      g.fillStyle = `${P.ambient}${0.035 + rng.float() * 0.06})`;
      g.beginPath();
      g.arc(x, y, rng.range(0.8, scene.particles.size), 0, Math.PI * 2);
      g.fill();
    }

    // 昼夜色调 + 天气层：只读地图元数据/种子；粒子排除路径格，不遮挡路线与敌人轮廓。
    // 低配只画预设里的色调，天气粒子数为 0。
    drawDayNightTint(g, width, height, preset.tint);
    if (preset.particleCount > 0) {
      // 独立 RNG：天气粒子的随机序列不改变既有背景烘焙的取数顺序。
      drawWeather(
        g,
        width,
        height,
        map,
        P,
        new RNG(`${weatherSeed}:${weather.weather}`),
        { ...weather, particles: preset.particleCount },
        excluded
      );
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
}

// 自注册到渲染器注册表：render.js 经 id 创建实例，不再逐个静态 import。
registerRenderer('background', BackgroundRenderer);
