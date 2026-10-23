import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { formatReport, listTestFiles, selectTests, TEST_MAP } from '../scripts/test-changed.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'test-changed.mjs');
const ALL = listTestFiles(ROOT);

test('命中显式映射时只跑相关测试', () => {
  const result = selectTests(['public/js/settings.js'], { testFiles: ALL });
  assert.equal(result.mode, 'selected');
  assert.deepEqual(result.tests, [
    'tests/audio-mix.test.mjs',
    'tests/music.test.mjs',
    'tests/settings.test.mjs',
    'tests/skill-audio.test.mjs',
  ]);
});

test('多个改动文件的选中结果去重合并', () => {
  const result = selectTests(
    ['public/js/app/input.js', 'public/js/app/controller.js', 'server/http/respond.mjs'],
    { testFiles: ALL },
  );
  assert.equal(result.mode, 'selected');
  assert.deepEqual(result.tests, [
    'tests/controller-wiring.test.mjs',
    'tests/http-hardening.test.mjs',
    'tests/mobile-input.test.mjs',
    'tests/security-headers.test.mjs',
  ]);
});

test('共享文件 sim.js 回退全量并说明原因', () => {
  const result = selectTests(['public/js/sim.js', 'public/js/settings.js'], { testFiles: ALL });
  assert.equal(result.mode, 'full');
  assert.deepEqual(result.tests, ALL);
  assert.equal(result.fullReasons.length, 1);
  assert.match(result.fullReasons[0].reason, /sim\.js/);

  const report = formatReport(result).join('\n');
  assert.match(report, /回退全量/);
  assert.match(report, /public\/js\/sim\.js/);
});

test('shared/ 目录改动回退全量', () => {
  const result = selectTests(['public/js/shared/mapgen.js'], { testFiles: ALL });
  assert.equal(result.mode, 'full');
  assert.match(result.fullReasons[0].reason, /shared\//);
});

test('未覆盖映射的文件回退全量并说明原因', () => {
  const result = selectTests(['docs/PRD.md'], { testFiles: ALL });
  assert.equal(result.mode, 'full');
  assert.deepEqual(result.tests, ALL);
  assert.match(result.fullReasons[0].reason, /未覆盖映射/);

  const report = formatReport(result).join('\n');
  assert.match(report, /docs\/PRD\.md/);
  assert.match(report, /未覆盖映射/);
});

test('改动测试文件时只跑该测试', () => {
  const result = selectTests(['tests/settings.test.mjs'], { testFiles: ALL });
  assert.equal(result.mode, 'selected');
  assert.deepEqual(result.tests, ['tests/settings.test.mjs']);
});

test('映射目标不在候选测试中时回退全量', () => {
  const result = selectTests(['public/js/settings.js'], { testFiles: ['tests/other.test.mjs'] });
  assert.equal(result.mode, 'full');
  assert.deepEqual(result.tests, ['tests/other.test.mjs']);
});

test('无改动时跳过', () => {
  const result = selectTests([], { testFiles: ALL });
  assert.equal(result.mode, 'none');
  assert.deepEqual(result.tests, []);
  assert.match(formatReport(result, { base: 'develop' }).join('\n'), /无改动/);
});

test('映射集中在一处且目标测试真实存在', () => {
  const known = new Set(ALL);
  for (const rule of TEST_MAP) {
    assert.ok(rule.tests.length > 0, `${rule.match} 未声明测试`);
    for (const target of rule.tests) {
      assert.ok(known.has(target), `${rule.match} 映射到不存在的测试 ${target}`);
      assert.ok(fs.existsSync(path.join(ROOT, target)), `${target} 不存在`);
    }
  }
});

test('CLI 在基准分支不存在时以非零码退出并给出提示', () => {
  const result = spawnSync(
    process.execPath,
    ['--no-warnings', SCRIPT, '--base', 'no-such-branch-for-test-changed'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--base/);
});
