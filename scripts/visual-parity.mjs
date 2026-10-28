#!/usr/bin/env node
// 视觉像素一致性见证：复用 tests/visual-scenes.mjs 的确定性采集路径，逐帧落 pixelHash 与 8×8 亮度网格，
// 与基线 docs/reviews/refactor-baseline.json 对照。任一帧缺失/多出/画面变了即 exit 1。
//
// 覆盖口径（PHASE_REFACTOR §7 AC-047）：5 个场景 × 各自两个视口 + 16 个 scenario × 两个视口。
// 基线本身不含时间戳与 commit：同一棵未改动的树两次采集必须逐字节一致。
//
// 判定分两级（实测依据见 PHASE_REFACTOR §8）：
//   1. 精确级：pixelHash 相同 → 该帧逐像素一致。
//   2. 变体级：pixelHash 不同时，8×8 亮度网格的单元最大差 ≤1、平均差 ≤0.25，且画面统计
//      （meanLuma/stdLuma/levels）在容差内 → 判为「同代码的渲染变体」（真实浏览器截图的字形/亚像素抖动，
//      实测跨进程单元差 ≤0.01），逐条列出；否则判真实漂移。
// 零容忍的部分：缺失帧、多出帧、亮度网格或画面统计越界——真实像素变化的幅度远大于上述容差。
//
// 用法：
//   node scripts/visual-parity.mjs --write    # 重新采集并写基线（只在确认像素变化合理时用）
//   node scripts/visual-parity.mjs --check    # 采集并与基线逐帧对照（默认）
// 选项：--quality <档位>  --baseline <文件>  --out <目录>  --json  --help
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { lumaSignature, pixelHash, regionStats } from './lib/visual-metrics.mjs';
import {
  GAME_SEED,
  SCENE_VIEWPORTS,
  SCENES,
  TEST_SEED,
  capture,
} from '../tests/visual-scenes.mjs';
import { SCENARIOS } from '../tests/visual-scenarios.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE_FILE = 'docs/reviews/refactor-baseline.json';
export const KIND = 'refactor-visual-parity';
export const VERSION = 1;
export const DEFAULT_QUALITY = 'high';
// scenario 与 combat 同视口口径：桌面 + 移动横屏（战斗只在横屏发生）。
export const SCENARIO_VIEWPORTS = Object.freeze(['desktop', 'mobile-landscape']);
export const LUMA_GRID = 8;
// 变体判定容差：8×8 网格（桌面每格约 180×112 像素）的单元差与画面统计漂移上限。
export const VARIANT_TOLERANCE = Object.freeze({
  maxCellDelta: 1,
  meanCellDelta: 0.25,
  meanLuma: 0.5,
  stdLuma: 0.5,
});

// 一帧的稳定键：场景/视口 + 帧 id（weapons 组带塔型前缀，与 contact sheet 文件名同口径）。
export function frameKey({ scene, viewport, frameId, towerType = null }) {
  const scope = towerType ? `${towerType}-` : '';
  return `${scene}@${viewport}/${scope}${frameId}`;
}

// 期望覆盖面：来自采集器的场景/视口定义本身，不另抄一份清单。
export function expectedCoverage() {
  const sceneViewports = SCENES.flatMap((scene) => (SCENE_VIEWPORTS[scene] || ['desktop']).map((viewport) => [scene, viewport]));
  return {
    scenes: [...SCENES],
    sceneViewports,
    scenarios: [...SCENARIOS],
    scenarioViewports: [...SCENARIO_VIEWPORTS],
  };
}

const round3 = (value) => Math.round(value * 1000) / 1000;

// 8×8 亮度网格：比单哈希宽容（亚像素抖动不改格均值），比阈值判定严格（少画一个元素必变多格）。
export function lumaGrid(image, size = LUMA_GRID) {
  return lumaSignature(image, size).map(round3);
}

// 帧指纹：精确像素哈希 + 亮度网格 + 画面统计（变体判定的三层依据）。
export function frameStats(image) {
  const stats = regionStats(image, { x: 0, y: 0, width: image.width, height: image.height });
  return {
    width: image.width,
    height: image.height,
    pixelHash: pixelHash(image),
    meanLuma: round3(stats.meanLuma),
    stdLuma: round3(stats.stdLuma),
    levels: stats.levels,
    lumaGrid: lumaGrid(image),
  };
}

