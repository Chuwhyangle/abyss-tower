#!/usr/bin/env node
// 覆盖率报告：跑 Node 内置测试覆盖率，解析为按文件排序的表，并执行文件级行覆盖率底线。
// 零第三方依赖；仅用于可见性与本地/CI 底线检查，不改变测试本身。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 文件级行覆盖率底线（百分比）。这是唯一来源；`--min-lines` 只覆盖单次运行。
export const MIN_LINE_COVERAGE = 60;

// 不参与底线判定的路径前缀：测试文件自身不要求被覆盖。
export const FLOOR_EXEMPT = ['tests/'];

const REPORT_START = 'start of coverage report';
const REPORT_END = 'end of coverage report';
// TAP 报告器用 "# " 前缀，spec 报告器用 "ℹ " 前缀。
const LINE_PREFIX = /^(?:#|ℹ) ?/;
const NUMBER = /^\d+(?:\.\d+)?$/;

const isNumberCell = (cell) => NUMBER.test(String(cell ?? '').trim());

export function listTestFiles(root = REPO_ROOT) {
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, 'tests'));
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith('.test.mjs'))
    .sort()
    .map((name) => `tests/${name}`);
}

// 解析 `node --test --experimental-test-coverage` 的报告表。
// 目录行只用于维护缩进路径栈；文件行才产出数据。
// 找不到报告或报告里没有任何文件时返回 ok:false —— 绝不伪装成通过。
export function parseCoverage(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const start = lines.findIndex((line) => line.includes(REPORT_START));
  const end = start === -1
    ? -1
    : lines.findIndex((line, index) => index > start && line.includes(REPORT_END));
  if (start === -1 || end === -1) {
    return {
      ok: false,
      error: '未找到覆盖率报告（确认测试运行器带 --experimental-test-coverage）',
      files: [],
      all: null,
    };
  }

  const dirs = [];
  const files = [];
  let all = null;

  for (const raw of lines.slice(start + 1, end)) {
    const line = raw.replace(LINE_PREFIX, '');
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('---')) continue;

    const cells = line.split('|');
    if (cells.length < 4) continue;

    const labelCell = cells[0];
    const label = labelCell.trim();
    if (!label || label === 'file') continue;

    const stats = cells.slice(1, 4).map((cell) => cell.trim());
    const depth = labelCell.length - labelCell.trimStart().length;

    if (!stats.every(isNumberCell)) {
      // 目录行（统计列为空），推进路径栈。
      dirs[depth] = label;
      dirs.length = depth + 1;
      continue;
    }

    if (label === 'all files') {
      all = { line: Number(stats[0]), branch: Number(stats[1]), funcs: Number(stats[2]) };
      continue;
    }

    files.push({
      file: label.startsWith('/') ? label : [...dirs.slice(0, depth), label].join('/'),
      line: Number(stats[0]),
      branch: Number(stats[1]),
      funcs: Number(stats[2]),
      uncovered: (cells[4] ?? '').trim(),
    });
  }

  if (files.length === 0) {
    return { ok: false, error: '覆盖率报告为空（没有解析到任何文件）', files: [], all };
  }
  return { ok: true, error: null, files, all };
}

export function isExempt(file, exempt = FLOOR_EXEMPT) {
  const normalized = String(file).replace(/\\/g, '/');
  return exempt.some((prefix) => normalized.startsWith(prefix));
}

export function findBelowFloor(files, { minLine = MIN_LINE_COVERAGE, exempt = FLOOR_EXEMPT } = {}) {
  return files.filter((entry) => !isExempt(entry.file, exempt) && entry.line < minLine);
}

// 改动文件门禁只判定脚本文件；package.json、文档等改动不参与覆盖率判定。
export const SCRIPT_FILE = /\.(?:js|mjs|cjs)$/;

