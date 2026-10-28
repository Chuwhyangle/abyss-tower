// 视觉基建单测：PNG 编解码、像素指标、套件判定、评审记录解析、两次采集比对。
// 不启动浏览器：浏览器路径由 tests/visual-scenes.mjs / scripts/visual-check.mjs 的 CLI 承担。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RgbaImage, blit, decodePng, encodePng, fillRect, resizeNearest } from '../scripts/lib/png.mjs';
import {
  ART_THRESHOLD_KEYS,
  THRESHOLDS,
  bandStats,
  contrastRatio,
  decorationDelta,
  decorationMonotonic,
  deltaE,
  differenceStats,
  evaluateArt,
  evaluateFeel,
  evaluateMobile,
  evaluateUi,
  luma,
  lumaSignature,
  parseCssColor,
  pixelHash,
  regionStats,
  signatureDistance,
  silhouetteCoverage,
  unitContrast,
} from '../scripts/lib/visual-metrics.mjs';
import {
  checkCoverage,
  checkReviewDocument,
  normalizeVerdict,
  parseEntries,
  parseScore,
} from '../scripts/lib/review-record.mjs';
import { checkArtReview } from '../scripts/art-review.mjs';
import { checkFeelReview } from '../scripts/feel-review.mjs';
import {
  INJECTIONS,
  artMetrics,
  feelMetrics,
  minTouchTarget,
  mobileMetrics,
  toScreenBoxes,
  toScreenPoints,
  uiMetrics,
} from '../scripts/visual-check.mjs';
import {
  CONTACT_CELL_HEIGHT,
  CONTACT_CELL_WIDTH,
  COMBAT_TIMELINE,
  QUALITY_CHOICES,
  buildContactSheet,
  compareRuns,
  orderCombatFrames,
  resolveQuality,
} from './visual-scenes.mjs';
import {
  EVENT_SCENARIOS,
  FLOATER_SCENARIOS,
  QUALITY_SCENARIOS,
  REDUCED_MOTION_SCENARIOS,
  SCENARIOS,
  WEAPON_TYPES,
  TimeDriftError,
  buildScenarioManifestEntry,
  buildScenarioRuntimeSource,
  checkFrameTimes,
  frameManifestEntry,
  scenarioPlan,
  validateScenarioPlans,
} from './visual-scenarios.mjs';
import { TOWERS } from '../public/js/shared/data.js';

function makeImage(width, height, color = [0, 0, 0, 255]) {
  const image = new RgbaImage(width, height);
  fillRect(image, 0, 0, width, height, color);
  return image;
}

function paint(image, x, y, width, height, color) {
  fillRect(image, x, y, width, height, color);
  return image;
}

const GOOD_FEEL = Object.freeze({
  feedbackCoverage: 0.02,
  effectCoverage: 0.01,
  hitFlashCoverage: 0.004,
  floaterCoverage: 0.001,
  effects: 12,
  floaters: 3,
  enemyContrast: 18,
});

const GOOD_ART = Object.freeze({
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
});

const GOOD_UI = Object.freeze({
  minFontSize: 13,
  hudContrast: 7,
  shopContrast: 9,
  lockedFontSize: 13,
  lockedOpacity: 0.5,
});

const GOOD_MOBILE = Object.freeze({
  overflowX: 0,
  portraitOverflowX: 0,
  minTouchTarget: 44,
  canvasWidth: 458,
  canvasHeight: 250,
  minFontSize: 13,
});

test('PNG 编解码往返保持像素不变', () => {
  const image = new RgbaImage(16, 9);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4;
      image.data[i] = (x * 16) % 256;
      image.data[i + 1] = (y * 28) % 256;
      image.data[i + 2] = (x * y) % 256;
      image.data[i + 3] = 255;
    }
  }
  const decoded = decodePng(encodePng(image));
  assert.equal(decoded.width, 16);
  assert.equal(decoded.height, 9);
  assert.deepEqual(decoded.data, image.data);
});

test('PNG 解码拒绝非 PNG 数据', () => {
  assert.throws(() => decodePng(Buffer.from('not a png')), /签名不符/);
});

test('contact sheet 拼接不改变源图，且尺寸按网格计算', () => {
  const a = makeImage(40, 20, [200, 10, 10, 255]);
  const b = paint(makeImage(40, 20), 0, 0, 40, 10, [10, 200, 10, 255]);
  const sheet = buildContactSheet([
    { image: a, scene: 'a', viewport: 'desktop', quality: 'high', file: 'a.png' },
    { image: b, scene: 'b', viewport: 'desktop', quality: 'high', file: 'b.png' },
  ]);
  // 两格一行：宽度 = 列数 × 单格宽 + 间隔；高度 = 行数 × 单格高 + 间隔。
  assert.equal(sheet.width, 2 * CONTACT_CELL_WIDTH + 3 * 14);
  assert.equal(sheet.height, CONTACT_CELL_HEIGHT + 2 * 14);
  // 小图不放大，居中贴在格子里：第一格中心仍是源图内容（红色）。
  const [r, g, bl] = sheet.pixel(14 + Math.floor(CONTACT_CELL_WIDTH / 2), 14 + Math.floor(CONTACT_CELL_HEIGHT / 2));
  assert.ok(r > 150 && g < 80 && bl < 80);
});

