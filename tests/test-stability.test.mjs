import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildRoundArgs,
  detectTestConcurrency,
  formatPercent,
  formatReport,
  normalizeConcurrency,
  parseArgs,
  parseConcurrencyFromScript,
  parseRoundCount,
  summarizeRounds,
} from '../scripts/test-stability.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'test-stability.mjs');

function round(number, { status = 'ok', tests = 10, pass = 10, fail = 0, failedTests = [], durationMs = 1000 } = {}) {
  return { round: number, status, tests, pass, fail, failedTests, durationMs };
}

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-stability-fixture-'));
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

test('失败率以轮次为分母，全部通过时为零', () => {
  const clean = summarizeRounds([round(1), round(2), round(3)]);
  assert.equal(clean.ok, true);
  assert.equal(clean.rounds, 3);
  assert.equal(clean.passed, 3);
  assert.equal(clean.failed, 0);
  assert.equal(clean.failureRate, 0);
  assert.equal(formatPercent(clean.failureRate), '0.0%');

  const flaky = summarizeRounds([
    round(1),
    round(2, { status: 'fail', pass: 9, fail: 1, failedTests: ['tests/flaky.test.mjs'] }),
    round(3),
  ]);
  assert.equal(flaky.ok, false);
  assert.equal(flaky.failed, 1);
  assert.equal(formatPercent(flaky.failureRate), '33.3%');
  assert.equal(formatPercent(flaky.testFailureRate), '3.3%');
});

test('失败用例跨轮聚合次数与轮次，按出现次数降序', () => {
  const report = summarizeRounds([
    round(1, { status: 'fail', pass: 8, fail: 2, failedTests: ['tests/b.test.mjs', 'tests/a.test.mjs'] }),
    round(2, { status: 'fail', pass: 9, fail: 1, failedTests: ['tests/a.test.mjs'] }),
    round(3),
  ]);
  assert.deepEqual(report.failedTests, [
    { name: 'tests/a.test.mjs', count: 2, rounds: [1, 2] },
    { name: 'tests/b.test.mjs', count: 1, rounds: [1] },
  ]);
  assert.equal(report.totalTests, 30);
  assert.equal(report.totalFailedTests, 3);
});

test('超时与异常轮次计入失败，失败原因保持可见', () => {
  const report = summarizeRounds([
    round(1, { status: 'timeout', tests: 0, pass: 0, fail: 0 }),
    round(2, { status: 'error', tests: 0, pass: 0, fail: 0 }),
  ]);
  assert.equal(report.failed, 2);
  assert.equal(report.failureRate, 1);
  assert.equal(report.ok, false);

  const lines = formatReport(report, { concurrency: 2, testFiles: 3 });
  assert.match(lines[0], /2 轮 \/ 并发 2 \/ 3 个测试文件/);
  assert.match(lines[1], /✗ 超时/);
  assert.match(lines[2], /✗ 异常/);
  assert.match(lines[3], /失败率：100\.0%（2\/2 轮失败）/);
});

test('空结果不算稳定，零轮次时明确不 ok', () => {
  const empty = summarizeRounds([]);
  assert.equal(empty.ok, false);
  assert.equal(empty.rounds, 0);
  assert.equal(empty.failureRate, 0);
});

test('并发与轮数参数只接受正整数，非法值直接报错', () => {
  assert.equal(normalizeConcurrency('4'), 4);
  assert.equal(normalizeConcurrency(null), null);
  assert.throws(() => normalizeConcurrency('0'), /无效并发档位/);
  assert.throws(() => normalizeConcurrency('1.5'), /无效并发档位/);
  assert.equal(parseRoundCount('3'), 3);
  assert.throws(() => parseRoundCount('0'), /无效轮数/);
  assert.throws(() => parseRoundCount('x'), /无效轮数/);
});

test('从 package.json 的 test 脚本解析固定并发档位', () => {
  assert.equal(parseConcurrencyFromScript('node --test --test-concurrency=2 tests/*.test.mjs'), 2);
  assert.equal(parseConcurrencyFromScript('node --test tests/*.test.mjs'), null);
  assert.equal(parseConcurrencyFromScript(undefined), null);
  assert.equal(detectTestConcurrency(ROOT), 2, 'package.json 的 npm test 应固定为实测档位');
});

test('构造轮次命令：未指定并发时不覆盖 package.json 的固定档位', () => {
  assert.deepEqual(buildRoundArgs({ concurrency: null, files: ['tests/a.test.mjs'] }), [
    '--no-warnings', '--test', '--test-reporter=tap', 'tests/a.test.mjs',
  ]);
  assert.deepEqual(buildRoundArgs({ concurrency: 2, files: ['tests/a.test.mjs'] }), [
    '--no-warnings', '--test', '--test-reporter=tap', '--test-concurrency=2', 'tests/a.test.mjs',
  ]);
});

test('命令行参数：轮数、并发、文件、超时与 JSON', () => {
  const defaults = parseArgs([]);
  assert.equal(defaults.rounds, 3);
  assert.equal(defaults.concurrency, undefined, '未显式指定时沿用 package.json 档位');
  assert.equal(defaults.json, false);

  const custom = parseArgs(['--rounds=5', '--concurrency=2', '--files=a.test.mjs', '--timeout-seconds=30', '--json']);
  assert.equal(custom.rounds, 5);
  assert.equal(custom.concurrency, 2);
  assert.deepEqual(custom.files, [path.join(ROOT, 'a.test.mjs')]);
  assert.equal(custom.timeoutMs, 30000);
  assert.equal(custom.json, true);

  assert.equal(parseArgs(['--concurrency=default']).concurrency, null);
  assert.throws(() => parseArgs(['--rounds=0']), /无效轮数/);
  assert.throws(() => parseArgs(['--concurrency=0']), /无效并发档位/);
  assert.throws(() => parseArgs(['--files=']), /为空/);
  assert.throws(() => parseArgs(['--nope']), /未知参数/);
  assert.throws(() => parseArgs(['--timeout-ms=-1']), /正数/);
});

test('CLI：多轮全绿时输出失败率并退出 0', (t) => {
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

  const result = runScript([`--files=${first},${second}`, '--rounds=2', '--concurrency=1']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /稳定性：2 轮 \/ 并发 1 \/ 2 个测试文件/);
  assert.match(result.stdout, /失败率：0\.0%（0\/2 轮失败）/);
  assert.match(result.stderr, /第 2\/2 轮/);
});

test('CLI：存在失败轮次时点名失败用例并以退出码 1 结束', (t) => {
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

  const result = runScript([`--files=${good},${bad}`, '--rounds=1', '--json']);
  assert.equal(result.status, 1, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.rounds, 1);
  assert.equal(payload.failed, 1);
  assert.equal(payload.failureRate, 1);
  assert.ok(payload.failedTests.some((entry) => entry.name.includes('bad')), '应点名失败用例');
});

test('CLI：没有测试文件时以退出码 2 拒绝', (t) => {
  const dir = tempDir(t);
  const result = runScript(['--root', dir]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /未找到测试文件/);
});