export function normalizeRepoPath(file) {
  return String(file).trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

function toRepoRelative(file, root) {
  const normalized = normalizeRepoPath(file);
  if (!path.isAbsolute(normalized)) return normalized;
  return normalizeRepoPath(path.relative(root, normalized));
}

// 纯函数：把改动文件与覆盖率报告对齐，产出评估 / 未评估 / 跳过三组。
// 报告里没有的改动脚本标记为 NOT-EVALUATED —— 没有基线就不推断通过或失败。
export function selectChangedCoverage(changedFiles, coverageFiles, {
  minLine = MIN_LINE_COVERAGE,
  exempt = FLOOR_EXEMPT,
  root = REPO_ROOT,
} = {}) {
  const byFile = new Map();
  for (const entry of coverageFiles) byFile.set(toRepoRelative(entry.file, root), entry);

  const evaluated = [];
  const notEvaluated = [];
  const skipped = [];

  for (const raw of changedFiles) {
    const file = normalizeRepoPath(raw);
    if (!file) continue;
    if (!SCRIPT_FILE.test(file)) {
      skipped.push({ file, reason: '非脚本文件' });
      continue;
    }
    if (isExempt(file, exempt)) {
      skipped.push({ file, reason: '豁免路径' });
      continue;
    }
    const entry = byFile.get(file);
    if (!entry) {
      notEvaluated.push({ file, reason: '覆盖率报告未包含该文件（无基线）' });
      continue;
    }
    evaluated.push({
      file,
      line: entry.line,
      branch: entry.branch,
      funcs: entry.funcs,
      ok: entry.line >= minLine,
    });
  }

  const below = evaluated.filter((entry) => !entry.ok);
  let status = 'pass';
  if (changedFiles.length === 0) status = 'skipped';
  else if (below.length > 0) status = 'fail';
  else if (evaluated.length === 0 && notEvaluated.length > 0) status = 'not-evaluated';

  return { status, minLine, evaluated, below, notEvaluated, skipped };
}

export function formatChangedReport(selection, { base = 'develop' } = {}) {
  const { status, minLine, below, notEvaluated } = selection;
  if (status === 'skipped') {
    return [`coverage:changed: 相对 ${base} 无改动，跳过覆盖率门禁。`];
  }

  const total = selection.evaluated.length + notEvaluated.length + selection.skipped.length;
  const lines = [
    `coverage:changed: 相对 ${base} 改动 ${total} 个文件（评估 ${selection.evaluated.length}`
      + ` / 未评估 ${notEvaluated.length} / 跳过 ${selection.skipped.length}），文件级底线：行 ≥ ${minLine}%`,
  ];
  for (const entry of selection.evaluated) {
    lines.push(`  ${entry.ok ? '✓' : '✗'} ${entry.file}（行 ${fmt(entry.line)}%）`);
  }
  for (const entry of notEvaluated) {
    lines.push(`  ⚠ ${entry.file}：NOT-EVALUATED（${entry.reason}）`);
  }
  for (const entry of selection.skipped) {
    lines.push(`  - ${entry.file}：跳过（${entry.reason}）`);
  }

  if (status === 'fail') {
    const named = below.map((entry) => `${entry.file}（行 ${fmt(entry.line)}% < ${minLine}%）`).join('、');
    lines.push(`coverage:changed: 失败 —— ${below.length} 个改动文件低于底线：${named}`);
  } else if (status === 'not-evaluated') {
    lines.push('coverage:changed: NOT-EVALUATED —— 改动脚本均无覆盖率基线，无法判定。');
  } else if (selection.evaluated.length === 0 && notEvaluated.length === 0) {
    lines.push('coverage:changed: 通过 —— 改动中无参与覆盖率判定的脚本文件。');
  } else {
    lines.push('coverage:changed: 通过 —— 所有可评估的改动文件均达到底线。');
  }
  return lines;
}

export function changedFilesFor(base, root = REPO_ROOT) {
  const result = spawnSync(
    'git',
    ['-C', root, 'diff', '--name-only', '--diff-filter=d', `${base}...HEAD`],
    { encoding: 'utf8' },
  );
  if (result.error) throw new Error(`无法运行 git：${result.error.message}`);
  if (result.status !== 0) {
    const detail = (result.stderr || '').trim();
    throw new Error(`无法与基准分支 ${base} 比较（用 --check-changed <base> 指定）${detail ? `：${detail}` : ''}`);
  }
  return result.stdout.split('\n').map(normalizeRepoPath).filter(Boolean);
}

const fmt = (value) => Number(value).toFixed(2);

// 按文件路径排序的纯文本表；底线列直接给出判定。
export function formatTable(files, { minLine = MIN_LINE_COVERAGE, exempt = FLOOR_EXEMPT } = {}) {
  const sorted = [...files].sort((a, b) => a.file.localeCompare(b.file));
  const header = ['文件', '行 %', '分支 %', '函数 %', '底线'];
  const rows = sorted.map((entry) => {
    let verdict = '✓';
    if (isExempt(entry.file, exempt)) verdict = '豁免';
    else if (entry.line < minLine) verdict = `✗ < ${minLine}`;
    return [entry.file, fmt(entry.line), fmt(entry.branch), fmt(entry.funcs), verdict];
  });

  const widths = header.map((cell, index) => Math.max(
    cell.length,
    ...rows.map((row) => row[index].length),
  ));
  const render = (row) => row
    .map((cell, index) => (index === 0 ? cell.padEnd(widths[index]) : cell.padStart(widths[index])))
    .join('  ');

  return [render(header), ...rows.map(render)];
}

export function formatFloorReport(below, { minLine = MIN_LINE_COVERAGE } = {}) {
  const scope = `文件级底线：行覆盖率 ≥ ${minLine}%`;
  if (below.length === 0) return [`${scope} —— 全部达标。`];
  const lines = [`${scope} —— ${below.length} 个文件低于底线：`];
  for (const entry of below) lines.push(`  ✗ ${entry.file}（行 ${fmt(entry.line)}%）`);
  return lines;
}

function parseArgs(argv) {
  const options = {
    check: false,
    help: false,
    minLine: MIN_LINE_COVERAGE,
    files: [],
    checkChanged: null,
    root: REPO_ROOT,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check') {
      options.check = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--check-changed') {
      const value = argv[i + 1];
      i += 1;
      if (!value || value.startsWith('-')) throw new Error('--check-changed 需要基准分支名');
      options.checkChanged = value;
    } else if (arg === '--root') {
      const value = argv[i + 1];
      i += 1;
      if (!value) throw new Error('--root 需要一个目录参数');
      options.root = path.resolve(value);
    } else if (arg === '--min-lines') {
      const value = Number(argv[i + 1]);
      i += 1;
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        throw new Error('--min-lines 需要 0 到 100 之间的数字');
      }
      options.minLine = value;
    } else if (arg.startsWith('-')) {
      throw new Error(`未知参数 ${arg}`);
    } else {
      options.files.push(arg);
    }
  }
  return options;
}

