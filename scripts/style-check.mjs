#!/usr/bin/env node
// 轻量风格检查：尾随空格、Tab、代码行宽、文件末尾换行。零依赖，只拦截明显问题。
// 行宽只统计「代码字符」——字符串、模板字面量、正则里的内容属于数据，不计入宽度。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_OPTIONS = {
  roots: ['public/js', 'server', 'scripts'],
  extensions: ['.js', '.mjs'],
  ignoreDirs: ['node_modules', '.git'],
  maxWidth: 160,
  maxFileBytes: 1024 * 1024,
};

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

export function analyzeLines(source, options = DEFAULT_OPTIONS) {
  const codeWidths = measureCodeWidths(source);
  return source.split('\n').map((text, index) => ({
    number: index + 1,
    text,
    codeWidth: codeWidths[index] ?? 0,
  }));
}

export function checkContent(source, options = DEFAULT_OPTIONS) {
  const context = {
    source,
    maxWidth: options.maxWidth ?? DEFAULT_OPTIONS.maxWidth,
    lines: analyzeLines(source, options),
  };
  const violations = [];
  for (const line of context.lines) {
    for (const rule of RULES) {
      const hit = rule.check(line, context);
      if (hit) {
        violations.push({ line: line.number, column: hit.column, rule: rule.id, message: rule.message });
      }
    }
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
    for (const violation of checkContent(source, settings)) violations.push({ file, ...violation });
  }

  return { root, files, violations, fixed, skipped };
}

function parseArgs(argv) {
  const options = { fix: false };
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
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      return { error: `未知参数：${arg}` };
    }
  }
  return options;
}

function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log('用法：node scripts/style-check.mjs [--fix] [--root <目录>] [--max-width <列数>]');
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
