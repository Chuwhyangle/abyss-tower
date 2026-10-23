#!/usr/bin/env node
// 安装 git pre-push 钩子：推送前跑语法检查，HOOK_FULL=1 时加跑完整测试。
// 零依赖、幂等；不覆盖非本工具写入的已有钩子。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK_NAME = 'pre-push';
const MARKER = '# abyss-tower pre-push hook (managed by scripts/install-hooks.mjs)';

export const HOOK_CONTENT = `#!/bin/sh
${MARKER}
# 安装：node scripts/install-hooks.mjs
# 绕过（不推荐）：git push --no-verify

set -e

echo "[pre-push] 语法检查…"
npm run check:syntax

if [ "\${HOOK_FULL:-0}" = "1" ]; then
  echo "[pre-push] HOOK_FULL=1：运行完整测试…"
  npm test
else
  echo "[pre-push] 已跳过完整测试（HOOK_FULL=1 可启用）"
fi
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

function isManaged(content) {
  return content.includes(MARKER);
}

export function planInstall(root, { force = false } = {}) {
  const hooksDir = resolveHooksDir(root);
  if (!hooksDir) return { error: `不是 git 仓库：${root}` };

  const target = path.join(hooksDir, HOOK_NAME);
  const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;

  if (existing !== null && !isManaged(existing) && !force) {
    return { status: 'foreign', target, content: HOOK_CONTENT };
  }
  if (existing === HOOK_CONTENT) {
    return { status: 'unchanged', target, content: HOOK_CONTENT };
  }
  return { status: existing === null ? 'install' : 'overwrite', target, content: HOOK_CONTENT };
}

function parseArgs(argv) {
  const options = { root: SCRIPT_ROOT, dryRun: false, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--force') {
      options.force = true;
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

function printDryRun(plan) {
  console.log(`pre-push 钩子目标：${plan.target}`);
  console.log('将要写入的内容：');
  console.log('-----');
  process.stdout.write(plan.content);
  console.log('-----');
  if (plan.status === 'foreign') {
    console.error('已存在非本工具写入的钩子；默认拒绝覆盖（确认覆盖请加 --force）。');
    return 1;
  }
  if (plan.status === 'unchanged') console.log('钩子已是最新，无需改动。');
  return 0;
}

function install(plan) {
  if (plan.status === 'foreign') {
    console.error(`已存在非本工具写入的 pre-push 钩子：${plan.target}`);
    console.error('为避免覆盖，未做修改。确认覆盖请加 --force。');
    return 1;
  }
  if (plan.status === 'unchanged') {
    console.log(`pre-push 钩子已是最新：${plan.target}`);
    return 0;
  }
  fs.mkdirSync(path.dirname(plan.target), { recursive: true });
  fs.writeFileSync(plan.target, plan.content, { mode: 0o755 });
  fs.chmodSync(plan.target, 0o755);
  console.log(`已安装 pre-push 钩子：${plan.target}`);
  console.log('默认只跑语法检查；设置 HOOK_FULL=1 可在推送前跑完整测试。');
  return 0;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('用法：node scripts/install-hooks.mjs [--dry-run] [--force] [--root <目录>]');
    return 0;
  }
  if (options.error) {
    console.error(options.error);
    return 2;
  }

  const plan = planInstall(options.root, { force: options.force });
  if (plan.error) {
    console.error(plan.error);
    return 2;
  }
  return options.dryRun ? printDryRun(plan) : install(plan);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
