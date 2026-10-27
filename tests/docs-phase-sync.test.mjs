// 阶段文档同步：PHASE_FEEL_ART 的必需章节、PRD/TECH 的可达交叉引用、AC 映射完整性，
// 以及「open 任务不得声明两份总文档」的文档所有权判决。
// 这是 DOCS-001 的验收见证（criterion: node --test tests/docs-phase-sync.test.mjs）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  DOC_OWNERS,
  analyze,
  extractTouches,
  findBlockedTasks,
  formatFixReport,
  isOpen,
  parseStatus,
} from '../scripts/check-doc-ownership.mjs';
import { analyzeDoc } from '../scripts/docs-consistency.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PHASE_DOC = 'docs/PHASE_FEEL_ART.md';
const PHASE_DOCS = ['docs/PRD.md', 'docs/TECH_DESIGN.md'];
const REQUIRED_SECTIONS = [/^##\s+1\.\s+背景/m, /^##\s+2\.\s+范围/m, /^##\s+3\.\s+命中反馈契约/m, /^##\s+4\.\s+精灵资源索引/m, /^##\s+5\.\s+AC 映射/m];
const PHASE_AC = /^AC-0(?:1[1-9]|2\d|3[01])$/;
const SCRIPT = path.join(ROOT, 'scripts/check-doc-ownership.mjs');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function makeFixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'abyss-docs-ownership-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

function runCli(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

function taskFile({ id, status, touches }) {
  const touchLines = touches.map((item) => `- \`${item}\``).join('\n');
  return `---\nid: ${id}\ntitle: fixture ${id}\nstatus: ${status}\n---\n## Proposal\n\nfixture\n\n## Touches\n\n${touchLines}\n`;
}

test('PHASE_FEEL_ART 存在且含背景/范围/命中反馈契约/精灵资源索引/AC 映射五节', () => {
  const markdown = read(PHASE_DOC);
  for (const pattern of REQUIRED_SECTIONS) assert.match(markdown, pattern);
});

test('PRD/TECH 都链接到 PHASE_FEEL_ART，且其引用的章节号真实存在', () => {
  const phase = read(PHASE_DOC);
  const headingNumbers = new Set(
    phase
      .split('\n')
      .map((line) => /^#{2,4}\s+(\d+(?:\.\d+)*)\.?\s+/.exec(line))
      .filter(Boolean)
      .map((match) => match[1])
  );
  for (const doc of PHASE_DOCS) {
    const markdown = read(doc);
    assert.match(markdown, /docs\/PHASE_FEEL_ART\.md/, `${doc} 必须引用阶段决策文档`);
    const refs = [...markdown.matchAll(/docs\/PHASE_FEEL_ART\.md`?\s*§(\d+(?:\.\d+)*)/g)].map((match) => match[1]);
    assert.ok(refs.length > 0, `${doc} 至少要有一处 §x.y 形式的交叉引用`);
    for (const ref of refs) {
      assert.ok(headingNumbers.has(ref), `${doc} 引用了不存在的章节 §${ref}`);
    }
  }
});

test('三份文档的链接、代码路径与 npm 脚本都可达（check:docs 的局部收口）', () => {
  const scripts = new Set(Object.keys(JSON.parse(read('package.json')).scripts ?? {}));
  for (const doc of [...PHASE_DOCS, PHASE_DOC]) {
    const problems = analyzeDoc(ROOT, doc, scripts);
    assert.deepEqual(problems, [], `${doc} 存在失效引用：\n${problems.join('\n')}`);
  }
});

test('AC 映射覆盖 AC-011…AC-031 与全部 open 的 GOAL-005/006 任务', () => {
  const phase = read(PHASE_DOC);
  const mapping = phase.slice(phase.indexOf('## 5. AC 映射'));
  const taskDir = path.join(ROOT, 'tasks');
  const tasks = fs
    .readdirSync(taskDir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => {
      const markdown = fs.readFileSync(path.join(taskDir, name), 'utf8');
      const goalAc = /^goal_ac:\s*(\S+)\s*$/m.exec(markdown.split(/^---$/m)[1] ?? '');
      return { id: name.replace(/\.md$/, ''), status: parseStatus(markdown), goalAc: goalAc ? goalAc[1] : null };
    });

  for (let ac = 11; ac <= 31; ac += 1) {
    const id = `AC-${String(ac).padStart(3, '0')}`;
    assert.ok(mapping.includes(id), `AC 映射缺少 ${id}`);
  }
  const openPhaseTasks = tasks.filter((task) => task.goalAc && PHASE_AC.test(task.goalAc) && isOpen(task.status));
  assert.ok(openPhaseTasks.length > 0, '任务库里应存在 open 的 GOAL-005/006 任务');
  for (const task of openPhaseTasks) {
    assert.ok(mapping.includes(task.id), `AC 映射缺少 open 任务 ${task.id}（${task.goalAc}）`);
  }
});

test('当前任务库：open 任务不再声明两份总文档（CLI exit 0）', () => {
  const result = analyze(ROOT);
  assert.equal(result.evaluated, true, result.reason);
  assert.deepEqual(result.violations, [], `仍有任务声明总文档：\n${formatFixReport(result)}`);
  const cli = runCli(['--root', ROOT]);
  assert.equal(cli.status, 0, cli.stdout + cli.stderr);
  assert.match(cli.stdout, /0 个 open 任务声明总文档/);
  const fix = runCli(['--root', ROOT, '--fix-report']);
  assert.equal(fix.status, 0);
  assert.equal(fix.stdout.trim(), '');
});

test('清理前能列出受阻任务：ready / todo 都算 open，done 与 DOCS-* 豁免', (t) => {
  const root = makeFixture(t, {
    'tasks/A-audio.md': taskFile({ id: 'A-audio', status: 'ready', touches: ['docs/PRD.md', 'docs/TECH_DESIGN.md', 'public/js/audio.js'] }),
    'tasks/B-done.md': taskFile({ id: 'B-done', status: 'done', touches: ['docs/PRD.md'] }),
    'tasks/C-todo.md': taskFile({ id: 'C-todo', status: 'todo', touches: ['docs/TECH_DESIGN.md'] }),
    'tasks/DOCS-9-lane.md': taskFile({ id: 'DOCS-9-lane', status: 'ready', touches: ['docs/PRD.md'] }),
    'tasks/D-clean.md': taskFile({ id: 'D-clean', status: 'ready', touches: ['public/js/render.js'] }),
  });
  const result = analyze(root);
  assert.equal(result.ok, false);
  assert.deepEqual(result.violations.map((item) => item.id).sort(), ['A-audio', 'C-todo']);
  assert.deepEqual(result.violations.find((item) => item.id === 'A-audio').docs, DOC_OWNERS);

  const cli = runCli(['--root', root]);
  assert.equal(cli.status, 1, cli.stdout + cli.stderr);
  assert.match(cli.stdout, /2 个 open 任务声明了总文档/);
  const fix = runCli(['--root', root, '--fix-report']);
  assert.equal(fix.status, 1);
  assert.deepEqual(fix.stdout.trim().split('\n').sort(), ['A-audio\tdocs/PRD.md', 'A-audio\tdocs/TECH_DESIGN.md', 'C-todo\tdocs/TECH_DESIGN.md']);
});

test('空任务库 / 缺失任务目录按「无法判定」exit 2，绝不静默通过', (t) => {
  const empty = makeFixture(t, { 'tasks/.keep': '' });
  const emptyCli = runCli(['--root', empty]);
  assert.equal(emptyCli.status, 2);
  assert.match(emptyCli.stderr, /没有任何 \.md/);

  const missing = makeFixture(t, { 'README.md': '# fixture\n' });
  const missingCli = runCli(['--root', missing]);
  assert.equal(missingCli.status, 2);
  assert.match(missingCli.stderr, /任务目录不存在/);
});

test('Touches 解析容忍反引号、(new) 尾注与缺失 Touches 区', () => {
  const markdown = taskFile({ id: 'X', status: 'ready', touches: ['docs/PRD.md (new)', 'public/js/x.js'] });
  assert.deepEqual(extractTouches(markdown), ['docs/PRD.md', 'public/js/x.js']);
  assert.equal(findBlockedTasks([{ id: 'X', status: 'ready', touches: extractTouches(markdown) }]).length, 1);
  assert.deepEqual(extractTouches('## Proposal\n\ntext\n'), []);
  assert.equal(parseStatus('---\nid: Y\nstatus: needs-human\n---\n'), 'needs-human');
});

test('CLAUDE.md 的文档所有权约定已更新', () => {
  const markdown = read('CLAUDE.md');
  assert.match(markdown, /文档所有权（单一 lane）/);
  assert.match(markdown, /只由文档 lane/);
  assert.match(markdown, /docs\/PHASE_<主题>\.md/);
  assert.match(markdown, /check-doc-ownership\.mjs/);
});