test('resizeNearest 与 blit 保持最近邻语义', () => {
  const source = makeImage(2, 2, [255, 0, 0, 255]);
  paint(source, 1, 1, 1, 1, [0, 0, 255, 255]);
  const scaled = resizeNearest(source, 4, 4);
  assert.deepEqual(scaled.pixel(0, 0), [255, 0, 0, 255]);
  assert.deepEqual(scaled.pixel(3, 3), [0, 0, 255, 255]);
  const target = makeImage(6, 6, [0, 0, 0, 255]);
  blit(target, source, 2, 2, 2, 2);
  assert.deepEqual(target.pixel(2, 2), [255, 0, 0, 255]);
});

test('颜色换算：ΔE 与 WCAG 对比度', () => {
  assert.equal(deltaE([10, 10, 10], [10, 10, 10]), 0);
  assert.ok(deltaE([255, 255, 255], [0, 0, 0]) > 90);
  assert.equal(Math.round(contrastRatio([255, 255, 255], [0, 0, 0])), 21);
  assert.equal(Math.round(luma([255, 255, 255])), 255);
  assert.deepEqual(parseCssColor('#ff0000'), [255, 0, 0, 1]);
  assert.deepEqual(parseCssColor('rgba(1, 2, 3, 0.5)'), [1, 2, 3, 0.5]);
});

test('区域统计与差异占比按矩形裁剪', () => {
  const image = makeImage(10, 10, [0, 0, 0, 255]);
  paint(image, 5, 0, 5, 10, [255, 255, 255, 255]);
  const left = regionStats(image, { x: 0, y: 0, width: 5, height: 10 });
  const right = regionStats(image, { x: 5, y: 0, width: 5, height: 10 });
  assert.equal(Math.round(left.meanLuma), 0);
  assert.equal(Math.round(right.meanLuma), 255);
  assert.ok(right.stdLuma < 1);

  const other = makeImage(10, 10, [0, 0, 0, 255]);
  const diff = differenceStats(image, other, 8, { x: 5, y: 0, width: 5, height: 10 });
  assert.equal(diff.ratio, 1);
  const none = differenceStats(image, image, 8, { x: 5, y: 0, width: 5, height: 10 });
  assert.equal(none.ratio, 0);
});

test('亮度指纹对同图稳定、对改动敏感', () => {
  const image = makeImage(32, 32, [40, 40, 40, 255]);
  paint(image, 0, 0, 16, 32, [220, 220, 220, 255]);
  const a = lumaSignature(image);
  const b = lumaSignature(image);
  assert.deepEqual(a, b);
  assert.equal(signatureDistance(a, b).meanAbs, 0);

  const changed = makeImage(32, 32, [40, 40, 40, 255]);
  const distance = signatureDistance(a, lumaSignature(changed));
  assert.ok(distance.meanAbs > 10);
  assert.equal(pixelHash(image) === pixelHash(changed), false);
});

test('单位反差与剪影覆盖率能区分前后景', () => {
  const image = makeImage(64, 64, [18, 30, 22, 255]);
  paint(image, 28, 28, 8, 8, [240, 240, 240, 255]);
  const contrast = unitContrast(image, [{ x: 32, y: 32 }], { core: 2, inner: 6, outer: 16 });
  assert.ok(contrast.meanDeltaE > 30);
  const coverage = silhouetteCoverage(image, [{ x: 28, y: 28, width: 8, height: 8 }]);
  assert.ok(coverage.meanCoverage > 0.9);

  const flat = makeImage(64, 64, [18, 30, 22, 255]);
  assert.ok(unitContrast(flat, [{ x: 32, y: 32 }]).meanDeltaE < 1);
});

test('feel 套件：正常指标通过，特效被删掉时必然红', () => {
  assert.equal(evaluateFeel(GOOD_FEEL).ok, true);

  const noEffects = evaluateFeel({ ...GOOD_FEEL, effectCoverage: 0 });
  assert.equal(noEffects.ok, false);
  assert.equal(noEffects.checks.find((item) => item.id === 'effect-coverage').ok, false);

  const noFeedback = evaluateFeel({
    ...GOOD_FEEL,
    feedbackCoverage: 0,
    effectCoverage: 0,
    hitFlashCoverage: 0,
    floaterCoverage: 0,
    effects: 0,
    floaters: 0,
  });
  assert.equal(noFeedback.ok, false);
  // 只有与表现层无关的两项还能过：敌人反差与特效预算。
  assert.deepEqual(
    noFeedback.checks.filter((item) => item.ok).map((item) => item.id),
    ['enemy-contrast', 'effect-budget']
  );

  assert.equal(evaluateFeel({ ...GOOD_FEEL, effects: 400 }).ok, false);
  assert.equal(evaluateFeel({ ...GOOD_FEEL, enemyContrast: 2 }).ok, false);
});

test('art / ui / mobile 套件阈值可判定', () => {
  assert.equal(evaluateArt(GOOD_ART).ok, true);
  assert.equal(evaluateArt({ ...GOOD_ART, silhouetteCoverage: 0.1 }).ok, false);
  assert.equal(evaluateArt({ ...GOOD_ART, backgroundLevels: 2 }).ok, false);

  assert.equal(evaluateUi(GOOD_UI).ok, true);
  assert.equal(evaluateUi({ ...GOOD_UI, minFontSize: 9 }).ok, false);
  assert.equal(evaluateUi({ ...GOOD_UI, lockedOpacity: 0.1 }).ok, false);

  assert.equal(evaluateMobile(GOOD_MOBILE).ok, true);
  assert.equal(evaluateMobile({ ...GOOD_MOBILE, canvasWidth: 100 }).ok, false);
  assert.equal(evaluateMobile({ ...GOOD_MOBILE, overflowX: 20 }).ok, false);
});

