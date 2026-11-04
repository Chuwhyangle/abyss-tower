// 文档一致性检查的判定：链接 / 代码路径 / npm 脚本三类失效、行号输出与豁免标记（行 / 整篇 / planned 块）。
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
  PLANNED_END,
  PLANNED_START,
  REPO_DIRS,
} from '../scripts/docs-consistency.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PLANNED_OPEN = `<!-- ${PLANNED_START} -->`;
const PLANNED_CLOSE = `<!-- ${PLANNED_END} -->`;
const FENCE = '```';

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

test('planned 块内不判代码路径存在性，块外同一路径照旧报', (t) => {
  const root = makeFixture(t, {
    'package.json': PACKAGE,
    'README.md': [
      '# 示例',
      PLANNED_OPEN,
      '计划新增 `public/js/planned.js`。',
      PLANNED_CLOSE,
      '正文 `public/js/planned.js`。',
      '',
    ].join('\n'),
    'docs/GUIDE.md': '# 手册\n',
  });

  const result = analyzeDocs(root);
  assert.deepEqual(result.problems, ['README.md:5: 代码路径不存在 -> public/js/planned.js']);
});

test('planned 块内相对链接目标缺失与不存在的 npm 脚本仍然报（只豁免路径存在性）', (t) => {
  const root = makeFixture(t, {
    'package.json': PACKAGE,
    'README.md': [
      PLANNED_OPEN,
      '[提案](docs/PROPOSED.md) 计划新增 `public/js/planned.js`，运行 npm run proposed。',
      PLANNED_CLOSE,
      '',
    ].join('\n'),
    'docs/GUIDE.md': '# 手册\n',
  });

  const result = analyzeDocs(root);
  assert.deepEqual(result.problems, [
    'README.md:2: 链接目标不存在 -> docs/PROPOSED.md',
    'README.md:2: npm 脚本不存在 -> proposed',
  ]);
});

test('三处 planned 结构错误 fail-closed：未闭合 / 嵌套 / 孤 end', (t) => {
  const cases = [
    {
      name: '未闭合',
      lines: [PLANNED_OPEN, '计划新增 `public/js/planned.js`。'],
      pattern: /计划块未闭合/,
    },
    {
      name: '嵌套',
      lines: [PLANNED_OPEN, '第一层', PLANNED_OPEN, '第二层', PLANNED_CLOSE],
      pattern: /计划块嵌套/,
    },
    {
      name: '孤 planned-end',
      lines: ['正文', PLANNED_CLOSE],
      pattern: /计划块缺少起始标记/,
    },
  ];

  for (const { name, lines, pattern } of cases) {
    const root = makeFixture(t, {
      'package.json': PACKAGE,
      'README.md': [...lines, ''].join('\n'),
      'docs/GUIDE.md': '# 手册\n',
    });
    const result = analyzeDocs(root);
    assert.equal(result.ok, false, `${name} 必须让 check:docs 转红`);
    assert.equal(result.problems.length, 1, `${name}: ${result.problems.join('\n')}`);
    assert.match(result.problems[0], pattern);
  }
});

test('围栏代码块内的 planned 标记按字面文本处理，不改变块状态', (t) => {
  const root = makeFixture(t, {
    'package.json': PACKAGE,
    'README.md': [
      PLANNED_OPEN,
      FENCE,
      PLANNED_CLOSE,
      FENCE,
      '块内仍在计划态：`public/js/planned.js`。',
      PLANNED_CLOSE,
      '块外：`public/js/planned.js`。',
      '',
    ].join('\n'),
    'docs/GUIDE.md': '# 手册\n',
  });

  const result = analyzeDocs(root);
  assert.deepEqual(result.problems, ['README.md:7: 代码路径不存在 -> public/js/planned.js']);
});

test('含中文（CJK）路径整段捕获：存在不误报、缺失报全名而非截断', (t) => {
  const cjkPath = 'docs/PHASE_爬塔.md';
  // 存在：不应误报缺失。
  const existsRoot = makeFixture(t, {
    'package.json': PACKAGE,
    'README.md': ['# 示例', `规划 \`${cjkPath}\` 冻结表。`, ''].join('\n'),
    'docs/GUIDE.md': '# 手册\n',
    [cjkPath]: '# 爬塔冻结表\n',
  });
  assert.deepEqual(analyzeDocs(existsRoot).problems, []);

  // 缺失：报完整路径（含中文），而非截断成 docs/PHASE_。
  const missingRoot = makeFixture(t, {
    'package.json': PACKAGE,
    'README.md': ['# 示例', `规划 \`${cjkPath}\` 冻结表。`, ''].join('\n'),
    'docs/GUIDE.md': '# 手册\n',
  });
  const missing = analyzeDocs(missingRoot);
  assert.equal(missing.ok, false);
  assert.equal(missing.problems.length, 1, missing.problems.join('\n'));
  assert.match(missing.problems[0], /README\.md:2: 代码路径不存在 -> docs\/PHASE_爬塔\.md$/);
  assert.ok(!missing.problems[0].endsWith('docs/PHASE_'), `不得截断：${missing.problems[0]}`);
});

