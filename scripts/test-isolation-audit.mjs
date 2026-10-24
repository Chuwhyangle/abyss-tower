#!/usr/bin/env node
// 测试隔离审计：静态扫描 tests/*.mjs，找出并行运行时可能互相干扰的写法。
// 只读、零依赖：不执行测试、不改断言，只输出「文件:行号 + 规则 + 说明」。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RULES = Object.freeze({
  HARDCODED_PORT: 'hardcoded-port',
  RANDOM_PORT_GUESS: 'random-port-guess',
  FIXED_DB_PATH: 'fixed-db-path',
  REPO_WRITE: 'repo-write',
  SHARED_USERNAME: 'shared-username',
});

export const RULE_HINTS = Object.freeze({
  [RULES.HARDCODED_PORT]: '端口写死，并行时可能被其他测试或进程占用；改用 listen(0) 或 tests/test-server.mjs 的 allocatePort()',
  [RULES.RANDOM_PORT_GUESS]: '端口从固定段里随机猜，会撞上长期占用的端口；改用 tests/test-server.mjs 的 allocatePort()（内核分配 + 租约）',
  [RULES.FIXED_DB_PATH]: '数据库路径写死，多个测试进程会共用同一文件；改用 os.tmpdir() + pid + 时间戳',
  [RULES.REPO_WRITE]: '测试写入仓库目录，会改动工作区并在并行时互相覆盖；改写到临时目录',
  [RULES.SHARED_USERNAME]: '多个测试文件共用同一个固定用户名，共享数据库时会互相污染；改用随机用户名',
});

// 手工 CLI（不在 npm test 里跑）本就会写仓库文档，默认不参与 repo-write 判定。
const MANUAL_TOOLS = new Set(['balance-sim.mjs', 'balance-sweep.mjs', 'dynamic-perf.mjs']);
const REPO_DIRS = 'docs|server|public|scripts|tests|backups|tasks|deploy';
const SUPPRESS_MARKER = 'isolation-audit-ignore';
const MIN_SHARED_USERNAME = 3;

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 把注释替换成空格（保留换行与字符串内容），避免注释里的示例被判为违规。
export function maskComments(source) {
  const out = source.split('');
  let mode = 'code';
  let quote = '';
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (mode === 'line-comment') {
      if (char === '\n') mode = 'code';
      else out[i] = ' ';
      continue;
    }
    if (mode === 'block-comment') {
      if (char === '*' && next === '/') {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 1;
        mode = 'code';
      } else if (char !== '\n') {
        out[i] = ' ';
      }
      continue;
    }
    if (mode === 'string') {
      if (char === '\\') i += 1;
      else if (char === quote) mode = 'code';
      continue;
    }
    if (char === '/' && next === '/') {
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 1;
      mode = 'line-comment';
      continue;
    }
    if (char === '/' && next === '*') {
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 1;
      mode = 'block-comment';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      mode = 'string';
      quote = char;
    }
  }
  return out.join('');
}

function buildLineIndex(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === '\n') starts.push(i + 1);
  }
  return (index) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (starts[mid] <= index) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
}

// 标记所在行与下一行都放行，方便把说明写在违规行上方。
function suppressionSet(source) {
  const lines = new Set();
  source.split('\n').forEach((text, index) => {
    if (text.includes(SUPPRESS_MARKER)) {
      lines.add(index + 1);
      lines.add(index + 2);
    }
  });
  return lines;
}

function callArguments(source, openIndex) {
  let depth = 0;
  let quote = '';
  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (char === '\\') i += 1;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, i);
    }
  }
  return source.slice(openIndex + 1);
}

function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (char === '\\') i += 1;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function pushFinding(findings, suppressed, lineIndex, file, index, rule, detail) {
  const line = lineIndex(index);
  if (suppressed.has(line)) return;
  findings.push({ file, line, rule, detail });
}

