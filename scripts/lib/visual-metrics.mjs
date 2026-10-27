// 视觉指标：像素、DOM 与模拟状态 → 可判定的机械数值。
// 纯函数 + 一套集中阈值；CLI 只负责采集与打印，判定规则全部在这里，便于单测。
import crypto from 'node:crypto';

import { RgbaImage } from './png.mjs';

// ── 集中阈值：一次改动只改一处，docs/ 里的说明与这里保持一致 ────────────────
export const THRESHOLDS = Object.freeze({
  feel: Object.freeze({
    // 反馈覆盖率 = 去掉特效/飘字/受击闪白后的同一帧与当前帧的像素差异占比。
    feedbackCoverage: 0.002,
    // 特效层单独覆盖：把特效涂成背景色 / 删掉特效时，它必须掉到阈值以下。
    effectCoverage: 0.0003,
    hitFlashCoverage: 0.0004,
    floaterCoverage: 0.00008,
    minFloaters: 1,
    minActiveEffects: 4,
    minEnemyContrast: 10,
    maxEffects: 320,
  }),
  art: Object.freeze({
    unitBackgroundDeltaE: 12,
    silhouetteCoverage: 0.32,
    towerBackgroundDeltaE: 10,
    minBackgroundLevels: 6,
    minBackgroundLumaSpread: 8,
  }),
  ui: Object.freeze({
    minFontSize: 12,
    minContrast: 4.5,
    minLockedFontSize: 12,
    minLockedOpacity: 0.45,
  }),
  mobile: Object.freeze({
    maxOverflowPx: 1,
    minTouchTarget: 40,
    minCanvasWidth: 380,
    minCanvasHeight: 200,
    minFontSize: 12,
  }),
});

// ── 颜色 ─────────────────────────────────────────────────────────────────────
export function luma([r, g, b]) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function toLinear(channel) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

// sRGB → CIE Lab（D65）。ΔE76 对「单位是否从背景里跳出来」足够，且无第三方依赖。
export function rgbToLab([r, g, b]) {
  const rl = toLinear(r);
  const gl = toLinear(g);
  const bl = toLinear(b);
  const x = (rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375) / 0.95047;
  const y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.072175;
  const z = (rl * 0.0193339 + gl * 0.119192 + bl * 0.9503041) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function deltaE(a, b) {
  const la = rgbToLab(a);
  const lb = rgbToLab(b);
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

export function relativeLuminance([r, g, b]) {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

// WCAG 对比度：UI 文本可读性用同一公式，避免"看起来差不多"的主观判断。
export function contrastRatio(fg, bg) {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  const light = Math.max(a, b);
  const dark = Math.min(a, b);
  return (light + 0.05) / (dark + 0.05);
}

export function parseCssColor(value) {
  const text = String(value || '').trim();
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(text);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), /rgba/i.test(text) ? Number(/,\s*([\d.]+)\s*\)$/.exec(text)?.[1] ?? 1) : 1];
  const hex = /^#([0-9a-f]{3,8})$/i.exec(text);
  if (hex) {
    const raw = hex[1];
    if (raw.length === 3) {
      return [parseInt(raw[0] + raw[0], 16), parseInt(raw[1] + raw[1], 16), parseInt(raw[2] + raw[2], 16), 1];
    }
    if (raw.length >= 6) {
      return [
        parseInt(raw.slice(0, 2), 16),
        parseInt(raw.slice(2, 4), 16),
        parseInt(raw.slice(4, 6), 16),
        raw.length === 8 ? parseInt(raw.slice(6, 8), 16) / 255 : 1,
      ];
    }
  }
  return [0, 0, 0, 1];
}

// ── 区域统计 ─────────────────────────────────────────────────────────────────
export function regionStats(image, rect) {
  const area = image.clippedRect(rect.x, rect.y, rect.width, rect.height);
  if (!area.width || !area.height) return { pixels: 0, meanLuma: 0, stdLuma: 0, levels: 0 };
  let sum = 0;
  let sumSq = 0;
  const buckets = new Set();
  for (let y = area.y; y < area.y + area.height; y++) {
    for (let x = area.x; x < area.x + area.width; x++) {
      const [r, g, b, a] = image.pixel(x, y);
      if (a === 0) continue;
      const l = luma([r, g, b]);
      sum += l;
      sumSq += l * l;
      buckets.add(Math.round(l / 8));
    }
  }
  const pixels = area.width * area.height;
  const mean = sum / pixels;
  const variance = Math.max(0, sumSq / pixels - mean * mean);
  return { pixels, meanLuma: mean, stdLuma: Math.sqrt(variance), levels: buckets.size };
}

