#!/usr/bin/env node
// Touches 冲突预检（并发重构·阶段 0 安全网）：只读解析 `tasks/*.md` 的 `## Touches`，
// 按文件归组，找出「两个 ready 任务同时申明同一非 new 文件」的重叠——worker 领任务前
// 自查会与谁串行。发现冲突即 exit 1，供调度前检查与 CI 复用；本脚本**从不修改任务文件**——
// 摘除共享文件必须走任务 ABI（`task_write`），手改任务体不会到达 fan-in。
//
// 判定规则（与 anti-drift 的 `(new)` 标注口径一致，见 dist/anti-drift-touches-check.js 的
// tagFromAnnotation）：
//   - 参与判定的任务 = frontmatter `status: ready`（正在派发池里的任务）；
//   - Touches 区 = `## Touches` 到下一个二级标题，逐行取 `- 路径`，去反引号并保留标注；
//   - 一个文件被 ≥2 个 ready 任务申明、且至少一条申明为「非 new」=> 一条冲突（有人在改既有文件）；
//   - 同一任务重复申明同一文件只记一次；两个任务都标 `(new)` 的同一路径不算冲突（各建各的，
//     这种归属撞车由命名唯一性 / anti-drift 另行兜底）。
//
// 反空转：任务目录不存在、目录里一个任务文件都没有，都按「无法判定」exit 2，绝不静默通过。
// 单 owner 表见 `docs/OWNERSHIP.md` —— 本脚本在文件粒度执行同一原则（比 lane 更细：任何共享文件即串行）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const READY_STATUS = 'ready';
export const TOUCHES_HEADING_RE = /^##\s+Touches\s*$/i;
export const HEADING_RE = /^##\s+/;

// 与 anti-drift 同口径：尾注里「恰好是 new」才判定为新建（大小写不敏感）。
export function tagFromAnnotation(text) {
  const a = String(text ?? '').trim().toLowerCase();
  if (a === 'new') return 'new';
  if (a === 'delete' || a === 'deleted') return 'delete';
  return null;
}

// 剥离尾注（含全角括号与半角括号多层嵌套），返回干净路径。与 anti-drift 同实现。
const TOUCH_PATH_TOKEN_RE = /^[^\s`'"()（）]+/;
const TOUCH_CONCRETE_PATH_RE = /\/|\.[A-Za-z0-9]{1,10}$/;
const TOUCH_ANNOTATION_HEAD_RE = /^[`'"（(]/;

function stripTrailingFullWidthAnnotation(s) {
  const t = s.trimEnd();
  const i = t.length - 1;
  if (t[i] !== '）') return s;
  let depth = 0;
  let open = -1;
  for (let j = i; j >= 0; j -= 1) {
    const c = t[j];
    if (c === '）') depth += 1;
    else if (c === '（' && (depth -= 1) === 0) {
      open = j;
      break;
    }
  }
  if (open === -1) return s;
  let k = open;
  while (k > 0 && /\s/.test(t[k - 1])) k -= 1;
  return t.slice(0, k);
}

export function stripTouchAnnotation(entry) {
  const raw = String(entry);
  const t = raw.trim();
  const m = TOUCH_PATH_TOKEN_RE.exec(t);
  if (m && TOUCH_CONCRETE_PATH_RE.test(m[0])) {
    const tail = t.slice(m[0].length).replace(/^\s+/, '');
    if (tail && TOUCH_ANNOTATION_HEAD_RE.test(tail)) return m[0];
  }
  let s = raw.trimEnd();
  for (;;) {
    const before = s;
    s = stripTrailingFullWidthAnnotation(s);
    s = s.replace(/\s*\([^)]*\)\s*$/, '').trimEnd();
    if (s === before) break;
  }
  return s.trim();
}