const PORT_ASSIGN = /\b(?:PORT|port|SERVER_PORT|DEBUG_PORT|debugPort|remoteDebuggingPort)\s*[:=]\s*(['"]?)(\d{2,5})\1\s*(?=[,;)}\n]|$)/g;
const PORT_GUESS = /\b(?:PORT|port|SERVER_PORT|DEBUG_PORT|debugPort|remoteDebuggingPort)\s*[:=][^;\n]*Math\.random\s*\(/g;
const PORT_LISTEN = /\blisten\s*\(\s*(\d{1,5})\s*[,)]/g;
const PORT_DEBUG_FLAG = /--remote-debugging-port=(\d{1,5})\b/g;
const PORT_URL = /(?:127\.0\.0\.1|localhost):(\d{2,5})\b/g;

function findPorts(masked, file, lineIndex, suppressed, findings) {
  const patterns = [
    [PORT_ASSIGN, '常量赋值'],
    [PORT_LISTEN, 'listen 参数'],
    [PORT_DEBUG_FLAG, 'Chrome 调试端口'],
    [PORT_URL, '写死的本机 URL'],
  ];
  for (const [pattern, kind] of patterns) {
    for (const match of masked.matchAll(pattern)) {
      const value = match[2] ?? match[1];
      if (value === '0') continue;
      pushFinding(findings, suppressed, lineIndex, file, match.index, RULES.HARDCODED_PORT, `端口 ${value} 写死（${kind}）`);
    }
  }
}

function findPortGuesses(masked, file, lineIndex, suppressed, findings) {
  for (const match of masked.matchAll(PORT_GUESS)) {
    pushFinding(
      findings,
      suppressed,
      lineIndex,
      file,
      match.index,
      RULES.RANDOM_PORT_GUESS,
      '端口由 Math.random() 在固定段里猜出'
    );
  }
}

const DB_ASSIGN = /\b(?:DB_PATH|DB_FILE|DATABASE_PATH|dbPath|DB|DATABASE|[A-Za-z_$][\w$]*_DB)\s*(?::|=)\s*(['"])([^'"\n]+)\1/g;
const DB_LIKE = /\.(?:db|sqlite|sqlite3)(?:-wal|-shm)?$/i;

function findFixedDbPaths(masked, file, lineIndex, suppressed, findings) {
  for (const match of masked.matchAll(DB_ASSIGN)) {
    const value = match[2].trim();
    if (!DB_LIKE.test(value) || value === ':memory:') continue;
    pushFinding(findings, suppressed, lineIndex, file, match.index, RULES.FIXED_DB_PATH, `数据库路径写死为 ${value}`);
  }
}

const WRITE_CALL = /\b(?:fs|fsp|fsPromises)\.(writeFileSync|writeFile|appendFileSync|appendFile|mkdirSync|mkdir|rmSync|rm|unlinkSync|unlink|createWriteStream|copyFileSync|renameSync|truncateSync)\s*\(/g;
const TMP_MARKER = /os\.tmpdir\s*\(|\btmpdir\s*\(|\bmkdtemp|\/tmp\b|\/var\/tmp\b|\bOUT_DIR\b/;
const TEMP_ABS = /^\/(?:tmp|var\/tmp)\//;

function quotedLiteral(text) {
  const match = /^(['"`])([^'"`]*)\1$/.exec(text.trim());
  return match ? match[2] : null;
}

// 只把「根在仓库」的目标算违规：ROOT 常量、字面量相对路径、path.resolve/join 的字面量基点。
// 基点来自变量（如测试自建的临时目录）时不判定，避免误报。
function isRepoWriteTarget(args) {
  if (/\bROOT\b/.test(args)) return true;
  if (TMP_MARKER.test(args)) return false;
  const first = splitTopLevel(args)[0] ?? '';
  const direct = quotedLiteral(first);
  if (direct !== null) return isRepoLiteral(direct);
  const call = /^\s*path\.(?:join|resolve)\s*\(([\s\S]+)\)\s*$/.exec(first);
  if (!call) return false;
  const base = quotedLiteral(splitTopLevel(call[1])[0] ?? '');
  return base === null ? false : isRepoLiteral(base);
}

function isRepoLiteral(value) {
  if (value === ':memory:') return false;
  if (value.startsWith('/')) return !TEMP_ABS.test(value);
  if (value === '.' || value.startsWith('./') || value.startsWith('../')) return true;
  return new RegExp(`^(?:${REPO_DIRS})/`).test(value);
}

function findRepoWrites(source, masked, file, lineIndex, suppressed, findings) {
  for (const match of masked.matchAll(WRITE_CALL)) {
    const openIndex = match.index + match[0].length - 1;
    const args = callArguments(masked, openIndex);
    if (!isRepoWriteTarget(args)) continue;
    const target = splitTopLevel(args)[0].trim().replace(/\s+/g, ' ').slice(0, 80);
    pushFinding(findings, suppressed, lineIndex, file, match.index, RULES.REPO_WRITE, `写入仓库路径 ${target}`);
  }
}

const USERNAME_LITERAL = /\b(?:username|userName|USERNAME)\s*[:=]\s*(['"])([^'"\n]+)\1/g;

function collectUsernames(masked, file, lineIndex, suppressed, usernames) {
  for (const match of masked.matchAll(USERNAME_LITERAL)) {
    const value = match[2].trim();
    if (value.length < MIN_SHARED_USERNAME) continue;
    const line = lineIndex(match.index);
    if (suppressed.has(line)) continue;
    if (!usernames.has(value)) usernames.set(value, []);
    usernames.get(value).push({ file, line });
  }
}

export function scanSources(entries, { includeTools = false } = {}) {
  const findings = [];
  const usernames = new Map();
  for (const { file, source } of entries) {
    const masked = maskComments(source);
    const lineIndex = buildLineIndex(source);
    const suppressed = suppressionSet(source);
    findPorts(masked, file, lineIndex, suppressed, findings);
    findPortGuesses(masked, file, lineIndex, suppressed, findings);
    findFixedDbPaths(masked, file, lineIndex, suppressed, findings);
    if (includeTools || !MANUAL_TOOLS.has(path.basename(file))) {
      findRepoWrites(source, masked, file, lineIndex, suppressed, findings);
    }
    collectUsernames(masked, file, lineIndex, suppressed, usernames);
  }
  for (const [value, places] of usernames) {
    const files = new Set(places.map((place) => place.file));
    if (files.size < 2) continue;
    for (const place of places) {
      findings.push({
        file: place.file,
        line: place.line,
        rule: RULES.SHARED_USERNAME,
        detail: `固定用户名 ${value} 出现在 ${files.size} 个测试文件`,
      });
    }
  }
  return findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
}

export function auditDirectory(root = DEFAULT_ROOT, { dir = 'tests', includeTools = false } = {}) {
  const target = path.join(root, dir);
  const files = fs
    .readdirSync(target)
    .filter((name) => name.endsWith('.mjs'))
    .sort();
  const entries = files.map((name) => {
    const file = path.join(target, name);
    return { file: path.relative(root, file), source: fs.readFileSync(file, 'utf8') };
  });
  const findings = scanSources(entries, { includeTools });
  return { root, scanned: entries.length, findings };
}

export function formatReport({ scanned, findings }) {
  const lines = [`测试隔离审计：扫描 ${scanned} 个测试文件`];
  for (const finding of findings) {
    lines.push(`  ${finding.file}:${finding.line}  [${finding.rule}] ${finding.detail}`);
  }
  if (findings.length === 0) {
    lines.push('未发现隔离风险：随机端口 / 临时目录 / 随机用户名。');
  } else {
    lines.push('');
    lines.push(`共 ${findings.length} 处隔离风险。修复提示：`);
    const rules = [...new Set(findings.map((finding) => finding.rule))];
    for (const rule of rules) lines.push(`  - ${RULE_HINTS[rule]}`);
  }
  return lines.join('\n');
}

function parseArgs(argv) {
  const options = { root: DEFAULT_ROOT, dir: 'tests', includeTools: false, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') options.root = path.resolve(argv[(i += 1)] ?? '');
    else if (arg === '--dir') options.dir = argv[(i += 1)] ?? 'tests';
    else if (arg === '--include-tools') options.includeTools = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else return { error: `未知参数：${arg}` };
  }
  return options;
}

const HELP = [
  '用法：node scripts/test-isolation-audit.mjs [--root <dir>] [--dir <subdir>] [--include-tools] [--json]',
  '',
  '静态扫描 tests/*.mjs，报告硬编码端口、随机猜端口、固定数据库路径、写入仓库目录、跨文件共用固定用户名。',
  '退出码：0 无风险；1 发现风险；2 参数错误。',
].join('\n');

function run(argv) {
  const options = parseArgs(argv);
  if (options.error) {
    console.error(options.error);
    console.error(HELP);
    return 2;
  }
  if (options.help) {
    console.log(HELP);
    return 0;
  }
  const result = auditDirectory(options.root, { dir: options.dir, includeTools: options.includeTools });
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatReport(result));
  return result.findings.length > 0 ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = run(process.argv.slice(2));
}
