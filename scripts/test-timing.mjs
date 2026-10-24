#!/usr/bin/env node
// 测试并发测量：以不同 --test-concurrency 档位各跑一次全量测试，记录耗时与失败数，给出稳定档位建议。
// 只测量，不修改任何测试与断言；零第三方依赖。
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { listTestFiles } from './test-changed.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// null 表示不传 --test-concurrency，沿用 Node 默认值（按 CPU 数决定）。
export const DEFAULT_LEVELS = [1, 2, 4, null];

export const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

// 建议值允许的耗时余量：落在最快档位 5% 以内的档位视为同等快。
export const RECOMMEND_TOLERANCE = 0.05;

export function labelFor(level) {
  return level === null || level === undefined ? '默认' : String(level);
}

// 解析 `node --test --test-reporter=tap` 的顶层汇总。缩进的子测试汇总不参与统计。
export function parseTapSummary(text) {
  const summary = { ok: false, tests: 0, pass: 0, fail: 0, skipped: 0, todo: 0, durationMs: 0, error: '' };
  const lines = String(text ?? '').split(/\r?\n/);
  const seen = new Set();
  for (const line of lines) {
    const match = line.match(/^#\s+(tests|pass|fail|skipped|todo|duration_ms)\s+(\d+(?:\.\d+)?)\s*$/);
    if (!match) continue;
    const key = match[1];
    const value = Number(match[2]);
    seen.add(key);
    if (key === 'duration_ms') summary.durationMs = value;
    else summary[key] = value;
  }
  if (!seen.has('tests')) {
    summary.error = '未找到 TAP 汇总（确认测试进程正常结束且使用 --test-reporter=tap）';
    return summary;
  }
  summary.ok = true;
  return summary;
}

// 顶层 `not ok` 行即失败的文件级测试；缩进的子测试行属于嵌套输出，不重复计入。
export function parseTapFailures(text) {
  const failures = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const match = line.match(/^not ok\s+\d+\s+-\s+(.+?)\s*$/);
    if (match) failures.push(match[1]);
  }
  return failures;
}

export function buildTestArgs(level, files) {
  const args = ['--no-warnings', '--test', '--test-reporter=tap'];
  if (level !== null && level !== undefined) args.push(`--test-concurrency=${level}`);
  args.push(...files);
  return args;
}

export function runLevel(level, {
  root = REPO_ROOT,
  files,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  execPath = process.execPath,
} = {}) {
  const testFiles = files ?? listTestFiles(root);
  const label = labelFor(level);
  if (testFiles.length === 0) {
    return {
      level, label, wallMs: 0, tests: 0, pass: 0, fail: 0, failedTests: [],
      status: 'error', detail: '未找到测试文件',
    };
  }

  // 若本进程自身由 node --test 启动，NODE_TEST_CONTEXT 会让子进程进入测试子进程模式、不产出汇总。
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;

  const started = process.hrtime.bigint();
  const result = spawnSync(execPath, buildTestArgs(level, testFiles), {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  const wallMs = Number(process.hrtime.bigint() - started) / 1e6;
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
    level,
    label,
    wallMs,
    tests: summary.tests,
    pass: summary.pass,
    fail: summary.fail,
    failedTests,
    status,
    detail,
  };
}

// 只在全部通过的档位里选：先取最快值，再在 5% 余量内挑并发最低的一档（并发越低越稳）。
export function recommend(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, level: null, label: '默认', wallMs: 0, reason: '没有测量结果' };
  }
  const passing = rows.filter((row) => row.status === 'ok');
  if (passing.length === 0) {
    return {
      ok: false,
      level: null,
      label: '默认',
      wallMs: 0,
      reason: '所有档位均有失败或异常，先修复不稳定的测试，再比较耗时',
    };
  }

  const fastest = passing.reduce((best, row) => (row.wallMs < best.wallMs ? row : best));
  const limit = fastest.wallMs * (1 + RECOMMEND_TOLERANCE);
  const rank = (row) => (row.level === null || row.level === undefined ? Infinity : row.level);
  const chosen = passing
    .filter((row) => row.wallMs <= limit)
    .reduce((best, row) => (rank(row) < rank(best) ? row : best));

  const gap = chosen.wallMs === 0 ? 0 : ((chosen.wallMs - fastest.wallMs) / chosen.wallMs) * 100;
  const note = gap < 0.05
    ? '与最快档位持平，并发更低更稳'
    : `仅比最快档位慢 ${gap.toFixed(1)}%，并发更低更稳`;
  return { ok: true, level: chosen.level, label: chosen.label, wallMs: chosen.wallMs, reason: note };
}

export function displayWidth(text) {
  let width = 0;
  for (const char of String(text)) {
    const code = char.codePointAt(0);
    width += (code >= 0x1100 && (
      code <= 0x115f
      || (code >= 0x2e80 && code <= 0xa4cf)
      || (code >= 0xac00 && code <= 0xd7a3)
      || (code >= 0xf900 && code <= 0xfaff)
      || (code >= 0xfe30 && code <= 0xfe6f)
      || (code >= 0xff00 && code <= 0xff60)
      || (code >= 0xffe0 && code <= 0xffe6)
    )) ? 2 : 1;
  }
  return width;
}