test('分带统计：纵向等分、空带归零、单色图各带只有一层', () => {
  const image = makeImage(30, 30, [0, 0, 0, 255]);
  // 上带黑、中带中灰、下带两种亮度：每带层次数应各自独立。
  paint(image, 0, 0, 30, 10, [0, 0, 0, 255]);
  paint(image, 0, 10, 30, 10, [128, 128, 128, 255]);
  paint(image, 0, 20, 15, 10, [200, 200, 200, 255]);
  paint(image, 15, 20, 15, 10, [255, 255, 255, 255]);
  const bands = bandStats(image, { x: 0, y: 0, width: 30, height: 30 }, 3);
  assert.equal(bands.length, 3);
  assert.equal(bands[0].levels, 1);
  assert.equal(bands[1].levels, 1);
  assert.equal(bands[2].levels, 2);
  assert.ok(bands[2].stdLuma > bands[0].stdLuma);

  const flat = makeImage(30, 30, [60, 60, 60, 255]);
  const flatBands = bandStats(flat, { x: 0, y: 0, width: 30, height: 30 }, 3);
  assert.deepEqual(flatBands.map((band) => band.levels), [1, 1, 1]);
  assert.ok(flatBands.every((band) => band.stdLuma < 1e-9));

  // 空矩形（高度 0）不抛错，也不产生虚假层次。
  const empty = bandStats(flat, { x: 0, y: 0, width: 30, height: 0 }, 3);
  assert.deepEqual(empty.map((band) => band.levels), [0, 0, 0]);
});

test('氛围层贡献：同图为零、差异按像素占比、缺图不抛错', () => {
  const off = makeImage(20, 20, [10, 10, 10, 255]);
  assert.equal(decorationDelta(off, off), 0);

  const full = makeImage(20, 20, [10, 10, 10, 255]);
  paint(full, 0, 0, 10, 20, [220, 220, 220, 255]);
  const ratio = decorationDelta(full, off);
  assert.equal(ratio, 0.5);

  // 只比较传入矩形：矩形外差异不计入。
  const clipped = decorationDelta(full, off, { x: 10, y: 0, width: 10, height: 20 });
  assert.equal(clipped, 0);

  assert.equal(decorationDelta(null, off), 0);
  assert.equal(decorationDelta(off, null), 0);
});

test('装饰档位单调：关闭 ≤ 低配 ≤ 高配', () => {
  assert.equal(decorationMonotonic(0, 0.002, 0.006), true);
  assert.equal(decorationMonotonic(0, 0, 0), true);
  assert.equal(decorationMonotonic(0, 0.006, 0.002), false);
  assert.equal(decorationMonotonic(0.001, 0.0005, 0.006), false);
});

test('art 套件：分带 / 氛围层 / 档位单调三项各自能红', () => {
  const bandDegraded = evaluateArt({
    ...GOOD_ART,
    backgroundBands: [{ index: 0, levels: 9 }, { index: 1, levels: 1 }, { index: 2, levels: 9 }],
  });
  assert.equal(bandDegraded.ok, false);
  assert.equal(bandDegraded.checks.find((item) => item.id === 'background-bands').ok, false);

  const noAtmosphere = evaluateArt({ ...GOOD_ART, atmosphereContribution: 0 });
  assert.equal(noAtmosphere.ok, false);
  assert.equal(noAtmosphere.checks.find((item) => item.id === 'atmosphere-contribution').ok, false);

  const notMonotonic = evaluateArt({
    ...GOOD_ART,
    atmosphereByTier: { off: 0, light: 0.006, full: 0.002 },
    decorMonotonic: false,
  });
  assert.equal(notMonotonic.ok, false);
  assert.equal(notMonotonic.checks.find((item) => item.id === 'decor-monotonic').ok, false);

  // 三项都在时正常通过（GOOD_ART 基线）。
  assert.equal(evaluateArt(GOOD_ART).ok, true);
});

test('注入 → 预期红灯映射：每种注入只打红它负责的指标', () => {
  const expectations = [
    {
      injection: 'units-hidden',
      red: ['unit-background', 'silhouette'],
      green: ['background-levels', 'background-spread', 'background-bands', 'atmosphere-contribution'],
    },
    {
      injection: 'flat-background',
      red: ['background-levels', 'background-spread', 'background-bands'],
      green: [],
    },
    {
      injection: 'decor-noop',
      red: ['atmosphere-contribution'],
      green: ['background-levels', 'background-spread', 'background-bands'],
    },
  ];
  // 与采集 shim 的真实效果一一对应：注入只能影响它该影响的指标。
  const applyInjection = (injection) => {
    if (injection === 'units-hidden') {
      return { ...GOOD_ART, unitBackgroundDeltaE: 0, silhouetteCoverage: 0 };
    }
    if (injection === 'flat-background') {
      return {
        ...GOOD_ART,
        backgroundLevels: 1,
        backgroundLumaSpread: 0,
        backgroundBands: [{ index: 0, levels: 1 }, { index: 1, levels: 1 }, { index: 2, levels: 1 }],
      };
    }
    if (injection === 'decor-noop') {
      return { ...GOOD_ART, atmosphereContribution: 0 };
    }
    return { ...GOOD_ART };
  };
  for (const { injection, red, green } of expectations) {
    assert.ok(INJECTIONS.includes(injection), `注入 ${injection} 必须在 CLI 白名单里`);
    const report = evaluateArt(applyInjection(injection));
    assert.equal(report.ok, false, `${injection} 必须让 art 变红`);
    const byId = new Map(report.checks.map((item) => [item.id, item.ok]));
    for (const id of red) assert.equal(byId.get(id), false, `${injection} 未让 ${id} 变红`);
    for (const id of green) assert.equal(byId.get(id), true, `${injection} 误伤 ${id}`);
  }
});