// 解析一条 touch：返回 { path, isNew }。`(new)` 尾注（及 `(new)（…）` 复合标注）判为新建。
export function parseTouch(raw) {
  let entry = String(raw ?? '').trim();
  entry = entry.replace(/^[`"']+|[`"']+$/g, '').trim();
  let tag = tagFromAnnotation(entry.match(/\s*\(([^)]*)\)\s*$/)?.[1]);
  if (!tag) {
    const beforeFullWidth = entry.match(/\s*\(([^)]*)\)\s*[（]/);
    tag = tagFromAnnotation(beforeFullWidth?.[1]);
  }
  const pathValue = stripTouchAnnotation(entry)
    .replace(/^[`"']+|[`"']+$/g, '')
    .replace(/^\.\//, '')
    .trim();
  return { path: pathValue, isNew: tag === 'new' };
}

// 从任务体里取 frontmatter 的 status；缺失返回空串（按非 ready 处理，宁可漏报也不误报串行）。
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
    if (item) {
      const touch = parseTouch(item[1]);
      if (touch.path) touches.push(touch);
    }
  }
  return touches;
}

export function parseTask(markdown, fallbackId) {
  return {
    id: parseTaskId(markdown, fallbackId),
    status: parseStatus(markdown),
    touches: extractTouches(markdown),
  };
}

// 纯函数：给定任务数组，返回冲突清单。每条冲突 = 一个被 ≥2 个 ready 任务申明、
// 且至少一条申明为「非 new」的文件，附带所有申明任务与两两对（重叠矩阵）。
export function findConflicts(tasks) {
  const ready = tasks.filter((task) => task.status === READY_STATUS);
  const byFile = new Map();
  for (const task of ready) {
    const seen = new Set();
    for (const touch of task.touches) {
      if (!touch.path || seen.has(touch.path)) continue;
      seen.add(touch.path);
      if (!byFile.has(touch.path)) byFile.set(touch.path, new Map());
      byFile.get(touch.path).set(task.id, touch.isNew);
    }
  }
  const conflicts = [];
  for (const [file, claims] of [...byFile.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const list = [...claims.entries()].map(([id, isNew]) => ({ id, isNew }));
    if (list.length < 2) continue;
    if (!list.some((claim) => !claim.isNew)) continue; // 全 (new) = 各建各的，不算冲突
    const ids = list.map((claim) => claim.id).sort();
    const pairs = [];
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) pairs.push([ids[i], ids[j]]);
    }
    conflicts.push({ file, tasks: list, pairs });
  }
  return { ready: ready.length, conflicts };
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
    return { ok: false, evaluated: false, reason: `任务目录不存在：${tasksDir}`, scanned: 0, ready: 0, conflicts: [] };
  }
  const tasks = loadTasks(tasksDir);
  if (tasks.length === 0) {
    return { ok: false, evaluated: false, reason: `任务目录里没有任何 .md：${tasksDir}`, scanned: 0, ready: 0, conflicts: [] };
  }
  const { ready, conflicts } = findConflicts(tasks);
  return { ok: conflicts.length === 0, evaluated: true, scanned: tasks.length, ready, conflicts };
}

export function formatReport(result) {
  const lines = [];
  if (result.conflicts.length === 0) {
    lines.push(`touches-conflict: OK — 0 个 ready 任务在共享文件上串行（ready ${result.ready} 个，已扫描 ${result.scanned} 个任务）`);
    return lines.join('\n');
  }
  lines.push(`touches-conflict: ${result.conflicts.length} 个文件被 ≥2 个 ready 任务同时申明（ready ${result.ready} 个，已扫描 ${result.scanned} 个任务）`);
  for (const conflict of result.conflicts) {
    lines.push(`  ${conflict.file}（${conflict.pairs.length} 对重叠）`);
    for (const claim of conflict.tasks) {
      lines.push(`    ${claim.id}${claim.isNew ? ' (new)' : ''}`);
    }
  }
  lines.push('修复：经任务 ABI（task_write）把共享文件从重叠任务的 Touches 中摘除，或让这些任务串行（单 owner 见 docs/OWNERSHIP.md）。');
  return lines.join('\n');
}

function parseArgs(argv) {
  const options = { root: ROOT, json: false, help: false, error: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') {
      options.root = path.resolve(argv[++i] ?? '');
    } else if (arg === '--json') {
      options.json = true;
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
    console.log('用法：node scripts/touches-conflict.mjs [--root <目录>] [--json]');
    return 0;
  }
  if (options.error) {
    console.error(`touches-conflict: ${options.error}`);
    return 2;
  }
  const result = analyze(options.root);
  if (!result.evaluated) {
    console.error(`touches-conflict: ${result.reason}`);
    return 2;
  }
  if (options.json) {
    console.log(JSON.stringify({ ok: result.ok, scanned: result.scanned, ready: result.ready, conflicts: result.conflicts }, null, 2));
  } else {
    console.log(formatReport(result));
  }
  return result.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
