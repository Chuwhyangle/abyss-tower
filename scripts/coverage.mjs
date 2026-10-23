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
  const options = { check: false, help: false, minLine: MIN_LINE_COVERAGE, files: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check') {
      options.check = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
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

function runCoverage(testFiles) {
  // 本脚本被测试运行时也可能被调用；继承的 NODE_TEST_CONTEXT 会让子进程当成测试子进程，
  // 从而不输出报告。显式剔除，保证独立运行。
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(
    process.execPath,
    ['--no-warnings', '--test', '--experimental-test-coverage', '--test-reporter=tap', ...testFiles],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env },
  );
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
      + `默认运行全部 ${listTestFiles().length} 个测试；--check 时低于文件级行覆盖率底线退出码 1。`);
    return;
  }

  const testFiles = options.files.length > 0 ? options.files : listTestFiles();
  if (testFiles.length === 0) {
    console.error('coverage: 未找到 tests/*.test.mjs');
    process.exitCode = 2;
    return;
  }

  const result = runCoverage(testFiles);
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