test('尖括号占位符整段捕获后跳过：不误报，真实缺失路径仍报', (t) => {
  const root = makeFixture(t, {
    'package.json': PACKAGE,
    'README.md': [
      '# 示例',
      '计划正本 `docs/PHASE_<主题>.md` 与通用示例 `docs/<topic>`。',
      '真实缺失路径 `docs/PHASE_不存在.md` 照旧报。',
      '',
    ].join('\n'),
    'docs/GUIDE.md': '# 手册\n',
  });

  const result = analyzeDocs(root);
  // 占位符（含尖括号）整段被 UNSAFE_PATH_CHARS 拒绝，不再截断成 docs/PHASE_ 前缀误报；
  // 唯一红的是真实缺失路径，且报全名而非截断。
  assert.equal(result.ok, false, '真实缺失路径必须让 check:docs 转红');
  assert.equal(result.problems.length, 1, result.problems.join('\n'));
  assert.match(result.problems[0], /README\.md:3: 代码路径不存在 -> docs\/PHASE_不存在\.md$/);
  assert.ok(!result.problems.some((p) => p.includes('docs/PHASE_<')), `占位符不得误报：${result.problems.join('\n')}`);
  assert.ok(!result.problems.some((p) => p.includes('docs/<topic>')), `占位符不得误报：${result.problems.join('\n')}`);
});

// 计划正本（docs/PHASE_<主题>.md）的块外必须保持真实校验：把不在 planned 块内的行取出来。
function outsidePlannedLines(text) {
  const outside = [];
  let inFence = false;
  let planned = false;
  text.split('\n').forEach((line, index) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) {
      if (!planned) outside.push({ line, lineNo: index + 1, inFence });
      return;
    }
    if (line.includes(PLANNED_START)) {
      planned = true;
      return;
    }
    if (line.includes(PLANNED_END)) {
      planned = false;
      return;
    }
    if (!planned) outside.push({ line, lineNo: index + 1, inFence });
  });
  return outside;
}

function plannedBodyLines(text) {
  const all = new Set();
  let inFence = false;
  let planned = false;
  text.split('\n').forEach((line) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    if (line.includes(PLANNED_START)) {
      planned = true;
      return;
    }
    if (line.includes(PLANNED_END)) {
      planned = false;
      return;
    }
    if (planned) all.add(line);
  });
  return [...all];
}

function codePathProblems(lines, root = ROOT) {
  const problems = [];
  for (const { line, lineNo, inFence } of lines) {
    const segments = inFence ? [line] : [...line.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]);
    for (const segment of segments) {
      for (const match of segment.matchAll(/[A-Za-z0-9._/*-]+/g)) {
        const candidate = normalizeCodePath(match[0]);
        if (!candidate) continue;
        if (!REPO_DIRS.some((dir) => candidate === `${dir}/` || candidate.startsWith(`${dir}/`))) continue;
        const problem = checkCodePath(root, candidate);
        if (problem) problems.push(`${lineNo}: ${problem}`);
      }
    }
  }
  return problems;
}

test('计划正本 PHASE_REFACTOR：块外无缺失路径，块内确实豁免了未落地产物', (t) => {
  const phaseDoc = fs.readFileSync(path.join(ROOT, 'docs/PHASE_REFACTOR.md'), 'utf8');
  // R6 收口：计划块（含起止标记行）已全部日落，整篇按「块外」口径做 100% 存在性校验。
  assert.equal(phaseDoc.includes(PLANNED_START), false, '收口后计划正本不应再有 planned 块');
  assert.equal(phaseDoc.includes(PLANNED_END), false, '收口后计划正本不应再有 planned 块');

  // 全文：任何反引号里的仓库路径都必须真实存在——证明门禁没有被整篇削弱。
  const outside = outsidePlannedLines(phaseDoc);
  assert.ok(outside.length > 20, `可达文档正文过少（${outside.length}）`);
  assert.deepEqual(codePathProblems(outside), []);

  // 块内：确实存在落地前不存在的产物，块是被这个冲突逼出来的，而不是无差别豁免。
  // 真实计划正本的产物全部落地后（R1–R5 收口时），块内便不再有缺失路径；该语义改由
  // 固定 fixture 证明——机制仍在（块内缺失路径被豁免、块外同样一条被判红），不依赖进度。
  const plannedFixtureRoot = makeFixture(t, {
    'package.json': PACKAGE,
    'README.md': [PLANNED_OPEN, '块内计划产物：`public/js/planned.js`。', PLANNED_CLOSE, '块外：`public/js/planned.js`。', ''].join('\n'),
    'docs/GUIDE.md': '# 手册\n',
  });
  const plannedFixture = fs.readFileSync(path.join(plannedFixtureRoot, 'README.md'), 'utf8');
  assert.ok(
    codePathProblems(plannedBodyLines(plannedFixture).map((line) => ({ line, lineNo: 0, inFence: false })), plannedFixtureRoot).length > 0,
    '块内豁免机制失效：planned 块内的缺失路径必须仍被判为「已豁免的缺失」'
  );
});

test('真实仓库文档一致：check:docs 的判定为通过', () => {
  const result = analyzeDocs(ROOT);
  assert.deepEqual(result.problems, [], result.problems.join('\n'));
  assert.ok(result.files.includes('README.md'));
  assert.ok(result.files.includes('CONTRIBUTING.md'));
  assert.ok(result.files.includes('docs/ARCHITECTURE.md'));
});
