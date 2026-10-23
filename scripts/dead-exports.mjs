#!/usr/bin/env node
// 死代码提示：列出模块导出在定义文件之外从未被引用的符号。
// 启发式统计（标识符全文匹配），仅供人工复核，不阻塞 CI。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_ROOTS = ['public/js', 'server'];
const REFERENCE_ROOTS = ['public/js', 'server', 'tests', 'scripts'];
const SOURCE_FILE = /\.m?js$/;

const DECLARATION_RE = /^[ \t]*export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
const LIST_RE = /^[ \t]*export\s*\{([^}]*)\}/gm;

function walk(dir, files) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.isFile() && SOURCE_FILE.test(entry.name)) files.push(path.normalize(full));
  }
}

function collect(root, roots) {
  const files = [];
  for (const relative of roots) walk(path.join(root, relative), files);
  return files.sort();
}

export function extractExports(source) {
  const names = new Set();
  for (const match of source.matchAll(DECLARATION_RE)) names.add(match[1]);
  for (const match of source.matchAll(LIST_RE)) {
    for (const part of match[1].split(',')) {
      const entry = part.trim();
      if (!entry) continue;
      const alias = entry.split(/\s+as\s+/).pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(alias)) names.add(alias);
    }
  }
  return [...names].sort();
}

export function findDeadExports(root) {
  const sourceFiles = collect(root, SOURCE_ROOTS);
  const references = collect(root, REFERENCE_ROOTS).map((file) => ({
    file,
    source: fs.readFileSync(file, 'utf8'),
  }));
  const report = [];
  for (const file of sourceFiles) {
    const exports = extractExports(fs.readFileSync(file, 'utf8'));
    if (exports.length === 0) continue;
    const unused = exports.filter((name) => {
      const pattern = new RegExp(`\\b${name}\\b`);
      return !references.some(({ file: other, source }) => other !== file && pattern.test(source));
    });
    if (unused.length > 0) report.push({ file, exports: unused });
  }
  return report;
}

export function formatReport(root, report) {
  const total = report.reduce((sum, entry) => sum + entry.exports.length, 0);
  const lines = [
    `dead-exports: ${total} 个导出在定义文件之外未被引用（仅供参考，不阻塞）`,
  ];
  for (const entry of report) {
    lines.push('');
    lines.push(path.relative(root, entry.file));
    for (const name of entry.exports) lines.push(`  - ${name}`);
  }
  return lines.join('\n');
}

function parseArgs(argv) {
  let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root' && argv[i + 1]) {
      root = path.resolve(argv[i + 1]);
      i += 1;
    }
  }
  return { root };
}

function main() {
  const { root } = parseArgs(process.argv.slice(2));
  console.log(formatReport(root, findDeadExports(root)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
