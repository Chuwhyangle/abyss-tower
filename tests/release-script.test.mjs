import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { isExcludedFromRelease, parseVersion } from '../scripts/release.mjs';

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'scripts',
  'release.mjs',
);

const versionFiles = (version, overrides = {}) => ({
  'server/config.mjs': `export const CONTENT_VERSION = process.env.CONTENT_VERSION || '${version}';\n`,
  'CHANGELOG.md': `# 更新日志\n\n版本号与 tag 保持一致。\n\n## ${version} — 2026-01-01\n\n- 测试\n`,
  'docs/PRD.md': `# 需求文档\n\n- 修订记录：\n  - ${version} 初始版本\n\n---\n\n正文\n`,
  'package.json': JSON.stringify({ name: 'fixture', version: '1.0.0' }, null, 2),
  'docs/RELEASE.md': '# 发布流程\n',
  'tasks/T1.md': '# 任务\n',
  'goals/G1.md': '# 目标\n',
  '.quay/config.yml': 'providers: {}\n',
  ...overrides,
});

const baseFiles = (overrides = {}) => versionFiles('v1.2.3', overrides);

function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-script-'));
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

const run = (root, args) =>
  spawnSync(process.execPath, [SCRIPT, ...args, '--root', root], { encoding: 'utf8' });

function snapshot(root) {
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
}

test('版本解析接受 v 前缀与裸 semver，拒绝非法版本', () => {
  assert.equal(parseVersion('v1.2.3').version, 'v1.2.3');
  assert.equal(parseVersion('1.2.3').version, 'v1.2.3');
  assert.equal(parseVersion('v2.0.0-rc.1').prerelease, 'rc.1');
  assert.throws(() => parseVersion('release-one'), /不合法/);
  assert.throws(() => parseVersion('1.2'), /不合法/);
  assert.throws(() => parseVersion(''), /不合法/);
});

test('发布树排除规则只命中任务板目录', () => {
  for (const relative of ['tasks', 'tasks/V1.md', 'goals/2026.md', '.quay/config.yml']) {
    assert.equal(isExcludedFromRelease(relative), true, relative);
  }
  for (const relative of ['docs/RELEASE.md', 'scripts/release.mjs', 'tasks.md', 'taskboard/x.md']) {
    assert.equal(isExcludedFromRelease(relative), false, relative);
  }
});

test('verify：版本、CHANGELOG、tag 一致时通过', (t) => {
  const root = gitFixture(t, baseFiles());
  git(root, ['tag', 'v1.2.3']);

  const result = run(root, ['verify', 'v1.2.3']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /发布校验 v1\.2\.3 通过/);
  assert.match(result.stdout, /tag v1\.2\.3 →/);
});

test('verify：tag 不存在时失败并点名 tag', (t) => {
  const root = gitFixture(t, baseFiles());

  const result = run(root, ['verify', 'v1.2.3']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /找不到 tag v1\.2\.3/);
});

test('verify：CHANGELOG 顶部版本不一致时点名文件与两个值', (t) => {
  const root = gitFixture(t, baseFiles({
    'CHANGELOG.md': '# 更新日志\n\n## v1.2.2 — 2025-12-01\n\n- 旧版本\n',
  }));
  git(root, ['tag', 'v1.2.3']);

  const result = run(root, ['verify', 'v1.2.3']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /CHANGELOG\.md: 顶部版本 v1\.2\.2 ≠ v1\.2\.3/);
});

test('verify：CONTENT_VERSION 不一致时点名文件与值', (t) => {
  const root = gitFixture(t, baseFiles({
    'server/config.mjs': "export const CONTENT_VERSION = process.env.CONTENT_VERSION || 'v1.2.2';\n",
  }));
  git(root, ['tag', 'v1.2.3']);

  const result = run(root, ['verify', 'v1.2.3']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /server\/config\.mjs: CONTENT_VERSION v1\.2\.2 ≠ v1\.2\.3/);
});

