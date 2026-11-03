// 视觉指标层：采集结果 → 可判定指标，并集中提供判定所需的阈值文档断言与单测基线样本。
// 只做纯计算（像素 / 几何 / DOM 数值），不启动浏览器、不读文件系统（除阈值文档断言）；
// 采集与截图在 tests/lib/visual/session.mjs，套件编排与 CLI 在 scripts/visual-check.mjs。
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

import { RgbaImage, decodePng, fillRect } from '../../../scripts/lib/png.mjs';
import {
  ART_THRESHOLD_KEYS,
  THRESHOLDS,
  bandStats,
  contrastRatio,
  decorationDelta,
  decorationMonotonic,
  differenceStats,
  regionStats,
  silhouetteCoverage,
  unitContrast,
} from '../../../scripts/lib/visual-metrics.mjs';
import { weatherLayer } from '../../../public/js/render/background-renderer.js';

// feel 注入作用于表现层；art 注入作用于背景/单位层，全部只存在于测试 shim。
export const INJECTIONS = Object.freeze([
  'no-feedback',
  'effects-invisible',
  'units-hidden',
  'flat-background',
  'decor-noop',
]);

const FALLBACK_UI_BG = [10, 16, 20, 1];

// 场景点坐标（tile）→ 截图像素。deviceScaleFactor 固定为 1，CSS 像素即截图像素。
export function toScreenPoints(points, payload) {
  const { canvas, tile } = payload;
  const scale = payload.scale || canvas.width / (payload.grid.cols * tile);
  return points.map((point) => ({
    x: canvas.left + point.x * tile * scale,
    y: canvas.top + point.y * tile * scale,
    r: point.r,
  }));
}

// 敌人包围盒（用于剪影覆盖率）：半径按 tile 换算到屏幕像素。
export function toScreenBoxes(points, payload) {
  const { canvas, tile } = payload;
  const scale = payload.scale || canvas.width / (payload.grid.cols * tile);
  return points.map((point) => {
    const radius = Math.max(4, (point.r || 0.3) * tile * scale);
    return {
      x: canvas.left + point.x * tile * scale - radius,
      y: canvas.top + point.y * tile * scale - radius,
      width: radius * 2,
      height: radius * 2,
    };
  });
}

function canvasRect(payload) {
  return {
    x: payload.canvas.left,
    y: payload.canvas.top,
    width: payload.canvas.width,
    height: payload.canvas.height,
  };
}

export function feelMetrics(result) {
  // 窗口峰值口径：优先用峰值瞬时采集的帧 / 参照帧 / payload（特效是短命爆发信号，单瞬时采样会撞空窗）；
  // 缺少峰值证据时回退到 metricsFrame + references + payload（单测与旧调用方）。
  const frame = result.feelFrame || result.frames.find((item) => item.id === result.metricsFrame);
  if (!frame) throw new Error('采集结果缺少指标帧');
  const references = result.feelReferences || result.references;
  if (!references?.all) throw new Error('采集结果缺少表现层参照帧');
  const payload = result.feelPayload || result.payload;
  const rect = canvasRect(payload);
  const points = toScreenPoints(payload.enemies, payload);
  return {
    feedbackCoverage: differenceStats(frame.image, references.all, 8, rect).ratio,
    effectCoverage: differenceStats(frame.image, references.effects, 8, rect).ratio,
    floaterCoverage: differenceStats(frame.image, references.floaters, 8, rect).ratio,
    hitFlashCoverage: differenceStats(frame.image, references.flash, 8, rect).ratio,
    effects: payload.effects,
    floaters: payload.floaters,
    enemyContrast: unitContrast(frame.image, points.slice(0, 16)).meanDeltaE,
    canvas: rect,
  };
}

function decodeDataUrl(value) {
  if (!value) return null;
  const comma = value.indexOf(',');
  if (comma < 0) return null;
  return decodePng(Buffer.from(value.slice(comma + 1), 'base64'));
}

// 背景画布（离屏烘焙）与截图尺度不同，背景类指标只在背景画布自己的矩形内比较。
function imageRect(image) {
  return image ? { x: 0, y: 0, width: image.width, height: image.height } : { x: 0, y: 0, width: 0, height: 0 };
}

