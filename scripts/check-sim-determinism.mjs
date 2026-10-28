#!/usr/bin/env node
// 模拟确定性见证：对固定 seed 集调 scripts/feel-sim-diff.mjs 的无头重跑，落 events/rng/state 三份哈希，
// 与基线 docs/reviews/sim-determinism.json 对照。重构前后逐字节一致才算「行为不变」。
//
// 复用而不是另写一套：runScene 已保证固定 startedAt、剔除 savedAt、按物理可观测字段落证，
// 这里只负责「三个 seed × 三份哈希」的登记与对照，不新增采集逻辑。
//
// 用法：
//   node scripts/check-sim-determinism.mjs --write   # 重算并写基线
//   node scripts/check-sim-determinism.mjs --check   # 重算并与基线对照（默认）
// 选项：--scene <场景>  --baseline <文件>  --json  --help
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_SEED, SCENES, runScene } from './feel-sim-diff.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE_FILE = 'docs/reviews/sim-determinism.json';
export const KIND = 'refactor-sim-determinism';
export const VERSION = 1;
export const SCENE = 'combat';
// 三个 seed：一个与视觉/手感证据共用的固定 seed，两个 feel-sim-diff 的对照 seed。
export const SEEDS = Object.freeze([DEFAULT_SEED, 'feel-sim-diff-seed-b', 'feel-sim-diff-seed-c']);
export const ARTIFACTS = Object.freeze(['events', 'rng', 'state']);

// 一次 runScene 的三份哈希（键名去掉 .json 后缀，便于按 events/rng/state 读）。
export function hashesFromArtifacts(artifacts) {
  const hashes = {};
  for (const name of ARTIFACTS) {
    const artifact = artifacts[`${name}.json`];
    if (!artifact || typeof artifact.hash !== 'string') {
      throw new Error(`场景产物缺少 ${name}.json 的哈希`);
    }
    hashes[name] = artifact.hash;
  }
  return hashes;
}

export async function collectHashes({ scene = SCENE, seeds = SEEDS, root = ROOT } = {}) {
  if (!SCENES[scene]) throw new Error(`未知场景：${scene}（可选 ${Object.keys(SCENES).join(' / ')}）`);
  const records = {};
  for (const seed of seeds) {
    const artifacts = await runScene({ scene, seed, root });
    records[seed] = hashesFromArtifacts(artifacts);
  }
  return records;
}