// §8.6 指标表的正本落在任务 Notes（`docs/PHASE_FEEL_ART.md` §2.3：两份总文档只由文档 lane 修改，
// 实现任务把设计增量写进自己的 Notes）。表格一旦与 THRESHOLDS.art 漂移，本用例变红。
const ART_DOC_MARKER = '8.6 机械视觉验收';

function readSection(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) return null;
  const rest = source.slice(start + marker.length);
  const end = rest.search(/\n#{2,3} /);
  return end >= 0 ? rest.slice(0, end) : rest;
}

function parseArtTable(section) {
  return [...section.matchAll(/^\|\s*`([a-z-]+)`\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/gm)].map((match) => ({
    id: match[1],
    name: match[2],
    threshold: match[3],
  }));
}

function assertArtTable(section, label) {
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

test('THRESHOLDS.art 与 §8.6 指标表逐项一致（任务 Notes 正本；docs/TECH_DESIGN.md 由文档 lane 收口）', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const taskDir = path.join(root, 'tasks');
  const owner = fs
    .readdirSync(taskDir)
    .filter((file) => file.endsWith('.md'))
    .map((file) => ({ file, source: fs.readFileSync(path.join(taskDir, file), 'utf8') }))
    .find((item) => item.source.includes(ART_DOC_MARKER));
  assert.ok(owner, '缺少 §8.6 指标表（应落在本任务 Notes）');
  const taskSection = readSection(owner.source, ART_DOC_MARKER);
  assert.ok(taskSection, `${owner.file} 的 §8.6 章节为空`);
  assertArtTable(taskSection, `${owner.file} Notes`);

  // 文档 lane 若已在 TECH_DESIGN 落地同名章节，同样逐项比对，防止两处漂移。
  const tech = fs.readFileSync(path.join(root, 'docs/TECH_DESIGN.md'), 'utf8');
  const techSection = readSection(tech, ART_DOC_MARKER);
  if (techSection) assertArtTable(techSection, 'docs/TECH_DESIGN.md');
});

test('阈值集中在 THRESHOLDS，判定函数只读这一份', () => {
  assert.equal(THRESHOLDS.feel.effectCoverage > 0, true);
  const boundary = evaluateFeel({ ...GOOD_FEEL, effectCoverage: THRESHOLDS.feel.effectCoverage });
  assert.equal(boundary.checks.find((item) => item.id === 'effect-coverage').ok, true);
});

test('评审记录：字段完整且通过时 ok', () => {
  const markdown = `# 打击感评审
## 评审记录
### combat · 混战前后对照
- 场景：combat
- 日期：2026-10-27
- 评审者：qa-agent
- 结论：通过
- 分数：8/10
`;
  const document = checkReviewDocument(markdown);
  assert.equal(document.ok, true);
  assert.equal(document.entries.length, 1);
  assert.equal(document.entries[0].verdict, 'pass');
  assert.equal(document.entries[0].score, '8/10');
});

test('评审记录：缺字段、未通过、非法分数都判红', () => {
  const missing = checkReviewDocument(`### 空条目\n- 场景：combat\n`);
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some((item) => item.includes('缺少字段')));

  const rejected = checkReviewDocument(`### 未通过条目
- 场景：combat
- 日期：2026-10-27
- 评审者：qa-agent
- 结论：不通过
- 分数：5/10
`);
  assert.equal(rejected.ok, false);
  assert.ok(rejected.errors.some((item) => item.includes('不是「通过」')));

  const badScore = checkReviewDocument(`### 分数非法
- 场景：combat
- 日期：2026-10-27
- 评审者：qa-agent
- 结论：通过
- 分数：优秀
`);
  assert.equal(badScore.ok, false);

  const badDate = checkReviewDocument(`### 日期非法
- 场景：combat
- 日期：10-27
- 评审者：qa-agent
- 结论：通过
- 分数：7/10
`);
  assert.equal(badDate.ok, false);
});

test('评审记录：解析工具的行为固定', () => {
  assert.equal(normalizeVerdict('通过'), 'pass');
  assert.equal(normalizeVerdict('通过（附截图）'), 'pass');
  assert.equal(normalizeVerdict('PASS'), 'pass');
  assert.equal(normalizeVerdict('待评审'), 'fail');
  assert.deepEqual(parseScore('8/10'), { score: 8, max: 10, ratio: 0.8 });
  assert.equal(parseScore('11/10'), null);
  assert.equal(parseScore('pass'), null);
  const entries = parseEntries('### 标题\n- 场景: combat\n');
  assert.deepEqual(entries[0].fields['场景'], 'combat');
});

