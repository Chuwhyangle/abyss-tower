#!/usr/bin/env node
// 文档一致性检查：文档里的相对链接、反引号代码路径与 npm 脚本必须真实存在。
// 只读、零依赖；失效项按「文件:行号」输出，发现即退出 1。
//
// 检查范围：docs/*.md、README.md、CONTRIBUTING.md。
// 三类判定：
//   1. 相对链接 [文字](相对地址)——外部协议、协议相对地址与页内锚点跳过。
//   2. 反引号中的代码路径——行内代码与围栏代码块，只校验以仓库顶层目录开头的路径。
//   3. npm 命令——`npm run <脚本>` 与 `npm test` / `npm start` 等别名必须能在 package.json 找到。
// 豁免：所在行包含 `docs-consistency:ignore` 时不检查该行（用于示例、模板与占位路径）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DOC_FILES = ['README.md', 'CONTRIBUTING.md'];
export const IGNORE_MARKER = 'docs-consistency:ignore';
export const IGNORE_FILE_MARKER = 'docs-consistency:ignore-file';

// gitignore 的运行时数据目录：文档会引用，但任何干净检出里都不存在，不属于仓库内容。
export const RUNTIME_ROOTS = ['server/data', 'backups'];

// 仓库内可引用的顶层目录；只校验这些前缀，避免把普通单词或命令参数当成路径。
export const REPO_DIRS = [
  'docs',
  'tests',
  'scripts',
  'server',
  'public',
  'deploy',
  'tasks',
  'goals',
  'adr',
  'meta',
  '.github',
];

const LINK_RE = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const INLINE_CODE_RE = /`([^`\n]+)`/g;
const FENCE_RE = /^\s*```/;
const NPM_RUN_RE = /\bnpm\s+run\s+([A-Za-z0-9:_.-]+)/g;
const NPM_ALIAS_RE = /\bnpm\s+(test|start|stop|restart)\b/g;
const NPM_ALIASES = new Set(['test', 'start', 'stop', 'restart']);

const pathPrefix = `(?:${REPO_DIRS.map((dir) => dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`;
// 以顶层目录开头、由常见路径字符组成的 token；遇到空白、引号、括号即结束。
// 通配符 * 也纳入 token，好在 normalizeCodePath 里整段判为 glob 后跳过。
const REPO_PATH_RE = new RegExp(`(?:^|[\\s\`'"(（\\[=])(${pathPrefix}/[A-Za-z0-9._/*-]*)`, 'g');
const TRAILING_PUNCTUATION = /[.,;:!?，。；：、）)\]}>]+$/;
const UNSAFE_PATH_CHARS = /[<>*{}$:?#|]/;

function isExternal(target) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target);
}

export function listDocFiles(root) {
  const docsDir = path.join(root, 'docs');
  const docs = fs
    .readdirSync(docsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.md$/i.test(entry.name))
    .map((entry) => `docs/${entry.name}`)
    .sort();
  return [...DOC_FILES, ...docs].filter((rel) => fs.existsSync(path.join(root, rel)));
}

function readScripts(root) {
  const parsed = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return new Set(Object.keys(parsed.scripts ?? {}));
}

// 去掉尾随标点后，判断该 token 是否是一个应当存在的具体仓库路径（通配符 token 一律跳过）。
export function normalizeCodePath(raw) {
  const candidate = String(raw ?? '').trim().replace(TRAILING_PUNCTUATION, '');
  if (!candidate) return null;
  if (UNSAFE_PATH_CHARS.test(candidate)) return null;
  if (!candidate.includes('/')) return null;
  return candidate;
}

export function checkLink(root, docRel, rawTarget) {
  if (!rawTarget || isExternal(rawTarget)) return null;
  const target = rawTarget.replace(/^<|>$/g, '');
  const [filePart] = target.split('#');
  const cleanFile = (filePart || '').split('?')[0];
  if (!cleanFile) return null;
  const docDir = path.dirname(path.join(root, docRel));
  let resolved;
  try {
    resolved = path.resolve(docDir, decodeURIComponent(cleanFile));
  } catch {
    resolved = path.resolve(docDir, cleanFile);
  }
  return fs.existsSync(resolved) ? null : `链接目标不存在 -> ${rawTarget}`;
}