// 采集结果的帧 → 基线条目；按 key 排序以保证字节稳定。
export function toBaselineFrames(entries) {
  const seen = new Set();
  const frames = entries.map((entry) => {
    if (seen.has(entry.key)) throw new Error(`帧键重复：${entry.key}`);
    seen.add(entry.key);
    return {
      key: entry.key,
      width: entry.width,
      height: entry.height,
      pixelHash: entry.pixelHash,
      meanLuma: round3(entry.meanLuma),
      stdLuma: round3(entry.stdLuma),
      levels: entry.levels,
      lumaGrid: entry.lumaGrid.map(round3),
    };
  });
  return frames.sort((a, b) => a.key.localeCompare(b.key));
}

export function serializeBaseline(document) {
  const coverage = expectedCoverage();
  const ordered = {
    kind: KIND,
    version: VERSION,
    quality: document.quality,
    seed: document.seed ?? GAME_SEED,
    testSeed: document.testSeed ?? TEST_SEED,
    scenes: coverage.scenes,
    sceneViewports: coverage.sceneViewports,
    scenarios: coverage.scenarios,
    scenarioViewports: coverage.scenarioViewports,
    frameCount: document.frames.length,
    frames: document.frames,
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

// 基线自检：结构、覆盖声明、帧排序与唯一性。不含浏览器，可在单测里直接跑。
export function validateBaseline(document) {
  const problems = [];
  if (document?.kind !== KIND) problems.push(`kind 应为 ${KIND}`);
  if (document?.version !== VERSION) problems.push(`version 应为 ${VERSION}`);
  const coverage = expectedCoverage();
  const asPairs = (list) => JSON.stringify(list);
  if (asPairs(document?.scenes) !== asPairs(coverage.scenes)) problems.push('scenes 覆盖与采集器定义不一致');
  if (asPairs(document?.sceneViewports) !== asPairs(coverage.sceneViewports)) problems.push('sceneViewports 覆盖与采集器定义不一致');
  if (asPairs(document?.scenarios) !== asPairs(coverage.scenarios)) problems.push('scenarios 覆盖与视觉场景集不一致');
  if (asPairs(document?.scenarioViewports) !== asPairs(coverage.scenarioViewports)) problems.push('scenarioViewports 覆盖不一致');
  const frames = Array.isArray(document?.frames) ? document.frames : null;
  if (!frames) {
    problems.push('frames 必须是数组');
    return { ok: false, problems };
  }
  if (document.frameCount !== frames.length) problems.push(`frameCount ${document.frameCount} 与实际帧数 ${frames.length} 不一致`);
  // 每个场景/视口对、每个 scenario/视口对都必须有帧，避免「基线只采了一半」被当成通过。
  for (const [scene, viewport] of coverage.sceneViewports) {
    if (!frames.some((frame) => frame.key.startsWith(`${scene}@${viewport}/`))) {
      problems.push(`缺少 ${scene}@${viewport} 的帧`);
    }
  }
  for (const scenario of coverage.scenarios) {
    for (const viewport of coverage.scenarioViewports) {
      if (!frames.some((frame) => frame.key.startsWith(`${scenario}@${viewport}/`))) {
        problems.push(`缺少 ${scenario}@${viewport} 的帧`);
      }
    }
  }
  const keys = frames.map((frame) => frame.key);
  const sorted = [...keys].sort((a, b) => a.localeCompare(b));
  if (JSON.stringify(keys) !== JSON.stringify(sorted)) problems.push('frames 未按 key 排序');
  if (new Set(keys).size !== keys.length) problems.push('frames 存在重复 key');
  for (const frame of frames) {
    const complete = frame?.key
      && Number.isFinite(frame.width)
      && Number.isFinite(frame.height)
      && typeof frame.pixelHash === 'string'
      && Number.isFinite(frame.meanLuma)
      && Number.isFinite(frame.stdLuma)
      && Number.isFinite(frame.levels)
      && Array.isArray(frame.lumaGrid)
      && frame.lumaGrid.length === LUMA_GRID * LUMA_GRID
      && frame.lumaGrid.every((value) => Number.isFinite(value));
    if (!complete) problems.push(`帧条目不完整：${JSON.stringify(frame).slice(0, 120)}`);
  }
  return { ok: problems.length === 0, problems };
}

// 亮度网格距离：单元最大差与平均差。
export function gridDistance(left, right) {
  let maxCellDelta = 0;
  let sum = 0;
  for (let i = 0; i < left.length; i += 1) {
    const delta = Math.abs(left[i] - right[i]);
    if (delta > maxCellDelta) maxCellDelta = delta;
    sum += delta;
  }
  return { maxCellDelta, meanCellDelta: left.length ? sum / left.length : 0 };
}

export function statsWithinTolerance(baselineFrame, currentFrame, tolerance = VARIANT_TOLERANCE) {
  return Math.abs(currentFrame.meanLuma - baselineFrame.meanLuma) <= tolerance.meanLuma
    && Math.abs(currentFrame.stdLuma - baselineFrame.stdLuma) <= tolerance.stdLuma
    && currentFrame.levels === baselineFrame.levels;
}

// ── 逐帧对照 ────────────────────────────────────────────────────────────────

// 返回四组结论：exact（逐像素一致）/ variants（同代码渲染变体，容差内）/ drifted（真实漂移）/ missing+extra。
export function compareFrames({ baselineFrames, currentFrames, tolerance = VARIANT_TOLERANCE }) {
  const base = new Map(baselineFrames.map((frame) => [frame.key, frame]));
  const current = new Map(currentFrames.map((frame) => [frame.key, frame]));
  const missing = [...base.keys()].filter((key) => !current.has(key)).sort();
  const extra = [...current.keys()].filter((key) => !base.has(key)).sort();
  const exact = [];
  const variants = [];
  const drifted = [];
  for (const key of [...base.keys()].sort()) {
    const currentFrame = current.get(key);
    if (!currentFrame) continue;
    const baseFrame = base.get(key);
    if (currentFrame.pixelHash === baseFrame.pixelHash) {
      exact.push(key);
      continue;
    }
    const grid = gridDistance(baseFrame.lumaGrid, currentFrame.lumaGrid);
    const statsOk = statsWithinTolerance(baseFrame, currentFrame, tolerance);
    const gridOk = grid.maxCellDelta <= tolerance.maxCellDelta && grid.meanCellDelta <= tolerance.meanCellDelta;
    const entry = {
      key,
      baseline: baseFrame.pixelHash,
      current: currentFrame.pixelHash,
      maxCellDelta: round3(grid.maxCellDelta),
      meanCellDelta: round3(grid.meanCellDelta),
      stats: {
        meanLuma: [baseFrame.meanLuma, currentFrame.meanLuma],
        stdLuma: [baseFrame.stdLuma, currentFrame.stdLuma],
        levels: [baseFrame.levels, currentFrame.levels],
      },
    };
    if (gridOk && statsOk) variants.push(entry);
    else drifted.push({ ...entry, reason: gridOk ? 'stats' : 'luma-grid' });
  }
  return {
    ok: missing.length === 0 && extra.length === 0 && drifted.length === 0,
    missing,
    extra,
    exact,
    variants,
    drifted,
  };
}

export function formatComparison(result, { limit = 20 } = {}) {
  const lines = [];
  for (const key of result.missing.slice(0, limit)) lines.push(`✗ 缺失帧 ${key}`);
  for (const key of result.extra.slice(0, limit)) lines.push(`✗ 多出帧 ${key}`);
  for (const item of result.drifted.slice(0, limit)) {
    lines.push(
      `✗ 像素漂移 ${item.key}（${item.reason}）：网格最大差 ${item.maxCellDelta} / 平均差 ${item.meanCellDelta}，`
      + `统计 ${JSON.stringify(item.stats)}`
    );
  }
  const total = result.missing.length + result.extra.length + result.drifted.length;
  if (total > limit) lines.push(`… 其余 ${total - limit} 处未展开`);
  return lines;
}

// ── 采集 ────────────────────────────────────────────────────────────────────

function sceneEntries(results) {
  return results.flatMap((result) =>
    result.frames.map((frame) => ({
      key: frameKey({ scene: result.scene, viewport: result.viewport, frameId: frame.id }),
      ...frameStats(frame.image),
    }))
  );
}

function scenarioEntries(scenarioResults) {
  return scenarioResults.flatMap((result) =>
    result.frames.map((frame) => ({
      key: frameKey({
        scene: result.scenario,
        viewport: result.viewport,
        frameId: frame.id,
        towerType: frame.towerType ?? null,
      }),
      ...frameStats(frame.image),
    }))
  );
}

// 两次采集：场景用各自的两个视口；scenario 用桌面 + 移动横屏（采集器的场景循环用 scenes: [] 关掉）。
export async function collectFrames({ quality = DEFAULT_QUALITY, outDir = null, log = () => {} } = {}) {
  const sceneRun = await capture({ scenes: [...SCENES], quality, outDir, log });
  const scenarioRun = await capture({
    scenes: [],
    scenarios: [...SCENARIOS],
    viewports: [...SCENARIO_VIEWPORTS],
    quality,
    outDir,
    log,
  });
  return [...sceneEntries(sceneRun.results), ...scenarioEntries(scenarioRun.scenarioResults)];
}

// collect 可注入：单测用假采集器跑完整的「写基线 / 对照」流程，不需要真浏览器。
export async function writeBaseline({
  baselinePath = path.join(ROOT, BASELINE_FILE),
  quality = DEFAULT_QUALITY,
  outDir = null,
  log = () => {},
  collect = collectFrames,
} = {}) {
  const entries = await collect({ quality, outDir, log });
  const document = { quality, seed: GAME_SEED, testSeed: TEST_SEED, frames: toBaselineFrames(entries) };
  // 序列化后的文档带覆盖声明，用它自检：写出的基线自身必须满足覆盖口径。
  const verdict = validateBaseline(JSON.parse(serializeBaseline(document)));
  if (!verdict.ok) throw new Error(`采集结果不满足覆盖口径：\n  - ${verdict.problems.join('\n  - ')}`);
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fs.writeFileSync(baselinePath, serializeBaseline(document));
  return { baselinePath, frames: document.frames.length, verdict };
}

export async function checkBaseline({
  baselinePath = path.join(ROOT, BASELINE_FILE),
  quality = DEFAULT_QUALITY,
  outDir = null,
  log = () => {},
  collect = collectFrames,
} = {}) {
  if (!fs.existsSync(baselinePath)) {
    return { ok: false, problems: [`基线不存在：${baselinePath}（先跑 --write）`], comparison: null };
  }
  let document;
  try {
    document = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  } catch (error) {
    return { ok: false, problems: [`基线无法解析：${error.message}`], comparison: null };
  }
  const verdict = validateBaseline(document);
  if (!verdict.ok) return { ok: false, problems: verdict.problems, comparison: null };
  const entries = await collect({ quality: document.quality || quality, outDir, log });
  const comparison = compareFrames({ baselineFrames: document.frames, currentFrames: toBaselineFrames(entries) });
  return { ok: comparison.ok, problems: [], comparison, frames: entries.length };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const options = { mode: 'check', quality: DEFAULT_QUALITY, baselinePath: path.join(ROOT, BASELINE_FILE), outDir: null, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--check') options.mode = 'check';
    else if (arg === '--write') options.mode = 'write';
    else if (arg === '--quality') options.quality = next();
    else if (arg === '--baseline') options.baselinePath = path.resolve(next());
    else if (arg === '--out') options.outDir = next();
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`未知参数：${arg}`);
  }
  return options;
}

export function formatUsage() {
  return [
    '用法：node scripts/visual-parity.mjs [--check|--write] [--quality <档位>] [--baseline <文件>] [--out <目录>] [--json]',
    `  默认 --check：采集并与 ${BASELINE_FILE} 逐帧对照（任一帧缺失/多出/像素漂移 → exit 1）。`,
    '  --write：重新采集并覆盖基线，仅用于确认像素变化合理之后。',
  ].join('\n');
}

export async function main(argv = process.argv.slice(2), { log = console.log, error = console.error } = {}) {
  const options = parseArgs(argv);
  if (options.help) {
    log(formatUsage());
    return 0;
  }
  const emit = options.json ? (line) => error(line) : log;
  if (options.mode === 'write') {
    const result = await writeBaseline({ baselinePath: options.baselinePath, quality: options.quality, outDir: options.outDir, log: emit });
    if (options.json) log(JSON.stringify({ ok: true, mode: 'write', baselinePath: result.baselinePath, frames: result.frames }, null, 2));
    else log(`visual-parity: 已写基线 ${path.relative(ROOT, result.baselinePath)}（${result.frames} 帧）`);
    return 0;
  }
  const result = await checkBaseline({ baselinePath: options.baselinePath, quality: options.quality, outDir: options.outDir, log: emit });
  if (!result.ok) {
    if (options.json) log(JSON.stringify({ ok: false, mode: 'check', problems: result.problems, comparison: result.comparison }, null, 2));
    else {
      for (const problem of result.problems) error(`✗ ${problem}`);
      for (const line of formatComparison(result.comparison || { missing: [], extra: [], drifted: [] })) error(line);
      error('visual-parity: 像素与基线不一致');
    }
    return 1;
  }
  const exactCount = result.comparison.exact.length;
  const variants = result.comparison.variants;
  if (options.json) {
    log(JSON.stringify({ ok: true, mode: 'check', frames: result.frames, exact: exactCount, variants }, null, 2));
  } else {
    log(`visual-parity: OK（${result.frames} 帧；逐像素一致 ${exactCount}，渲染变体 ${variants.length}）`);
    for (const item of variants) {
      log(`  ~ 渲染变体 ${item.key}：网格最大差 ${item.maxCellDelta} / 平均差 ${item.meanCellDelta}（容差 ${VARIANT_TOLERANCE.maxCellDelta} / ${VARIANT_TOLERANCE.meanCellDelta}）`);
    }
  }
  return 0;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((cause) => {
      console.error(`[visual-parity] ${cause.stack || cause.message}`);
      process.exitCode = 2;
    });
}
