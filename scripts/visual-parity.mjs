#!/usr/bin/env node
// 视觉像素一致性见证：复用 tests/visual-scenes.mjs 的确定性采集路径，逐帧落 pixelHash，
// 与基线 docs/reviews/refactor-baseline.json 对照。任一帧缺失/多出/哈希不同即 exit 1。
//
// 覆盖口径（PHASE_REFACTOR §7 AC-047）：5 个场景 × 各自两个视口 + 16 个 scenario × 两个视口。
// 基线本身不含时间戳与 commit：同一棵未改动的树两次采集必须逐字节一致。
//
// 用法：
//   node scripts/visual-parity.mjs --write    # 重新采集并写基线（只在确认像素变化合理时用）
//   node scripts/visual-parity.mjs --check    # 采集并与基线逐帧对照（默认）
// 选项：--quality <档位>  --baseline <文件>  --out <目录>  --json  --help
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { pixelHash } from './lib/visual-metrics.mjs';
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

// 采集结果的帧 → 基线条目：键、尺寸、pixelHash；按 key 排序以保证字节稳定。
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
    if (!frame?.key || !Number.isFinite(frame.width) || !Number.isFinite(frame.height) || !frame.pixelHash) {
      problems.push(`帧条目不完整：${JSON.stringify(frame)}`);
    }
  }
  return { ok: problems.length === 0, problems };
}

// 逐帧对照：缺失 / 多出 / 哈希不同 三类都算失败。
export function compareFrameSets(baselineFrames, currentFrames) {
  const base = new Map(baselineFrames.map((frame) => [frame.key, frame]));
  const current = new Map(currentFrames.map((frame) => [frame.key, frame]));
  const missing = [...base.keys()].filter((key) => !current.has(key)).sort();
  const extra = [...current.keys()].filter((key) => !base.has(key)).sort();
  const mismatched = [...base.keys()]
    .filter((key) => current.has(key) && current.get(key).pixelHash !== base.get(key).pixelHash)
    .sort()
    .map((key) => ({ key, baseline: base.get(key).pixelHash, current: current.get(key).pixelHash }));
  return { ok: missing.length + extra.length + mismatched.length === 0, missing, extra, mismatched };
}

export function formatComparison(result, { limit = 20 } = {}) {
  const lines = [];
  for (const key of result.missing.slice(0, limit)) lines.push(`✗ 缺失帧 ${key}`);
  for (const key of result.extra.slice(0, limit)) lines.push(`✗ 多出帧 ${key}`);
  for (const item of result.mismatched.slice(0, limit)) {
    lines.push(`✗ 像素漂移 ${item.key}：基线 ${item.baseline.slice(0, 12)} / 当前 ${item.current.slice(0, 12)}`);
  }
  const total = result.missing.length + result.extra.length + result.mismatched.length;
  if (total > limit) lines.push(`… 其余 ${total - limit} 处未展开`);
  return lines;
}

// ── 采集 ────────────────────────────────────────────────────────────────────

function sceneEntries(results) {
  return results.flatMap((result) =>
    result.frames.map((frame) => ({
      key: frameKey({ scene: result.scene, viewport: result.viewport, frameId: frame.id }),
      width: frame.image.width,
      height: frame.image.height,
      pixelHash: pixelHash(frame.image),
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
      width: frame.image.width,
      height: frame.image.height,
      pixelHash: pixelHash(frame.image),
    }))
  );
}

// 两次采集：场景用各自的两个视口；scenario 用桌面 + 移动横屏（采集器的场景循环用 scenes: [] 关掉）。
export async function collectFrameEntries({ quality = DEFAULT_QUALITY, outDir = null, log = () => {} } = {}) {
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

export async function writeBaseline({ baselinePath = path.join(ROOT, BASELINE_FILE), quality = DEFAULT_QUALITY, outDir = null, log = () => {} } = {}) {
  const entries = await collectFrameEntries({ quality, outDir, log });
  const document = { quality, seed: GAME_SEED, testSeed: TEST_SEED, frames: toBaselineFrames(entries) };
  // 序列化后的文档带覆盖声明，用它自检：写出的基线自身必须满足覆盖口径。
  const verdict = validateBaseline(JSON.parse(serializeBaseline(document)));
  if (!verdict.ok) throw new Error(`采集结果不满足覆盖口径：\n  - ${verdict.problems.join('\n  - ')}`);
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fs.writeFileSync(baselinePath, serializeBaseline(document));
  return { baselinePath, frames: document.frames.length, verdict };
}

export async function checkBaseline({ baselinePath = path.join(ROOT, BASELINE_FILE), quality = DEFAULT_QUALITY, outDir = null, log = () => {} } = {}) {
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
  const entries = await collectFrameEntries({ quality: document.quality || quality, outDir, log });
  const comparison = compareFrameSets(document.frames, toBaselineFrames(entries));
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
    `  默认 --check：采集并与 ${BASELINE_FILE} 逐帧对照（任一帧缺失/多出/哈希不同 → exit 1）。`,
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
      for (const line of formatComparison(result.comparison || { missing: [], extra: [], mismatched: [] })) error(line);
      error('visual-parity: 像素与基线不一致');
    }
    return 1;
  }
  if (options.json) log(JSON.stringify({ ok: true, mode: 'check', frames: result.frames }, null, 2));
  else log(`visual-parity: OK（${result.frames} 帧与基线逐帧一致）`);
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
