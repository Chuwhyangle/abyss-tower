import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildTestArgs,
  displayWidth,
  formatMilliseconds,
  formatTable,
  labelFor,
  parseArgs,
  parseTapFailures,
  parseTapSummary,
  RECOMMEND_TOLERANCE,
  recommend,
} from '../scripts/test-timing.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'test-timing.mjs');

const TAP = [
  'TAP version 13',
  '# Subtest: 文本宽度',
  'ok 1 - 文本宽度',
  '  ---',
  '  duration_ms: 0.5',
  '  ...',
  '    # tests 99',
  '    # fail 99',
  '1..2',
  '# tests 2',
  '# suites 0',
  '# pass 2',
  '# fail 0',
  '# cancelled 0',
  '# skipped 0',
  '# todo 0',
  '# duration_ms 321.25',
].join('\n');

function row(level, wallMs, { status = 'ok', pass = 10, fail = 0 } = {}) {
  return { level, label: labelFor(level), wallMs, tests: pass + fail, pass, fail, status };
}

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-timing-fixture-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeFixture(dir, name, body) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, body);
  return file;
}

function runScript(args) {
  return spawnSync(process.execPath, ['--no-warnings', SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120000,
  });
}

test('解析 TAP 顶层汇总，忽略缩进的子测试汇总', () => {
  const summary = parseTapSummary(TAP);
  assert.equal(summary.ok, true);
  assert.equal(summary.tests, 2);
  assert.equal(summary.pass, 2);
  assert.equal(summary.fail, 0);
  assert.equal(summary.durationMs, 321.25);
});

test('只收集顶层失败用例，嵌套的子测试失败不重复计入', () => {
  const tap = [
    'not ok 1 - 用例 A',
    '  ---',
    '  ...',
    '    not ok 1 - 嵌套 B',
    'ok 2 - 用例 C',
  ].join('\n');
  assert.deepEqual(parseTapFailures(tap), ['用例 A']);
  assert.deepEqual(parseTapFailures(''), []);
});

test('缺少汇总或输出为空时明确失败，而不是当成零失败', () => {
  for (const text of ['', 'TAP version 13\nok 1 - 半截输出\n', '意外输出']) {
    const summary = parseTapSummary(text);
    assert.equal(summary.ok, false);
    assert.match(summary.error, /TAP 汇总/);
  }
});

test('构造测试命令：默认档位不传并发参数，指定档位追加参数', () => {
  assert.deepEqual(buildTestArgs(null, ['tests/a.test.mjs']), [
    '--no-warnings', '--test', '--test-reporter=tap', 'tests/a.test.mjs',
  ]);
  assert.deepEqual(buildTestArgs(4, ['tests/a.test.mjs']), [
    '--no-warnings', '--test', '--test-reporter=tap', '--test-concurrency=4', 'tests/a.test.mjs',
  ]);
  assert.equal(labelFor(null), '默认');
  assert.equal(labelFor(3), '3');
});

test('建议取全部通过档位中的最快值', () => {
  const advice = recommend([row(1, 22000), row(2, 18000), row(4, 19000)]);
  assert.equal(advice.ok, true);
  assert.equal(advice.level, 2);
  assert.match(advice.reason, /最快/);
});

test(`落在最快值 ${RECOMMEND_TOLERANCE * 100}% 余量内时优先更低并发`, () => {
  const advice = recommend([row(1, 1000), row(2, 1020), row(4, 1500)]);
  assert.equal(advice.ok, true);
  assert.equal(advice.level, 1);

  const reversed = recommend([row(1, 1050), row(2, 1000)]);
  assert.equal(reversed.level, 1, '1 档在 5% 余量内，仍然更稳');
});

test('默认档位明显更快时推荐保持默认', () => {
  const advice = recommend([row(1, 24000), row(2, 21000), row(null, 18000)]);
  assert.equal(advice.ok, true);
  assert.equal(advice.level, null);
  assert.equal(advice.label, '默认');
});

