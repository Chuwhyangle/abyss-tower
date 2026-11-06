#!/usr/bin/env node
// 安装两个受管 git 钩子：
//   pre-push   — 分级门禁：默认语法 + 版本一致性 + 风格 + 依赖图检查，HOOK_FULL=1 时改跑
//                统一入口 verify:local（上述检查 + 全量测试）与性能预算。
//   post-commit — 提交后维持不变式「main ⊆ develop」，消除 fan-in anti-drift 的
//                BASELINE-MISMATCH 竞态（task_store 提交落 main，fan-in 目标却是 develop）。
// 零依赖、幂等；不覆盖非本工具写入的已有钩子。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK_NAME = 'pre-push';
const MARKER = '# abyss-tower pre-push hook (managed by scripts/install-hooks.mjs)';
const POST_COMMIT_HOOK_NAME = 'post-commit';
const POST_COMMIT_MARKER = '# abyss-tower post-commit hook (managed by scripts/install-hooks.mjs)';

export const HOOK_CONTENT = `#!/bin/sh
${MARKER}
# 安装：node scripts/install-hooks.mjs
# 绕过（不推荐）：git push --no-verify

set -e

run_check() {
  label=$1
  shift
  echo "[pre-push] \${label}…"
  if ! "$@"; then
    echo "[pre-push] ✗ \${label}未通过" >&2
    exit 1
  fi
}

if [ "\${HOOK_FULL:-0}" = "1" ]; then
  run_check "本地全量门禁" npm run verify:local
  run_check "性能预算快速集" npm run perf:budget
else
  run_check "语法检查" npm run check:syntax
  run_check "版本一致性检查" node scripts/check-version.mjs
  run_check "风格检查" npm run check:style
  run_check "依赖图检查" node --no-warnings scripts/import-graph.mjs
  echo "[pre-push] 已跳过完整测试与性能预算（HOOK_FULL=1 可启用）"
fi
`;

// 目标：把 worker 失败率最高的 BASELINE-MISMATCH 竞态窗口缩到 0。
// task_write 自动提交到 main，而机械 fan-in 的合并目标固定是 develop；只要 main 领先
// develop（哪怕一个任务库提交），anti-drift 就判「develop 不是 main 的延续」（exit 3），
// 整个 worker 会话被烧掉。post-commit 在提交返回前把 main 合进 develop。
export const POST_COMMIT_HOOK_CONTENT = `#!/bin/sh
${POST_COMMIT_MARKER}
#
# 不变式：main 是 develop 的祖先（main ⊆ develop）。
# 只做合并提交，绝不 reset/rebase —— develop 独有的提交不会被孤儿化。
# 冲突时保持 develop 原样并留证据；并发推进时按 update-ref 旧值比较重试（最多 3 次）。
# 钩子永远以 0 退出，绝不影响提交结果。需要 git >= 2.38（merge-tree --write-tree）。
#
# 安装：node scripts/install-hooks.mjs
# 关闭：QUAY_BASELINE_SYNC=0
# 证据：<checkout>/.quay/baseline-sync.jsonl

[ "\${QUAY_BASELINE_SYNC:-1}" = "0" ] && exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0
git rev-parse --verify --quiet refs/heads/main >/dev/null 2>&1 || exit 0
git rev-parse --verify --quiet refs/heads/develop >/dev/null 2>&1 || exit 0
git merge-base --is-ancestor refs/heads/main refs/heads/develop 2>/dev/null && exit 0
git worktree list --porcelain 2>/dev/null | grep -qx 'branch refs/heads/develop' && exit 0

record() {
  [ -d .quay ] || return 0
  printf '{"ts":"%s","event":"%s","develop":"%s","main":"%s"}\\n' \\
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "$3" >> .quay/baseline-sync.jsonl 2>/dev/null || true
}

main_sha=$(git rev-parse refs/heads/main) || exit 0
attempt=0
while [ "$attempt" -lt 3 ]; do
  attempt=$((attempt + 1))
  develop_sha=$(git rev-parse refs/heads/develop) || exit 0
  tree=$(git merge-tree --write-tree "$develop_sha" refs/heads/main 2>/dev/null)
  rc=$?
  if [ "$rc" -ne 0 ]; then
    [ "$rc" -eq 1 ] && record baseline-sync-conflict "$develop_sha" "$main_sha"
    exit 0
  fi
  merge_commit=$(git commit-tree "$tree" -p "$develop_sha" -p refs/heads/main \\
    -m "Merge branch 'main' into develop（post-commit 基线自动对齐）" 2>/dev/null) || exit 0
  if git update-ref refs/heads/develop "$merge_commit" "$develop_sha" 2>/dev/null; then
    record baseline-sync-merged "$merge_commit" "$main_sha"
    exit 0
  fi
done
record baseline-sync-cas-exhausted "$develop_sha" "$main_sha"
exit 0
`;