function padCell(text, width) {
  return `${text}${' '.repeat(Math.max(0, width - displayWidth(text)))}`;
}

export function formatMilliseconds(ms) {
  return `${(Number(ms) / 1000).toFixed(2)}s`;
}

function statusCell(row, { fastest = null, recommended = null } = {}) {
  if (row.status === 'timeout') return '✗ 超时';
  if (row.status === 'error') return '✗ 异常';
  if (row.status === 'fail') return '✗ 失败';
  const marks = [];
  if (row === fastest) marks.push('最快');
  if (row === recommended) marks.push('推荐');
  return marks.length > 0 ? `✓ 通过（${marks.join('、')}）` : '✓ 通过';
}

export function formatTable(rows, { fastest = null, recommended = null } = {}) {
  const header = ['档位', '耗时', '通过', '失败', '状态'];
  const body = rows.map((row) => [
    row.label,
    formatMilliseconds(row.wallMs),
    String(row.pass),
    String(row.fail),
    statusCell(row, { fastest, recommended }),
  ]);
  const widths = header.map((cell, index) => Math.max(
    displayWidth(cell),
    ...body.map((line) => displayWidth(line[index])),
  ));
  const render = (cells) => cells
    .map((cell, index) => padCell(cell, widths[index]))
    .join('  ')
    .trimEnd();
  return [render(header), ...body.map(render)];
}

function parseLevels(spec) {
  if (spec === null || spec === undefined) return DEFAULT_LEVELS;
  const levels = [];
  for (const part of String(spec).split(',')) {
    const token = part.trim().toLowerCase();
    if (!token) continue;
    if (token === 'default' || token === 'auto') {
      if (!levels.includes(null)) levels.push(null);
      continue;
    }
    const value = Number(token);
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`无效并发档位：${part}（正整数或 default）`);
    }
    if (!levels.includes(value)) levels.push(value);
  }
  if (levels.length === 0) throw new Error('并发档位为空');
  return levels;
}

export function parseArgs(argv) {
  const options = {
    levels: DEFAULT_LEVELS,
    files: null,
    root: REPO_ROOT,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const [flag, inline] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, null];
    const value = () => {
      if (inline !== null) return inline;
      i += 1;
      return argv[i];
    };
    if (flag === '--levels') options.levels = parseLevels(value());
    else if (flag === '--files') options.files = value();
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
    // --root 可能写在 --files 之后，因此这里才把相对路径解析成绝对路径。
    options.files = options.files.split(',').map((entry) => entry.trim()).filter(Boolean)
      .map((entry) => (path.isAbsolute(entry) ? entry : path.resolve(options.root, entry)));
    if (options.files.length === 0) throw new Error('--files 为空');
  }
  return options;
}

function usage() {
  return [
    '用法：node scripts/test-timing.mjs [选项]',
    '',
    '  --levels=1,2,4,default  并发档位（default 表示不传 --test-concurrency）',
    '  --files=a.test.mjs,...  只跑指定测试文件（默认 tests/*.test.mjs 全量）',
    '  --root=<dir>            仓库根目录（默认脚本所在仓库）',
    '  --timeout-ms=<ms>       单档位超时（默认 900000）',
    '  --json                  以 JSON 输出结果（进度仍走 stderr）',
    '  --help                  显示本帮助',
  ].join('\n');
}

function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`test-timing: ${error.message}`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log(usage());
    return;
  }

  const files = options.files ?? listTestFiles(options.root);
  if (files.length === 0) {
    console.error('test-timing: 未找到测试文件');
    process.exitCode = 2;
    return;
  }

  console.error(`test-timing: ${files.length} 个测试文件，档位 ${options.levels.map(labelFor).join(' / ')}`);
  const rows = [];
  for (const level of options.levels) {
    process.stderr.write(`test-timing: 并发 ${labelFor(level)} … `);
    const row = runLevel(level, {
      root: options.root,
      files,
      timeoutMs: options.timeoutMs,
    });
    rows.push(row);
    process.stderr.write(`${formatMilliseconds(row.wallMs)}（通过 ${row.pass}，失败 ${row.fail}）\n`);
  }

  const fastest = rows
    .filter((row) => row.status === 'ok')
    .reduce((best, row) => (best && best.wallMs <= row.wallMs ? best : row), null);
  const recommendation = recommend(rows);
  const recommendedRow = recommendation.ok
    ? rows.find((row) => row.level === recommendation.level) ?? null
    : null;

  if (options.json) {
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      files: files.length,
      rows,
      recommendation,
    }, null, 2));
  } else {
    for (const line of formatTable(rows, { fastest, recommended: recommendedRow })) console.log(line);
    for (const row of rows) {
      if (row.status === 'ok' || row.failedTests.length === 0) continue;
      console.log(`并发 ${row.label} 失败：${row.failedTests.join('、')}`);
    }
    if (recommendation.ok) {
      const target = recommendation.level === null
        ? '保持默认（不传 --test-concurrency）'
        : `--test-concurrency=${recommendation.level}`;
      console.log(`建议：${target}，耗时 ${formatMilliseconds(recommendation.wallMs)}（${recommendation.reason}）`);
    } else {
      console.log(`建议：${recommendation.reason}`);
    }
  }

  if (rows.some((row) => row.status !== 'ok')) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
