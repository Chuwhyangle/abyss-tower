#!/usr/bin/env node
// 结构预算门禁（口径的唯一定义处是 docs/PHASE_REFACTOR.md §5）：
//   1. 行数预算：`public/js` 与 `server` ≤ 600 行；`scripts` 与 `tests` ≤ 800 行；
//      数据文件豁免（`public/js/shared/i18n/*.js`、`server/db/migrations/*.mjs`、`*-data.js`）。
//   2. 导入图无环（Tarjan SCC）：从四个源根构建静态 import 图，任何强连通分量 > 1 即判环。
//   3. 数据模块纯度：`*-data.js` 只能依赖其他数据模块、`node:` 内建或 shared 纯常量，
//      不得 import 运行时模块（`public/js/sim|render|app|ui`、`server/`）。
//   4. 债务登记：`scripts/structure-budget.allow.d/<owner>.json`，文件名 = owner 任务 id，
//      条目 = `{ path, maxLines, owner }`。超限文件必须有条目；条目不得超出上限、
//      不得指向预算内的文件（已还清就该删）、不得指向不存在的文件、owner 必须真实存在。
//
// 零依赖；import 解析与文件收集复用 `scripts/import-graph.mjs`，避免两套解析器各说各话。
// 用法：node scripts/structure-budget.mjs [--check] [--root <目录>] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectFiles, parseImports, resolveSpecifier } from './import-graph.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 预算表：与 PHASE_REFACTOR §5 逐条对应；改这里必须同时改文档与 tests/structure-budget.test.mjs。
export const BUDGETS = Object.freeze({
  runtime: Object.freeze({ maxLines: 600, roots: Object.freeze(['public/js', 'server']) }),
  tool: Object.freeze({ maxLines: 800, roots: Object.freeze(['scripts', 'tests']) }),
});
export const SOURCE_ROOTS = Object.freeze([...BUDGETS.runtime.roots, ...BUDGETS.tool.roots]);
export const DEBT_DIR = 'scripts/structure-budget.allow.d';
export const DEBT_SUFFIX = '.json';

// 数据豁免：整文件不参与行数预算。纯度规则另算（见 DATA_MODULE）。
export const DATA_EXEMPT = Object.freeze([
  /^public\/js\/shared\/i18n\/[^/]+\.js$/,
  /^server\/db\/migrations\/[^/]+\.mjs$/,
]);
export const DATA_MODULE = /^\S+-data\.(?:js|mjs)$/;

// 运行时模块前缀：数据模块 import 到这些路径即越层，一律判违规。
export const RUNTIME_PREFIXES = Object.freeze([
  'public/js/sim.js',
  'public/js/sim/',
  'public/js/render/',
  'public/js/app/',
  'public/js/ui.js',
  'public/js/ui/',
  'server/',
]);

// 数据模块除其他数据模块外唯一允许的相对依赖：shared 的纯常量表。
export const SHARED_PURE_DATA = 'public/js/shared/data.js';

const OWNER_TASKS_DIR = 'tasks';

export function toPosix(value) {
  return value.split(path.sep).join('/');
}

// 与 `wc -l` 同口径：以换行符计数；无末尾换行的最后一行也算一行。
export function countLines(text) {
  if (!text) return 0;
  const breaks = text.split('\n').length - 1;
  return text.endsWith('\n') ? breaks : breaks + 1;
}

export function isDataExempt(relativePath) {
  const rel = toPosix(relativePath);
  return DATA_EXEMPT.some((pattern) => pattern.test(rel)) || DATA_MODULE.test(path.posix.basename(rel));
}

// 行数预算：数据豁免文件返回 null（不设限）。
export function budgetFor(relativePath) {
  const rel = toPosix(relativePath);
  if (isDataExempt(rel)) return null;
  if (BUDGETS.runtime.roots.some((root) => rel.startsWith(`${root}/`))) return BUDGETS.runtime.maxLines;
  if (BUDGETS.tool.roots.some((root) => rel.startsWith(`${root}/`))) return BUDGETS.tool.maxLines;
  return null;
}

export function isDataModule(relativePath) {
  return DATA_MODULE.test(path.posix.basename(toPosix(relativePath)));
}

export function collectSourceFiles(root = ROOT) {
  return collectFiles(root, SOURCE_ROOTS).map((file) => toPosix(path.relative(root, file)));
}