test('评审覆盖：art 必须覆盖四场景 × 两视口', () => {
  const entries = [
    { scene: 'title', viewport: 'desktop' },
    { scene: 'map', viewport: 'mobile' },
    { scene: 'combat', viewport: 'desktop、mobile' },
  ];
  const coverage = checkCoverage(entries, { scenes: ['title', 'map', 'combat', 'result'], viewports: ['desktop', 'mobile'] });
  assert.deepEqual(coverage.missingScenes, ['result']);
  assert.deepEqual(coverage.missingViewports, []);
  assert.equal(coverage.errors.length, 1);
});

test('feel-review / art-review：缺少记录时 exit 1 语义（ok=false）', () => {
  const missingFeel = checkFeelReview({ file: '/tmp/definitely-missing-feel-review.md' });
  assert.equal(missingFeel.ok, false);
  assert.equal(missingFeel.missingFile, true);

  const missingArt = checkArtReview({ file: '/tmp/definitely-missing-art-review.md' });
  assert.equal(missingArt.ok, false);
  assert.equal(missingArt.missingFile, true);

  const feelTemplate = checkFeelReview({ text: '# 打击感评审\n\n> 待评审\n', file: 'inline.md' });
  assert.equal(feelTemplate.ok, false);
  assert.ok(feelTemplate.errors.some((item) => item.includes('缺少评审条目')));
});

test('feel-review 只有覆盖 combat 的通过条目才算过', () => {
  const text = `### combat 混战
- 场景：combat
- 日期：2026-10-27
- 评审者：qa-agent
- 结论：通过
- 分数：8/10
`;
  assert.equal(checkFeelReview({ text, file: 'inline.md' }).ok, true);

  const wrongScene = text.replace('场景：combat', '场景：title');
  const report = checkFeelReview({ text: wrongScene, file: 'inline.md' });
  assert.equal(report.ok, false);
  assert.deepEqual(report.coverage.missingScenes, ['combat']);
});

test('art-review 覆盖不足时判红', () => {
  const text = `### title
- 场景：title
- 视口：desktop
- 日期：2026-10-27
- 评审者：qa-agent
- 结论：通过
- 分数：8/10
`;
  const report = checkArtReview({ text, file: 'inline.md' });
  assert.equal(report.ok, false);
  assert.deepEqual(report.coverage.missingScenes, ['map', 'combat', 'result']);
  assert.deepEqual(report.coverage.missingViewports, ['mobile']);
});

test('采集结果 → 指标：feel / art 的换算路径', () => {
  const size = 120;
  const canvas = { left: 0, top: 0, width: size, height: size };
  const onFrame = makeImage(size, size, [20, 40, 30, 255]);
  paint(onFrame, 10, 10, 6, 6, [250, 250, 250, 255]);
  paint(onFrame, 60, 60, 10, 10, [255, 120, 40, 255]);
  const hiddenAll = makeImage(size, size, [20, 40, 30, 255]);
  paint(hiddenAll, 10, 10, 6, 6, [250, 250, 250, 255]);
  const hiddenEffects = makeImage(size, size, [20, 40, 30, 255]);
  paint(hiddenEffects, 10, 10, 6, 6, [250, 250, 250, 255]);
  const payload = {
    canvas,
    scale: 1,
    tile: 48,
    grid: { cols: 2, rows: 2 },
    enemies: [{ x: 0.2, y: 0.2, r: 0.3 }],
    towers: [{ x: 0.6, y: 0.6, type: 'arrow' }],
    effects: 6,
    floaters: 2,
    skillFx: 0,
    backgroundPng: null,
  };
  const result = {
    metricsFrame: 'combat-impact',
    frames: [{ id: 'combat-impact', image: onFrame }],
    references: { all: hiddenAll, effects: hiddenEffects, floaters: hiddenAll, flash: hiddenAll },
    payload,
  };
  const feel = feelMetrics(result);
  assert.ok(feel.feedbackCoverage > 0);
  assert.equal(feel.effects, 6);
  assert.equal(feel.floaters, 2);
  assert.ok(feel.enemyContrast >= 0);

  const art = artMetrics(result);
  assert.ok(art.backgroundLevels >= 0);
  assert.ok(art.silhouetteCoverage >= 0);
  assert.equal(Number.isFinite(art.unitBackgroundDeltaE), true);
});

test('坐标换算：tile → 截图 CSS 像素', () => {
  const payload = {
    canvas: { left: 100, top: 50, width: 480, height: 240 },
    scale: 480 / (10 * 48),
    tile: 48,
    grid: { cols: 10, rows: 5 },
  };
  const [point] = toScreenPoints([{ x: 1, y: 2 }], payload);
  assert.equal(point.x, 100 + 1 * 48 * (480 / 480));
  assert.equal(point.y, 50 + 2 * 48 * (480 / 480));
  const [box] = toScreenBoxes([{ x: 1, y: 2, r: 0.5 }], payload);
  assert.ok(box.width >= 24);
  assert.equal(Math.round(box.x + box.width / 2), Math.round(point.x));
});