// 两张同尺寸图的差异占比：ΔE 超过阈值的像素算"被表现层改写过"。
export function differenceStats(left, right, threshold = 8, rect = null) {
  const area = rect
    ? left.clippedRect(rect.x, rect.y, rect.width, rect.height)
    : { x: 0, y: 0, width: Math.min(left.width, right.width), height: Math.min(left.height, right.height) };
  let changed = 0;
  let total = 0;
  let sumDelta = 0;
  for (let y = area.y; y < area.y + area.height; y++) {
    for (let x = area.x; x < area.x + area.width; x++) {
      const a = left.pixel(x, y);
      const b = right.pixel(x, y);
      total++;
      const d = deltaE(a, b);
      sumDelta += d;
      if (d > threshold) changed++;
    }
  }
  return {
    pixels: total,
    changed,
    ratio: total ? changed / total : 0,
    meanDeltaE: total ? sumDelta / total : 0,
  };
}

// 单位与背景反差：核心区平均色 vs 外环平均色。点坐标是画布 CSS 像素。
export function unitContrast(image, points, { core = 2, inner = 5, outer = 13 } = {}) {
  const values = [];
  for (const point of points) {
    const { x, y } = point;
    const coreRect = image.clippedRect(Math.round(x - core), Math.round(y - core), core * 2, core * 2);
    if (!coreRect.width || !coreRect.height) continue;
    const coreColor = meanColor(image, coreRect);
    let ringSum = [0, 0, 0];
    let samples = 0;
    const step = 2;
    for (let dy = -outer; dy <= outer; dy += step) {
      for (let dx = -outer; dx <= outer; dx += step) {
        const dist = Math.hypot(dx, dy);
        if (dist < inner || dist > outer) continue;
        const px = Math.round(x + dx);
        const py = Math.round(y + dy);
        if (px < 0 || py < 0 || px >= image.width || py >= image.height) continue;
        const [r, g, b] = image.pixel(px, py);
        ringSum[0] += r;
        ringSum[1] += g;
        ringSum[2] += b;
        samples++;
      }
    }
    if (!samples) continue;
    const ring = ringSum.map((value) => value / samples);
    const d = deltaE(coreColor.slice(0, 3), ring);
    if (Number.isFinite(d)) values.push(d);
  }
  return {
    samples: values.length,
    meanDeltaE: values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0,
  };
}

export function meanColor(image, rect) {
  const area = image.clippedRect(rect.x, rect.y, rect.width, rect.height);
  let sum = [0, 0, 0];
  let count = 0;
  for (let y = area.y; y < area.y + area.height; y++) {
    for (let x = area.x; x < area.x + area.width; x++) {
      const [r, g, b, a] = image.pixel(x, y);
      if (a === 0) continue;
      sum = [sum[0] + r, sum[1] + g, sum[2] + b];
      count++;
    }
  }
  return count ? sum.map((value) => value / count) : [0, 0, 0];
}

// 剪影覆盖率：包围盒内明显不同于背景的像素占比。
export function silhouetteCoverage(image, boxes, { backgroundSample = 4, threshold = 20 } = {}) {
  const ratios = [];
  for (const box of boxes) {
    const x = Math.round(box.x);
    const y = Math.round(box.y);
    const w = Math.max(2, Math.round(box.width));
    const h = Math.max(2, Math.round(box.height));
    const ring = [
      { x: x - backgroundSample, y: y - backgroundSample, width: w + backgroundSample * 2, height: backgroundSample },
      { x: x - backgroundSample, y: y + h, width: w + backgroundSample * 2, height: backgroundSample },
      { x: x - backgroundSample, y, width: backgroundSample, height: h },
      { x: x + w, y, width: backgroundSample, height: h },
    ];
    const colors = ring.map((rect) => meanColor(image, rect));
    const bg = [0, 1, 2].map(
      (channel) => colors.reduce((sum, color) => sum + color[channel], 0) / (colors.length || 1)
    );
    let filled = 0;
    for (let row = y; row < y + h; row++) {
      for (let col = x; col < x + w; col++) {
        if (col < 0 || row < 0 || col >= image.width || row >= image.height) continue;
        const [r, g, b, a] = image.pixel(col, row);
        if (!a) continue;
        if (deltaE([r, g, b], bg) > threshold) filled++;
      }
    }
    ratios.push(filled / (w * h));
  }
  return {
    boxes: ratios.length,
    meanCoverage: ratios.length ? ratios.reduce((sum, v) => sum + v, 0) / ratios.length : 0,
  };
}

