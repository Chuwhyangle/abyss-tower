import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'scripts',
  'check-version.mjs',
);

const baseFiles = (overrides = {}) => ({
  'server/config.mjs': "export const CONTENT_VERSION = process.env.CONTENT_VERSION || 'v1.2.3';\n",
  'CHANGELOG.md': '# 更新日志\n\n## v1.2.3 — 2026-01-01\n\n- 测试\n',
  'docs/PRD.md': '# 需求文档\n\n- 修订记录：\n  - v1.2.3 初始版本\n  - v1.2.2 旧版本\n\n---\n\n正文\n',
  'package.json': JSON.stringify({ name: 'fixture', version: '1.0.0' }, null, 2),
  ...overrides,
});

function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-version-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function commitAll(root, message) {
  git(root, ['add', '-A']);
  git(root, ['-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

function gitFixture(t, files) {
  const root = fixture(t, files);
  git(root, ['init', '-b', 'main']);
  commitAll(root, 'init');
  return root;
}

const run = (root, extra = []) =>
  spawnSync(process.execPath, ['--no-warnings', SCRIPT, '--root', root, ...extra], {
    encoding: 'utf8',
  });

test('四个来源一致时通过并输出各自的值', (t) => {
  const root = fixture(t, baseFiles());
  const result = run(root);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /版本一致性检查通过/);
  assert.match(result.stdout, /server\/config\.mjs: CONTENT_VERSION = v1\.2\.3/);
  assert.match(result.stdout, /CHANGELOG\.md: 顶部版本 = v1\.2\.3/);
  assert.match(result.stdout, /docs\/PRD\.md: 修订记录包含 v1\.2\.3/);
  assert.match(result.stdout, /package\.json: version = 1\.0\.0/);
});

test('CHANGELOG 缺少当前版本条目时失败，并点名文件与数值', (t) => {
  const root = fixture(t, baseFiles({
    'CHANGELOG.md': '# 更新日志\n\n## v1.2.2 — 2025-12-01\n\n- 旧版本\n',
  }));
  const result = run(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /CHANGELOG\.md/);
  assert.match(result.stderr, /v1\.2\.2/);
  assert.match(result.stderr, /v1\.2\.3/);
});

test('PRD 修订记录缺少当前版本时失败', (t) => {
  const root = fixture(t, baseFiles({
    'docs/PRD.md': '# 需求文档\n\n- 修订记录：\n  - v1.2.2 旧版本\n\n---\n\n正文\n',
  }));
  const result = run(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /docs\/PRD\.md/);
  assert.match(result.stderr, /修订记录缺少 v1\.2\.3/);
});

test('package.json 允许独立版本，但必须是合法 semver', (t) => {
  const independent = run(fixture(t, baseFiles()));
  assert.equal(independent.status, 0, independent.stderr);
  assert.match(independent.stdout, /独立包版本/);

  const invalid = run(fixture(t, baseFiles({
    'package.json': JSON.stringify({ name: 'fixture', version: 'release-one' }),
  })));
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /package\.json/);
  assert.match(invalid.stderr, /release-one/);
});

test('--tag 指向当前 HEAD 且 CHANGELOG 有条目时通过', (t) => {
  const root = gitFixture(t, baseFiles());
  git(root, ['tag', 'v1.2.3']);

  const result = run(root, ['--tag', 'v1.2.3']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /tag v1\.2\.3/);
});

test('--tag 指向旧提交时失败，并点名 tag 与提交', (t) => {
  const root = gitFixture(t, baseFiles());
  git(root, ['tag', 'v1.2.3']);
  fs.appendFileSync(path.join(root, 'docs/PRD.md'), '\n补充。\n');
  commitAll(root, 'second');

  const result = run(root, ['--tag', 'v1.2.3']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /tag v1\.2\.3 指向/);
  assert.match(result.stderr, /HEAD/);
});

test('--tag 不存在时失败', (t) => {
  const root = gitFixture(t, baseFiles());

  const result = run(root, ['--tag', 'v9.9.9']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /找不到 tag v9\.9\.9/);
});

test('检查过程只读，不修改任何文件', (t) => {
  const root = gitFixture(t, baseFiles());
  git(root, ['tag', 'v1.2.3']);
  const snapshot = () => {
    const entries = {};
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir)) {
        if (name === '.git') continue;
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) walk(full);
        else entries[path.relative(root, full)] = fs.readFileSync(full, 'utf8');
      }
    };
    walk(root);
    return entries;
  };
  const before = snapshot();

  run(root, ['--tag', 'v1.2.3']);

  assert.deepEqual(snapshot(), before);
});