// ── 债务登记 ────────────────────────────────────────────────────────────────

function readDebtFile(file) {
  const name = path.basename(file);
  const owner = name.slice(0, -DEBT_SUFFIX.length);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return { file: name, owner, entries: [], problems: [{ kind: 'debt-parse', file: name, message: `无法解析：${error.message}` }] };
  }
  const list = Array.isArray(parsed) ? parsed : parsed?.entries;
  if (!Array.isArray(list)) {
    return { file: name, owner, entries: [], problems: [{ kind: 'debt-shape', file: name, message: '必须是条目数组或 { entries: [...] }' }] };
  }
  const problems = [];
  const entries = [];
  for (const item of list) {
    const entryPath = typeof item?.path === 'string' ? toPosix(item.path) : null;
    const maxLines = Number.isFinite(item?.maxLines) ? item.maxLines : null;
    const entryOwner = typeof item?.owner === 'string' ? item.owner : null;
    if (!entryPath || maxLines === null || !entryOwner) {
      problems.push({ kind: 'debt-shape', file: name, path: entryPath, message: '条目必须含 path / maxLines / owner' });
      continue;
    }
    if (entryOwner !== owner) {
      problems.push({
        kind: 'debt-owner-mismatch',
        file: name,
        path: entryPath,
        message: `owner ${entryOwner} 与文件名 ${owner} 不一致（一个任务一个文件）`,
      });
      continue;
    }
    entries.push({ path: entryPath, maxLines, owner: entryOwner, file: name });
  }
  return { file: name, owner, entries, problems };
}

// 读全部债务文件：`scripts/structure-budget.allow.d/<owner>.json`。
// 返回 Map(相对路径 → 条目) 与格式类问题；语义判定（存在性/上限/是否还清）留给 runCheck。
export function loadDebt(root = ROOT, { dir = DEBT_DIR } = {}) {
  const entries = new Map();
  const problems = [];
  const files = [];
  const debtRoot = path.join(root, dir);
  let names = [];
  try {
    names = fs.readdirSync(debtRoot).filter((name) => name.endsWith(DEBT_SUFFIX)).sort();
  } catch {
    return { entries, problems, files };
  }
  for (const name of names) {
    const read = readDebtFile(path.join(debtRoot, name));
    files.push(read.file);
    problems.push(...read.problems);
    for (const entry of read.entries) {
      const previous = entries.get(entry.path);
      if (previous) {
        problems.push({
          kind: 'debt-duplicate',
          file: entry.file,
          path: entry.path,
          message: `同一路径在 ${previous.file} 与 ${entry.file} 各登记一次`,
        });
        continue;
      }
      entries.set(entry.path, entry);
    }
  }
  return { entries, problems, files };
}

function ownerExists(root, owner) {
  return fs.existsSync(path.join(root, OWNER_TASKS_DIR, `${owner}.md`));
}

// ── 导入图 ──────────────────────────────────────────────────────────────────

// 构建静态 import 图：节点为四根下的源文件，边为可解析的相对 import。
export function buildImportGraph(root = ROOT, files = collectSourceFiles(root)) {
  const known = new Set(files);
  const edges = [];
  for (const relative of files) {
    const absolute = path.join(root, relative);
    let source;
    try {
      source = fs.readFileSync(absolute, 'utf8');
    } catch {
      continue;
    }
    for (const { specifier, line } of parseImports(source)) {
      const target = resolveSpecifier(absolute, specifier);
      if (!target) continue;
      const targetRelative = toPosix(path.relative(root, target));
      if (!known.has(targetRelative)) continue;
      edges.push({ from: relative, to: targetRelative, specifier, line });
    }
  }
  edges.sort((a, b) => (a.from === b.from ? a.to.localeCompare(b.to) : a.from.localeCompare(b.from)));
  return { files, edges };
}

