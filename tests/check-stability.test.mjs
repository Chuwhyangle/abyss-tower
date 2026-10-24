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

test('参数错误时以 2 退出', () => {
  const result = run(['--nope']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /check-stability:/);
});

test('package.json 暴露门禁入口', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['check:stability'], /scripts\/check-stability\.mjs/);
});