test('UI / 移动指标换算：对比度与触控尺寸', () => {
  const metrics = uiMetrics({
    minFontSize: 13,
    hud: { color: [240, 245, 250, 1], background: [12, 18, 22, 1] },
    shop: { color: [250, 220, 150, 1], background: [20, 26, 32, 1] },
    locked: { fontSize: 13, opacity: 0.5, visible: true },
  });
  assert.ok(metrics.hudContrast > 10);
  assert.equal(evaluateUi(metrics).ok, true);

  assert.equal(minTouchTarget([{ w: 100, h: 44, cls: 'btn' }, { w: 32, h: 32, cls: 'icon-btn' }]), 44);
  assert.equal(minTouchTarget([]), 0);

  const portrait = { viewport: { width: 390, height: 844, scrollWidth: 390 }, minFontSize: 13, targets: [{ w: 44, h: 44, cls: 'btn' }], canvas: null };
  const landscape = { viewport: { width: 844, height: 390, scrollWidth: 844 }, minFontSize: 13, targets: [{ w: 44, h: 44, cls: 'btn' }], canvas: { width: 458, height: 250 } };
  const mobile = mobileMetrics(portrait, landscape);
  assert.equal(evaluateMobile(mobile).ok, true);

  const broken = mobileMetrics(portrait, { ...landscape, viewport: { width: 844, height: 390, scrollWidth: 900 } });
  assert.equal(evaluateMobile(broken).ok, false);
});

test('两次采集比对：同图通过、改图失败', () => {
  const frame = makeImage(40, 40, [30, 30, 30, 255]);
  paint(frame, 0, 0, 20, 40, [200, 200, 200, 255]);
  const runA = [{ scene: 'combat', viewport: 'desktop', frames: [{ id: 'combat-impact', image: frame }] }];
  const same = compareRuns(runA, runA);
  assert.equal(same.ok, true);
  assert.equal(same.comparisons[0].exact, true);

  const changed = makeImage(40, 40, [80, 80, 80, 255]);
  const runB = [{ scene: 'combat', viewport: 'desktop', frames: [{ id: 'combat-impact', image: changed }] }];
  const different = compareRuns(runA, runB);
  assert.equal(different.ok, false);
  assert.equal(different.comparisons[0].exact, false);

  const missing = compareRuns(runA, [{ scene: 'combat', viewport: 'mobile', frames: [{ id: 'combat-impact', image: frame }] }]);
  assert.equal(missing.ok, false);
});

// ── 采集场景：时间断言 + 事件触发帧（gap-feel-capture-scenarios） ─────────────
// 这些用例不启动浏览器：场景计划是纯数据，页面运行时只按计划注入。

test('画质解析：auto 走设备解析路径，显式档位标记 manual，未知档位抛错', () => {
  const auto = resolveQuality('auto');
  assert.equal(auto.name, 'auto');
  assert.equal(auto.settings.qualityMode, 'auto');

  const low = resolveQuality('low');
  assert.equal(low.settings.qualityMode, 'manual');
  assert.equal(low.settings.fps, 30);
  assert.equal(resolveQuality('high').settings.fps, 60);
  assert.deepEqual(QUALITY_CHOICES, ['auto', 'low', 'high']);
  assert.throws(() => resolveQuality('ultra'), /未知画质/);
});

test('场景目录：武器 × 事件 × 飘字 × reduced-motion × 画质，id 不重复', () => {
  assert.equal(new Set(SCENARIOS).size, SCENARIOS.length);
  for (const id of ['weapons', ...EVENT_SCENARIOS, ...Object.keys(FLOATER_SCENARIOS), ...Object.keys(REDUCED_MOTION_SCENARIOS), ...Object.keys(QUALITY_SCENARIOS)]) {
    assert.ok(SCENARIOS.includes(id), `目录缺少 ${id}`);
  }
  assert.equal(EVENT_SCENARIOS.length, 7);
  assert.deepEqual([...Object.values(FLOATER_SCENARIOS)], ['all', 'key', 'off']);
  assert.deepEqual([...Object.values(QUALITY_SCENARIOS)], ['auto', 'low', 'high']);
  assert.deepEqual([...Object.values(REDUCED_MOTION_SCENARIOS)], [true, false]);
});

test('场景计划自检通过：每个场景都有帧组、帧 id 唯一、requestedTime 单调', () => {
  const report = validateScenarioPlans();
  assert.deepEqual(report.errors, []);
  assert.equal(report.ok, true);
});

test('weapons：8 组帧，towerType 覆盖 TOWERS 且互不相同，每组都放置自己的塔', () => {
  const plan = scenarioPlan('weapons');
  const types = plan.groups.map((group) => group.towerType);
  assert.equal(types.length, 8);
  assert.equal(new Set(types).size, 8);
  assert.deepEqual([...types].sort(), Object.keys(TOWERS).sort());
  assert.deepEqual([...WEAPON_TYPES].sort(), Object.keys(TOWERS).sort());
  for (const group of plan.groups) {
    assert.ok(group.setup.some((step) => step.type === 'tower' && step.tower === group.towerType), `${group.key} 没有放置 ${group.towerType}`);
    assert.equal(group.frames.length, 6);
    assert.deepEqual(group.frames.map((frame) => frame.requestedTime), [0.5, 1, 1.5, 2, 2.5, 3]);
    assert.equal(group.support, group.towerType === 'banner');
  }
});

