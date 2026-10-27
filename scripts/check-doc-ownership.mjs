#!/usr/bin/env node
// 文档所有权检查：open 任务（文档 lane `DOCS-*` 除外）不得把两份总文档写进 `## Touches`。
// 只读、零依赖。发现违规即 exit 1，供调度前检查与 CI 复用；本脚本**从不修改任务文件**——
// 摘除必须走任务 ABI（`task_write`），手改任务体不会到达 fan-in。
//
// 判定规则：
//   - open = frontmatter 的 status 不在 {done, superseded, retired, rejected}；
//   - Touches 区 = `## Touches` 到下一个二级标题，逐行取 `- 路径`，去掉反引号与 `(new)` 尾注；
//   - 命中 docs/PRD.md 或 docs/TECH_DESIGN.md 即为一条违规（同一任务两份都写只报一条，docs 列全）。
//
// 反空转：任务目录不存在、目录里一个任务文件都没有，都按「无法判定」exit 2，绝不静默通过。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DOC_OWNERS = Object.freeze(['docs/PRD.md', 'docs/TECH_DESIGN.md']);
export const DOC_LANE_PREFIX = 'DOCS-';
export const CLOSED_STATUSES = Object.freeze(['done', 'superseded', 'retired', 'rejected']);
export const TOUCHES_HEADING_RE = /^##\s+Touches\s*$/i;
export const HEADING_RE = /^##\s+/;

// 从任务体里取 frontmatter 的 status；缺失返回空串（按 open 处理，宁可多报）。
export function parseStatus(markdown) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (!frontmatter) return '';
  const match = /^status:\s*(.+?)\s*$/m.exec(frontmatter[1]);
  return match ? match[1].replace(/^['"]|['"]$/g, '').trim() : '';
}

// 取任务体的 id（frontmatter 优先，缺省用文件名）。
export function parseTaskId(markdown, fallback) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (frontmatter) {
    const match = /^id:\s*(.+?)\s*$/m.exec(frontmatter[1]);
    if (match) return match[1].replace(/^['"]|['"]$/g, '').trim();
  }
  return fallback;
}

// 去掉反引号与 `(new)` / `（新增）` 之类尾注，返回干净的路径。
export function normalizeTouch(raw) {
  return String(raw ?? '')
    .replace(/`/g, '')
    .replace(/\s*[（(][^）)]*[）)]\s*$/u, '')
    .trim();
}

// 解析 Touches 区；没有该区时返回空数组（不是错误：很多 finding 类任务没有代码面）。
export function extractTouches(markdown) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => TOUCHES_HEADING_RE.test(line));
  if (start === -1) return [];
  const touches = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (HEADING_RE.test(line)) break;
    const item = /^\s*[-*]\s+(.+?)\s*$/.exec(line);
    if (item) touches.push(normalizeTouch(item[1]));
  }
  return touches.filter(Boolean);
}

export function parseTask(markdown, fallbackId) {
  return {
    id: parseTaskId(markdown, fallbackId),
    status: parseStatus(markdown),
    touches: extractTouches(markdown),
  };
}

export function isOpen(status) {
  return !CLOSED_STATUSES.includes(status);
}

// 纯函数：给定任务数组，返回违规清单。文档 lane 自身不参与检查。
export function findBlockedTasks(tasks) {
  return tasks
    .filter((task) => !String(task.id).startsWith(DOC_LANE_PREFIX))
    .filter((task) => isOpen(task.status))
    .map((task) => ({ id: task.id, status: task.status, docs: DOC_OWNERS.filter((doc) => task.touches.includes(doc)) }))
    .filter((violation) => violation.docs.length > 0);
}

export function loadTasks(tasksDir) {
  const files = fs
    .readdirSync(tasksDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.md$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  return files.map((name) => {
    const markdown = fs.readFileSync(path.join(tasksDir, name), 'utf8');
    return parseTask(markdown, path.basename(name, '.md'));
  });
}

export function analyze(root = ROOT) {
  const tasksDir = path.join(root, 'tasks');
  if (!fs.existsSync(tasksDir)) {
    return { ok: false, evaluated: false, reason: `任务目录不存在：${tasksDir}`, scanned: 0, violations: [] };
  }
  const tasks = loadTasks(tasksDir);
  if (tasks.length === 0) {
    return { ok: false, evaluated: false, reason: `任务目录里没有任何 .md：${tasksDir}`, scanned: 0, violations: [] };
  }
  const violations = findBlockedTasks(tasks);
  return { ok: violations.length === 0, evaluated: true, scanned: tasks.length, violations };
}

export function formatReport(result) {
  const lines = [];
  if (result.violations.length === 0) {
    lines.push(`check-doc-ownership: OK — 0 个 open 任务声明总文档（已扫描 ${result.scanned} 个任务）`);
    return lines.join('\n');
  }
  lines.push(`check-doc-ownership: ${result.violations.length} 个 open 任务声明了总文档（文档锁热点）`);
  for (const violation of result.violations) {
    lines.push(`  ${violation.id} [${violation.status || 'unknown'}] -> ${violation.docs.join(', ')}`);
  }
  lines.push('修复：经任务 ABI 摘除这些文件（不要手改任务文件），或先由文档 lane 收口设计增量。');
  return lines.join('\n');
}

// 机器可读清单：<task-id>\t<doc>，每行一条，便于任务操作员批量摘除。
export function formatFixReport(result) {
  return result.violations
    .flatMap((violation) => violation.docs.map((doc) => `${violation.id}\t${doc}`))
    .join('\n');
}

function parseArgs(argv) {
  const options = { root: ROOT, json: false, fixReport: false, help: false, error: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') {
      options.root = path.resolve(argv[++i] ?? '');
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--fix-report') {
      options.fixReport = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      options.error = `未知参数：${arg}`;
    }
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('用法：node scripts/check-doc-ownership.mjs [--root <目录>] [--fix-report] [--json]');
    return 0;
  }
  if (options.error) {
    console.error(options.error);
    return 2;
  }
  const result = analyze(options.root);
  if (!result.evaluated) {
    console.error(`check-doc-ownership: ${result.reason}`);
    return 2;
  }
  if (options.json) {
    console.log(JSON.stringify({ ok: result.ok, scanned: result.scanned, violations: result.violations }, null, 2));
  } else if (options.fixReport) {
    console.log(formatFixReport(result));
  } else {
    console.log(formatReport(result));
  }
  return result.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
