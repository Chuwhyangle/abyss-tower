import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  RULES,
  checkContent,
  fixContent,
  measureCodeWidths,
  run,
} from '../scripts/style-check.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'style-check.mjs');

function tempRoot(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'style-check-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(root, relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

const rulesOf = (source, options) => checkContent(source, options).map((item) => item.rule);

test('规则集合集中定义，可增删', () => {
  assert.deepEqual(
    RULES.map((rule) => rule.id),
    ['trailing-whitespace', 'tab', 'max-width', 'final-newline', 'import-order', 'console-log'],
  );
  assert.deepEqual(
    RULES.filter((rule) => rule.fixable).map((rule) => rule.id),
    ['trailing-whitespace', 'final-newline'],
  );
});

test('import 分组顺序：内建 → 第三方 → 本地', () => {
  const good = [
    "import fs from 'node:fs';",
    "import { join } from 'path';",
    "import pkg from 'some-pkg';",
    "import local from './local.js';",
    '',
  ].join('\n');
  assert.deepEqual(rulesOf(good), []);

  const bad = [
    "import local from './local.js';",
    "import fs from 'node:fs';",
    '',
  ].join('\n');
  const violations = checkContent(bad);
  assert.deepEqual(violations.map((item) => item.rule), ['import-order']);
  assert.equal(violations[0].line, 2);
});

test('import 分组支持跨行与副作用 import，动态 import 不计', () => {
  const good = [
    'import {',
    '  readFile,',
    "} from 'node:fs';",
    "import './setup.js';",
    "const mod = await import('./lazy.js');",
    '',
  ].join('\n');
  assert.deepEqual(rulesOf(good), []);

  const bad = [
    "import './setup.js';",
    'import {',
    '  readFile,',
    "} from 'node:fs';",
    '',
  ].join('\n');
  const violations = checkContent(bad);
  assert.deepEqual(violations.map((item) => item.rule), ['import-order']);
  assert.equal(violations[0].line, 2);
});

test('console-log 命中 console.log，允许 warn/error/info', () => {
  const browser = { file: 'public/js/a.js' };
  assert.deepEqual(rulesOf('console.log(a);\n', browser), ['console-log']);
  assert.deepEqual(rulesOf('console.error(a);\nconsole.warn(a);\nconsole.info(a);\n', browser), []);
  assert.deepEqual(rulesOf("const s = 'console.log(x)';\n// console.log(y)\n/* console.log(z) */\n", browser), []);
  assert.deepEqual(rulesOf('console.logger(a);\n', browser), []);
  assert.deepEqual(rulesOf("const s = `console.log(${value})`;\n", browser), []);
});

test('console-log 只作用于浏览器代码（public/js）', () => {
  assert.deepEqual(rulesOf('console.log(a);\n', { file: 'scripts/a.mjs' }), []);
  assert.deepEqual(rulesOf('console.log(a);\n', { file: 'server/a.mjs' }), []);
});

test('// style-allow 行内豁免：整行或指定规则', () => {
  const browser = { file: 'public/js/a.js' };
  assert.deepEqual(rulesOf('console.log(a); // style-allow\n', browser), []);
  assert.deepEqual(rulesOf('console.log(a); // style-allow console-log\n', browser), []);
  assert.deepEqual(rulesOf('console.log(a); // style-allow import-order\n', browser), ['console-log']);
  assert.deepEqual(rulesOf('console.log(a); // style-allow\nconsole.log(b);\n', browser), ['console-log']);
  assert.deepEqual(rulesOf("const s = '// style-allow';\nconsole.log(a);\n", browser), ['console-log']);
  assert.deepEqual(rulesOf('\tconst a = 1; // style-allow\n'), []);

  const bad = [
    "import local from './local.js';",
    "import fs from 'node:fs'; // style-allow import-order",
    '',
  ].join('\n');
  assert.deepEqual(rulesOf(bad), []);
});

test('规则可单独开关', () => {
  const browser = { file: 'public/js/a.js' };
  assert.deepEqual(rulesOf('console.log(a);\n', { ...browser, enabledRules: ['import-order'] }), []);
  assert.deepEqual(rulesOf('console.log(a);\n', { ...browser, enabledRules: ['console-log'] }), ['console-log']);

  const bad = [
    "import local from './local.js';",
    "import fs from 'node:fs';",
    '',
  ].join('\n');
  assert.deepEqual(rulesOf(bad, { enabledRules: ['console-log'] }), []);
});

test('CLI --enable / --disable 切换规则', (t) => {
  const root = tempRoot(t);
  write(root, 'public/js/a.js', 'console.log(1);\n');

  const disabled = spawnSync(process.execPath, ['--no-warnings', SCRIPT, '--root', root, '--disable', 'console-log'], {
    encoding: 'utf8',
  });
  assert.equal(disabled.status, 0, disabled.stderr);

  const only = spawnSync(process.execPath, ['--no-warnings', SCRIPT, '--root', root, '--enable', 'console-log'], {
    encoding: 'utf8',
  });
  assert.equal(only.status, 1);
  assert.match(only.stderr, /public\/js\/a\.js:1:\d+ \[console-log\]/);

  const unknown = spawnSync(process.execPath, ['--no-warnings', SCRIPT, '--root', root, '--enable', 'nope'], {
    encoding: 'utf8',
  });
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /未知规则/);
});

