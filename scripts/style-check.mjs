#!/usr/bin/env node
// 轻量风格检查：尾随空格、Tab、代码行宽、文件末尾换行、import 分组顺序、console.log。
// 零依赖，只拦截明显问题。行宽只统计「代码字符」——字符串、模板字面量、正则里的内容属于数据。
import fs from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_OPTIONS = {
  roots: ['public/js', 'server', 'scripts'],
  extensions: ['.js', '.mjs'],
  ignoreDirs: ['node_modules', '.git'],
  maxWidth: 160,
  maxFileBytes: 1024 * 1024,
};

const BUILTIN_MODULES = new Set(builtinModules);
const IMPORT_GROUPS = ['内建', '第三方', '本地'];

// import 分组：node: 前缀或 Node 内建模块 → 内建；./ 或 / 开头 → 本地；其余 → 第三方。
export function classifySpecifier(specifier) {
  if (specifier.startsWith('node:') || BUILTIN_MODULES.has(specifier)) return 0;
  if (specifier.startsWith('.') || specifier.startsWith('/')) return 2;
  return 1;
}

// 收集静态 import 声明（支持跨行与副作用 import），返回 { line, specifier }。
// 动态 import() 与 import.meta 不属于分组顺序的讨论范围。
export function findImports(source) {
  const lines = source.split('\n');
  const imports = [];
  for (let i = 0; i < lines.length; i += 1) {
    const start = /^[ \t]*import\b/.exec(lines[i]);
    if (!start) continue;
    let text = lines[i].slice(start[0].length);
    if (/^[ \t]*[.(]/.test(text)) continue;
    let end = i;
    let specifier = null;
    for (let guard = 0; guard < 50; guard += 1) {
      const sideEffect = /^[ \t]*['"]([^'"]+)['"][ \t]*;?[ \t]*$/.exec(text);
      if (sideEffect) {
        specifier = sideEffect[1];
        break;
      }
      const from = /\bfrom[ \t]*['"]([^'"]+)['"]/.exec(text);
      if (from) {
        specifier = from[1];
        break;
      }
      if ((guard > 0 && /;[ \t]*$/.test(text)) || end + 1 >= lines.length) break;
      end += 1;
      text += `\n${lines[end]}`;
    }
    if (specifier === null) continue;
    imports.push({ line: i + 1, specifier });
    i = end;
  }
  return imports;
}

export const RULES = [
  {
    id: 'trailing-whitespace',
    fixable: true,
    message: '行尾有多余空格或 Tab',
    check(line) {
      const match = /[ \t]+$/.exec(line.text);
      return match ? { column: match.index + 1 } : null;
    },
    fix(text) {
      return text.replace(/[ \t]+$/, '');
    },
  },
  {
    id: 'tab',
    fixable: false,
    message: '包含 Tab 字符（请用空格缩进）',
    check(line) {
      const index = line.text.indexOf('\t');
      return index === -1 ? null : { column: index + 1 };
    },
  },
  {
    id: 'max-width',
    fixable: false,
    message: '代码行宽超过上限',
    check(line, context) {
      return line.codeWidth > context.maxWidth ? { column: context.maxWidth + 1 } : null;
    },
  },
  {
    id: 'final-newline',
    fixable: true,
    message: '文件末尾缺少换行',
    check(line, context) {
      const isLast = line.number === context.lines.length;
      if (!isLast || context.source.length === 0) return null;
      return context.source.endsWith('\n') ? null : { column: line.text.length + 1 };
    },
    fixSource(source) {
      return source.endsWith('\n') ? source : `${source}\n`;
    },
  },
  {
    id: 'import-order',
    fixable: false,
    message: 'import 分组顺序应为：内建 → 第三方 → 本地',
    checkFile(context) {
      const violations = [];
      let highest = -1;
      let highestLabel = '';
      for (const item of findImports(context.source)) {
        const group = classifySpecifier(item.specifier);
        if (group < highest) {
          violations.push({
            line: item.line,
            column: 1,
            message: `${this.message}（「${item.specifier}」属于「${IMPORT_GROUPS[group]}」，却排在「${highestLabel}」之后）`,
          });
        } else {
          highest = group;
          highestLabel = IMPORT_GROUPS[group];
        }
      }
      return violations;
    },
  },
  {
    id: 'console-log',
    fixable: false,
    scope: ['public/js'],
    message: '禁止 console.log（可用 console.warn / console.error，或加 // style-allow）',
    check(line, context) {
      const masked = context.masked[line.number - 1] ?? '';
      const match = /\bconsole\s*\.\s*log\s*\(/.exec(masked);
      return match ? { column: match.index + 1 } : null;
    },
  },
];

// 只有在这些符号之后出现的 / 才按正则字面量处理（否则是除号）。
const REGEX_PRECEDERS = new Set([
  '', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^', '<', '>',
]);

// 逐字符扫描，只把「代码字符」计入宽度；返回每一行的代码宽度。
export function measureCodeWidths(source) {
  const widths = [0];
  const braces = [];
  let mode = 'code';
  let regexClass = false;
  let lastSignificant = '';
  let index = 0;

  const count = () => {
    widths[widths.length - 1] += 1;
  };

  while (index < source.length) {
    const char = source[index];

    if (char === '\n') {
      if (mode === 'line-comment') mode = 'code';
      widths.push(0);
      index += 1;
      continue;
    }

    if (mode === 'line-comment') {
      count();
      index += 1;
      continue;
    }

    if (mode === 'block-comment') {
      count();
      if (char === '*' && source[index + 1] === '/') {
        count();
        mode = 'code';
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    if (mode === 'single' || mode === 'double') {
      if (char === '\\') {
        index += 2;
        continue;
      }
      if (char === (mode === 'single' ? "'" : '"')) {
        lastSignificant = char;
        mode = 'code';
      }
      index += 1;
      continue;
    }

    if (mode === 'template') {
      if (char === '\\') {
        index += 2;
        continue;
      }
      if (char === '`') {
        lastSignificant = '`';
        mode = 'code';
        index += 1;
        continue;
      }
      if (char === '$' && source[index + 1] === '{') {
        braces.push(0);
        mode = 'code';
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    if (mode === 'regex') {
      if (char === '\\') {
        index += 2;
        continue;
      }
      if (char === '[') regexClass = true;
      if (char === ']') regexClass = false;
      if (char === '/' && !regexClass) {
        lastSignificant = '/';
        mode = 'code';
      }
      index += 1;
      continue;
    }

    // mode === 'code'
    if (braces.length && char === '}') {
      if (braces[braces.length - 1] === 0) {
        braces.pop();
        mode = 'template';
        index += 1;
        continue;
      }
      braces[braces.length - 1] -= 1;
    } else if (braces.length && char === '{') {
      braces[braces.length - 1] += 1;
    }

    if (char === "'") {
      mode = 'single';
      index += 1;
      continue;
    }
    if (char === '"') {
      mode = 'double';
      index += 1;
      continue;
    }
    if (char === '`') {
      mode = 'template';
      index += 1;
      continue;
    }
    if (char === '/' && source[index + 1] === '/') {
      mode = 'line-comment';
      index += 1;
      continue;
    }
    if (char === '/' && source[index + 1] === '*') {
      mode = 'block-comment';
      index += 2;
      continue;
    }
    if (char === '/' && REGEX_PRECEDERS.has(lastSignificant)) {
      mode = 'regex';
      regexClass = false;
      index += 1;
      continue;
    }

    if (!/\s/.test(char)) lastSignificant = char;
    count();
    index += 1;
  }

  return widths;
}

// 与 measureCodeWidths 使用同一套状态机，额外返回两份等长掩码行：
// code —— 只保留代码（字符串、模板、正则、注释都抹成空格）；
// withComments —— 抹掉字符串等内容但保留注释，用来识别 // style-allow。
export function maskSource(source) {
  const code = [''];
  const withComments = [''];
  const braces = [];
  let mode = 'code';
  let regexClass = false;
  let lastSignificant = '';
  let index = 0;

  const blank = () => {
    code[code.length - 1] += ' ';
    withComments[withComments.length - 1] += ' ';
  };
  const comment = (char) => {
    code[code.length - 1] += ' ';
    withComments[withComments.length - 1] += char;
  };
  const emit = (char) => {
    code[code.length - 1] += char;
    withComments[withComments.length - 1] += char;
  };
  const skipEscape = () => {
    blank();
    index += 1;
    if (index < source.length && source[index] !== '\n') {
      blank();
      index += 1;
    }
  };

  while (index < source.length) {
    const char = source[index];

    if (char === '\n') {
      if (mode === 'line-comment') mode = 'code';
      code.push('');
      withComments.push('');
      index += 1;
      continue;
    }

    if (mode === 'line-comment' || mode === 'block-comment') {
      comment(char);
      if (mode === 'block-comment' && char === '*' && source[index + 1] === '/') {
        comment('/');
        mode = 'code';
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    if (mode === 'single' || mode === 'double') {
      if (char === '\\') {
        skipEscape();
        continue;
      }
      blank();
      if (char === (mode === 'single' ? "'" : '"')) {
        lastSignificant = char;
        mode = 'code';
      }
      index += 1;
      continue;
    }

    if (mode === 'template') {
      if (char === '\\') {
        skipEscape();
        continue;
      }
      if (char === '`') {
        blank();
        lastSignificant = '`';
        mode = 'code';
        index += 1;
        continue;
      }
      if (char === '$' && source[index + 1] === '{') {
        braces.push(0);
        blank();
        blank();
        mode = 'code';
        index += 2;
        continue;
      }
      blank();
      index += 1;
      continue;
    }

    if (mode === 'regex') {
      if (char === '\\') {
        skipEscape();
        continue;
      }
      if (char === '[') regexClass = true;
      if (char === ']') regexClass = false;
      if (char === '/' && !regexClass) {
        blank();
        lastSignificant = '/';
        mode = 'code';
        index += 1;
        continue;
      }
      blank();
      index += 1;
      continue;
    }

    // mode === 'code'
    if (braces.length && char === '}') {
      if (braces[braces.length - 1] === 0) {
        braces.pop();
        blank();
        mode = 'template';
        index += 1;
        continue;
      }
      braces[braces.length - 1] -= 1;
    } else if (braces.length && char === '{') {
      braces[braces.length - 1] += 1;
    }

    if (char === "'") {
      blank();
      mode = 'single';
      index += 1;
      continue;
    }
    if (char === '"') {
      blank();
      mode = 'double';
      index += 1;
      continue;
    }
    if (char === '`') {
      blank();
      mode = 'template';
      index += 1;
      continue;
    }
    if (char === '/' && source[index + 1] === '/') {
      comment('/');
      comment('/');
      mode = 'line-comment';
      index += 2;
      continue;
    }
    if (char === '/' && source[index + 1] === '*') {
      comment('/');
      comment('*');
      mode = 'block-comment';
      index += 2;
      continue;
    }
    if (char === '/' && REGEX_PRECEDERS.has(lastSignificant)) {
      blank();
      mode = 'regex';
      regexClass = false;
      index += 1;
      continue;
    }

    if (!/\s/.test(char)) lastSignificant = char;
    emit(char);
    index += 1;
  }

  return { code, withComments };
}

// 行内豁免：`// style-allow` 豁免该行全部规则，`// style-allow <规则 id,...>` 只豁免指定规则。
const STYLE_ALLOW = /\/\/[ \t]*style-allow\b([^\n]*)/;

export function parseStyleAllow(commentVisibleLine) {
  const match = STYLE_ALLOW.exec(commentVisibleLine);
  if (!match) return null;
  const rest = match[1].trim();
  if (!rest) return new Set(['*']);
  const ids = rest.toLowerCase().split(/[\s,]+/).filter((token) => RULES.some((rule) => rule.id === token));
  return ids.length > 0 ? new Set(ids) : new Set(['*']);
}

function isRuleEnabled(rule, options) {
  if (Array.isArray(options.enabledRules) && !options.enabledRules.includes(rule.id)) return false;
  if (!rule.scope || !options.file) return true;
  const file = options.file.split(path.sep).join('/');
  return rule.scope.some((prefix) => file === prefix || file.startsWith(`${prefix}/`));
}

export function analyzeLines(source, options = DEFAULT_OPTIONS) {
  const codeWidths = measureCodeWidths(source);
  return source.split('\n').map((text, index) => ({
    number: index + 1,
    text,
    codeWidth: codeWidths[index] ?? 0,
  }));
}

export function checkContent(source, options = DEFAULT_OPTIONS) {
  const masks = maskSource(source);
  const context = {
    source,
    file: options.file ?? '',
    maxWidth: options.maxWidth ?? DEFAULT_OPTIONS.maxWidth,
    masked: masks.code,
    lines: analyzeLines(source, options),
  };
  const allowed = context.lines.map((line) => parseStyleAllow(masks.withComments[line.number - 1] ?? ''));
  const violations = [];
  const push = (rule, hit) => {
    const allow = allowed[hit.line - 1];
    if (allow && (allow.has('*') || allow.has(rule.id))) return;
    violations.push({ line: hit.line, column: hit.column, rule: rule.id, message: hit.message ?? rule.message });
  };

  for (const line of context.lines) {
    for (const rule of RULES) {
      if (!rule.check || !isRuleEnabled(rule, options)) continue;
      const hit = rule.check(line, context);
      if (hit) push(rule, { line: line.number, ...hit });
    }
  }
  for (const rule of RULES) {
    if (!rule.checkFile || !isRuleEnabled(rule, options)) continue;
    for (const hit of rule.checkFile(context)) push(rule, hit);
  }
  return violations;
}

// 只做无争议修复：去行尾空白、补末尾换行。Tab 等需要人工判断的不动。
export function fixContent(source) {
  let text = source;
  for (const rule of RULES) {
    if (!rule.fixable) continue;
    if (rule.fix) text = text.split('\n').map((line) => rule.fix(line)).join('\n');
    if (rule.fixSource) text = rule.fixSource(text);
  }
  return text;
}

// 少量 NUL 可能只是源码里的分隔符，按密度判定二进制（超过 1%）。
function isBinary(buffer) {
  const limit = Math.min(buffer.length, 8192);
  let nul = 0;
  for (let i = 0; i < limit; i += 1) {
    if (buffer[i] === 0) nul += 1;
  }
  return nul > limit * 0.01;
}

export function collectFiles(root, options = DEFAULT_OPTIONS) {
  const extensions = options.extensions ?? DEFAULT_OPTIONS.extensions;
  const ignoreDirs = options.ignoreDirs ?? DEFAULT_OPTIONS.ignoreDirs;
  const files = [];

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!ignoreDirs.includes(entry.name)) walk(full);
      } else if (entry.isFile() && extensions.includes(path.extname(entry.name))) {
        files.push(full);
      }
    }
  };

  for (const relative of options.roots ?? DEFAULT_OPTIONS.roots) {
    const absolute = path.join(root, relative);
    if (fs.existsSync(absolute) && fs.statSync(absolute).isDirectory()) walk(absolute);
  }
  return files.sort();
}

export function inspectFile(file, options = DEFAULT_OPTIONS) {
  const stat = fs.statSync(file);
  if (stat.size > (options.maxFileBytes ?? DEFAULT_OPTIONS.maxFileBytes)) return { skipped: 'large' };
  const buffer = fs.readFileSync(file);
  if (isBinary(buffer)) return { skipped: 'binary' };
  return { source: buffer.toString('utf8') };
}

export function run(options = {}) {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  const root = settings.root ? path.resolve(settings.root) : process.cwd();
  const files = collectFiles(root, settings);
  const violations = [];
  const fixed = [];
  const skipped = [];

  for (const file of files) {
    const inspected = inspectFile(file, settings);
    if (inspected.skipped) {
      skipped.push({ file, reason: inspected.skipped });
      continue;
    }
    let source = inspected.source;
    if (settings.fix) {
      const next = fixContent(source);
      if (next !== source) {
        fs.writeFileSync(file, next);
        fixed.push(file);
        source = next;
      }
    }
    const relativeFile = path.relative(root, file).split(path.sep).join('/');
    for (const violation of checkContent(source, { ...settings, file: relativeFile })) {
      violations.push({ file, ...violation });
    }
  }

  return { root, files, violations, fixed, skipped };
}

function parseRuleIds(value, flag) {
  const ids = value.split(',').map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0) return { error: `${flag} 需要规则 id（逗号分隔）` };
  const unknown = ids.filter((id) => !RULES.some((rule) => rule.id === id));
  return unknown.length > 0 ? { error: `未知规则：${unknown.join('、')}` } : { ids };
}

function parseArgs(argv) {
  const options = { fix: false, enable: [], disable: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--fix') {
      options.fix = true;
    } else if (arg === '--root') {
      const value = argv[++i];
      if (!value) return { error: '--root 需要一个目录参数' };
      options.root = value;
    } else if (arg === '--max-width') {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value) || value <= 0) return { error: '--max-width 需要一个正整数' };
      options.maxWidth = Math.floor(value);
    } else if (arg === '--enable' || arg === '--disable') {
      const value = argv[++i];
      if (!value) return { error: `${arg} 需要规则 id（逗号分隔）` };
      const parsed = parseRuleIds(value, arg);
      if (parsed.error) return parsed;
      options[arg === '--enable' ? 'enable' : 'disable'].push(...parsed.ids);
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      return { error: `未知参数：${arg}` };
    }
  }
  const { enable, disable } = options;
  if (enable.length > 0 || disable.length > 0) {
    const base = enable.length > 0 ? enable : RULES.map((rule) => rule.id);
    options.enabledRules = base.filter((id) => !disable.includes(id));
  }
  delete options.enable;
  delete options.disable;
  return options;
}

function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log('用法：node scripts/style-check.mjs [--fix] [--root <目录>] [--max-width <列数>] [--enable <规则>] [--disable <规则>]');
    console.log('规则：', RULES.map((rule) => `${rule.id}${rule.fixable ? '(可自动修复)' : ''}`).join('、'));
    return 0;
  }
  if (options.error) {
    console.error(options.error);
    return 2;
  }

  const result = run(options);
  const relative = (file) => path.relative(result.root, file) || file;

  for (const file of result.fixed) console.log(`已修复：${relative(file)}`);
  for (const violation of result.violations) {
    const where = `${relative(violation.file)}:${violation.line}:${violation.column}`;
    console.error(`${where} [${violation.rule}] ${violation.message}`);
  }
  for (const item of result.skipped) {
    console.log(`跳过：${relative(item.file)}（${item.reason === 'binary' ? '二进制' : '文件过大'}）`);
  }

  if (result.violations.length > 0) {
    console.error(`风格检查未通过：${result.violations.length} 个问题（${result.files.length} 个文件）`);
    return 1;
  }
  console.log(`风格检查通过：${result.files.length} 个文件`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