// Tarjan 强连通分量：返回每个分量（节点已排序）。自环单独成环，由 findCycles 处理。
export function stronglyConnectedComponents(files, edges) {
  const adjacency = new Map(files.map((file) => [file, []]));
  for (const edge of edges) {
    if (!adjacency.has(edge.from) || !adjacency.has(edge.to)) continue;
    adjacency.get(edge.from).push(edge.to);
  }
  for (const targets of adjacency.values()) targets.sort();

  let index = 0;
  const indices = new Map();
  const lowlink = new Map();
  const onStack = new Set();
  const stack = [];
  const components = [];

  const strongConnect = (node) => {
    indices.set(node, index);
    lowlink.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);
    for (const next of adjacency.get(node) || []) {
      if (!indices.has(next)) {
        strongConnect(next);
        lowlink.set(node, Math.min(lowlink.get(node), lowlink.get(next)));
      } else if (onStack.has(next)) {
        lowlink.set(node, Math.min(lowlink.get(node), indices.get(next)));
      }
    }
    if (lowlink.get(node) === indices.get(node)) {
      const component = [];
      let popped;
      do {
        popped = stack.pop();
        onStack.delete(popped);
        component.push(popped);
      } while (popped !== node);
      components.push(component.sort());
    }
  };

  for (const file of [...files].sort()) if (!indices.has(file)) strongConnect(file);
  return components;
}

// 判环：分量 > 1 即环；分量 == 1 时只有自环才算环。
export function findCycles(files, edges) {
  const selfLoops = new Set(edges.filter((edge) => edge.from === edge.to).map((edge) => edge.from));
  return stronglyConnectedComponents(files, edges)
    .filter((component) => component.length > 1 || selfLoops.has(component[0]))
    .map((component) => component)
    .sort((a, b) => a[0].localeCompare(b[0]));
}

// ── 数据模块纯度 ────────────────────────────────────────────────────────────

export function checkDataPurity(root, files) {
  const violations = [];
  for (const relative of files) {
    if (!isDataModule(relative)) continue;
    const absolute = path.join(root, relative);
    let source;
    try {
      source = fs.readFileSync(absolute, 'utf8');
    } catch {
      continue;
    }
    for (const { specifier, line } of parseImports(source)) {
      if (!specifier.startsWith('.')) {
        // node: 内建是纯函数来源，允许；第三方包（本仓库零依赖）一律判违规。
        if (!specifier.startsWith('node:')) {
          violations.push({ kind: 'data-impurity', path: relative, line, specifier, target: null, message: '数据模块不得依赖第三方/裸模块名' });
        }
        continue;
      }
      const target = resolveSpecifier(absolute, specifier);
      const targetRelative = target ? toPosix(path.relative(root, target)) : null;
      if (!targetRelative) {
        violations.push({ kind: 'data-impurity', path: relative, line, specifier, target: null, message: '数据模块的相对 import 无法解析' });
        continue;
      }
      const runtimePrefix = RUNTIME_PREFIXES.find((prefix) => targetRelative === prefix || targetRelative.startsWith(prefix));
      if (!runtimePrefix) continue;
      // 数据模块之间互相依赖、以及 shared 的纯常量表都是允许方向（data → data）。
      if (isDataModule(targetRelative) || targetRelative === SHARED_PURE_DATA) continue;
      violations.push({
        kind: 'data-impurity',
        path: relative,
        line,
        specifier,
        target: targetRelative,
        message: '数据模块不得 import 运行时模块',
      });
    }
  }
  return violations;
}

// ── 总检 ────────────────────────────────────────────────────────────────────

