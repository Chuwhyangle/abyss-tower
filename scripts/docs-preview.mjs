// 零依赖文档预览：把 docs/*.md 渲染成一页静态 HTML（目录 + 搜索框 + 正文）。
//
// 用法：npm run docs:preview            生成 dist/docs/index.html
//       node scripts/docs-preview.mjs --out <文件>
//
// 只支持 Markdown 子集，其余语法按纯文本显示：
//   - ATX 标题 # ~ ######
//   - 无序列表 - * +、有序列表 1.
//   - 围栏代码块 ```（可带语言）
//   - 引用块 >、水平线 ---
//   - 行内代码 `x`、粗体 **x**、斜体 *x*、链接 [文字](地址)
// 不支持：表格、图片、嵌套列表、原始 HTML、脚注、任务列表、自动链接、缩进代码块。
//
// 安全约定：所有来自 Markdown 的文本（正文、标题、代码块、链接文字）都先做 HTML 转义；
// 链接只放行 http(s)、mailto、相对地址与页内锚点，javascript:/data: 等协议降级为纯文本，
// 因此文档内容无法向页面注入脚本。
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_DOC_ORDER = ['GUIDE.md', 'ARCHITECTURE.md', 'RELEASE.md', 'GLOSSARY.md'];
export const SUPPORTED_SYNTAX = [
  'ATX 标题（# ~ ######）',
  '无序列表（- * +）与有序列表（1.）',
  '围栏代码块（```，可带语言）',
  '引用块（>）与水平线（---）',
  '行内代码、粗体、斜体、链接',
];
export const UNSUPPORTED_SYNTAX = [
  '表格',
  '图片',
  '嵌套列表',
  '原始 HTML',
  '脚注',
  '任务列表',
  '自动链接',
  '缩进代码块',
];

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

// 与 docs-links 门禁一致的锚点规则：小写、去标点、空白转连字符，保留中文与 _-。
export function slugify(text) {
  return (
    String(text)
      .replace(/<[^>]*>/g, '')
      .toLocaleLowerCase('en-US')
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .trim()
      .replace(/\s+/g, '-') || 'section'
  );
}

export function docSlug(fileName) {
  return slugify(String(fileName).replace(/\.md$/i, ''));
}

// 只放行可安全用于 href 的协议；返回 null 表示应降级为纯文本。
export function sanitizeHref(raw) {
  const href = String(raw ?? '').trim();
  if (!href) return null;
  if (href.startsWith('//')) return null; // 协议相对地址同样可能是外部注入入口
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href);
  if (scheme && !/^(?:https?|mailto)$/i.test(scheme[1])) return null;
  return href;
}

function applyEmphasis(escapedText) {
  return escapedText
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function renderLink(labelRaw, hrefRaw, resolveHref) {
  const label = applyEmphasis(escapeHtml(labelRaw));
  const safe = sanitizeHref(hrefRaw);
  if (!safe) return label;
  const resolved = resolveHref ? resolveHref(safe) : safe;
  const external = /^https?:\/\//i.test(safe);
  const target = external ? ' target="_blank" rel="noopener noreferrer"' : '';
  return `<a href="${escapeHtml(resolved)}"${target}>${label}</a>`;
}

const LINK_RE = /\[([^\]]*)\]\(([^)\s]+)\)/g;
const INLINE_CODE_RE = /(`+[\s\S]*?`+)/g;

export function renderInline(text, resolveHref) {
  return String(text)
    .split(INLINE_CODE_RE)
    .map((piece) => {
      if (piece.length > 2 && /^`+[\s\S]*`+$/.test(piece)) {
        return `<code>${escapeHtml(piece.replace(/^`+|`+$/g, ''))}</code>`;
      }
      let out = '';
      let last = 0;
      for (const match of piece.matchAll(LINK_RE)) {
        out += applyEmphasis(escapeHtml(piece.slice(last, match.index)));
        out += renderLink(match[1], match[2], resolveHref);
        last = match.index + match[0].length;
      }
      out += applyEmphasis(escapeHtml(piece.slice(last)));
      return out;
    })
    .join('');
}

