// 文档预览：子集渲染、XSS 转义与 CLI 产物。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  escapeHtml,
  docSlug,
  renderMarkdown,
  createDocLinkResolver,
  buildDocsHtml,
  writeDocsPreview,
  SUPPORTED_SYNTAX,
  UNSUPPORTED_SYNTAX,
} from '../scripts/docs-preview.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'docs-preview.mjs');

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('标题、列表与代码块按子集渲染', () => {
  const { html, headings } = renderMarkdown(
    ['# 标题', '', '- 一', '- 二', '', '1. 甲', '2. 乙', '', '```js', 'const a = 1 < 2;', '```', ''].join('\n'),
    { docSlug: 'demo' }
  );
  assert.deepEqual(headings, [{ level: 1, text: '标题', id: 'demo--标题' }]);
  assert.match(html, /<h1 id="demo--标题" data-search-block>标题<\/h1>/);
  assert.match(html, /<ul data-search-block><li>一<\/li><li>二<\/li><\/ul>/);
  assert.match(html, /<ol data-search-block><li>甲<\/li><li>乙<\/li><\/ol>/);
  assert.match(html, /<pre data-search-block><code class="language-js">const a = 1 &lt; 2;<\/code><\/pre>/);
});

test('行内格式与文档间锚点链接', () => {
  const resolve = createDocLinkResolver('guide', new Map([['architecture.md', 'architecture']]));
  const { html } = renderMarkdown(
    '见 [架构](ARCHITECTURE.md#分层) 与 [本页](#上手)，**重点**、`npm test`。',
    { docSlug: 'guide', resolveHref: resolve }
  );
  assert.match(html, /href="#architecture--分层"/);
  assert.match(html, /href="#guide--上手"/);
  assert.match(html, /<strong>重点<\/strong>/);
  assert.match(html, /<code>npm test<\/code>/);
});

test('所有用户内容都转义，脚本与危险协议不生效', () => {
  const { html } = renderMarkdown(
    [
      '# <script>alert(1)</script>',
      '',
      '段落 <img src=x onerror=alert(2)>',
      '',
      '[点我](javascript:alert(3))',
      '',
      '```html',
      '<script>alert(4)</script>',
      '```',
      '',
    ].join('\n')
  );
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /javascript:/i);
  assert.doesNotMatch(html, /<img/i);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(2\)&gt;/);
  assert.match(html, /&lt;script&gt;alert\(4\)&lt;\/script&gt;/);
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
});

test('单页包含目录、搜索框、各文档与限制说明', () => {
  const docs = [
    {
      name: 'GUIDE.md',
      slug: docSlug('GUIDE.md'),
      markdown: '# 玩家手册\n\n## 上手\n\n- 开始\n',
    },
    {
      name: 'ARCHITECTURE.md',
      slug: docSlug('ARCHITECTURE.md'),
      markdown: '# 架构总览\n\n参见 [手册](GUIDE.md#上手)。\n',
    },
  ];
  const html = buildDocsHtml({ docs });
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<input id="search" type="search"/);
  assert.match(html, /<nav class="toc" id="toc"/);
  assert.match(html, /id="guide" data-doc/);
  assert.match(html, /id="architecture" data-doc/);
  assert.match(html, /href="#guide--上手"/);
  assert.match(html, /不支持：/);
  for (const syntax of [...SUPPORTED_SYNTAX, ...UNSUPPORTED_SYNTAX]) {
    assert.ok(html.includes(escapeHtml(syntax)), `页面缺少子集说明：${syntax}`);
  }
});

test('writeDocsPreview 默认写入 dist/docs/index.html', (t) => {
  const root = tempDir(t, 'docs-preview-');
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, 'docs', 'GUIDE.md'), '# 手册\n\n## 上手\n\n正文\n');

  const result = writeDocsPreview({ root });

  assert.equal(result.count, 1);
  assert.equal(result.path, path.join(root, 'dist', 'docs', 'index.html'));
  const html = fs.readFileSync(result.path, 'utf8');
  assert.match(html, /id="guide" data-doc/);
  assert.match(html, /id="guide--上手"/);
});

test('CLI 生成可打开的真实文档页面', (t) => {
  const out = path.join(tempDir(t, 'docs-preview-cli-'), 'index.html');
  const result = spawnSync(process.execPath, ['--no-warnings', SCRIPT, '--out', out], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /已生成/);

  const html = fs.readFileSync(out, 'utf8');
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /玩家手册/);
  assert.match(html, /架构总览/);
  assert.match(html, /id="guide" data-doc/);
  assert.match(html, /<script>[\s\S]*getElementById\('search'\)/);
});

test('package.json 暴露 docs:preview 且声明零依赖', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['docs:preview'], 'node --no-warnings scripts/docs-preview.mjs');
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
});
