// 背景烘焙的数据表：分层定义、群系场景/调色板覆盖、天气与粒子预算、过渡带与排除区。
// 纯常量与纯查表函数，不 import 任何运行时模块（structure-budget 的数据模块纯度规则）。
// 绘制在 background-draw.js，烘焙编排在 background-renderer.js。

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

// 天气粒子预算：off 为 0（低配可完全关闭），light 约 40%，full 到场景上限。
export function weatherParticleBudget(decorations, maxCount) {
  const cap = Number.isFinite(maxCount) ? Math.floor(maxCount) : 0;
  if (cap <= 0 || decorations === 'off') return 0;
  if (decorations === 'full') return cap;
  return Math.max(1, Math.round(cap * 0.4));
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