// 把文档间的 .md 链接改写成单页内的锚点；其他地址原样保留。
export function createDocLinkResolver(currentSlug, docsByBasename) {
  return (href) => {
    const [rawTarget, rawAnchor] = href.split('#');
    const baseName = rawTarget.split('/').pop().toLowerCase();
    let anchor = rawAnchor;
    if (anchor) {
      try {
        anchor = decodeURIComponent(anchor);
      } catch {
        // 保留原样：非法转义不应让整页生成失败。
      }
    }
    if (rawTarget && /\.md$/i.test(rawTarget) && docsByBasename.has(baseName)) {
      const slug = docsByBasename.get(baseName);
      return anchor ? `#${slug}--${slugify(anchor)}` : `#${slug}`;
    }
    if (!rawTarget && anchor) {
      return `#${currentSlug}--${slugify(anchor)}`;
    }
    return href;
  };
}

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const UL_RE = /^\s*[-*+]\s+(.*)$/;
const OL_RE = /^\s*\d{1,9}[.)]\s+(.*)$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;
const HR_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE_RE = /^\s*```(.*)$/;

function renderCode(language, lines) {
  const lang = String(language || '').trim().split(/\s+/)[0];
  const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
  return `<pre data-search-block><code${cls}>${escapeHtml(lines.join('\n'))}</code></pre>`;
}

// 返回 { html, headings }；headings 供目录与锚点链接使用。
export function renderMarkdown(markdown, { docSlug: slug = '', resolveHref } = {}) {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  const headings = [];
  const usedIds = new Set();
  let paragraph = [];
  let list = null;
  let quote = [];
  let code = null;

  const idFor = (text) => {
    const base = slug ? `${slug}--${slugify(text)}` : slugify(text);
    let id = base;
    let n = 2;
    while (usedIds.has(id)) id = `${base}-${n++}`;
    usedIds.add(id);
    return id;
  };

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p data-search-block>${renderInline(paragraph.join(' '), resolveHref)}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const tag = list.ordered ? 'ol' : 'ul';
    const items = list.items.map((item) => `<li>${renderInline(item, resolveHref)}</li>`).join('');
    blocks.push(`<${tag} data-search-block>${items}</${tag}>`);
    list = null;
  };
  const flushQuote = () => {
    if (!quote.length) return;
    blocks.push(`<blockquote data-search-block><p>${renderInline(quote.join(' '), resolveHref)}</p></blockquote>`);
    quote = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const line of lines) {
    if (code) {
      if (FENCE_RE.test(line)) {
        blocks.push(renderCode(code.language, code.lines));
        code = null;
      } else {
        code.lines.push(line);
      }
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      flushAll();
      code = { language: fence[1], lines: [] };
      continue;
    }

    if (!line.trim()) {
      flushAll();
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      const text = heading[2];
      const id = idFor(text);
      headings.push({ level, text, id });
      blocks.push(`<h${level} id="${id}" data-search-block>${renderInline(text, resolveHref)}</h${level}>`);
      continue;
    }

    if (HR_RE.test(line)) {
      flushAll();
      blocks.push('<hr>');
      continue;
    }

    const quoted = QUOTE_RE.exec(line);
    if (quoted) {
      flushParagraph();
      flushList();
      quote.push(quoted[1]);
      continue;
    }

    const unordered = UL_RE.exec(line);
    const ordered = OL_RE.exec(line);
    if (unordered || ordered) {
      flushParagraph();
      flushQuote();
      const kind = ordered ? 'ordered' : 'unordered';
      if (list && list.kind !== kind) flushList();
      if (!list) list = { kind, ordered: Boolean(ordered), items: [] };
      list.items.push((ordered || unordered)[1]);
      continue;
    }

    flushList();
    flushQuote();
    paragraph.push(line.trim());
  }

  if (code) blocks.push(renderCode(code.language, code.lines));
  flushAll();

  return { html: blocks.join('\n'), headings };
}

// 读取 docs 目录：核心四篇排在前面，其余按文件名排序。
export function loadDocs(docsDir) {
  const names = fs
    .readdirSync(docsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.md$/i.test(entry.name))
    .map((entry) => entry.name);
  const ordered = DEFAULT_DOC_ORDER.filter((name) => names.includes(name));
  const rest = names
    .filter((name) => !DEFAULT_DOC_ORDER.includes(name))
    .sort((a, b) => a.localeCompare(b, 'en'));
  return [...ordered, ...rest].map((name) => ({
    name,
    slug: docSlug(name),
    markdown: fs.readFileSync(path.join(docsDir, name), 'utf8'),
  }));
}

const STYLE = `
:root { color-scheme: light dark; --fg:#1f2328; --muted:#59636e; --bg:#ffffff; --line:#d1d9e0; --accent:#0969da; }
@media (prefers-color-scheme: dark) { :root { --fg:#e6edf3; --muted:#9198a1; --bg:#0d1117; --line:#30363d; --accent:#4493f8; } }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.65 -apple-system,"Segoe UI","Noto Sans SC",sans-serif; }
header { position:sticky; top:0; z-index:1; display:flex; flex-wrap:wrap; gap:12px; align-items:center; padding:12px 20px; background:var(--bg); border-bottom:1px solid var(--line); }
header h1 { margin:0; font-size:18px; }
header input { flex:1 1 240px; max-width:420px; padding:8px 12px; border:1px solid var(--line); border-radius:6px; background:transparent; color:inherit; font:inherit; }
.layout { display:grid; grid-template-columns:280px minmax(0,1fr); gap:24px; max-width:1200px; margin:0 auto; padding:20px; }
nav.toc { position:sticky; top:72px; align-self:start; max-height:calc(100vh - 96px); overflow:auto; font-size:14px; }
nav.toc ul { list-style:none; margin:0; padding-left:14px; }
nav.toc > ul { padding-left:0; }
nav.toc a { color:var(--muted); text-decoration:none; }
nav.toc a:hover { color:var(--accent); }
nav.toc .toc-h3 { padding-left:12px; }
main { min-width:0; }
.doc { padding-bottom:32px; border-bottom:1px solid var(--line); margin-bottom:32px; }
.doc h1,.doc h2,.doc h3 { line-height:1.3; scroll-margin-top:80px; }
.doc a { color:var(--accent); }
.doc code { padding:1px 4px; border-radius:4px; background:rgba(127,127,127,.16); font:0.9em ui-monospace,SFMono-Regular,Consolas,monospace; }
.doc pre { overflow:auto; padding:12px 14px; border:1px solid var(--line); border-radius:6px; background:rgba(127,127,127,.08); }
.doc pre code { padding:0; background:none; }
.doc blockquote { margin:0 0 1em; padding-left:14px; border-left:3px solid var(--line); color:var(--muted); }
footer { max-width:1200px; margin:0 auto; padding:0 20px 40px; color:var(--muted); font-size:13px; }
#search-empty { padding:20px; color:var(--muted); }
@media (max-width:820px) { .layout { grid-template-columns:1fr; } nav.toc { position:static; max-height:none; } }
`;

const SEARCH_SCRIPT = `
(() => {
  const input = document.getElementById('search');
  const empty = document.getElementById('search-empty');
  const toc = document.getElementById('toc');
  const docs = Array.from(document.querySelectorAll('[data-doc]'));
  input.addEventListener('input', () => {
    const query = input.value.trim().toLocaleLowerCase();
    let visible = 0;
    for (const doc of docs) {
      let hitDoc = false;
      for (const block of doc.querySelectorAll('[data-search-block]')) {
        const hit = !query || block.textContent.toLocaleLowerCase().includes(query);
        block.hidden = !hit;
        if (hit) hitDoc = true;
      }
      doc.hidden = !hitDoc;
      if (hitDoc) visible += 1;
    }
    toc.hidden = Boolean(query);
    empty.hidden = visible !== 0;
  });
})();
`;

function docTitle(rendered) {
  const h1 = rendered.headings.find((heading) => heading.level === 1);
  return h1 ? h1.text : rendered.name.replace(/\.md$/i, '');
}

export function buildDocsHtml({ docs, title = '渊塔守卫 · 文档预览' }) {
  const byBasename = new Map(docs.map((doc) => [doc.name.toLowerCase(), doc.slug]));
  const rendered = docs.map((doc) => ({
    ...doc,
    ...renderMarkdown(doc.markdown, {
      docSlug: doc.slug,
      resolveHref: createDocLinkResolver(doc.slug, byBasename),
    }),
  }));

  const tocEntries = rendered
    .map((doc) => {
      const sub = doc.headings
        .filter((heading) => heading.level >= 2 && heading.level <= 3)
        .map((heading) => `<li class="toc-h${heading.level}"><a href="#${heading.id}">${escapeHtml(heading.text)}</a></li>`)
        .join('\n');
      const nested = sub ? `<ul>${sub}</ul>` : '';
      return `<li><a href="#${doc.slug}">${escapeHtml(docTitle(doc))}</a>${nested}</li>`;
    })
    .join('\n');

  const sections = rendered
    .map(
      (doc) =>
        `<section class="doc" id="${doc.slug}" data-doc>\n${doc.html}\n</section>`
    )
    .join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<header>
<h1>${escapeHtml(title)}</h1>
<input id="search" type="search" placeholder="搜索文档…" autocomplete="off" aria-label="搜索文档">
</header>
<div class="layout">
<nav class="toc" id="toc" aria-label="目录"><ul>
${tocEntries}
</ul></nav>
<main>
<p id="search-empty" hidden>没有匹配的内容。</p>
${sections}
</main>
</div>
<footer>
<p>本页由 <code>npm run docs:preview</code> 生成，零第三方依赖。</p>
<p>支持的 Markdown 子集：${escapeHtml(SUPPORTED_SYNTAX.join('；'))}。</p>
<p>不支持：${escapeHtml(UNSUPPORTED_SYNTAX.join('、'))}。</p>
</footer>
<script>${SEARCH_SCRIPT}</script>
</body>
</html>
`;
}

export function writeDocsPreview({ root = ROOT, outPath } = {}) {
  const docsDir = path.join(root, 'docs');
  const docs = loadDocs(docsDir);
  const target = outPath || path.join(root, 'dist', 'docs', 'index.html');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, buildDocsHtml({ docs }), 'utf8');
  return { path: target, count: docs.length };
}

const USAGE = `文档本地预览（零依赖）

用法：
  npm run docs:preview
  node scripts/docs-preview.mjs [--out <文件>]

选项：
  -o, --out <文件>   输出路径，默认 dist/docs/index.html
  -h, --help         显示帮助
`;

function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      out: { type: 'string', short: 'o' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    process.stdout.write(USAGE);
    return;
  }
  const { path: outPath, count } = writeDocsPreview({ outPath: values.out });
  process.stdout.write(`docs-preview: 已生成 ${outPath}（${count} 篇文档）\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`docs-preview: ${error.message}\n`);
    process.exitCode = 1;
  }
}