test('有失败或异常的档位不参与建议', () => {
  const advice = recommend([
    row(1, 30000),
    row(2, 15000, { status: 'fail', fail: 3 }),
    row(4, 16000),
  ]);
  assert.equal(advice.ok, true);
  assert.equal(advice.level, 4);

  const none = recommend([row(1, 1000, { status: 'fail', fail: 1 }), row(2, 2000, { status: 'timeout' })]);
  assert.equal(none.ok, false);
  assert.match(none.reason, /所有档位/);

  assert.equal(recommend([]).ok, false);
});

test('CJK 字符按两个显示宽度计算', () => {
  assert.equal(displayWidth('默认'), 4);
  assert.equal(displayWidth('ok'), 2);
  assert.equal(displayWidth('✓ 通过'), 6);
  assert.equal(formatMilliseconds(1234.5), '1.23s');
});

test('表格包含每个档位，并标注最快、推荐与失败状态', () => {
  const rows = [
    row(1, 22000),
    row(2, 18000, { status: 'fail', fail: 2 }),
    row(null, 18500),
  ];
  const table = formatTable(rows, { fastest: rows[2], recommended: rows[2] });
  assert.match(table[0], /^档位/);
  assert.equal(table.length, 4);

  for (const line of table) {
    assert.equal(line.split(/\s{2,}/).length, 5, `列数不一致：${line}`);
  }
  assert.match(table[1], /22\.00s/);
  assert.match(table[2], /✗ 失败/);
  assert.match(table[3], /✓ 通过（最快、推荐）/);
});

test('命令行参数：并发档位、文件、超时与 JSON', () => {
  const defaults = parseArgs([]);
  assert.deepEqual(defaults.levels, [1, 2, 4, null]);
  assert.equal(defaults.json, false);

  const custom = parseArgs(['--levels=8,default,2,2', '--files=a.test.mjs', '--timeout-seconds=30', '--json']);
  assert.deepEqual(custom.levels, [8, null, 2]);
  assert.deepEqual(custom.files, [path.join(ROOT, 'a.test.mjs')]);
  assert.equal(custom.timeoutMs, 30000);
  assert.equal(custom.json, true);

  assert.throws(() => parseArgs(['--levels=0']), /无效并发档位/);
  assert.throws(() => parseArgs(['--levels=']), /为空/);
  assert.throws(() => parseArgs(['--nope']), /未知参数/);
  assert.throws(() => parseArgs(['--timeout-ms=-1']), /正数/);
});

test('CLI：所有档位通过时输出耗时表并退出 0', (t) => {
  const dir = tempDir(t);
  const first = writeFixture(dir, 'one.test.mjs', [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "test('one', () => assert.equal(1, 1));",
    '',
  ].join('\n'));
  const second = writeFixture(dir, 'two.test.mjs', [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "test('two', () => assert.equal(2, 2));",
    '',
  ].join('\n'));

  const result = runScript(['--levels=1,2', `--files=${first},${second}`, '--timeout-ms=60000']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /档位/);
  assert.match(result.stdout, /1\s+[\d.]+s\s+2\s+0\s+✓ 通过/);
  assert.match(result.stdout, /2\s+[\d.]+s\s+2\s+0\s+✓ 通过/);
  assert.match(result.stdout, /建议：--test-concurrency=/);
  assert.match(result.stderr, /2 个测试文件/);
});

test('CLI：存在失败档位时退出 1 并说明原因', (t) => {
  const dir = tempDir(t);
  const good = writeFixture(dir, 'good.test.mjs', [
    "import test from 'node:test';",
    "test('good', () => {});",
    '',
  ].join('\n'));
  const bad = writeFixture(dir, 'bad.test.mjs', [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "test('bad', () => assert.equal(1, 2));",
    '',
  ].join('\n'));

  const result = runScript([`--files=${good},${bad}`, '--levels=2', '--json']);
  assert.equal(result.status, 1, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.rows.length, 1);
  assert.equal(payload.rows[0].status, 'fail');
  assert.ok(payload.rows[0].fail >= 1);
  assert.ok(payload.rows[0].failedTests.includes('bad'), '应记录失败用例名');
  assert.equal(payload.recommendation.ok, false);
  assert.match(payload.recommendation.reason, /所有档位/);
});

test('CLI：没有测试文件时以退出码 2 拒绝', (t) => {
  const dir = tempDir(t);
  const result = runScript(['--root', dir]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /未找到测试文件/);
});
