// 文档门禁：README 与玩家手册里的相对链接、代码块路径必须能在仓库中解析。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DOCS = ['README.md', 'docs/GUIDE.md'];

// 仓库内可引用的顶层目录；代码块只校验这些前缀，避免把命令参数当成路径。
const REPO_DIRS = ['docs', 'tests', 'scripts', 'server', 'public', 'deploy', 'tasks', 'goals', 'adr', 'meta'];
const LINK_RE = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const FENCE_RE = /```[^\n`]*\n([\s\S]*?)```/g;
const REPO_PATH_RE = new RegExp(
  `(?:^|[\\s\`'"(（])((?:${REPO_DIRS.join('|')})/[A-Za-z0-9._\\-/]+)`,
  'g'
);

function isExternal(target) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target);
}

// GitHub 风格标题锚点：小写、去标点、空格转连字符，保留中文与连字符。
function slugify(heading) {
  return heading
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/<[^>]*>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-');
}

function headingSlugs(markdown) {
  return new Set(
    markdown
      .split('\n')
      .map((line) => /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)?.[1])
      .filter(Boolean)
      .map(slugify)
  );
}

// 返回该文档中所有无法解析的相对链接；target 去掉 ?query 与 #anchor 后再看文件。
export function collectBrokenLinks(root, docRel, markdown) {
  const problems = [];
  for (const match of markdown.matchAll(LINK_RE)) {
    const raw = match[1];
    if (!raw || isExternal(raw)) continue;
    const target = raw.replace(/^<|>$/g, '');
    const [filePart, anchorPart] = target.split('#');
    const cleanFile = (filePart || '').split('?')[0];
    const docDir = path.dirname(path.join(root, docRel));
    const resolved = cleanFile
      ? path.resolve(docDir, decodeURIComponent(cleanFile))
      : path.join(root, docRel);
    if (!fs.existsSync(resolved)) {
      problems.push(`${docRel}: 链接目标不存在 -> ${raw}`);
      continue;
    }
    if (anchorPart && resolved.endsWith('.md')) {
      const headings = headingSlugs(fs.readFileSync(resolved, 'utf8'));
      if (!headings.has(slugify(anchorPart))) {
        problems.push(`${docRel}: 锚点不存在 -> ${raw}`);
      }
    }
  }
  return problems;
}

// 代码块中的仓库相对路径（如 docs/BALANCE.md、deploy/rogue-td.service）必须存在。
export function collectBrokenCodePaths(root, docRel, markdown) {
  const problems = [];
  for (const block of markdown.matchAll(FENCE_RE)) {
    for (const match of block[1].matchAll(REPO_PATH_RE)) {
      let candidate = match[1].replace(/[.,;:!?，。；：、）)\]}]+$/, '');
      if (!candidate || /[<>*{}$]/.test(candidate)) continue;
      if (!fs.existsSync(path.join(root, candidate))) {
        problems.push(`${docRel}: 代码块路径不存在 -> ${candidate}`);
      }
    }
  }
  return problems;
}

function checkDocs(root, docs) {
  const problems = [];
  for (const doc of docs) {
    const markdown = fs.readFileSync(path.join(root, doc), 'utf8');
    problems.push(...collectBrokenLinks(root, doc, markdown));
    problems.push(...collectBrokenCodePaths(root, doc, markdown));
  }
  return problems;
}

test('README 与玩家手册中的相对链接可解析', () => {
  const problems = [];
  for (const doc of DOCS) {
    const markdown = fs.readFileSync(path.join(ROOT, doc), 'utf8');
    problems.push(...collectBrokenLinks(ROOT, doc, markdown));
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('文档代码块引用的仓库路径存在', () => {
  const problems = [];
  for (const doc of DOCS) {
    const markdown = fs.readFileSync(path.join(ROOT, doc), 'utf8');
    problems.push(...collectBrokenCodePaths(ROOT, doc, markdown));
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('损坏的相对链接与代码块路径会被检出', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'abyss-docs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(
    path.join(root, 'README.md'),
    [
      '# 示例',
      '',
      '[存在的文档](docs/GUIDE.md)',
      '[缺失的文档](docs/MISSING.md)',
      '[外部链接](https://example.com)',
      '[页内锚点](#示例)',
      '',
      '```bash',
      'npm run check -- docs/GUIDE.md',
      'npm run check -- docs/MISSING.md',
      '```',
      '',
    ].join('\n')
  );
  fs.writeFileSync(path.join(root, 'docs/GUIDE.md'), '# 手册\n\n## 玩法\n');

  const markdown = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const linkProblems = collectBrokenLinks(root, 'README.md', markdown);
  const codeProblems = collectBrokenCodePaths(root, 'README.md', markdown);
  assert.equal(linkProblems.length, 1, linkProblems.join('\n'));
  assert.match(linkProblems[0], /docs\/MISSING\.md/);
  assert.equal(codeProblems.length, 1, codeProblems.join('\n'));
  assert.match(codeProblems[0], /docs\/MISSING\.md/);
});