// ── 指纹与确定性 ─────────────────────────────────────────────────────────────
export function pixelHash(image) {
  const hash = crypto.createHash('sha256');
  hash.update(`${image.width}x${image.height}:`);
  hash.update(image.data);
  return hash.digest('hex');
}

// 32×32 亮度指纹：允许 DOM 场景的亚像素漂移，同时能把"画面变了"抓出来。
export function lumaSignature(image, size = 32) {
  const signature = new Array(size * size).fill(0);
  for (let row = 0; row < size; row++) {
    const y0 = Math.floor((row * image.height) / size);
    const y1 = Math.max(y0 + 1, Math.floor(((row + 1) * image.height) / size));
    for (let col = 0; col < size; col++) {
      const x0 = Math.floor((col * image.width) / size);
      const x1 = Math.max(x0 + 1, Math.floor(((col + 1) * image.width) / size));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const [r, g, b] = image.pixel(x, y);
          sum += luma([r, g, b]);
          count++;
        }
      }
      signature[row * size + col] = count ? sum / count : 0;
    }
  }
  return signature;
}

export function signatureDistance(left, right) {
  const length = Math.min(left.length, right.length);
  if (!length) return { meanAbs: 255, maxAbs: 255, diffRatio: 1 };
  let sum = 0;
  let max = 0;
  let changed = 0;
  for (let i = 0; i < length; i++) {
    const d = Math.abs(left[i] - right[i]);
    sum += d;
    if (d > max) max = d;
    if (d > 6) changed++;
  }
  return { meanAbs: sum / length, maxAbs: max, diffRatio: changed / length };
}

export function signaturesMatch(left, right, { meanAbs = 2.5, diffRatio = 0.08 } = {}) {
  const distance = signatureDistance(left, right);
  return { ...distance, ok: distance.meanAbs <= meanAbs && distance.diffRatio <= diffRatio };
}

// ── 套件判定：输入采集到的指标对象，输出可打印的检查表 ─────────────────────
function check(id, label, value, threshold, ok, detail = '') {
  return { id, label, value, threshold, ok: !!ok, detail };
}

export function evaluateFeel(metrics) {
  const t = THRESHOLDS.feel;
  const checks = [
    check('feedback-coverage', '反馈覆盖（特效+飘字+受击闪白）', metrics.feedbackCoverage, `≥ ${t.feedbackCoverage}`, metrics.feedbackCoverage >= t.feedbackCoverage, '同一帧去掉表现层前后的像素差异占比'),
    check('effect-coverage', '命中特效覆盖', metrics.effectCoverage, `≥ ${t.effectCoverage}`, metrics.effectCoverage >= t.effectCoverage, '只把特效层拿掉后的像素差异占比'),
    check('hit-flash', '受击闪白覆盖', metrics.hitFlashCoverage, `≥ ${t.hitFlashCoverage}`, metrics.hitFlashCoverage >= t.hitFlashCoverage),
    check('floaters', '伤害飘字覆盖', metrics.floaterCoverage, `≥ ${t.floaterCoverage}`, metrics.floaterCoverage >= t.floaterCoverage),
    check('floater-count', '飘字条数', metrics.floaters, `≥ ${t.minFloaters}`, metrics.floaters >= t.minFloaters),
    check('effects-active', '同时存在的命中特效', metrics.effects, `≥ ${t.minActiveEffects}`, metrics.effects >= t.minActiveEffects),
    check('enemy-contrast', '敌人与背景 ΔE', round(metrics.enemyContrast), `≥ ${t.minEnemyContrast}`, metrics.enemyContrast >= t.minEnemyContrast),
    check('effect-budget', '特效预算', metrics.effects, `≤ ${t.maxEffects}`, metrics.effects <= t.maxEffects),
  ];
  return { suite: 'feel', ok: checks.every((item) => item.ok), checks };
}