test('verify：tag 指向的提交内容不一致时点名该提交', (t) => {
  const root = gitFixture(t, versionFiles('v1.2.2'));
  git(root, ['tag', 'v1.2.3']);
  for (const [relative, content] of Object.entries(versionFiles('v1.2.3'))) {
    fs.writeFileSync(path.join(root, relative), content);
  }
  commitAll(root, 'bump to v1.2.3');

  const result = run(root, ['verify', 'v1.2.3']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /tag v1\.2\.3 提交：server\/config\.mjs: CONTENT_VERSION v1\.2\.2 ≠ v1\.2\.3/);
});

test('verify：非法版本号直接失败', (t) => {
  const root = gitFixture(t, baseFiles());

  const result = run(root, ['verify', 'release-one']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /不合法/);
});

test('prepare：默认 dry-run，不修改任何文件', (t) => {
  const root = gitFixture(t, baseFiles());
  const before = snapshot(root);

  const result = run(root, ['prepare', 'v1.3.0', '--date', '2026-02-02']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /dry-run：未写入任何文件/);
  assert.match(result.stdout, /CONTENT_VERSION v1\.2\.3 → v1\.3\.0/);
  assert.deepEqual(snapshot(root), before);
});

test('prepare --yes 同时更新三处版本标记', (t) => {
  const root = gitFixture(t, baseFiles());

  const result = run(root, ['prepare', 'v1.3.0', '--date', '2026-02-02', '--yes']);

  assert.equal(result.status, 0, result.stderr);

  const config = fs.readFileSync(path.join(root, 'server/config.mjs'), 'utf8');
  assert.match(config, /CONTENT_VERSION = process\.env\.CONTENT_VERSION \|\| 'v1\.3\.0'/);

  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, /## v1\.3\.0 — 2026-02-02/);
  assert.match(changelog, /## v1\.2\.3 — 2026-01-01/);

  const prd = fs.readFileSync(path.join(root, 'docs/PRD.md'), 'utf8');
  assert.match(prd, /  - v1\.3\.0 待补充。/);
});

test('prepare：目标版本低于当前版本时失败并点名两个值', (t) => {
  const root = gitFixture(t, baseFiles());

  const result = run(root, ['prepare', 'v1.2.2']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /目标版本 v1\.2\.2 低于当前版本 v1\.2\.3/);
});

test('build：默认 dry-run，只打印计划', (t) => {
  const root = gitFixture(t, baseFiles());
  const out = path.join(fixture(t, {}), 'tree');

  const result = run(root, ['build', 'v1.2.3', '--ref', 'main', '--out', out]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /dry-run：未创建任何目录/);
  assert.match(result.stdout, /排除路径：tasks、goals、\.quay/);
  assert.equal(fs.existsSync(out), false);
});

test('build --yes 生成仅代码的发布树', (t) => {
  const root = gitFixture(t, baseFiles());
  const out = path.join(fixture(t, {}), 'tree');

  const result = run(root, ['build', 'v1.2.3', '--ref', 'main', '--out', out, '--yes']);

  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(path.join(out, 'server/config.mjs')));
  assert.ok(fs.existsSync(path.join(out, 'docs/RELEASE.md')));
  assert.ok(fs.existsSync(path.join(out, 'package.json')));
  for (const excluded of ['tasks', 'goals', '.quay', '.git']) {
    assert.equal(fs.existsSync(path.join(out, excluded)), false, excluded);
  }
});

test('build：来源分支版本不一致时失败，不创建目录', (t) => {
  const root = gitFixture(t, versionFiles('v1.2.2'));
  const out = path.join(fixture(t, {}), 'tree');

  const result = run(root, ['build', 'v1.2.3', '--ref', 'main', '--out', out, '--yes']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /main：server\/config\.mjs: CONTENT_VERSION v1\.2\.2 ≠ v1\.2\.3/);
  assert.equal(fs.existsSync(out), false);
});
