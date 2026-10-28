#!/usr/bin/env node
// 视觉机械检查：采集确定性场景 → 读像素/DOM/模拟指标 → 按套件判定 → 逐项打印并给出退出码。
// 用法：node scripts/visual-check.mjs --suite feel|art|ui|mobile|all
// 关键设计：feedback 覆盖率 = 同一帧「表现层可见」与「表现层被拿掉」的像素差异，
//           因此把特效删掉或涂成背景色会直接把覆盖率打到 0，检查必然变红。
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluateSuite } from './lib/visual-metrics.mjs';
import {
  INJECTIONS,
  artMetrics,
  feelMetrics,
  minTouchTarget,
  mobileMetrics,
  toScreenBoxes,
  toScreenPoints,
  uiMetrics,
} from '../tests/lib/visual/metrics.mjs';
import { capture, resolveQuality } from '../tests/visual-scenes.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SUITES = Object.freeze(['feel', 'art', 'ui', 'mobile']);

// 指标换算与注入白名单归 harness（tests/lib/visual/metrics.mjs）；本文件只做套件编排与打印。
// re-export 保持原有导出面：既有 import 方无需改动。
export {
  INJECTIONS,
  artMetrics,
  feelMetrics,
  minTouchTarget,
  mobileMetrics,
  toScreenBoxes,
  toScreenPoints,
  uiMetrics,
} from '../tests/lib/visual/metrics.mjs';

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

