// 文档一致性检查的判定：链接 / 代码路径 / npm 脚本三类失效、行号输出与豁免标记。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyzeDocs,
  checkCodePath,
  checkLink,
  checkNpmScript,
  normalizeCodePath,
  IGNORE_FILE_MARKER,
  IGNORE_MARKER,
} from '../scripts/docs-consistency.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

function makeFixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'abyss-docs-consistency-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

const PACKAGE = JSON.stringify({
  name: 'fixture',
  scripts: { test: 'node --test', start: 'node server/index.mjs', 'check:docs': 'node check.mjs' },
});

test('相对链接、代码路径与 npm 脚本三类失效都带文件行号', (t) => {
  const root = makeFixture(t, {
    'package.json': PACKAGE,
    'README.md': [
      '# 示例',
      '[有效链接](docs/GUIDE.md)',
      '[失效链接](docs/MISSING.md)',
      '正文 `public/js/missing.js`，另见 `server/index.mjs`。',
      '运行 npm run no-such-script 会失败。',
      '',
    ].join('\n'),
    'docs/GUIDE.md': '# 手册\n',
    'server/index.mjs': '// entry\n',
  });

  const result = analyzeDocs(root);
  assert.equal(result.ok, false);
  assert.equal(result.problems.length, 3, result.problems.join('\n'));
  assert.ok(result.problems.some((line) => line.startsWith('README.md:3:') && line.includes('docs/MISSING.md')));
  assert.ok(result.problems.some((line) => line.startsWith('README.md:4:') && line.includes('public/js/missing.js')));
  assert.ok(result.problems.some((line) => line.startsWith('README.md:5:') && line.includes('no-such-script')));
});

test('外部链接、页内锚点、通配符与运行时数据目录不误报', (t) => {
  const root = makeFixture(t, {
    'package.json': PACKAGE,
    'README.md': [
      '[外部](https://example.com)',
      '[协议相对](//example.com/x)',
      '[锚点](#示例)',
      '通配符 `tests/browser-*.mjs`、`public/js/**` 与运行时 `server/data/game.db`。',
      '无需 `npm install`，也无需访问 npm registry。',
      '脚本 npm test、npm start、npm run check:docs 都存在。',
      '路径 `server/index.mjs` 存在。',
      '',
    ].join('\n'),
    'docs/GUIDE.md': '# 手册\n',
    'server/index.mjs': '// entry\n',
  });

  const result = analyzeDocs(root);
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
});

test('ignore 标记只豁免所在行', (t) => {
  const root = makeFixture(t, {
    'package.json': PACKAGE,
    'README.md': [
      `[豁免](docs/MISSING.md) <!-- ${IGNORE_MARKER} -->`,
      '[未豁免](docs/MISSING.md)',
      '',
    ].join('\n'),
    'docs/GUIDE.md': '# 手册\n',
  });

  const result = analyzeDocs(root);
  assert.deepEqual(result.problems, ['README.md:2: 链接目标不存在 -> docs/MISSING.md']);
});

test('ignore-file 标记豁免整篇文档', (t) => {
  const root = makeFixture(t, {
    'package.json': PACKAGE,
    'README.md': '# 示例\n',
    'docs/LEGACY.md': [
      `<!-- ${IGNORE_FILE_MARKER} -->`,
      '# 历史方案',
      '[提案文件](docs/PROPOSED.md)',
      '计划使用 `public/js/proposed.js` 与 npm run proposed。',
      '',
    ].join('\n'),
  });

  const result = analyzeDocs(root);
  assert.deepEqual(result.problems, []);
});

test('判定函数直接行为：链接、路径与脚本', (t) => {
  const root = makeFixture(t, {
    'package.json': PACKAGE,
    'server/index.mjs': '// entry\n',
  });
  const scripts = new Set(['test', 'start', 'check:docs']);

  assert.equal(checkLink(root, 'README.md', 'server/index.mjs'), null);
  assert.match(checkLink(root, 'README.md', 'server/missing.mjs'), /链接目标不存在/);
  assert.equal(checkLink(root, 'README.md', 'https://example.com'), null);
  assert.equal(checkCodePath(root, 'server/index.mjs'), null);
  assert.match(checkCodePath(root, 'server/missing.mjs'), /代码路径不存在/);
  assert.equal(checkCodePath(root, 'server/data/game.db'), null);
  assert.equal(checkCodePath(root, 'server/**.mjs'), null);
  assert.equal(checkNpmScript(scripts, 'test'), null);
  assert.match(checkNpmScript(scripts, 'missing'), /npm 脚本不存在/);
  assert.equal(normalizeCodePath('server/index.mjs,'), 'server/index.mjs');
  assert.equal(normalizeCodePath('server/**.mjs'), null);
});

test('真实仓库文档一致：check:docs 的判定为通过', () => {
  const result = analyzeDocs(ROOT);
  assert.deepEqual(result.problems, [], result.problems.join('\n'));
  assert.ok(result.files.includes('README.md'));
  assert.ok(result.files.includes('CONTRIBUTING.md'));
  assert.ok(result.files.includes('docs/ARCHITECTURE.md'));
});