test('事件场景：七个都有事件前后帧序列，注入动作只走确定性入口', () => {
  for (const id of EVENT_SCENARIOS) {
    const plan = scenarioPlan(id);
    const [group] = plan.groups;
    const frames = group.frames;
    assert.ok(frames.length >= 2, `${id} 帧数不足`);
    assert.equal(frames[0].role, 'before');
    assert.ok(frames.slice(1).every((frame) => frame.role === 'after'), `${id} 缺少事件后帧`);
    assert.ok(frames[0].requestedTime > 0);
    assert.ok(frames.every((frame, index) => index === 0 || frame.requestedTime >= frames[index - 1].requestedTime));
    const actions = frames.flatMap((frame) => frame.steps.filter((step) => typeof step.type === 'string'));
    assert.ok(actions.length >= 1, `${id} 没有注入动作`);
    // 只允许确定性动作：damage / leak / complete-wave / wave 等，没有随机源。
    for (const action of actions) {
      assert.ok(['damage', 'leak', 'complete-wave', 'wave'].includes(action.type), `${id} 出现非确定性动作 ${action.type}`);
    }
  }
  // 清波后模拟时钟停在 prep：后续帧必须走视觉时钟，requestedTime 不变。
  const waveclear = scenarioPlan('waveclear').groups[0].frames;
  assert.deepEqual(waveclear.map((frame) => frame.requestedTime), [1, 1, 1, 1]);
  assert.ok(waveclear.slice(1).every((frame) => frame.steps.every((step) => !Number.isFinite(step.sim))));
  assert.deepEqual(waveclear.slice(2).map((frame) => frame.visualMs), [250, 250]);
});

test('飘字三档 / reduced-motion 开关 / 画质三档：同 seed 同 t 各一帧', () => {
  const floaterFrames = Object.keys(FLOATER_SCENARIOS).map((id) => {
    const plan = scenarioPlan(id);
    assert.equal(plan.floaters, FLOATER_SCENARIOS[id]);
    assert.ok(plan.groups[0].setup.some((step) => step.type === 'floaters' && step.value === FLOATER_SCENARIOS[id]));
    const frames = plan.groups.flatMap((group) => group.frames);
    assert.equal(frames.length, 1, `${id} 必须恰好一帧`);
    return frames[0].requestedTime;
  });
  assert.deepEqual(floaterFrames, [1.25, 1.25, 1.25]);

  const motionFrames = Object.keys(REDUCED_MOTION_SCENARIOS).map((id) => {
    const plan = scenarioPlan(id);
    assert.equal(plan.reducedMotion, REDUCED_MOTION_SCENARIOS[id]);
    const frames = plan.groups.flatMap((group) => group.frames);
    assert.equal(frames.length, 1);
    assert.equal(frames[0].event, 'leak');
    assert.ok(plan.groups[0].setup.some((step) => step.type === 'reduced-motion'));
    return frames[0].requestedTime;
  });
  assert.deepEqual(motionFrames, [1, 1]);

  for (const id of Object.keys(QUALITY_SCENARIOS)) {
    const plan = scenarioPlan(id);
    assert.equal(plan.quality, QUALITY_SCENARIOS[id]);
    assert.ok(plan.groups[0].setup.some((step) => step.type === 'quality' && step.value === QUALITY_SCENARIOS[id]));
    const frames = plan.groups.flatMap((group) => group.frames);
    assert.equal(frames.length, 1);
    assert.equal(frames[0].requestedTime, 1.5);
  }
});

test('时间断言：requestedTime 与 snapshot.time 不一致时判红并写明请求 vs 实际', () => {
  const ok = checkFrameTimes([
    { key: 'combat@desktop#combat-contact', requestedTime: 2, snapshot: { time: 2 } },
    { key: 'combat@desktop#combat-mixed', requestedTime: 4.5, snapshot: { time: 4.5 } },
  ]);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.drifts, []);

  const drift = checkFrameTimes([
    { key: 'combat@desktop#combat-contact', requestedTime: 2, snapshot: { time: 2 } },
    { key: 'combat@desktop#combat-impact', requestedTime: 8, snapshot: { time: 12 } },
    { key: 'combat@desktop#combat-mixed', requestedTime: 4.5, snapshot: { time: 8 } },
  ]);
  assert.equal(drift.ok, false);
  assert.deepEqual(drift.drifts.map((item) => item.key), ['combat@desktop#combat-impact', 'combat@desktop#combat-mixed']);
  assert.equal(drift.drifts[0].requestedTime, 8);
  assert.equal(drift.drifts[0].actualTime, 12);

  const missing = checkFrameTimes([{ key: 'x#y', requestedTime: 1, snapshot: null }]);
  assert.equal(missing.ok, false);
  assert.equal(missing.drifts[0].reason, '缺少 snapshot.time');

  // 没有 requestedTime 的帧（title/lobby/map/result）不参与断言。
  assert.equal(checkFrameTimes([{ key: 'title@desktop#title', snapshot: { time: 0 } }]).ok, true);

  const error = new TimeDriftError(drift.drifts);
  assert.match(error.message, /请求 t=8s/);
  assert.match(error.message, /实际 t=12s/);
});