export function artMetrics(result) {
  const frame = result.frames.find((item) => item.id === result.metricsFrame);
  if (!frame) throw new Error('采集结果缺少指标帧');
  const { payload } = result;
  const enemyPoints = toScreenPoints(payload.enemies, payload);
  const towerPoints = toScreenPoints(payload.towers, payload);
  const boxes = toScreenBoxes(payload.enemies, payload);
  const background = decodeDataUrl(payload.backgroundPng);
  const backgroundStats = background
    ? regionStats(background, imageRect(background))
    : { levels: 0, stdLuma: 0 };
  const bands = background ? bandStats(background, imageRect(background), 3) : [];
  // 三档烘焙：当前帧背景（受注入影响）vs 关闭档 / 高配 / 低配。
  const fullBackground = decodeDataUrl(payload.backgroundFullPng) || background;
  const lightBackground = decodeDataUrl(payload.backgroundLightPng);
  const offBackground = decodeDataUrl(payload.backgroundOffPng);
  const offRect = imageRect(offBackground);
  const atmosphereByTier = {
    off: 0,
    light: lightBackground && offBackground ? decorationDelta(lightBackground, offBackground, offRect) : 0,
    full: fullBackground && offBackground ? decorationDelta(fullBackground, offBackground, offRect) : 0,
  };
  const weather = payload.mapMeta
    ? weatherLayer(payload.mapMeta, payload.seed, payload.decorations || 'full')
    : null;
  return {
    unitBackgroundDeltaE: unitContrast(frame.image, enemyPoints.slice(0, 16)).meanDeltaE,
    towerBackgroundDeltaE: unitContrast(frame.image, towerPoints.slice(0, 12)).meanDeltaE,
    silhouetteCoverage: silhouetteCoverage(frame.image, boxes.slice(0, 16)).meanCoverage,
    backgroundLevels: backgroundStats.levels,
    backgroundLumaSpread: backgroundStats.stdLuma,
    backgroundBands: bands,
    atmosphereContribution: background && offBackground
      ? decorationDelta(background, offBackground, imageRect(background))
      : 0,
    atmosphereByTier,
    decorMonotonic: decorationMonotonic(atmosphereByTier.off, atmosphereByTier.light, atmosphereByTier.full),
    weather: weather ? { ...weather, biome: payload.mapMeta?.archetype || 'canyon' } : null,
    canvas: canvasRect(payload),
  };
}

export function uiMetrics(dom) {
  if (!dom) throw new Error('采集结果缺少 DOM 指标');
  const hudBg = dom.hud?.background || FALLBACK_UI_BG;
  const shopBg = dom.shop?.background || FALLBACK_UI_BG;
  return {
    minFontSize: dom.minFontSize,
    minFontSample: dom.minFontSample,
    hudContrast: dom.hud?.color ? contrastRatio(dom.hud.color.slice(0, 3), hudBg.slice(0, 3)) : 0,
    shopContrast: dom.shop?.color ? contrastRatio(dom.shop.color.slice(0, 3), shopBg.slice(0, 3)) : 0,
    lockedFontSize: dom.locked?.fontSize ?? 0,
    lockedOpacity: dom.locked?.opacity ?? 0,
    lockedVisible: !!dom.locked?.visible,
  };
}

// 触控目标只统计真正的操作控件：图标按钮按设计更小，不参与最小尺寸判定。
export function minTouchTarget(targets = []) {
  const sizes = targets
    .filter((target) => !String(target.cls || '').split(/\s+/).includes('icon-btn'))
    .map((target) => Math.min(target.w, target.h))
    .filter((value) => Number.isFinite(value) && value > 0);
  return sizes.length ? Math.min(...sizes) : 0;
}

export function mobileMetrics(portrait, landscape) {
  if (!portrait || !landscape) throw new Error('移动套件需要竖屏与横屏两份 DOM 指标');
  const overflow = (dom) => Math.max(0, dom.viewport.scrollWidth - dom.viewport.width);
  const canvas = landscape.canvas || { width: 0, height: 0 };
  return {
    overflowX: overflow(landscape),
    portraitOverflowX: overflow(portrait),
    minTouchTarget: Math.min(minTouchTarget(portrait.targets), minTouchTarget(landscape.targets)),
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    minFontSize: Math.min(portrait.minFontSize, landscape.minFontSize),
  };
}

// ── 阈值文档断言（§8.6 指标表） ─────────────────────────────────────────────

// §8.6 指标表的正本落在任务 Notes（`docs/PHASE_FEEL_ART.md` §2.3：两份总文档只由文档 lane 修改，
// 实现任务把设计增量写进自己的 Notes）。表格一旦与 THRESHOLDS.art 漂移，调用方用例变红。
export const ART_DOC_MARKER = '8.6 机械视觉验收';

export function readSection(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) return null;
  const rest = source.slice(start + marker.length);
  const end = rest.search(/\n#{2,3} /);
  return end >= 0 ? rest.slice(0, end) : rest;
}

export function parseArtTable(section) {
  return [...section.matchAll(/^\|\s*`([a-z-]+)`\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/gm)].map((match) => ({
    id: match[1],
    name: match[2],
    threshold: match[3],
  }));
}