// 基线序列化：seed 与产物键都排序，无时间戳、无 commit，同一棵未改动的树必然字节一致。
export function serializeBaseline(document) {
  const seeds = Object.keys(document.records).sort();
  const ordered = {
    kind: KIND,
    version: VERSION,
    scene: document.scene,
    seeds,
    records: Object.fromEntries(
      seeds.map((seed) => [
        seed,
        Object.fromEntries(ARTIFACTS.map((name) => [name, document.records[seed][name]])),
      ])
    ),
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

export function validateBaseline(document, { scene = SCENE, seeds = SEEDS } = {}) {
  const problems = [];
  if (document?.kind !== KIND) problems.push(`kind 应为 ${KIND}`);
  if (document?.version !== VERSION) problems.push(`version 应为 ${VERSION}`);
  if (document?.scene !== scene) problems.push(`scene 应为 ${scene}`);
  const declared = Array.isArray(document?.seeds) ? document.seeds : [];
  const expected = [...seeds].sort();
  if (JSON.stringify(declared) !== JSON.stringify(expected)) {
    problems.push(`seeds 覆盖应为 ${expected.join(', ')}，实际 ${declared.join(', ') || '(空)'}`);
  }
  for (const seed of expected) {
    const record = document?.records?.[seed];
    if (!record) {
      problems.push(`缺少 seed ${seed} 的记录`);
      continue;
    }
    for (const name of ARTIFACTS) {
      if (typeof record[name] !== 'string' || record[name].length === 0) {
        problems.push(`seed ${seed} 缺少 ${name} 哈希`);
      }
    }
  }
  return { ok: problems.length === 0, problems };
}

// 逐 seed 逐产物对照：缺失/多出/不同都算失败，并给出首个差异的定位信息。
export function compareRecords(baselineRecords, currentRecords) {
  const problems = [];
  const seeds = [...new Set([...Object.keys(baselineRecords || {}), ...Object.keys(currentRecords || {})])].sort();
  for (const seed of seeds) {
    const left = baselineRecords?.[seed];
    const right = currentRecords?.[seed];
    if (!left) {
      problems.push(`多出 seed ${seed}（基线未登记）`);
      continue;
    }
    if (!right) {
      problems.push(`缺少 seed ${seed}（基线已登记）`);
      continue;
    }
    for (const name of ARTIFACTS) {
      if (left[name] !== right[name]) {
        problems.push(`seed ${seed} 的 ${name} 哈希不同：基线 ${String(left[name]).slice(0, 12)} / 当前 ${String(right[name]).slice(0, 12)}`);
      }
    }
  }
  return { ok: problems.length === 0, problems };
}

export async function writeBaseline({ baselinePath = path.join(ROOT, BASELINE_FILE), scene = SCENE, seeds = SEEDS, root = ROOT, log = () => {} } = {}) {
  log(`[sim-determinism] 重算 ${seeds.length} 个 seed …`);
  const records = await collectHashes({ scene, seeds, root });
  const document = { scene, records };
  const verdict = validateBaseline(JSON.parse(serializeBaseline(document)), { scene, seeds });
  if (!verdict.ok) throw new Error(`采集结果不满足基线口径：\n  - ${verdict.problems.join('\n  - ')}`);
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fs.writeFileSync(baselinePath, serializeBaseline(document));
  return { baselinePath, seeds: Object.keys(records).length };
}

export async function checkBaseline({ baselinePath = path.join(ROOT, BASELINE_FILE), scene = SCENE, seeds = SEEDS, root = ROOT, log = () => {} } = {}) {
  if (!fs.existsSync(baselinePath)) {
    return { ok: false, problems: [`基线不存在：${baselinePath}（先跑 --write）`] };
  }
  let document;
  try {
    document = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  } catch (error) {
    return { ok: false, problems: [`基线无法解析：${error.message}`] };
  }
  const verdict = validateBaseline(document, { scene, seeds });
  if (!verdict.ok) return { ok: false, problems: verdict.problems };
  const records = await collectHashes({ scene: document.scene, seeds: document.seeds, root });
  return compareRecords(document.records, records);
}

// ── CLI ─────────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const options = { mode: 'check', scene: SCENE, baselinePath: path.join(ROOT, BASELINE_FILE), json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--check') options.mode = 'check';
    else if (arg === '--write') options.mode = 'write';
    else if (arg === '--scene') options.scene = next();
    else if (arg === '--baseline') options.baselinePath = path.resolve(next());
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`未知参数：${arg}`);
  }
  return options;
}

export function formatUsage() {
  return [
    '用法：node scripts/check-sim-determinism.mjs [--check|--write] [--scene <场景>] [--baseline <文件>] [--json]',
    `  默认 --check：重跑 ${SEEDS.join(' / ')} 并对照 ${BASELINE_FILE} 的 events/rng/state 哈希。`,
    '  --write：重算并覆盖基线，仅用于确认模拟行为变化合理之后。',
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
    const result = await writeBaseline({ baselinePath: options.baselinePath, scene: options.scene, log: emit });
    if (options.json) log(JSON.stringify({ ok: true, mode: 'write', baselinePath: result.baselinePath, seeds: result.seeds }, null, 2));
    else log(`sim-determinism: 已写基线 ${path.relative(ROOT, result.baselinePath)}（${result.seeds} 个 seed）`);
    return 0;
  }
  const result = await checkBaseline({ baselinePath: options.baselinePath, scene: options.scene, log: emit });
  if (!result.ok) {
    if (options.json) log(JSON.stringify({ ok: false, mode: 'check', problems: result.problems }, null, 2));
    else {
      for (const problem of result.problems) error(`✗ ${problem}`);
      error('sim-determinism: 模拟结果与基线不一致');
    }
    return 1;
  }
  if (options.json) log(JSON.stringify({ ok: true, mode: 'check', seeds: SEEDS.length }, null, 2));
  else log(`sim-determinism: OK（${SEEDS.length} 个 seed 的 events/rng/state 三份哈希与基线一致）`);
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
      console.error(`[sim-determinism] ${cause.stack || cause.message}`);
      process.exitCode = 2;
    });
}
