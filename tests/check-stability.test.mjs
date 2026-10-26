// 稳定性门禁脚本：失败必须输出 CAUSE= 并以非 0 退出，全部通过才放行。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { causeLine } from '../scripts/check-stability.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'check-stability.mjs');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-stability-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeTest(dir, name, body) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, body);
  return file;
}

const PASSING = "import test from 'node:test';\nimport assert from 'node:assert/strict';\n"
  + "test('ok', () => assert.equal(1, 1));\n";
const FAILING = "import test from 'node:test';\nimport assert from 'node:assert/strict';\n"
  + "test('稳定性夹具失败', () => assert.equal(1, 2));\n";
// before() 抛错时该文件每个用例各输出一条 `not ok` 且 failureType 都是 hookFailed：
// 只看看例名会把「整文件没起来」误读成「N 个断言坏了」，证据落盘要保留 failureType。
const HOOK_FAILING = "import test, { before } from 'node:test';\n"
  + "before(() => { throw new Error('before boom'); });\n"
  + "test('甲', () => {});\n"
  + "test('乙', () => {});\n";

function run(args) {
  return spawnSync(process.execPath, ['--no-warnings', SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120000,
  });
}

test('causeLine 按轮次状态给出可检索的原因', () => {
  assert.equal(
    causeLine({ round: 2, status: 'fail', fail: 1, failedTests: ['稳定性夹具失败'], detail: '' }),
    'CAUSE=full suite failed on run 2（1 项失败：稳定性夹具失败）'
  );
  assert.match(causeLine({ round: 1, status: 'timeout', detail: '超过 1s 被终止' }), /^CAUSE=full suite timed out on run 1/);
  assert.match(causeLine({ round: 3, status: 'error', detail: '未产出 TAP 汇总' }), /^CAUSE=full suite errored on run 3/);
});

test('连续多轮通过时退出码 0', (t) => {
  const dir = tempDir(t);
  const file = writeTest(dir, 'pass.test.mjs', PASSING);
  const result = run([`--rounds=2`, `--root=${dir}`, `--files=${file}`]);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /CAUSE=/);
  assert.match(result.stdout, /失败率：0\.0%/);
});

test('任一轮失败时输出 CAUSE= 并以 1 退出', (t) => {
  const dir = tempDir(t);
  const file = writeTest(dir, 'fail.test.mjs', FAILING);
  const result = run([`--rounds=2`, `--root=${dir}`, `--files=${file}`]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /CAUSE=full suite failed on run 1（1 项失败：稳定性夹具失败）/);
  assert.match(result.stderr, /CAUSE=full suite failed on run 2/);
});

test('before() 抛错的失败轮：CAUSE 含 hookFailed 与证据路径，原始 TAP 落盘', (t) => {
  const dir = tempDir(t);
  const file = writeTest(dir, 'hook-fail.test.mjs', HOOK_FAILING);
  const result = run([`--rounds=1`, `--root=${dir}`, `--files=${file}`]);
  assert.equal(result.status, 1, result.stderr);

  const cause = result.stderr.split('\n').find((line) => line.startsWith('CAUSE='));
  assert.ok(cause, `stderr 应有 CAUSE= 行：${result.stderr}`);
  assert.match(cause, /hookFailed/);
  const evidence = cause.match(/证据 (\S+\.tap)/);
  assert.ok(evidence, `CAUSE 行应带证据文件路径：${cause}`);
  assert.equal(fs.existsSync(evidence[1]), true, `证据文件应落盘：${evidence[1]}`);

  const tap = fs.readFileSync(evidence[1], 'utf8');
  assert.match(tap, /failureType: 'hookFailed'/, '证据应保留 failureType');
  assert.match(tap, /hook-fail\.test\.mjs/, '证据应能定位到具体文件');
  for (const name of ['甲', '乙']) {
    assert.ok(tap.includes(name), `证据应保留用例名 ${name}`);
  }
});

test('全部通过的轮次不产生失败证据文件', (t) => {
  const dir = tempDir(t);
  const file = writeTest(dir, 'pass.test.mjs', PASSING);
  const result = run([`--rounds=2`, `--root=${dir}`, `--files=${file}`]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(dir, '.quay', 'stability')), false);
});

test('causeLine 在失败轮附 failureType 与证据路径', () => {
  const line = causeLine({
    round: 2,
    status: 'fail',
    fail: 7,
    failedTests: ['同一事件重复写入保持幂等'],
    failureTypes: ['hookFailed'],
    evidencePath: '/tmp/stability/round-2-x.tap',
    detail: '',
  });
  assert.match(line, /failureType=hookFailed/);
  assert.match(line, /证据 \/tmp\/stability\/round-2-x\.tap/);
  assert.match(line, /^CAUSE=full suite failed on run 2/);
});

test('参数错误时以 2 退出', () => {
  const result = run(['--nope']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /check-stability:/);
});

test('package.json 暴露门禁入口', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['check:stability'], /scripts\/check-stability\.mjs/);
});