export function assertArtTable(section, label) {
  const rows = parseArtTable(section);
  assert.deepEqual(
    rows.map((row) => row.id),
    [...ART_THRESHOLD_KEYS.map((item) => item.id), 'decor-monotonic'],
    `${label}：§8.6 表格的指标顺序/数量必须与判定项一致`
  );
  for (const { id, key } of ART_THRESHOLD_KEYS) {
    const row = rows.find((item) => item.id === id);
    assert.equal(Number(row.threshold), THRESHOLDS.art[key], `${label}：${id} 阈值与 THRESHOLDS.art.${key} 不一致`);
  }
  const monotonic = rows.find((item) => item.id === 'decor-monotonic');
  assert.match(monotonic.threshold, /off\s*≤\s*light\s*≤\s*full/);
}

// 逐项比对 §8.6 指标表：任务 Notes 里必须有一份；文档 lane 若已在 TECH_DESIGN 落地同名章节，同样比对。
export function assertArtThresholdDocument({ root, marker = ART_DOC_MARKER }) {
  const taskDir = path.join(root, 'tasks');
  const owner = fs
    .readdirSync(taskDir)
    .filter((file) => file.endsWith('.md'))
    .map((file) => ({ file, source: fs.readFileSync(path.join(taskDir, file), 'utf8') }))
    .find((item) => item.source.includes(marker));
  assert.ok(owner, '缺少 §8.6 指标表（应落在本任务 Notes）');
  const taskSection = readSection(owner.source, marker);
  assert.ok(taskSection, `${owner.file} 的 §8.6 章节为空`);
  assertArtTable(taskSection, `${owner.file} Notes`);

  const tech = fs.readFileSync(path.join(root, 'docs/TECH_DESIGN.md'), 'utf8');
  const techSection = readSection(tech, marker);
  if (techSection) assertArtTable(techSection, 'docs/TECH_DESIGN.md');
}

// ── 单测基线样本 ────────────────────────────────────────────────────────────
// 一套「全部判定项都在阈值内」的指标：判定函数用它做正例，单点劣化做反例。
export const METRIC_FIXTURES = Object.freeze({
  feel: Object.freeze({
    feedbackCoverage: 0.02,
    effectCoverage: 0.01,
    hitFlashCoverage: 0.004,
    floaterCoverage: 0.001,
    effects: 12,
    floaters: 3,
    enemyContrast: 18,
  }),
  art: Object.freeze({
    unitBackgroundDeltaE: 20,
    towerBackgroundDeltaE: 16,
    silhouetteCoverage: 0.5,
    backgroundLevels: 12,
    backgroundLumaSpread: 12,
    backgroundBands: [
      { index: 0, levels: 9 },
      { index: 1, levels: 8 },
      { index: 2, levels: 7 },
    ],
    atmosphereContribution: 0.006,
    atmosphereByTier: { off: 0, light: 0.002, full: 0.006 },
    decorMonotonic: true,
  }),
  ui: Object.freeze({
    minFontSize: 13,
    hudContrast: 7,
    shopContrast: 9,
    lockedFontSize: 13,
    lockedOpacity: 0.5,
  }),
  mobile: Object.freeze({
    overflowX: 0,
    portraitOverflowX: 0,
    minTouchTarget: 44,
    canvasWidth: 458,
    canvasHeight: 250,
    minFontSize: 13,
  }),
});

// 注入 → 预期红灯映射：每种注入只打红它负责的指标（与采集 shim 的真实效果一一对应）。
export const INJECTION_EXPECTATIONS = Object.freeze([
  Object.freeze({
    injection: 'units-hidden',
    red: Object.freeze(['unit-background', 'silhouette']),
    green: Object.freeze(['background-levels', 'background-spread', 'background-bands', 'atmosphere-contribution']),
  }),
  Object.freeze({
    injection: 'flat-background',
    red: Object.freeze(['background-levels', 'background-spread', 'background-bands']),
    green: Object.freeze([]),
  }),
  Object.freeze({
    injection: 'decor-noop',
    red: Object.freeze(['atmosphere-contribution']),
    green: Object.freeze(['background-levels', 'background-spread', 'background-bands']),
  }),
]);

// 与采集 shim 的注入效果等价的指标样本：注入只能影响它该影响的指标。
export function artInjectionFixture(injection) {
  const art = METRIC_FIXTURES.art;
  if (injection === 'units-hidden') {
    return { ...art, unitBackgroundDeltaE: 0, silhouetteCoverage: 0 };
  }
  if (injection === 'flat-background') {
    return {
      ...art,
      backgroundLevels: 1,
      backgroundLumaSpread: 0,
      backgroundBands: [{ index: 0, levels: 1 }, { index: 1, levels: 1 }, { index: 2, levels: 1 }],
    };
  }
  if (injection === 'decor-noop') return { ...art, atmosphereContribution: 0 };
  return { ...art };
}

// ── 单测画布助手 ────────────────────────────────────────────────────────────

export function makeImage(width, height, color = [0, 0, 0, 255]) {
  const image = new RgbaImage(width, height);
  fillRect(image, 0, 0, width, height, color);
  return image;
}

export function paint(image, x, y, width, height, color) {
  fillRect(image, x, y, width, height, color);
  return image;
}