export function checkCodePath(root, candidate) {
  const normalized = normalizeCodePath(candidate);
  if (!normalized) return null;
  const runtime = RUNTIME_ROOTS.some(
    (runtimeRoot) => normalized === runtimeRoot || normalized === `${runtimeRoot}/` || normalized.startsWith(`${runtimeRoot}/`)
  );
  if (runtime) return null;
  const resolved = path.resolve(root, normalized);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  // 解析后必须仍位于仓库内，避免 `../` 与绝对路径越界检查。
  if (resolved !== root && !resolved.startsWith(rootWithSep)) return null;
  return fs.existsSync(resolved) ? null : `代码路径不存在 -> ${normalized}`;
}

export function checkNpmScript(scripts, rawCommand) {
  const name = String(rawCommand ?? '').trim();
  if (!name) return null;
  if (scripts.has(name)) return null;
  if (NPM_ALIASES.has(name)) return null;
  return `npm 脚本不存在 -> ${name}`;
}

// 从一行里找出所有应校验的代码路径 token（行内反引号 + 围栏代码块正文）。
function codeSegments(line, inFence) {
  if (inFence) return [line];
  return [...line.matchAll(INLINE_CODE_RE)].map((match) => match[1]);
}

function scanLine({ root, docRel, line, lineNo, inFence, scripts, problems }) {
  if (line.includes(IGNORE_MARKER)) return;

  for (const match of line.matchAll(LINK_RE)) {
    const problem = checkLink(root, docRel, match[1]);
    if (problem) problems.push(`${docRel}:${lineNo}: ${problem}`);
  }

  for (const segment of codeSegments(line, inFence)) {
    for (const match of segment.matchAll(REPO_PATH_RE)) {
      const problem = checkCodePath(root, match[1]);
      if (problem) problems.push(`${docRel}:${lineNo}: ${problem}`);
    }
  }

  // npm 命令同时出现在正文与代码中，按整行提取即可。
  for (const match of line.matchAll(NPM_RUN_RE)) {
    const problem = checkNpmScript(scripts, match[1]);
    if (problem) problems.push(`${docRel}:${lineNo}: ${problem}`);
  }
  for (const match of line.matchAll(NPM_ALIAS_RE)) {
    const problem = checkNpmScript(scripts, match[1]);
    if (problem) problems.push(`${docRel}:${lineNo}: ${problem}`);
  }
}

export function analyzeDoc(root, docRel, scripts) {
  const markdown = fs.readFileSync(path.join(root, docRel), 'utf8');
  if (markdown.includes(IGNORE_FILE_MARKER)) return [];
  const problems = [];
  let inFence = false;
  markdown.split('\n').forEach((line, index) => {
    const lineNo = index + 1;
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      return;
    }
    scanLine({ root, docRel, line, lineNo, inFence, scripts, problems });
  });
  return problems;
}

export function analyzeDocs(root = ROOT) {
  const files = listDocFiles(root);
  const scripts = readScripts(root);
  const problems = files.flatMap((docRel) => analyzeDoc(root, docRel, scripts));
  return { ok: problems.length === 0, files, problems };
}

function parseArgs(argv) {
  const options = { root: ROOT };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') {
      options.root = path.resolve(argv[++i] ?? '');
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
    console.log('用法：node scripts/docs-consistency.mjs [--root <目录>]');
    return 0;
  }
  if (options.error) {
    console.error(options.error);
    return 2;
  }
  const result = analyzeDocs(options.root);
  if (result.ok) {
    console.log(`docs-consistency: 文档一致性检查通过（${result.files.length} 个文件）`);
    return 0;
  }
  console.error(`docs-consistency: 发现 ${result.problems.length} 处失效`);
  for (const problem of result.problems) console.error(`  ${problem}`);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
