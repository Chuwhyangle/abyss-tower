import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  findBelowFloor,
  formatFloorReport,
  formatTable,
  isExempt,
  MIN_LINE_COVERAGE,
  parseCoverage,
} from '../scripts/coverage.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'coverage.mjs');

const SAMPLE = [
  '# Subtest: ignored',
  'ok 1 - ignored',
  '# start of coverage report',
  '# -----------------------------------------------------------------------',
  '# file                         | line % | branch % | funcs % | uncovered lines',
  '# -----------------------------------------------------------------------',
  '# public                       |        |          |         | ',
  '#  js                          |        |          |         | ',
  '#   shared                     |        |          |         | ',
  '#    mapgen.js                 |  50.00 |    40.00 |   50.00 | 1-9',
  '#    data                      |        |          |         | ',
  '#     enemies.js               |  91.00 |    80.00 |  100.00 | 12-14',
  '# tests                        |        |          |         | ',
  '#  coverage-script.test.mjs    |  10.00 |     0.00 |    0.00 | ',
  '# -----------------------------------------------------------------------',
  '# all files                    |  60.00 |    33.33 |   50.00 | ',
  '# -----------------------------------------------------------------------',
  '# end of coverage report',
].join('\n');

function writeFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-fixture-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'subject.mjs'), [
    'export function pick(value) {',
    '  if (value > 0) {',
    "    return 'positive';",
    '  }',
    "  return 'non-positive';",
    '}',
    '',
  ].join('\n'));
  const testFile = path.join(dir, 'subject.test.mjs');
  fs.writeFileSync(testFile, [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { pick } from './subject.mjs';",
    '',
    "test('pick positive', () => {",
    "  assert.equal(pick(1), 'positive');",
    '});',
    '',
  ].join('\n'));
  return testFile;
}

function runScript(args) {
  return spawnSync(process.execPath, ['--no-warnings', SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120000,
  });
}

test('解析器还原缩进目录树中的文件名与数值', () => {
  const parsed = parseCoverage(SAMPLE);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.files.map((entry) => entry.file), [
    'public/js/shared/mapgen.js',
    'public/js/shared/data/enemies.js',
    'tests/coverage-script.test.mjs',
  ]);
  assert.deepEqual(parsed.files[1], {
    file: 'public/js/shared/data/enemies.js',
    line: 91,
    branch: 80,
    funcs: 100,
    uncovered: '12-14',
  });
  assert.deepEqual(parsed.all, { line: 60, branch: 33.33, funcs: 50 });
});

test('解析器同时接受 spec 报告器的 ℹ 前缀', () => {
  const spec = SAMPLE.replace(/^# /gm, 'ℹ ');
  const parsed = parseCoverage(spec);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.files.length, 3);
});

test('空输出与缺失结束标记返回明确失败，而不是空报告通过', () => {
  const empty = parseCoverage('');
  assert.equal(empty.ok, false);
  assert.deepEqual(empty.files, []);
  assert.match(empty.error, /未找到覆盖率报告/);

  const truncated = parseCoverage(SAMPLE.split('# end of coverage report')[0]);
  assert.equal(truncated.ok, false);
  assert.match(truncated.error, /未找到覆盖率报告/);

  const garbage = parseCoverage('意外输出\n没有任何覆盖率表');
  assert.equal(garbage.ok, false);
});

test('报告存在但没有任何文件同样视为失败', () => {
  const noFiles = [
    '# start of coverage report',
    '# file | line % | branch % | funcs % | uncovered lines',
    '# all files | 0.00 | 0.00 | 0.00 | ',
    '# end of coverage report',
  ].join('\n');
  const parsed = parseCoverage(noFiles);
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /为空/);
});

test('底线判定：等于底线通过，低于底线失败', () => {
  const files = [
    { file: 'a.mjs', line: MIN_LINE_COVERAGE, branch: 0, funcs: 0 },
    { file: 'b.mjs', line: MIN_LINE_COVERAGE - 0.01, branch: 0, funcs: 0 },
  ];
  const below = findBelowFloor(files);
  assert.deepEqual(below.map((entry) => entry.file), ['b.mjs']);
});

test('tests/ 默认豁免，自定义底线与豁免生效', () => {
  const files = [
    { file: 'tests/low.test.mjs', line: 5, branch: 0, funcs: 0 },
    { file: 'server/low.mjs', line: 5, branch: 0, funcs: 0 },
  ];
  assert.equal(isExempt('tests/low.test.mjs'), true);
  assert.equal(isExempt('server/low.mjs'), false);
  assert.deepEqual(findBelowFloor(files).map((entry) => entry.file), ['server/low.mjs']);

  const custom = findBelowFloor(files, { minLine: 0 });
  assert.deepEqual(custom, []);
  assert.deepEqual(
    findBelowFloor(files, { minLine: 10, exempt: [] }).map((entry) => entry.file),
    ['tests/low.test.mjs', 'server/low.mjs'],
  );
});

test('表格按路径排序并标注底线结论', () => {
  const parsed = parseCoverage(SAMPLE);
  const table = formatTable(parsed.files);

  const enemiesAt = table.findIndex((line) => line.includes('public/js/shared/data/enemies.js'));
  const mapgenAt = table.findIndex((line) => line.includes('public/js/shared/mapgen.js'));
  assert.ok(enemiesAt > 0 && mapgenAt > enemiesAt, '表格应按路径升序');
  assert.match(table[mapgenAt], /✗ < 60/);
  assert.match(table[enemiesAt], /✓/);
  assert.match(table.find((line) => line.includes('tests/coverage-script.test.mjs')), /豁免/);
  assert.match(table[0], /文件/);
});

test('底线清单汇总低于底线的文件', () => {
  const parsed = parseCoverage(SAMPLE);
  const lines = formatFloorReport(findBelowFloor(parsed.files)).join('\n');
  assert.match(lines, /低于底线/);
  assert.match(lines, /public\/js\/shared\/mapgen\.js（行 50\.00%）/);

  const clean = formatFloorReport([]).join('\n');
  assert.match(clean, /全部达标/);
});

test('CLI：--check 在达到底线时退出 0 并输出表格', (t) => {
  const testFile = writeFixture(t);
  const result = runScript(['--check', '--min-lines', '0', testFile]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /文件/);
  assert.match(result.stdout, /subject\.mjs/);
  assert.match(result.stdout, /全部达标/);
});

test('CLI：--check 在低于底线时退出 1 并点名文件', (t) => {
  const testFile = writeFixture(t);
  const result = runScript(['--check', '--min-lines', '100', testFile]);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /低于底线/);
  assert.match(result.stdout, /subject\.mjs/);
});

test('CLI：非法的 --min-lines 以退出码 2 拒绝', () => {
  const invalid = runScript(['--min-lines', 'abc']);
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /0 到 100/);

  const missing = runScript(['--min-lines']);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /0 到 100/);
});
