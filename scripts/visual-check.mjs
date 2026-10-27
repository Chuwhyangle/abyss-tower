#!/usr/bin/env node
// 视觉机械检查：采集确定性场景 → 读像素/DOM/模拟指标 → 按套件判定 → 逐项打印并给出退出码。
// 用法：node scripts/visual-check.mjs --suite feel|art|ui|mobile|all
// 关键设计：feedback 覆盖率 = 同一帧「表现层可见」与「表现层被拿掉」的像素差异，
//           因此把特效删掉或涂成背景色会直接把覆盖率打到 0，检查必然变红。
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodePng } from './lib/png.mjs';
import {
  bandStats,
  contrastRatio,
  decorationDelta,
  decorationMonotonic,
  differenceStats,
  evaluateSuite,
  regionStats,
  silhouetteCoverage,
  unitContrast,
} from './lib/visual-metrics.mjs';
import { weatherLayer } from '../public/js/render/background-renderer.js';
import { capture, resolveQuality } from '../tests/visual-scenes.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SUITES = Object.freeze(['feel', 'art', 'ui', 'mobile']);
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
  const frame = result.frames.find((item) => item.id === result.metricsFrame);
  if (!frame) throw new Error('采集结果缺少指标帧');
  const { references, payload } = result;
  if (!references?.all) throw new Error('采集结果缺少表现层参照帧');
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

function findResult(results, scene, viewport) {
  return results.find((item) => item.scene === scene && item.viewport === viewport);
}

// 每个套件需要哪些场景/视口：feel/art/ui 用桌面战斗；mobile 另需竖屏标题布局。
export async function collectSuiteMetrics(suite, { quality = 'high', injection = null, outDir = null, log = () => {} } = {}) {
  if (suite === 'mobile') {
    const { results } = await capture({
      scenes: ['title', 'combat'],
      viewports: ['mobile', 'mobile-landscape'],
      quality,
      outDir,
      injection,
      log,
    });
    const portrait = findResult(results, 'title', 'mobile');
    const landscape = findResult(results, 'combat', 'mobile-landscape');
    return { metrics: mobileMetrics(portrait?.dom, landscape?.dom), results };
  }
  const { results } = await capture({
    scenes: ['combat'],
    viewports: ['desktop'],
    quality,
    outDir,
    injection,
    log,
  });
  const combat = findResult(results, 'combat', 'desktop');
  if (!combat) throw new Error('未采集到桌面战斗场景');
  if (suite === 'feel') return { metrics: feelMetrics(combat), results };
  if (suite === 'art') return { metrics: artMetrics(combat), results };
  if (suite === 'ui') return { metrics: uiMetrics(combat.dom), results };
  throw new Error(`未知套件：${suite}`);
}

function formatValue(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(4);
  }
  return String(value);
}

export function printReport(report, { log = console.log } = {}) {
  const title = report.suite === 'all' ? '全部套件' : report.suite;
  log(`\n视觉检查 · ${title}`);
  for (const result of report.results) {
    log(`  [${result.suite}] ${result.ok ? 'PASS' : 'FAIL'}`);
    for (const check of result.checks) {
      const mark = check.ok ? '✔' : '✘';
      log(`    ${mark} ${check.name}: ${formatValue(check.value)}（阈值 ${check.threshold}）${check.detail ? ` · ${check.detail}` : ''}`);
    }
  }
  log(`\n结论：${report.ok ? '通过' : '未通过'}`);
}

function parseArgs(argv) {
  const options = {
    suite: 'all',
    quality: 'high',
    outDir: null,
    injection: null,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--suite') {
      options.suite = next();
    } else if (arg === '--quality') {
      options.quality = next();
    } else if (arg === '--out') {
      options.outDir = next();
    } else if (arg === '--inject') {
      options.injection = next();
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  if (!options.help && options.suite !== 'all' && !SUITES.includes(options.suite)) {
    throw new Error(`未知套件：${options.suite}（可选 ${SUITES.join(' / ')} / all）`);
  }
  if (options.injection && !INJECTIONS.includes(options.injection)) {
    throw new Error(`未知回归注入：${options.injection}（可选 ${INJECTIONS.join(' / ')}）`);
  }
  resolveQuality(options.quality);
  return options;
}

export async function run({ suite = 'all', quality = 'high', injection = null, outDir = null, log = () => {} } = {}) {
  const suites = suite === 'all' ? [...SUITES] : [suite];
  const reports = [];
  for (const item of suites) {
    const { metrics } = await collectSuiteMetrics(item, { quality, injection, outDir, log });
    reports.push({ ...evaluateSuite(item, metrics), metrics });
  }
  return {
    ok: reports.every((report) => report.ok),
    suite,
    // 单套件时把该项检查表提到顶层，便于 --json 消费者按稳定 schema 读取。
    checks: reports.length === 1 ? reports[0].checks : undefined,
    suites,
    injection: injection || null,
    quality,
    results: reports,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`用法：node scripts/visual-check.mjs --suite feel|art|ui|mobile|all [--quality high] [--inject ${INJECTIONS.join('|')}] [--out dir] [--json]`);
    return 0;
  }
  const report = await run({
    suite: options.suite,
    quality: options.quality,
    injection: options.injection,
    outDir: options.outDir,
    // --json 时 stdout 必须是可解析的单一 JSON：采集进度日志改走 stderr。
    log: options.json ? (line) => console.error(line) : (line) => console.log(line),
  });
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }
  return report.ok ? 0 : 1;
}

const isDirectEntry =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectEntry) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`[visual-check] ${error.stack || error.message}`);
      process.exit(2);
    });
}
