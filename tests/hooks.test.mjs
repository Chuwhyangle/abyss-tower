import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'install-hooks.mjs');
const FOREIGN_HOOK = '#!/bin/sh\necho "用户自己的钩子"\n';

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-hooks-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function gitRepo(t) {
  const dir = tempDir(t);
  const init = spawnSync('git', ['init', '-b', 'main'], { cwd: dir, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  return dir;
}

const hookPath = (root) => path.join(root, '.git', 'hooks', 'pre-push');

function run(root, extra = []) {
  return spawnSync(process.execPath, ['--no-warnings', SCRIPT, '--root', root, ...extra], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

// 用桩 npm + 桩版本检查脚本真实执行钩子，验证分级行为而不是只匹配文本。
function fakeToolchain(root) {
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  const log = path.join(root, 'hook.log');
  fs.writeFileSync(
    path.join(bin, 'npm'),
    `#!/bin/sh
echo "npm $*" >> "$HOOK_LOG"
if [ "\${FAKE_NPM_FAIL:-}" = "syntax" ] && [ "$1" = "run" ] && [ "$2" = "check:syntax" ]; then
  echo "syntax failed" >&2
  exit 1
fi
`,
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(root, 'scripts', 'check-version.mjs'),
    `import fs from 'node:fs';\nfs.appendFileSync(process.env.HOOK_LOG, 'version-check\\n');\n`,
  );
  return log;
}

function runHook(root, log, env = {}) {
  return spawnSync('/bin/sh', [hookPath(root)], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${path.join(root, 'bin')}:${process.env.PATH}`,
      HOOK_LOG: log,
      ...env,
    },
  });
}

test('--dry-run 输出目标路径与内容，且不写入文件', (t) => {
  const root = gitRepo(t);
  const result = run(root, ['--dry-run']);

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`pre-push 钩子目标：${hookPath(root)}`), result.stdout);
  assert.ok(result.stdout.includes('将要写入的内容：'), result.stdout);
  assert.match(result.stdout, /npm run check:syntax/);
  assert.match(result.stdout, /node scripts\/check-version\.mjs/);
  assert.match(result.stdout, /npm test/);
  assert.match(result.stdout, /npm run perf:budget/);
  assert.match(result.stdout, /HOOK_FULL/);
  assert.equal(fs.existsSync(hookPath(root)), false, 'dry-run 不应创建钩子');
});

test('安装生成可执行钩子，内容包含快速检查与完整测试开关', (t) => {
  const root = gitRepo(t);
  const result = run(root);

  assert.equal(result.status, 0, result.stderr);
  const content = fs.readFileSync(hookPath(root), 'utf8');
  assert.match(content, /^#!\/bin\/sh/);
  assert.match(content, /managed by scripts\/install-hooks\.mjs/);
  assert.match(content, /npm run check:syntax/);
  assert.match(content, /node scripts\/check-version\.mjs/);
  assert.match(content, /HOOK_FULL/);
  assert.match(content, /npm test/);
  assert.match(content, /npm run perf:budget/);
  assert.match(content, /✗ \$\{label\}未通过/, '失败信息应指出具体检查项');

  const mode = fs.statSync(hookPath(root)).mode & 0o777;
  assert.ok(mode & 0o111, `钩子应可执行，实际权限 ${mode.toString(8)}`);
});

test('默认分级只跑语法与版本一致性检查', (t) => {
  const root = gitRepo(t);
  assert.equal(run(root).status, 0);
  const log = fakeToolchain(root);

  const result = runHook(root, log);
  assert.equal(result.status, 0, result.stderr);
  const calls = fs.readFileSync(log, 'utf8');
  assert.match(calls, /^npm run check:syntax$/m);
  assert.match(calls, /^version-check$/m);
  assert.doesNotMatch(calls, /npm test/);
  assert.doesNotMatch(calls, /perf:budget/);
  assert.match(result.stdout, /已跳过完整测试与性能预算/);
});

test('HOOK_FULL=1 时加跑完整测试与性能预算', (t) => {
  const root = gitRepo(t);
  assert.equal(run(root).status, 0);
  const log = fakeToolchain(root);

  const result = runHook(root, log, { HOOK_FULL: '1' });
  assert.equal(result.status, 0, result.stderr);
  const calls = fs.readFileSync(log, 'utf8');
  assert.match(calls, /^npm run check:syntax$/m);
  assert.match(calls, /^version-check$/m);
  assert.match(calls, /^npm test$/m);
  assert.match(calls, /^npm run perf:budget$/m);
});

test('某一级检查失败时输出对应检查项并中止后续检查', (t) => {
  const root = gitRepo(t);
  assert.equal(run(root).status, 0);
  const log = fakeToolchain(root);

  const result = runHook(root, log, { FAKE_NPM_FAIL: 'syntax' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /✗ 语法检查未通过/);
  assert.doesNotMatch(fs.readFileSync(log, 'utf8'), /version-check/, '语法检查失败后不应继续');
});

test('重复安装是幂等的，第二次不修改内容', (t) => {
  const root = gitRepo(t);
  assert.equal(run(root).status, 0);
  const before = fs.readFileSync(hookPath(root), 'utf8');

  const second = run(root);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /已是最新/);
  assert.equal(fs.readFileSync(hookPath(root), 'utf8'), before);
});

test('检测到已有非本工具钩子时拒绝覆盖并提示', (t) => {
  const root = gitRepo(t);
  fs.writeFileSync(hookPath(root), FOREIGN_HOOK, { mode: 0o755 });

  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /已存在非本工具写入的 pre-push 钩子/);
  assert.match(result.stderr, /--force/);
  assert.equal(fs.readFileSync(hookPath(root), 'utf8'), FOREIGN_HOOK, '不应覆盖用户钩子');
});

test('--dry-run 遇到已有非本工具钩子时同样拒绝且不写入', (t) => {
  const root = gitRepo(t);
  fs.writeFileSync(hookPath(root), FOREIGN_HOOK, { mode: 0o755 });

  const result = run(root, ['--dry-run']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /拒绝覆盖/);
  assert.equal(fs.readFileSync(hookPath(root), 'utf8'), FOREIGN_HOOK);
});

test('--force 允许覆盖已有非本工具钩子', (t) => {
  const root = gitRepo(t);
  fs.writeFileSync(hookPath(root), FOREIGN_HOOK, { mode: 0o755 });

  const result = run(root, ['--force']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(hookPath(root), 'utf8'), /managed by scripts\/install-hooks\.mjs/);
});

test('非 git 目录以退出码 2 拒绝', (t) => {
  const root = tempDir(t);
  const result = run(root);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /不是 git 仓库/);
});