test('combat 三帧：请求 2 / 4.5 / 8s，manifest 按对照顺序给出 8 / 4.5 / 2', () => {
  assert.deepEqual(COMBAT_TIMELINE.map((frame) => frame.requestedTime), [2, 4.5, 8]);
  const frames = [
    { id: 'combat-contact', requestedTime: 2, snapshot: { time: 2 } },
    { id: 'combat-mixed', requestedTime: 4.5, snapshot: { time: 4.5 } },
    { id: 'combat-impact', requestedTime: 8, snapshot: { time: 8 } },
  ];
  const ordered = orderCombatFrames(frames);
  assert.deepEqual(ordered.map((frame) => frame.id), ['combat-impact', 'combat-mixed', 'combat-contact']);
  assert.deepEqual(ordered.map((frame) => frame.snapshot.time), [8, 4.5, 2]);
  // 非 combat 帧不受影响。
  assert.deepEqual(orderCombatFrames([{ id: 'title' }]).map((frame) => frame.id), ['title']);
});

test('两次采集比对：场景帧按 scenario + towerType 分组，互不串味', () => {
  const image = makeImage(24, 24, [40, 40, 40, 255]);
  const changed = makeImage(24, 24, [200, 200, 200, 255]);
  const arrow = [{ scenario: 'weapons', viewport: 'desktop', towerType: 'arrow', frames: [{ id: 'f1', image }] }];
  const cannon = [{ scenario: 'weapons', viewport: 'desktop', towerType: 'cannon', frames: [{ id: 'f1', image }] }];
  const same = compareRuns(arrow, arrow);
  assert.equal(same.ok, true);
  assert.equal(same.comparisons[0].exact, true);
  assert.match(same.comparisons[0].key, /weapons@desktop:arrow#f1/);

  const wrongGroup = compareRuns(arrow, [{ ...arrow[0], towerType: 'cannon', frames: [{ id: 'f1', image: changed }] }]);
  assert.equal(wrongGroup.ok, false);
  assert.ok(wrongGroup.comparisons.some((item) => item.reason === 'missing-first-run'));

  const differ = compareRuns([{ scenario: 'crit', viewport: 'desktop', frames: [{ id: 't0', image }] }], [{ scenario: 'crit', viewport: 'desktop', frames: [{ id: 't0', image: changed }] }]);
  assert.equal(differ.ok, false);
  assert.equal(differ.comparisons[0].exact, false);

  // cannon 与 arrow 是两组不同的帧，不互为对照。
  assert.equal(compareRuns(arrow, cannon).ok, false);
});

test('页面运行时不含 Math.random 调用（同 seed 两次采集因此逐帧一致）', () => {
  const source = buildScenarioRuntimeSource('visual-scene-seed');
  assert.equal(/Math\.random\s*\(/.test(source), false, '运行时不得调用 Math.random()');
  // 允许替换成确定性序列（赋值不是调用）。
  assert.match(source, /Math\.random\s*=/);
  assert.match(source, /__visualScenario/);
  assert.match(source, /visual-scene-seed/);
});

test('manifest 记录 scenario / seed / commit / frames[] 与每组证据', () => {
  const image = makeImage(8, 6, [10, 10, 10, 255]);
  const result = {
    scenario: 'weapons',
    viewport: 'desktop',
    quality: 'high',
    qualityActual: 'high',
    description: '八种武器',
    notes: 'n',
    elapsedMs: 12,
    groups: [{
      key: 'weapons-arrow',
      towerType: 'arrow',
      trace: { effectKinds: ['spark'], effectSignatures: ['spark:arrow'], maxProjectiles: 1, maxEffects: 2, maxFloaters: 3 },
    }, {
      key: 'weapons-banner',
      towerType: 'banner',
      support: true,
      trace: { effectKinds: ['place'], effectSignatures: [], maxProjectiles: 0, maxEffects: 1, maxFloaters: 0 },
    }],
    frames: [{
      id: 'f1',
      group: 'weapons-arrow',
      towerType: 'arrow',
      role: 'evidence',
      requestedTime: 0.5,
      timeDriven: 'sim',
      visualMs: 0,
      image,
      snapshot: { time: 0.5, effects: 2, floaters: 1, projectiles: 1, effectKinds: ['spark'], effectSignatures: ['spark:arrow'] },
    }],
    files: ['weapons-desktop-arrow-f1-high.png'],
  };
  const entry = buildScenarioManifestEntry(result, {
    commit: 'deadbeef',
    seed: 'visual-scene-seed',
    fingerprints: () => ({ pixelHash: () => 'hash', lumaSignature: () => [1, 2] }),
  });
  assert.equal(entry.scenario, 'weapons');
  assert.equal(entry.seed, 'visual-scene-seed');
  assert.equal(entry.commit, 'deadbeef');
  assert.equal(entry.frames.length, 1);
  assert.equal(entry.frames[0].requestedTime, 0.5);
  assert.equal(entry.frames[0].snapshot.time, 0.5);
  assert.equal(entry.frames[0].towerType, 'arrow');
  assert.equal(entry.frames[0].file, 'weapons-desktop-arrow-f1-high.png');
  assert.equal(entry.frames[0].pixelHash, 'hash');
  assert.equal(entry.groups[0].fired, true);
  assert.deepEqual(entry.groups[0].weaponSignatures, ['spark:arrow']);
  // 只有建造特效的组不算开过火；support 塔照实标注。
  assert.equal(entry.groups[1].fired, false);
  assert.equal(entry.groups[1].support, true);
  assert.deepEqual(entry.groups[1].weaponSignatures, []);

  const frame = frameManifestEntry({ id: 'x', requestedTime: 2, snapshot: { time: 2 }, image }, 'x.png');
  assert.equal(frame.pixelHash, null);
  assert.equal(frame.requestedTime, 2);
});