test('尾随空格命中，--fix 修复且幂等', (t) => {
  const root = tempRoot(t);
  const file = write(root, 'scripts/a.mjs', 'const a = 1;  \nconst b = 2;\t\n');

  const first = run({ root, fix: true });
  assert.equal(first.violations.length, 0, JSON.stringify(first.violations));
  assert.deepEqual(first.fixed, [file]);
  assert.equal(fs.readFileSync(file, 'utf8'), 'const a = 1;\nconst b = 2;\n');

  const second = run({ root, fix: true });
  assert.deepEqual(second.fixed, [], '第二次修复不应再改动文件');
  assert.equal(fs.readFileSync(file, 'utf8'), 'const a = 1;\nconst b = 2;\n');
});

test('Tab 命中且 --fix 不自动处理', (t) => {
  const root = tempRoot(t);
  const file = write(root, 'scripts/a.mjs', '\tconst a = 1;\n');

  const violations = checkContent(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(violations.map((item) => item.rule), ['tab']);
  assert.equal(violations[0].column, 1);

  const result = run({ root, fix: true });
  assert.deepEqual(result.violations.map((item) => item.rule), ['tab']);
  assert.equal(fs.readFileSync(file, 'utf8'), '\tconst a = 1;\n');
});

test('代码行宽超限命中', () => {
  const line = `const value = ${Array(40).fill('a + 1').join(' + ')};`;
  assert.ok(line.length > 160);
  assert.equal(measureCodeWidths(`${line}\n`)[0], line.length);
  assert.deepEqual(rulesOf(`${line}\n`), ['max-width']);
});

test('字符串、模板、正则里的长内容不计入行宽', () => {
  const longString = `const s = "${'x'.repeat(300)}";\n`;
  const longTemplate = [
    'const css = `',
    `.card { ${'color: red; '.repeat(30)}}`,
    '`;',
    '',
  ].join('\n');
  const longRegex = `const re = /${'[a-z]+'.repeat(30)}/gi;\n`;

  for (const source of [longString, longTemplate, longRegex]) {
    assert.deepEqual(rulesOf(source), [], JSON.stringify(source.slice(0, 30)));
  }
});

test('模板插值里的代码仍计入行宽', () => {
  const source = `const s = \`x\${${Array(30).fill('a + b').join(' + ')}}\`;\n`;
  assert.deepEqual(rulesOf(source), ['max-width']);
});

test('文件末尾缺少换行命中并可修复', (t) => {
  const root = tempRoot(t);
  const file = write(root, 'scripts/a.mjs', 'const a = 1;');

  assert.deepEqual(rulesOf('const a = 1;'), ['final-newline']);
  const result = run({ root, fix: true });
  assert.equal(result.violations.length, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), 'const a = 1;\n');
  assert.equal(fixContent('const a = 1;\n'), 'const a = 1;\n');
});

test('二进制文件跳过', (t) => {
  const root = tempRoot(t);
  write(root, 'scripts/blob.mjs', Buffer.concat([Buffer.alloc(64, 0), Buffer.from('const a = 1;\n')]));

  const result = run({ root });
  assert.deepEqual(result.skipped.map((item) => item.reason), ['binary']);
  assert.deepEqual(result.violations, []);
});

test('少量 NUL 的文本文件不算二进制', (t) => {
  const root = tempRoot(t);
  const separator = `const key = \`\${line}\u0000\${specifier}\`;\n${'// padding\n'.repeat(40)}`;
  const file = write(root, 'scripts/nul-text.mjs', separator);

  const result = run({ root });
  assert.deepEqual(result.skipped, []);
  assert.equal(fs.existsSync(file), true);
  assert.deepEqual(result.violations, []);
});

test('超过体积上限的文件跳过', (t) => {
  const root = tempRoot(t);
  write(root, 'scripts/big.mjs', `${'const a = 1;  \n'.repeat(20)}`);

  const result = run({ root, maxFileBytes: 32 });
  assert.deepEqual(result.skipped.map((item) => item.reason), ['large']);
  assert.deepEqual(result.violations, []);
});

test('忽略 node_modules 等目录', (t) => {
  const root = tempRoot(t);
  write(root, 'scripts/ok.mjs', 'const a = 1;\n');
  write(root, 'scripts/node_modules/bad.mjs', 'const a = 1;  \n');

  const result = run({ root });
  assert.deepEqual(result.violations, []);
});

test('CLI 干净仓库退出 0，有违规退出 1 并给出行列', (t) => {
  const clean = tempRoot(t);
  write(clean, 'scripts/ok.mjs', 'const a = 1;\n');
  const cleanRun = spawnSync(process.execPath, ['--no-warnings', SCRIPT, '--root', clean], {
    encoding: 'utf8',
  });
  assert.equal(cleanRun.status, 0, cleanRun.stderr);
  assert.match(cleanRun.stdout, /风格检查通过/);

  const dirty = tempRoot(t);
  write(dirty, 'scripts/bad.mjs', 'const a = 1;  \n');
  const dirtyRun = spawnSync(process.execPath, ['--no-warnings', SCRIPT, '--root', dirty], {
    encoding: 'utf8',
  });
  assert.equal(dirtyRun.status, 1);
  assert.match(dirtyRun.stderr, /scripts\/bad\.mjs:1:\d+ \[trailing-whitespace\]/);
});

test('--max-width 可调', () => {
  const source = 'const value = a + b;\n';
  assert.deepEqual(rulesOf(source, { maxWidth: 200 }), []);
  assert.deepEqual(rulesOf(source, { maxWidth: 10 }), ['max-width']);
});

test('当前仓库通过风格检查（AC）', () => {
  const result = spawnSync(process.execPath, ['--no-warnings', SCRIPT, '--root', ROOT], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /风格检查通过/);
});
