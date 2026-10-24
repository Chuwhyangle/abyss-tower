#!/usr/bin/env node
// 测试稳定性治理：连续跑 N 轮全量测试，输出失败轮次率与失败用例，不修改任何断言；零第三方依赖。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { listTestFiles } from './test-changed.mjs';
import { parseTapFailures, parseTapSummary } from './test-timing.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULT_ROUNDS = 3;
export const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

// null 表示不传 --test-concurrency，沿用 package.json 中固定的并发档位。
export function normalizeConcurrency(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`无效并发档位：${value}（正整数或 default）`);
  }
  return number;
}

export function parseRoundCount(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`无效轮数：${value}（正整数）`);
  }
  return number;
}

// 默认沿用 package.json 里 `npm test` 固定下来的并发档位，避免脚本与门禁跑不同配置。
export function parseConcurrencyFromScript(script) {
  const match = String(script ?? '').match(/--test-concurrency=(\d+)/);
  return match ? normalizeConcurrency(match[1]) : null;
}

export function detectTestConcurrency(root = REPO_ROOT) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return parseConcurrencyFromScript(pkg?.scripts?.test);
  } catch {
    return null;
  }
}

export function buildRoundArgs({ concurrency = null, files = [] } = {}) {
  const args = ['--no-warnings', '--test', '--test-reporter=tap'];
  if (concurrency !== null && concurrency !== undefined) {
    args.push(`--test-concurrency=${concurrency}`);
  }
  args.push(...files);
  return args;
}

// 稳定性的分母是“轮次”：一轮里只要有一个用例失败，这一轮就算不稳定。
export function summarizeRounds(rounds) {
  const list = Array.isArray(rounds) ? rounds : [];
  const passed = list.filter((round) => round.status === 'ok').length;
  const failed = list.length - passed;
  const failures = new Map();
  let totalTests = 0;
  let totalFailedTests = 0;
  for (const round of list) {
    totalTests += Number(round.tests) || 0;
    totalFailedTests += Number(round.fail) || 0;
    for (const name of round.failedTests ?? []) {
      const entry = failures.get(name) ?? { name, count: 0, rounds: [] };
      entry.count += 1;
      entry.rounds.push(round.round);
      failures.set(name, entry);
    }
  }
  const failedTests = [...failures.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return {
    rounds: list.length,
    roundsList: list,
    passed,
    failed,
    failureRate: list.length === 0 ? 0 : failed / list.length,
    testFailureRate: totalTests === 0 ? 0 : totalFailedTests / totalTests,
    totalTests,
    totalFailedTests,
    failedTests,
    ok: list.length > 0 && failed === 0,
  };
}

export function formatPercent(ratio) {
  return `${(Number(ratio) * 100).toFixed(1)}%`;
}

function roundLine(round) {
  const seconds = `${(Number(round.durationMs) / 1000).toFixed(2)}s`;
  if (round.status === 'ok') {
    return `  轮次 ${round.round}: ✓ 通过 ${seconds}（${round.tests} 项）`;
  }
  if (round.status === 'timeout') {
    return `  轮次 ${round.round}: ✗ 超时 ${seconds}（${round.detail || '超过时限'}）`;
  }
  if (round.status === 'error') {
    return `  轮次 ${round.round}: ✗ 异常 ${seconds}（${round.detail || '未产出 TAP 汇总'}）`;
  }
  return `  轮次 ${round.round}: ✗ 失败 ${seconds}（${round.pass} 通过 / ${round.fail} 失败）`;
}

export function formatReport(report, { concurrency = null, testFiles = 0 } = {}) {
  const tier = concurrency === null || concurrency === undefined ? '默认' : String(concurrency);
  const lines = [
    `稳定性：${report.rounds} 轮 / 并发 ${tier} / ${testFiles} 个测试文件`,
    ...report.roundsList.map(roundLine),
    `失败率：${formatPercent(report.failureRate)}（${report.failed}/${report.rounds} 轮失败）`,
  ];
  if (report.totalTests > 0) {
    lines.push(`用例失败率：${formatPercent(report.testFailureRate)}（${report.totalFailedTests}/${report.totalTests} 项）`);
  }
  if (report.failedTests.length > 0) {
    lines.push('失败用例：');
    for (const entry of report.failedTests) {
      lines.push(`  ${entry.name}（${entry.count} 次，轮次 ${entry.rounds.join('、')}）`);
    }
  }
  return lines;
}

export function parseArgs(argv) {
  const options = {
    rounds: DEFAULT_ROUNDS,
    concurrency: undefined,
    files: null,
    root: REPO_ROOT,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const [flag, inline] = arg.includes('=')
      ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]
      : [arg, null];
    const value = () => {
      if (inline !== null) return inline;
      i += 1;
      return argv[i];
    };
    if (flag === '--rounds') options.rounds = parseRoundCount(value());
    else if (flag === '--concurrency') {
      const raw = value();
      options.concurrency = raw === 'default' || raw === 'auto' ? null : normalizeConcurrency(raw);
    } else if (flag === '--files') options.files = value();
    else if (flag === '--root') options.root = path.resolve(value());
    else if (flag === '--timeout-ms') options.timeoutMs = Number(value());
    else if (flag === '--timeout-seconds') options.timeoutMs = Number(value()) * 1000;
    else if (flag === '--json') options.json = true;
    else if (flag === '--help' || flag === '-h') options.help = true;
    else throw new Error(`未知参数：${arg}`);
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error('--timeout-ms 必须是正数');
  }
  if (options.files !== null) {
    options.files = options.files.split(',').map((entry) => entry.trim()).filter(Boolean)
      .map((entry) => (path.isAbsolute(entry) ? entry : path.resolve(options.root, entry)));
    if (options.files.length === 0) throw new Error('--files 为空');
  }
  return options;
}