function resolveHooksDir(root) {
  try {
    return execFileSync(
      'git',
      ['-C', root, 'rev-parse', '--path-format=absolute', '--git-path', 'hooks'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
  } catch {
    return null;
  }
}

function isManaged(content, marker) {
  return content.includes(marker);
}

export function planHook(root, hook, { force = false } = {}) {
  const hooksDir = resolveHooksDir(root);
  if (!hooksDir) return { error: `不是 git 仓库：${root}` };

  const target = path.join(hooksDir, hook.name);
  const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
  const plan = { name: hook.name, target, content: hook.content };

  if (existing !== null && !isManaged(existing, hook.marker) && !force) {
    return { ...plan, status: 'foreign' };
  }
  if (existing === hook.content) {
    return { ...plan, status: 'unchanged' };
  }
  return { ...plan, status: existing === null ? 'install' : 'overwrite' };
}

export const PRE_PUSH_HOOK = Object.freeze({ name: HOOK_NAME, marker: MARKER, content: HOOK_CONTENT });
export const POST_COMMIT_HOOK = Object.freeze({
  name: POST_COMMIT_HOOK_NAME,
  marker: POST_COMMIT_MARKER,
  content: POST_COMMIT_HOOK_CONTENT,
});
export const MANAGED_HOOKS = Object.freeze([PRE_PUSH_HOOK, POST_COMMIT_HOOK]);

export function planInstall(root, options = {}) {
  return planHook(root, PRE_PUSH_HOOK, options);
}

export function planPostCommitInstall(root, options = {}) {
  return planHook(root, POST_COMMIT_HOOK, options);
}

// only: 只安装指定的钩子（用于「先只装 post-commit，暂不启用 pre-push 门禁」这类渐进启用）。
export function planAllHooks(root, { force = false, only = [] } = {}) {
  const selected = only.length === 0 ? MANAGED_HOOKS : MANAGED_HOOKS.filter((hook) => only.includes(hook.name));
  return selected.map((hook) => planHook(root, hook, { force }));
}

function parseArgs(argv) {
  const options = { root: SCRIPT_ROOT, dryRun: false, force: false, only: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--only') {
      const value = argv[++i];
      if (!value) return { error: '--only 需要钩子名（pre-push / post-commit）' };
      const names = value.split(',').map((name) => name.trim()).filter(Boolean);
      const unknown = names.filter((name) => !MANAGED_HOOKS.some((hook) => hook.name === name));
      if (unknown.length > 0) return { error: `未知钩子名：${unknown.join('、')}（可用：${MANAGED_HOOKS.map((hook) => hook.name).join(' / ')}）` };
      options.only.push(...names);
    } else if (arg === '--root') {
      const value = argv[++i];
      if (!value) return { error: '--root 需要一个目录参数' };
      options.root = path.resolve(value);
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      return { error: `未知参数：${arg}` };
    }
  }
  return options;
}

// 有任一钩子被非本工具占用时整体拒绝：避免「装了一半」的钩子组合让人以为流程已受管。
function refuseForeign(plans) {
  const foreign = plans.filter((plan) => plan.status === 'foreign');
  for (const plan of foreign) {
    console.error(`已存在非本工具写入的 ${plan.name} 钩子：${plan.target}`);
  }
  if (foreign.length > 0) console.error('为避免覆盖，未做修改。确认覆盖请加 --force。');
  return foreign.length > 0;
}

function printDryRun(plans) {
  for (const plan of plans) {
    console.log(`${plan.name} 钩子目标：${plan.target}`);
    console.log('将要写入的内容：');
    console.log('-----');
    process.stdout.write(plan.content);
    console.log('-----');
    if (plan.status === 'unchanged') console.log('钩子已是最新，无需改动。');
  }
  if (plans.some((plan) => plan.status === 'foreign')) {
    console.error('已存在非本工具写入的钩子；默认拒绝覆盖（确认覆盖请加 --force）。');
    return 1;
  }
  return 0;
}

function install(plans) {
  if (refuseForeign(plans)) return 1;
  for (const plan of plans) {
    if (plan.status === 'unchanged') {
      console.log(`${plan.name} 钩子已是最新：${plan.target}`);
      continue;
    }
    fs.mkdirSync(path.dirname(plan.target), { recursive: true });
    fs.writeFileSync(plan.target, plan.content, { mode: 0o755 });
    fs.chmodSync(plan.target, 0o755);
    console.log(`已安装 ${plan.name} 钩子：${plan.target}`);
  }
  console.log('默认跑语法、版本一致性、风格与依赖图检查；设置 HOOK_FULL=1 改跑 verify:local（含全量测试）与性能预算。');
  console.log('post-commit 在每次提交后把 main 合进 develop，避免 fan-in 的 BASELINE-MISMATCH 竞态。');
  return 0;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('用法：node scripts/install-hooks.mjs [--dry-run] [--force] [--only pre-push|post-commit] [--root <目录>]');
    return 0;
  }
  if (options.error) {
    console.error(options.error);
    return 2;
  }

  const plans = planAllHooks(options.root, { force: options.force, only: options.only });
  const failure = plans.find((plan) => plan.error);
  if (failure) {
    console.error(failure.error);
    return 2;
  }
  return options.dryRun ? printDryRun(plans) : install(plans);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