function runCoverage(testFiles, root = REPO_ROOT) {
  // 本脚本被测试运行时也可能被调用；继承的 NODE_TEST_CONTEXT 会让子进程当成测试子进程，
  // 从而不输出报告。显式剔除，保证独立运行。
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(
    process.execPath,
    ['--no-warnings', '--test', '--experimental-test-coverage', '--test-reporter=tap', ...testFiles],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env },
  );
}

function runChangedCheck(options) {
  const { root, checkChanged: base, minLine } = options;
  if (process.env.SKIP_COVERAGE_CHANGED === '1') {
    console.log('coverage:changed: SKIP_COVERAGE_CHANGED=1，跳过覆盖率门禁。');
    return;
  }

  let changed;
  try {
    changed = changedFilesFor(base, root);
  } catch (error) {
    console.error(`coverage:changed: ${error.message}`);
    process.exitCode = 2;
    return;
  }
  if (changed.length === 0) {
    const selection = { status: 'skipped', minLine, evaluated: [], below: [], notEvaluated: [], skipped: [] };
    console.log(formatChangedReport(selection, { base }).join('\n'));
    return;
  }

  const testFiles = listTestFiles(root);
  if (testFiles.length === 0) {
    console.error('coverage:changed: 未找到 tests/*.test.mjs');
    process.exitCode = 2;
    return;
  }

  const result = runCoverage(testFiles, root);
  if (result.error) {
    console.error(`coverage:changed: 无法运行测试：${result.error.message}`);
    process.exitCode = 2;
    return;
  }

  const parsed = parseCoverage(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  if (!parsed.ok) {
    console.error(`coverage:changed: ${parsed.error}`);
    if (result.status !== 0) console.error(`coverage:changed: 测试退出码 ${result.status}，先运行 npm test 排查。`);
    process.exitCode = 2;
    return;
  }

  const selection = selectChangedCoverage(changed, parsed.files, { minLine, root });
  for (const line of formatChangedReport(selection, { base })) console.log(line);

  if (result.status !== 0) {
    console.error(`coverage:changed: 测试未通过（退出码 ${result.status}），覆盖率仅作参考。`);
    process.exitCode = result.status ?? 1;
    return;
  }
  if (selection.status === 'fail') process.exitCode = 1;
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`coverage: ${error.message}`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log('用法：node scripts/coverage.mjs [--check] [--min-lines <0-100>] [测试文件…]\n'
      + '      node scripts/coverage.mjs --check-changed <基准分支> [--root <目录>] [--min-lines <0-100>]\n'
      + `默认运行全部 ${listTestFiles(options.root).length} 个测试；--check 时低于文件级行覆盖率底线退出码 1。\n`
      + '--check-changed 只判定相对基准分支改动的脚本文件；无改动时跳过，无基线时标 NOT-EVALUATED。\n'
      + '设置 SKIP_COVERAGE_CHANGED=1 可跳过改动文件门禁。');
    return;
  }

  if (options.checkChanged) {
    runChangedCheck(options);
    return;
  }

  const testFiles = options.files.length > 0 ? options.files : listTestFiles(options.root);
  if (testFiles.length === 0) {
    console.error('coverage: 未找到 tests/*.test.mjs');
    process.exitCode = 2;
    return;
  }

  const result = runCoverage(testFiles, options.root);
  if (result.error) {
    console.error(`coverage: 无法运行测试：${result.error.message}`);
    process.exitCode = 2;
    return;
  }

  const parsed = parseCoverage(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  if (!parsed.ok) {
    console.error(`coverage: ${parsed.error}`);
    if (result.status !== 0) console.error(`coverage: 测试退出码 ${result.status}，先运行 npm test 排查。`);
    process.exitCode = 2;
    return;
  }

  console.log(formatTable(parsed.files, { minLine: options.minLine }).join('\n'));
  if (parsed.all) {
    console.log(`总计：行 ${fmt(parsed.all.line)}% / 分支 ${fmt(parsed.all.branch)}% / 函数 ${fmt(parsed.all.funcs)}%`);
  }

  const below = findBelowFloor(parsed.files, { minLine: options.minLine });
  for (const line of formatFloorReport(below, { minLine: options.minLine })) console.log(line);

  if (result.status !== 0) {
    console.error(`coverage: 测试未通过（退出码 ${result.status}），覆盖率仅作参考。`);
    process.exitCode = result.status ?? 1;
    return;
  }
  if (options.check && below.length > 0) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
