import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const EXPECTED_STEPS = [
  'npm run check:syntax',
  'npm run check:style',
  'npm run check:imports',
  'npm run check:version',
  'npm run check:docs',
  'npm test',
  'npm run coverage:changed',
];

const STEP_NAMES = EXPECTED_STEPS.map((step) => step.replace(/^npm run /, '').replace(/^npm /, ''));

function chainParts() {
  return PKG.scripts['verify:local'].split('&&').map((part) => part.trim());
}

// 用桩脚本组成的临时包跑真实链条，验证的是 npm 的 && 短路语义，而不是只匹配文本。
function makeFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-local-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const scripts = { 'verify:local': PKG.scripts['verify:local'] };
  for (const name of STEP_NAMES) scripts[name] = `node step.mjs ${name}`;

  fs.writeFileSync(
    path.join(dir, 'package.json'),
    `${JSON.stringify({ name: 'verify-local-fixture', private: true, scripts }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(dir, 'step.mjs'),
    `import fs from 'node:fs';
const name = process.argv[2];
fs.appendFileSync(process.env.VERIFY_LOG, name + '\\n');
if (process.env.VERIFY_FAIL === name) {
  console.error('已模拟 ' + name + ' 失败');
  process.exit(1);
}
`,
  );
  return dir;
}

function runChain(dir, env = {}) {
  const log = path.join(dir, 'steps.log');
  const result = spawnSync('npm', ['run', 'verify:local'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, VERIFY_LOG: log, ...env },
  });
  const steps = fs.existsSync(log)
    ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean)
    : [];
  return { result, steps };
}

test('verify:local 按固定顺序串联全部本地检查', () => {
  assert.equal(typeof PKG.scripts['verify:local'], 'string');
  assert.deepEqual(chainParts(), EXPECTED_STEPS);
  for (const name of STEP_NAMES) {
    assert.equal(typeof PKG.scripts[name], 'string', `缺少子步骤脚本 ${name}`);
  }
});

test('全部子步骤通过时按顺序执行到最后一步', (t) => {
  const dir = makeFixture(t);
  const { result, steps } = runChain(dir);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(steps, STEP_NAMES);
});

test('首个子步骤失败时立即停止', (t) => {
  const dir = makeFixture(t);
  const { result, steps } = runChain(dir, { VERIFY_FAIL: 'check:syntax' });

  assert.notEqual(result.status, 0);
  assert.deepEqual(steps, ['check:syntax']);
});

test('中间子步骤失败时停止并指出步骤名', (t) => {
  const dir = makeFixture(t);
  const { result, steps } = runChain(dir, { VERIFY_FAIL: 'check:style' });

  assert.notEqual(result.status, 0);
  assert.deepEqual(steps, ['check:syntax', 'check:style'], '风格检查失败后不应继续');
  assert.match(`${result.stdout}${result.stderr}`, /check:style/);
});

test('全量测试失败后不再执行覆盖率门禁', (t) => {
  const dir = makeFixture(t);
  const { result, steps } = runChain(dir, { VERIFY_FAIL: 'test' });

  assert.notEqual(result.status, 0);
  assert.deepEqual(steps, STEP_NAMES.slice(0, -1));
});