export function evaluateArt(metrics) {
  const t = THRESHOLDS.art;
  const checks = [
    check('unit-background', '单位与背景 ΔE', round(metrics.unitBackgroundDeltaE), `≥ ${t.unitBackgroundDeltaE}`, metrics.unitBackgroundDeltaE >= t.unitBackgroundDeltaE),
    check('tower-background', '防御塔与背景 ΔE', round(metrics.towerBackgroundDeltaE), `≥ ${t.towerBackgroundDeltaE}`, metrics.towerBackgroundDeltaE >= t.towerBackgroundDeltaE),
    check('silhouette', '剪影像素覆盖', round(metrics.silhouetteCoverage), `≥ ${t.silhouetteCoverage}`, metrics.silhouetteCoverage >= t.silhouetteCoverage),
    check('background-levels', '背景亮度层次数', metrics.backgroundLevels, `≥ ${t.minBackgroundLevels}`, metrics.backgroundLevels >= t.minBackgroundLevels),
    check('background-spread', '背景亮度跨度', round(metrics.backgroundLumaSpread), `≥ ${t.minBackgroundLumaSpread}`, metrics.backgroundLumaSpread >= t.minBackgroundLumaSpread),
  ];
  return { suite: 'art', ok: checks.every((item) => item.ok), checks };
}

export function evaluateUi(metrics) {
  const t = THRESHOLDS.ui;
  const checks = [
    check('min-font', '最小可见字号（px）', round(metrics.minFontSize), `≥ ${t.minFontSize}`, metrics.minFontSize >= t.minFontSize, metrics.minFontSample || ''),
    check('hud-contrast', 'HUD 文本对比度', round(metrics.hudContrast), `≥ ${t.minContrast}`, metrics.hudContrast >= t.minContrast),
    check('shop-contrast', '商店卡文本对比度', round(metrics.shopContrast), `≥ ${t.minContrast}`, metrics.shopContrast >= t.minContrast),
    check('locked-font', '未解锁卡字号（px）', round(metrics.lockedFontSize), `≥ ${t.minLockedFontSize}`, metrics.lockedFontSize >= t.minLockedFontSize),
    check('locked-opacity', '未解锁卡不透明度', round(metrics.lockedOpacity), `≥ ${t.minLockedOpacity}`, metrics.lockedOpacity >= t.minLockedOpacity),
  ];
  return { suite: 'ui', ok: checks.every((item) => item.ok), checks };
}

export function evaluateMobile(metrics) {
  const t = THRESHOLDS.mobile;
  const checks = [
    check('overflow', '横屏横向溢出（px）', metrics.overflowX, `≤ ${t.maxOverflowPx}`, metrics.overflowX <= t.maxOverflowPx),
    check('portrait-overflow', '竖屏横向溢出（px）', metrics.portraitOverflowX, `≤ ${t.maxOverflowPx}`, metrics.portraitOverflowX <= t.maxOverflowPx),
    check('touch-target', '最小可点击尺寸（px）', round(metrics.minTouchTarget), `≥ ${t.minTouchTarget}`, metrics.minTouchTarget >= t.minTouchTarget),
    check('canvas-width', '画布宽度（px）', round(metrics.canvasWidth), `≥ ${t.minCanvasWidth}`, metrics.canvasWidth >= t.minCanvasWidth),
    check('canvas-height', '画布高度（px）', round(metrics.canvasHeight), `≥ ${t.minCanvasHeight}`, metrics.canvasHeight >= t.minCanvasHeight),
    check('mobile-font', '移动端最小字号（px）', round(metrics.minFontSize), `≥ ${t.minFontSize}`, metrics.minFontSize >= t.minFontSize),
  ];
  return { suite: 'mobile', ok: checks.every((item) => item.ok), checks };
}

export function evaluateSuite(suite, metrics) {
  switch (suite) {
    case 'feel':
      return evaluateFeel(metrics);
    case 'art':
      return evaluateArt(metrics);
    case 'ui':
      return evaluateUi(metrics);
    case 'mobile':
      return evaluateMobile(metrics);
    default:
      throw new Error(`未知套件：${suite}`);
  }
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : value;
}

// 便于诊断：把一张图按网格切块，返回每块的平均色（contact sheet 与排查用）。
export function sampleGrid(image, cols = 8, rows = 6) {
  const cells = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const rect = {
        x: Math.floor((col * image.width) / cols),
        y: Math.floor((row * image.height) / rows),
        width: Math.ceil(image.width / cols),
        height: Math.ceil(image.height / rows),
      };
      const stats = regionStats(image, rect);
      cells.push({ col, row, meanLuma: Number(stats.meanLuma.toFixed(1)), stdLuma: Number(stats.stdLuma.toFixed(1)) });
    }
  }
  return cells;
}

export { RgbaImage };