function usage() {
  return [
    '用法：node scripts/test-stability.mjs [选项]',
    '',
    '  --rounds=<n>            连续跑 n 轮（默认 3）',
    '  --concurrency=<n>       覆盖并发档位（默认沿用 npm test 的固定档位；default 表示不传）',
    '  --files=a.test.mjs,...  只跑指定测试文件（默认 tests/*.test.mjs 全量）',
    '  --root=<dir>            仓库根目录（默认脚本所在仓库）',
    '  --timeout-ms=<ms>       单轮超时（默认 900000）',
    '  --json                  以 JSON 输出结果（进度仍走 stderr）',
    '  --help                  显示本帮助',
  ].join('\n');
}

export function runRound(round, { root = REPO_ROOT, files, concurrency = null, timeoutMs = DEFAULT_TIMEOUT_MS, execPath = process.execPath } = {}) {
  // 若本进程自身由 node --test 启动，NODE_TEST_CONTEXT 会让子进程进入测试子进程模式、不产出汇总。
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const started = process.hrtime.bigint();
  const result = spawnSync(execPath, buildRoundArgs({ concurrency, files }), {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
  const summary = parseTapSummary(result.stdout ?? '');
  const failedTests = parseTapFailures(result.stdout ?? '');

  let status = 'ok';
  let detail = '';
  if (result.error?.code === 'ETIMEDOUT') {
    status = 'timeout';
    detail = `超过 ${Math.round(timeoutMs / 1000)}s 被终止`;
  } else if (!summary.ok) {
    status = 'error';
    detail = summary.error || (result.stderr ?? '').trim().split('\n').slice(-3).join(' ');
  } else if (summary.fail > 0) {
    status = 'fail';
    detail = `${summary.fail} 项失败`;
  } else if (result.status !== 0) {
    status = 'error';
    detail = `退出码 ${result.status}${result.signal ? `（${result.signal}）` : ''}`;
  }

  return {
    round,
    status,
    durationMs,
    tests: summary.tests,
    pass: summary.pass,
    fail: summary.fail,
    failedTests,
    detail,
  };
}

function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`test-stability: ${error.message}`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log(usage());
    return;
  }

  const files = options.files ?? listTestFiles(options.root);
  if (files.length === 0) {
    console.error('test-stability: 未找到测试文件');
    process.exitCode = 2;
    return;
  }
  const concurrency = options.concurrency === undefined
    ? detectTestConcurrency(options.root)
    : options.concurrency;

  console.error(`test-stability: ${files.length} 个测试文件，${options.rounds} 轮，并发 ${concurrency ?? '默认'}`);
  const rounds = [];
  for (let index = 1; index <= options.rounds; index += 1) {
    process.stderr.write(`test-stability: 第 ${index}/${options.rounds} 轮 … `);
    const round = runRound(index, {
      root: options.root,
      files,
      concurrency,
      timeoutMs: options.timeoutMs,
    });
    rounds.push(round);
    process.stderr.write(`${(round.durationMs / 1000).toFixed(2)}s（${round.status}）\n`);
  }

  const report = summarizeRounds(rounds);
  if (options.json) {
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      concurrency,
      files: files.length,
      ...report,
    }, null, 2));
  } else {
    for (const line of formatReport(report, { concurrency, testFiles: files.length })) {
      console.log(line);
    }
  }
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
