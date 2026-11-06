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
if [ "\${FAKE_NPM_FAIL:-}" = "verify-local" ] && [ "$1" = "run" ] && [ "$2" = "verify:local" ]; then
  echo "verify failed" >&2
  exit 1
fi
`,
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(root, 'scripts', 'check-version.mjs'),
    `import fs from 'node:fs';\nfs.appendFileSync(process.env.HOOK_LOG, 'version-check\\n');\n`,
  );
  fs.writeFileSync(
    path.join(root, 'scripts', 'import-graph.mjs'),
    `import fs from 'node:fs';
fs.appendFileSync(process.env.HOOK_LOG, 'import-graph\\n');
if (process.env.FAKE_IMPORT_FAIL === '1') {
  console.error("✗ public/js/shared/bad.js:1  import '../app/upper.js'");
  process.exitCode = 1;
}
`,
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
  assert.match(result.stdout, /node --no-warnings scripts\/import-graph\.mjs/);
  assert.match(result.stdout, /npm run verify:local/);
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
  assert.match(content, /node --no-warnings scripts\/import-graph\.mjs/);
  assert.match(content, /依赖图检查/);
  assert.match(content, /HOOK_FULL/);
  assert.match(content, /npm run verify:local/);
  assert.match(content, /npm run perf:budget/);
  assert.match(content, /✗ \$\{label\}未通过/, '失败信息应指出具体检查项');

  const mode = fs.statSync(hookPath(root)).mode & 0o777;
  assert.ok(mode & 0o111, `钩子应可执行，实际权限 ${mode.toString(8)}`);
});

test('默认分级跑语法、版本一致性与依赖图检查', (t) => {
  const root = gitRepo(t);
  assert.equal(run(root).status, 0);
  const log = fakeToolchain(root);

  const result = runHook(root, log);
  assert.equal(result.status, 0, result.stderr);
  const calls = fs.readFileSync(log, 'utf8');
  assert.match(calls, /^npm run check:syntax$/m);
  assert.match(calls, /^version-check$/m);
  assert.match(calls, /^import-graph$/m);
  assert.doesNotMatch(calls, /npm test/);
  assert.doesNotMatch(calls, /perf:budget/);
  assert.match(result.stdout, /已跳过完整测试与性能预算/);
  assert.match(result.stdout, /\[pre-push\] 依赖图检查/);
});

test('HOOK_FULL=1 时改跑 verify:local 与性能预算', (t) => {
  const root = gitRepo(t);
  assert.equal(run(root).status, 0);
  const log = fakeToolchain(root);

  const result = runHook(root, log, { HOOK_FULL: '1' });
  assert.equal(result.status, 0, result.stderr);
  const calls = fs.readFileSync(log, 'utf8');
  assert.match(calls, /^npm run verify:local$/m);
  assert.match(calls, /^npm run perf:budget$/m);
  assert.doesNotMatch(calls, /^npm run check:syntax$/m, '快速检查已包含在 verify:local 中，不应重复执行');
  assert.match(result.stdout, /\[pre-push\] 本地全量门禁/);
});

test('verify:local 失败时中止性能预算并指出检查项', (t) => {
  const root = gitRepo(t);
  assert.equal(run(root).status, 0);
  const log = fakeToolchain(root);

  const result = runHook(root, log, { HOOK_FULL: '1', FAKE_NPM_FAIL: 'verify-local' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /✗ 本地全量门禁未通过/);
  assert.doesNotMatch(fs.readFileSync(log, 'utf8'), /perf:budget/, 'verify:local 失败后不应继续');
});

test('依赖图检查失败时输出违规位置并中止后续检查', (t) => {
  const root = gitRepo(t);
  assert.equal(run(root).status, 0);
  const log = fakeToolchain(root);

  const result = runHook(root, log, { FAKE_IMPORT_FAIL: '1' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /✗ 依赖图检查未通过/);
  assert.match(result.stderr, /public\/js\/shared\/bad\.js:1/);
  assert.doesNotMatch(fs.readFileSync(log, 'utf8'), /npm test/, '依赖图检查失败后不应继续');
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

// ── post-commit：维持 main ⊆ develop，消除 fan-in 的 BASELINE-MISMATCH 竞态 ──

const postCommitPath = (root) => path.join(root, '.git', 'hooks', 'post-commit');

const GIT_ENV = {
  GIT_AUTHOR_NAME: '测试',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: '测试',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

function gitRun(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...GIT_ENV },
  });
  assert.equal(result.status, 0, `git ${args.join(' ')} 失败：${result.stderr}`);
  return result.stdout.trim();
}

// 与 quay task_store 的提交方式一致：--no-verify 只跳过 pre-commit/commit-msg，
// post-commit 仍会运行 —— 这正是钩子能覆盖自动提交路径的原因。
function commitFile(root, file, content, message) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  gitRun(root, ['add', file]);
  gitRun(root, ['commit', '--no-verify', '-m', message]);
}

// main 与 develop 各自有独有提交：develop 领先 main 的常见态。
function repoWithDevelop(t) {
  const root = gitRepo(t);
  fs.mkdirSync(path.join(root, '.quay'), { recursive: true });
  commitFile(root, 'base.txt', 'base\n', 'base');
  gitRun(root, ['checkout', '-b', 'develop']);
  commitFile(root, 'develop-only.txt', 'develop\n', 'develop only');
  gitRun(root, ['checkout', 'main']);
  return root;
}

function baselineEvents(root) {
  const file = path.join(root, '.quay', 'baseline-sync.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test('安装会同时写出可执行的 post-commit 钩子', (t) => {
  const root = gitRepo(t);
  assert.equal(run(root).status, 0);

  const content = fs.readFileSync(postCommitPath(root), 'utf8');
  assert.match(content, /^#!\/bin\/sh/);
  assert.match(content, /managed by scripts\/install-hooks\.mjs/);
  assert.match(content, /main ⊆ develop/);
  assert.match(content, /merge-tree --write-tree/);
  const mode = fs.statSync(postCommitPath(root)).mode & 0o777;
  assert.ok(mode & 0o111, `钩子应可执行，实际权限 ${mode.toString(8)}`);
});

test('post-commit：main 领先时（--no-verify 自动提交）把 main 合进 develop 且不丢 develop 独有提交', (t) => {
  const root = repoWithDevelop(t);
  assert.equal(run(root).status, 0);

  commitFile(root, 'tasks/fix-x.md', '- [ ] AC\n', 'tasks: fix-x task_write');

  gitRun(root, ['merge-base', '--is-ancestor', 'refs/heads/main', 'refs/heads/develop']);
  const parents = gitRun(root, ['rev-list', '--parents', '-n', '1', 'develop']).split(' ').slice(1);
  assert.equal(parents.length, 2, '对齐应产生合并提交（两个父提交）而非 reset');
  const tree = gitRun(root, ['ls-tree', '-r', '--name-only', 'develop']);
  assert.match(tree, /^develop-only\.txt$/m, 'develop 独有文件必须保留');
  assert.match(tree, /^tasks\/fix-x\.md$/m, 'main 的任务提交必须进入 develop');

  const events = baselineEvents(root);
  assert.equal(events.at(-1)?.event, 'baseline-sync-merged', JSON.stringify(events));
  assert.equal(events.at(-1)?.main, gitRun(root, ['rev-parse', 'refs/heads/main']));
});

test('post-commit：已对齐时是 no-op，不再追加合并提交', (t) => {
  const root = repoWithDevelop(t);
  assert.equal(run(root).status, 0);

  gitRun(root, ['checkout', 'develop']);
  const before = gitRun(root, ['rev-parse', 'develop']);
  commitFile(root, 'develop-2.txt', 'more\n', 'develop only 2');

  const after = gitRun(root, ['rev-parse', 'develop']);
  assert.equal(gitRun(root, ['rev-list', '--count', `${before}..${after}`]), '1');
  assert.equal(gitRun(root, ['rev-list', '--parents', '-n', '1', 'develop']).split(' ').length, 2, '不应追加合并提交');
  assert.deepEqual(baselineEvents(root), []);
});

test('post-commit：合并冲突时保持 develop 不动、不阻塞提交，并留证据', (t) => {
  const root = gitRepo(t);
  fs.mkdirSync(path.join(root, '.quay'), { recursive: true });
  commitFile(root, 'shared.txt', 'base\n', 'base');
  gitRun(root, ['checkout', '-b', 'develop']);
  commitFile(root, 'shared.txt', 'develop\n', 'develop change');
  gitRun(root, ['checkout', 'main']);
  assert.equal(run(root).status, 0);

  const developBefore = gitRun(root, ['rev-parse', 'develop']);
  commitFile(root, 'shared.txt', 'main\n', 'main change');

  assert.equal(gitRun(root, ['rev-parse', 'develop']), developBefore, '冲突时不得改动 develop');
  assert.equal(gitRun(root, ['log', '-1', '--format=%s', 'main']), 'main change');
  const events = baselineEvents(root);
  assert.equal(events.at(-1)?.event, 'baseline-sync-conflict', JSON.stringify(events));
});

test('post-commit：仓库没有 develop 分支时不报错也不影响提交', (t) => {
  const root = gitRepo(t);
  assert.equal(run(root).status, 0);

  commitFile(root, 'only-main.txt', 'x\n', 'main only');

  assert.equal(gitRun(root, ['log', '-1', '--format=%s', 'main']), 'main only');
});

test('--only post-commit 只装对齐钩子，不启用 pre-push 门禁', (t) => {
  const root = gitRepo(t);
  const result = run(root, ['--only', 'post-commit']);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(hookPath(root)), false, '未指定的 pre-push 不应被安装');
  assert.ok(fs.existsSync(postCommitPath(root)));
});

test('--only 收到未知钩子名时以退出码 2 拒绝', (t) => {
  const root = gitRepo(t);
  const result = run(root, ['--only', 'pre-push,post-merge']);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /未知钩子名：post-merge/);
  assert.equal(fs.existsSync(hookPath(root)), false);
  assert.equal(fs.existsSync(postCommitPath(root)), false);
});

test('重复安装不会改写已安装的 post-commit 钩子', (t) => {
  const root = gitRepo(t);
  assert.equal(run(root).status, 0);
  const before = fs.readFileSync(postCommitPath(root), 'utf8');

  assert.equal(run(root).status, 0);
  assert.equal(fs.readFileSync(postCommitPath(root), 'utf8'), before);
});