export function runCheck({
  root = ROOT,
  budgets = BUDGETS,
  debtDir = DEBT_DIR,
  checkOwners = true,
} = {}) {
  const files = collectSourceFiles(root);
  const budgetOf = (relative) => {
    if (isDataExempt(relative)) return null;
    const rel = toPosix(relative);
    if (budgets.runtime.roots.some((dir) => rel.startsWith(`${dir}/`))) return budgets.runtime.maxLines;
    if (budgets.tool.roots.some((dir) => rel.startsWith(`${dir}/`))) return budgets.tool.maxLines;
    return null;
  };

  const debt = loadDebt(root, { dir: debtDir });
  const violations = [...debt.problems];
  const knownFiles = new Set(files);
  const counted = { runtime: 0, tool: 0, exempt: 0 };

  for (const relative of files) {
    const limit = budgetOf(relative);
    if (limit === null) {
      counted.exempt += 1;
      continue;
    }
    if (budgets.runtime.roots.some((dir) => relative.startsWith(`${dir}/`))) counted.runtime += 1;
    else counted.tool += 1;

    let lines = 0;
    try {
      lines = countLines(fs.readFileSync(path.join(root, relative), 'utf8'));
    } catch {
      continue;
    }
    const entry = debt.entries.get(relative);
    if (lines > limit) {
      if (!entry) {
        violations.push({ kind: 'over-budget', path: relative, lines, limit, message: `超过预算 ${limit} 行且未登记债务` });
      } else if (lines > entry.maxLines) {
        violations.push({
          kind: 'debt-exceeded',
          path: relative,
          lines,
          limit: entry.maxLines,
          message: `债务上限 ${entry.maxLines} 行已超出（当前 ${lines} 行，登记于 ${entry.file}）`,
        });
      }
    } else if (entry) {
      violations.push({
        kind: 'debt-stale',
        path: relative,
        lines,
        limit,
        message: `已在预算内（${lines} ≤ ${limit}），债务条目应从 ${entry.file} 删除`,
      });
    }
  }

  for (const entry of debt.entries.values()) {
    if (!knownFiles.has(entry.path)) {
      violations.push({
        kind: 'debt-unknown-path',
        path: entry.path,
        message: `登记的路径不存在（${entry.file}）`,
      });
    }
    if (checkOwners && !ownerExists(root, entry.owner)) {
      violations.push({
        kind: 'debt-owner-missing',
        path: entry.path,
        owner: entry.owner,
        message: `owner 任务 ${entry.owner} 不存在（tasks/${entry.owner}.md 缺失）`,
      });
    }
  }

  const graph = buildImportGraph(root, files);
  const cycles = findCycles(graph.files, graph.edges);
  for (const cycle of cycles) {
    violations.push({ kind: 'cycle', path: cycle[0], cycle, message: `import 环：${cycle.join(' -> ')}` });
  }
  violations.push(...checkDataPurity(root, files));

  violations.sort((a, b) => `${a.kind}:${a.path}`.localeCompare(`${b.kind}:${b.path}`));

  return {
    ok: violations.length === 0,
    root,
    files: files.length,
    counted,
    debtFiles: debt.files,
    debtEntries: debt.entries.size,
    edges: graph.edges.length,
    cycles,
    violations,
  };
}

export function formatViolation(violation) {
  const where = violation.path ? `${violation.path}${violation.line ? `:${violation.line}` : ''}` : '(债务登记)';
  return `✗ [${violation.kind}] ${where} — ${violation.message}`;
}

export function summaryLine(result) {
  if (!result.ok) return `structure-budget: ${result.violations.length} 处违规（${result.files} 个源文件）`;
  return `structure-budget: OK（${result.files} 个源文件，运行时 ${result.counted.runtime} / 工具 ${result.counted.tool} / 豁免 ${result.counted.exempt}，债务 ${result.debtEntries} 条，${result.edges} 条依赖，无环）`;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const options = { root: ROOT, json: false, budgets: { ...BUDGETS }, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--check') continue;
    else if (arg === '--root') options.root = path.resolve(next());
    else if (arg === '--budget-lines') options.budgets = { ...options.budgets, runtime: { ...options.budgets.runtime, maxLines: Number(next()) } };
    else if (arg === '--budget-tool-lines') options.budgets = { ...options.budgets, tool: { ...options.budgets.tool, maxLines: Number(next()) } };
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`未知参数：${arg}`);
  }
  for (const [name, budget] of Object.entries(options.budgets)) {
    if (!Number.isFinite(budget.maxLines) || budget.maxLines <= 0) {
      throw new Error(`预算 ${name} 必须是正整数`);
    }
  }
  return options;
}

export function formatUsage() {
  return [
    '用法：node scripts/structure-budget.mjs [--check] [--root <目录>] [--json]',
    '      [--budget-lines <n>] [--budget-tool-lines <n>]',
    '  行数预算 + 导入无环 + 数据模块纯度 + 按任务登记的债务（PHASE_REFACTOR §5）。',
  ].join('\n');
}

export function main(argv = process.argv.slice(2), { log = console.log, error = console.error } = {}) {
  const options = parseArgs(argv);
  if (options.help) {
    log(formatUsage());
    return 0;
  }
  const result = runCheck({ root: options.root, budgets: options.budgets });
  if (options.json) {
    log(JSON.stringify(result, null, 2));
  } else {
    for (const violation of result.violations) error(formatViolation(violation));
    (result.ok ? log : error)(summaryLine(result));
  }
  return result.ok ? 0 : 1;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  try {
    process.exitCode = main();
  } catch (cause) {
    console.error(`[structure-budget] ${cause.stack || cause.message}`);
    process.exitCode = 2;
  }
}
