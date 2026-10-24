import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  changedFilesFor,
  formatChangedReport,
  MIN_LINE_COVERAGE,
  selectChangedCoverage,
} from '../scripts/coverage.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'coverage.mjs');

const SUBJECT = [
  'export function pick(value) {',
  '  if (value > 0) {',
  "    return 'positive';",
  '  }',
  "  return 'non-positive';",
  '}',
  '',
].join('\n');

const SUBJECT_CHANGED = `${SUBJECT}export const changed = true;\n`;

const FIXTURE_TEST = [
  "import test from 'node:test';",
  "import assert from 'node:assert/strict';",
  "import { pick } from '../subject.mjs';",
  '',
  "test('pick positive', () => {",
  "  assert.equal(pick(1), 'positive');",
  '});',
  '',
].join('\n');

function runCli(args, env = {}) {
  return spawnSync(process.execPath, ['--no-warnings', SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120000,
    env: { ...process.env, ...env },
  });
}

function initRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-changed-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    return result.stdout.trim();
  };
  const writeSubject = (source = SUBJECT) => fs.writeFileSync(path.join(dir, 'subject.mjs'), source);
  const commit = (message) => {
    git('add', '-A');
    git('commit', '-m', message);
  };

  git('init', '-b', 'main');
  git('config', 'user.email', 'coverage-test@example.com');
  git('config', 'user.name', 'Coverage Test');
  git('config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  writeSubject();
  fs.writeFileSync(path.join(dir, 'tests', 'subject.test.mjs'), FIXTURE_TEST);

  return { dir, git, writeSubject, commit };
}

test('无改动文件时明确跳过', () => {
  const selection = selectChangedCoverage([], [{ file: 'a.js', line: 1, branch: 0, funcs: 0 }]);
  assert.equal(selection.status, 'skipped');
  const report = formatChangedReport(selection, { base: 'develop' }).join('\n');
  assert.match(report, /相对 develop 无改动，跳过覆盖率门禁/);
});

test('改动文件对齐覆盖率报告，低于底线时点名文件与百分比', () => {
  const selection = selectChangedCoverage(
    ['public/js/a.js', 'public/js/b.js', 'package.json', 'tests/x.test.mjs'],
    [
      { file: 'public/js/a.js', line: 80, branch: 70, funcs: 90 },
      { file: 'public/js/b.js', line: 55.5, branch: 40, funcs: 60 },
    ],
  );
  assert.equal(selection.status, 'fail');
  assert.deepEqual(selection.evaluated.map((entry) => entry.file), ['public/js/a.js', 'public/js/b.js']);
  assert.deepEqual(selection.below.map((entry) => entry.file), ['public/js/b.js']);
  assert.deepEqual(selection.skipped.map((entry) => entry.file), ['package.json', 'tests/x.test.mjs']);

  const report = formatChangedReport(selection, { base: 'develop' }).join('\n');
  assert.match(report, /✗ public\/js\/b\.js（行 55\.50%）/);
  assert.match(report, /失败/);
  assert.match(report, /public\/js\/b\.js（行 55\.50% < 60%）/);
});

test('报告中不存在的改动脚本标记为 NOT-EVALUATED', () => {
  const selection = selectChangedCoverage(
    ['public/js/new.js'],
    [{ file: 'public/js/other.js', line: 90, branch: 0, funcs: 0 }],
  );
  assert.equal(selection.status, 'not-evaluated');
  assert.equal(selection.evaluated.length, 0);
  assert.deepEqual(selection.notEvaluated.map((entry) => entry.file), ['public/js/new.js']);

  const report = formatChangedReport(selection).join('\n');
  assert.match(report, /public\/js\/new\.js：NOT-EVALUATED/);
  assert.match(report, /无法判定/);
});

test('绝对路径按仓库根对齐，等于底线视为通过', () => {
  const selection = selectChangedCoverage(
    ['public/js/a.js'],
    [{ file: '/repo/public/js/a.js', line: MIN_LINE_COVERAGE, branch: 0, funcs: 0 }],
    { root: '/repo' },
  );
  assert.equal(selection.status, 'pass');
  assert.deepEqual(selection.below, []);
  assert.match(formatChangedReport(selection).join('\n'), /通过/);
});

test('只改动非脚本文件时明确说明未参与判定', () => {
  const selection = selectChangedCoverage(['package.json', 'docs/PRD.md'], []);
  assert.equal(selection.status, 'pass');
  assert.deepEqual(selection.skipped.map((entry) => entry.file), ['package.json', 'docs/PRD.md']);
  assert.match(formatChangedReport(selection).join('\n'), /无参与覆盖率判定的脚本文件/);
});

test('changedFilesFor 用 git 解析相对基准的改动文件', (t) => {
  const repo = initRepo(t);
  repo.commit('base');
  const base = repo.git('rev-parse', 'HEAD');
  repo.writeSubject(SUBJECT_CHANGED);
  repo.commit('change');

  assert.deepEqual(changedFilesFor(base, repo.dir), ['subject.mjs']);
  assert.deepEqual(changedFilesFor('HEAD', repo.dir), []);
});

test('CLI：无改动时输出跳过结论且不运行测试', (t) => {
  const repo = initRepo(t);
  repo.commit('base');
  const result = runCli(['--check-changed', 'HEAD', '--root', repo.dir]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /无改动，跳过覆盖率门禁/);
  assert.doesNotMatch(result.stdout, /start of coverage report/);
});

test('CLI：改动文件达到底线时通过并输出百分比', (t) => {
  const repo = initRepo(t);
  repo.commit('base');
  const base = repo.git('rev-parse', 'HEAD');
  repo.writeSubject(SUBJECT_CHANGED);
  repo.commit('change');

  const result = runCli(['--check-changed', base, '--root', repo.dir]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /✓ subject\.mjs（行 \d+\.\d+%）/);
  assert.match(result.stdout, /coverage:changed: 通过/);
});

test('CLI：低于底线时退出 1 并点名文件与百分比', (t) => {
  const repo = initRepo(t);
  repo.commit('base');
  const base = repo.git('rev-parse', 'HEAD');
  repo.writeSubject(SUBJECT_CHANGED);
  repo.commit('change');

  const result = runCli(['--check-changed', base, '--root', repo.dir, '--min-lines', '100']);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /✗ subject\.mjs（行 \d+\.\d+%）/);
  assert.match(result.stdout, /失败/);
});

test('CLI：SKIP_COVERAGE_CHANGED=1 时明确跳过', (t) => {
  const repo = initRepo(t);
  repo.commit('base');
  const base = repo.git('rev-parse', 'HEAD');
  repo.writeSubject(SUBJECT_CHANGED);
  repo.commit('change');

  const result = runCli(['--check-changed', base, '--root', repo.dir], { SKIP_COVERAGE_CHANGED: '1' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SKIP_COVERAGE_CHANGED=1/);
});

test('CLI：--check-changed 缺少基准分支时以退出码 2 拒绝', () => {
  const missing = runCli(['--check-changed']);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /需要基准分支名/);
});
