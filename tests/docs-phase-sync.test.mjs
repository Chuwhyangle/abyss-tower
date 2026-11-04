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
const TOWER_DOC = 'docs/PHASE_TOWER.md';
const TOWER_REQUIRED_SECTIONS = [/^##\s+1\.\s+背景/m, /^##\s+2\.\s+范围/m, /^##\s+3\.\s+节点图契约/m, /^##\s+4\.\s+三类节点经济契约/m, /^##\s+5\.\s+难度映射/m, /^##\s+6\.\s+实现拆分/m];
const CHAPTER_DOC = 'docs/PHASE_CHAPTERS.md';
const CHAPTER_REQUIRED_SECTIONS = [/^##\s+1\.\s+背景/m, /^##\s+2\.\s+范围/m, /^##\s+3\.\s+章节契约/m, /^##\s+4\.\s+难度曲线/m, /^##\s+5\.\s+平衡红线/m, /^##\s+6\.\s+实现三阶段/m];
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

test('PHASE_TOWER 存在且含背景/范围/节点图契约/经济契约/难度映射/实现拆分六节', () => {
  const markdown = read(TOWER_DOC);
  for (const pattern of TOWER_REQUIRED_SECTIONS) assert.match(markdown, pattern);
});

test('PHASE_CHAPTERS 存在且含背景/范围/章节契约/难度曲线/平衡红线/实现三阶段六节', () => {
  const markdown = read(CHAPTER_DOC);
  for (const pattern of CHAPTER_REQUIRED_SECTIONS) assert.match(markdown, pattern);
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

// ---- AC 映射契约 -------------------------------------------------------------
// 判定抽成纯函数：真实仓库用例与 fixture 正/反例共用同一实现，避免两处各抄一套判据。
// 契约（不读可变的任务 id 清单，只读阶段文档自身）：
//   (a) AC-011…AC-031 每个 AC id 都出现在 §5；
//   (b) 每个 open 的 GOAL-005/006 任务，其 `goal_ac` 必须是被 §5 映射到的 AC——
//       新立案任务由它自己的 AC 行自动覆盖，不再要求任务 id 逐字进表；
//   (c) §5 表格「任务」列引用的任务 id 必须在 tasks/ 下有对应文件（拦改名/删任务留下的悬空引用）。
// 任务 id 级完整清单若仍要强制，应由文档 lane 在阶段文档里维护成独立检查，
// 不能挂在 3 轮全量稳定性门禁上：任务库经 task_write 持续增长，登记与立案不同步即全量转红。
const PHASE_ACS = Object.freeze(Array.from({ length: 21 }, (_, index) => `AC-${String(11 + index).padStart(3, '0')}`));
const AC_MAPPING_HEADING = '## 5. AC 映射';
const TASK_ID_TOKEN = /^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+$/;

function sliceAcMapping(phaseMarkdown) {
  const start = phaseMarkdown.indexOf(AC_MAPPING_HEADING);
  return start === -1 ? '' : phaseMarkdown.slice(start);
}

// §5 表格「任务」列里的任务 id；`—（goal 级）` 这类占位不算。
function extractMappedTaskIds(mappingMarkdown) {
  const ids = new Set();
  let taskColumn = -1;
  for (const line of mappingMarkdown.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) {
      taskColumn = -1;
      continue;
    }
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
    if (taskColumn === -1) {
      const header = cells.indexOf('任务');
      if (header !== -1) taskColumn = header;
      continue;
    }
    for (const token of (cells[taskColumn] ?? '').replace(/`/g, '').split(/[\s、,，/]+/)) {
      if (TASK_ID_TOKEN.test(token)) ids.add(token);
    }
  }
  return ids;
}

function loadTasks(taskDir) {
  return fs
    .readdirSync(taskDir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => {
      const markdown = fs.readFileSync(path.join(taskDir, name), 'utf8');
      const goalAc = /^goal_ac:\s*(\S+)\s*$/m.exec(markdown.split(/^---$/m)[1] ?? '');
      return { id: name.replace(/\.md$/, ''), status: parseStatus(markdown), goalAc: goalAc ? goalAc[1] : null };
    });
}

export function checkAcMapping({ phaseMarkdown, tasks }) {
  const problems = [];
  const mapping = sliceAcMapping(phaseMarkdown);
  const mappedAcs = new Set([...mapping.matchAll(/\bAC-\d{3}\b/g)].map((match) => match[0]));
  for (const ac of PHASE_ACS) {
    if (!mappedAcs.has(ac)) problems.push(`AC 映射缺少 ${ac}`);
  }
  const knownIds = new Set(tasks.map((task) => task.id));
  for (const id of extractMappedTaskIds(mapping)) {
    if (!knownIds.has(id)) problems.push(`AC 映射引用的任务 ${id} 在 tasks/ 下没有对应文件`);
  }
  const openPhaseTasks = tasks.filter((task) => task.goalAc && PHASE_AC.test(task.goalAc) && isOpen(task.status));
  for (const task of openPhaseTasks) {
    if (!mappedAcs.has(task.goalAc)) {
      problems.push(`open 任务 ${task.id} 的 goal_ac ${task.goalAc} 未出现在 AC 映射`);
    }
  }
  return problems;
}

function acMappingRows({ omit = [], withTask = {} } = {}) {
  return PHASE_ACS.filter((ac) => !omit.includes(ac))
    .map((ac) => `| ${ac} fixture | ${withTask[ac] ?? '—（goal 级）'} | goal | fixture | fixture |`)
    .join('\n');
}

function acMappingDoc(rows) {
  return `# fixture 阶段文档\n\n## 1. 背景\n\nfixture\n\n## 5. AC 映射\n\n| AC | 任务 | 状态 | 见证 | 文档落点 |\n|---|---|---|---|---|\n${rows}\n`;
}

test('AC 映射覆盖 AC-011…AC-031，且 open 的 GOAL-005/006 任务都落在已映射 AC 上', () => {
  const problems = checkAcMapping({ phaseMarkdown: read(PHASE_DOC), tasks: loadTasks(path.join(ROOT, 'tasks')) });
  assert.deepEqual(problems, [], `AC 映射存在缺口：\n${problems.join('\n')}`);
});

test('AC 映射反例：§5 缺任一 AC-011…AC-031 的 id 时返回 problem', () => {
  for (const missing of ['AC-011', 'AC-021', 'AC-031']) {
    const problems = checkAcMapping({ phaseMarkdown: acMappingDoc(acMappingRows({ omit: [missing] })), tasks: [] });
    assert.deepEqual(problems, [`AC 映射缺少 ${missing}`]);
  }
});

test('AC 映射反例：open 任务的 goal_ac 未出现在 §5 时返回 problem', () => {
  const tasks = [
    { id: 'gap-unmapped-case', status: 'ready', goalAc: 'AC-020' },
    { id: 'gap-closed-case', status: 'done', goalAc: 'AC-021' },
  ];
  const problems = checkAcMapping({ phaseMarkdown: acMappingDoc(acMappingRows({ omit: ['AC-020'] })), tasks });
  assert.ok(
    problems.some((problem) => problem.includes('gap-unmapped-case') && problem.includes('AC-020')),
    problems.join('\n')
  );
  assert.ok(!problems.some((problem) => problem.includes('gap-closed-case')), '已关闭任务不参与判定');
});

test('AC 映射反例：§5 引用的任务 id 在 tasks/ 下无对应文件时返回 problem', () => {
  const rows = acMappingRows({ withTask: { 'AC-011': 'gap-ghost-task' } });
  const problems = checkAcMapping({
    phaseMarkdown: acMappingDoc(rows),
    tasks: [{ id: 'gap-auto-quality-default', status: 'done', goalAc: 'AC-011' }],
  });
  assert.deepEqual(problems, ['AC 映射引用的任务 gap-ghost-task 在 tasks/ 下没有对应文件']);
});

test('AC 映射正例：新立案 open 任务与已映射 AC 同 goal_ac、且 open 阶段任务为 0 时都返回空 problems', () => {
  const rows = acMappingRows({ withTask: { 'AC-020': 'gap-feel-review-record' } });
  const closedOnly = [{ id: 'gap-feel-review-record', status: 'done', goalAc: 'AC-020' }];
  assert.deepEqual(checkAcMapping({ phaseMarkdown: acMappingDoc(rows), tasks: closedOnly }), []);
  assert.deepEqual(
    checkAcMapping({ phaseMarkdown: acMappingDoc(rows), tasks: [...closedOnly, { id: 'gap-newly-filed', status: 'ready', goalAc: 'AC-020' }] }),
    [],
    '新立案任务的 id 不必逐字进 §5，只要 goal_ac 已被映射'
  );
});

test('解耦复演：真实 tasks/ + 真实阶段文档，注入一个新的 open 任务后仍无 problem', (t) => {
  // 只读真实文件（源），全部写入都落在临时根，绝不写仓库目录。
  const realTasksDir = path.join(ROOT, 'tasks');
  const realTasks = fs
    .readdirSync(realTasksDir)
    .filter((entry) => entry.endsWith('.md'))
    .map((name) => [name, fs.readFileSync(path.join(realTasksDir, name), 'utf8')]);
  const realPhaseMarkdown = read(PHASE_DOC);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'abyss-ac-mapping-replay-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  for (const [name, markdown] of realTasks) fs.writeFileSync(path.join(root, 'tasks', name), markdown);
  fs.writeFileSync(path.join(root, 'docs', 'PHASE_FEEL_ART.md'), realPhaseMarkdown);

  const injected = 'gap-replay-newly-filed';
  fs.writeFileSync(
    path.join(root, 'tasks', `${injected}.md`),
    `---\nid: ${injected}\ntitle: 复演注入的新立案任务\nstatus: ready\ngoal_ac: AC-020\n---\n## Proposal\n\n只存在于临时根的复演注入，模拟 task_write 新立案。\n`
  );

  const phaseMarkdown = fs.readFileSync(path.join(root, 'docs', 'PHASE_FEEL_ART.md'), 'utf8');
  assert.equal(phaseMarkdown.includes(injected), false, '真实阶段文档本不该提到合成任务 id（旧契约会因此转红）');
  const problems = checkAcMapping({ phaseMarkdown, tasks: loadTasks(path.join(root, 'tasks')) });
  assert.deepEqual(problems, [], `注入新立案 open 任务后仍应无 problem：\n${problems.join('\n')}`);
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
