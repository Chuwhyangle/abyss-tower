// 阶段文档与文档所有权一致：PHASE_REFACTOR §7「AC ↔ 判据 ↔ 命令」表的漂移钉子。
// 这是 GOAL-009 AC-049 的验收见证（criterion: npm run check:doc-ownership）。
//
// 契约（纯读取 + 纯函数，不跑扫描、不联网、不读 goal store）：
//   (a) §7 表覆盖 AC-043…AC-049 各一次，且每行「命令」单元格非空；
//   (b) 每个 open（todo / ready / needs-human）任务若 `goal_ac` 落在 AC-043…AC-049，该 AC 必须出现在 §7 ——
//       沿用 AC-007 已解耦的口径：只要求 goal_ac 命中 AC 行，不要求任务 id 逐字进表，
//       否则任务库经 task_write 持续增长会让全量套件周期性转红；
//   (c) `package.json` 的 `check:doc-ownership` 逐字等于 AC-049 判据（判据在仓库里只有这一处字面定义），
//       且 §7 的 AC-049 行只引用它、不再手抄两条命令。
// 正例（真实仓库）与负对照（同一份真实文本改一处再断言）共用 checkPhaseRefactorSync，避免两处各抄一套判据。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isOpen, parseStatus } from '../scripts/check-doc-ownership.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PHASE_DOC = 'docs/PHASE_REFACTOR.md';
const TASKS_DIR = 'tasks';
const SECTION_HEADING = '## 7. 门禁与 GOAL AC 映射';
const PHASE_ACS = Object.freeze(Array.from({ length: 7 }, (_, index) => `AC-${String(43 + index).padStart(3, '0')}`));
const PHASE_AC_SET = new Set(PHASE_ACS);
const CHECK_SCRIPT = 'check:doc-ownership';
// AC-049 判据的唯一字面定义；顺序、`&&` 与 `node` 前缀都是判据的一部分，不得改写。
export const AC049_CRITERION = 'node scripts/check-doc-ownership.mjs && node scripts/docs-consistency.mjs';

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// 任务摘要：只取 frontmatter 的 status 与 goal_ac，不读 body（契约不依赖任务叙事）。
export function parseGoalAc(markdown) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (!frontmatter) return null;
  const match = /^goal_ac:\s*(.+?)\s*$/m.exec(frontmatter[1]);
  return match ? match[1].replace(/^['"]|['"]$/g, '').trim() : null;
}

export function loadTaskSummaries(taskDir) {
  return fs
    .readdirSync(taskDir)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => {
      const markdown = fs.readFileSync(path.join(taskDir, name), 'utf8');
      return { id: name.replace(/\.md$/, ''), status: parseStatus(markdown), goalAc: parseGoalAc(markdown) };
    });
}

// 取某一级标题到下一个二级标题之间的正文；缺章节返回空串。
export function sliceSection(markdown, heading) {
  const start = markdown.indexOf(heading);
  if (start === -1) return '';
  const rest = markdown.slice(start + heading.length);
  const next = /^##\s+/m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

// §7 表格行：| AC | 判据 | 命令 |。表头与分隔行跳过。
export function parseAcTable(sectionMarkdown) {
  const rows = [];
  for (const line of sectionMarkdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    const cells = trimmed
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim());
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
    const ac = cells[0].replace(/`/g, '');
    if (!/^AC-\d{3}$/.test(ac)) continue;
    rows.push({ ac, criterion: cells[1] ?? '', command: cells[2] ?? '' });
  }
  return rows;
}

export function checkPhaseRefactorSync({ phaseMarkdown, tasks = [], pkg = {} }) {
  const problems = [];
  const section = sliceSection(phaseMarkdown, SECTION_HEADING);
  if (!section) return [`阶段文档缺少「${SECTION_HEADING}」章节`];

  const rows = parseAcTable(section);
  const byAc = new Map();
  for (const row of rows) {
    if (byAc.has(row.ac)) problems.push(`§7 重复映射 ${row.ac}`);
    else byAc.set(row.ac, row);
    if (!row.command.replace(/`/g, '').trim()) problems.push(`§7 的 ${row.ac} 行缺少命令`);
  }
  for (const ac of PHASE_ACS) {
    if (!byAc.has(ac)) problems.push(`§7 缺少 ${ac}`);
  }

  // (b) 只判 open 任务的 goal_ac 命中 AC 行，不要求任务 id 逐字进表。
  for (const task of tasks) {
    if (!task.goalAc || !PHASE_AC_SET.has(task.goalAc) || !isOpen(task.status)) continue;
    if (!byAc.has(task.goalAc)) {
      problems.push(`open 任务 ${task.id} 的 goal_ac ${task.goalAc} 未出现在 §7`);
    }
  }

  // (c) 判据单一入口：字面量只在 package.json 定义一次，§7 只引用它。
  const declared = pkg.scripts?.[CHECK_SCRIPT];
  if (declared !== AC049_CRITERION) {
    problems.push(`package.json 的 ${CHECK_SCRIPT} 必须逐字等于 AC-049 判据：${AC049_CRITERION}`);
  }
  const ac049 = byAc.get('AC-049');
  if (ac049 && !ac049.command.includes(`npm run ${CHECK_SCRIPT}`)) {
    problems.push(`§7 的 AC-049 行必须引用 npm run ${CHECK_SCRIPT}，不得手抄判据命令`);
  }
  return problems;
}

// 从真实文本里删掉某个 AC 行，作为负对照的输入（不是「断言某字符串存在」的弱检查）。
function withoutAcRow(markdown, ac) {
  const kept = markdown.split(/\r?\n/).filter((line) => !line.trim().startsWith(`| ${ac} `));
  assert.equal(kept.length, markdown.split(/\r?\n/).length - 1, `真实 §7 里应恰有一行 ${ac}`);
  return kept.join('\n');
}

function realRepo() {
  return {
    phaseMarkdown: read(PHASE_DOC),
    tasks: loadTaskSummaries(path.join(ROOT, TASKS_DIR)),
    pkg: JSON.parse(read('package.json')),
  };
}

test('§7 覆盖 AC-043…AC-049、open 任务 goal_ac 都落在表内、判据有单一入口（真实仓库）', () => {
  const repo = realRepo();
  assert.deepEqual(checkPhaseRefactorSync(repo), []);

  // 反空转见证：真实仓库里确实有 open 的 GOAL-009 任务被 (b) 判定覆盖，契约不是空跑。
  const openGoalTasks = repo.tasks.filter((task) => task.goalAc && PHASE_AC_SET.has(task.goalAc) && isOpen(task.status));
  assert.ok(openGoalTasks.length > 0, '真实任务库里应至少有一个 open 的 AC-043…AC-049 任务');
  for (const ac of PHASE_ACS) {
    assert.ok(repo.phaseMarkdown.includes(ac), `阶段文档必须提到 ${ac}`);
  }
});

test('(a) 负对照：删掉 §7 的 AC-046 行 → 缺少 AC-046', () => {
  const repo = realRepo();
  const problems = checkPhaseRefactorSync({ ...repo, phaseMarkdown: withoutAcRow(repo.phaseMarkdown, 'AC-046') });
  assert.deepEqual(problems, ['§7 缺少 AC-046']);
});

test('(a) 负对照：§7 某行命令单元格为空 → 该行缺少命令', () => {
  const repo = realRepo();
  const phaseMarkdown = repo.phaseMarkdown.replace(
    /^\| AC-047 \|(.+?)\|[^|\n]*\|$/m,
    (line) => `${line.split('|').slice(0, -2).join('|')}|  |`
  );
  const problems = checkPhaseRefactorSync({ ...repo, phaseMarkdown });
  assert.ok(problems.includes('§7 的 AC-047 行缺少命令'), problems.join('\n'));
});

test('(b) 负对照：删掉 AC-048 行且存在 open 的 goal_ac: AC-048 任务 → 指名该任务', () => {
  const repo = realRepo();
  const openTask = { id: 'gap-ac-048-fixture-open', status: 'ready', goalAc: 'AC-048' };
  const problems = checkPhaseRefactorSync({
    ...repo,
    phaseMarkdown: withoutAcRow(repo.phaseMarkdown, 'AC-048'),
    tasks: [...repo.tasks, openTask],
  });
  assert.ok(
    problems.includes(`open 任务 ${openTask.id} 的 goal_ac AC-048 未出现在 §7`),
    problems.join('\n')
  );
});

test('(b) 正对照：同一任务改成 done 后再跑不报它（只看 open）', () => {
  const repo = realRepo();
  const closedTask = { id: 'gap-ac-048-fixture-done', status: 'done', goalAc: 'AC-048' };
  const problems = checkPhaseRefactorSync({
    ...repo,
    phaseMarkdown: withoutAcRow(repo.phaseMarkdown, 'AC-048'),
    tasks: [...repo.tasks, closedTask],
  });
  assert.deepEqual(problems, ['§7 缺少 AC-048'], '只剩 (a) 的缺行问题，已关闭任务不参与 (b)');
});

test('(b) 解耦口径：新的 open 任务与已映射 AC 同 goal_ac，id 不必逐字进表', () => {
  const repo = realRepo();
  const injected = { id: 'gap-refactor-newly-filed', status: 'todo', goalAc: 'AC-046' };
  assert.equal(repo.phaseMarkdown.includes(injected.id), false, '真实阶段文档本不该提到合成任务 id');
  assert.deepEqual(checkPhaseRefactorSync({ ...repo, tasks: [...repo.tasks, injected] }), []);
});

test('(c) 负对照：check:doc-ownership 丢掉 docs-consistency 一段 → 判据不再逐字相等', () => {
  const repo = realRepo();
  const pkg = {
    ...repo.pkg,
    scripts: { ...repo.pkg.scripts, [CHECK_SCRIPT]: 'node scripts/check-doc-ownership.mjs' },
  };
  const problems = checkPhaseRefactorSync({ ...repo, pkg });
  assert.deepEqual(problems, [`package.json 的 ${CHECK_SCRIPT} 必须逐字等于 AC-049 判据：${AC049_CRITERION}`]);
});

test('(c) 负对照：§7 的 AC-049 行手抄两条命令（不引用 npm run 入口）→ 报漂移', () => {
  const repo = realRepo();
  const phaseMarkdown = repo.phaseMarkdown.replace(
    /^(\| AC-049 \|.+?\|)[^|\n]*\|$/m,
    (_, head) => `${head} \`${AC049_CRITERION}\` |`
  );
  const problems = checkPhaseRefactorSync({ ...repo, phaseMarkdown });
  assert.deepEqual(problems, [`§7 的 AC-049 行必须引用 npm run ${CHECK_SCRIPT}，不得手抄判据命令`]);
});

test('缺 §7 章节时 fail-closed，不静默通过', () => {
  const repo = realRepo();
  const problems = checkPhaseRefactorSync({
    ...repo,
    phaseMarkdown: repo.phaseMarkdown.replace(SECTION_HEADING, '## 7. 门禁（标题被改）'),
  });
  assert.deepEqual(problems, [`阶段文档缺少「${SECTION_HEADING}」章节`]);
});

test('AC-049 判据在 package.json 有唯一可执行入口，§7 的命令单元格只引用它', () => {
  const repo = realRepo();
  assert.equal(repo.pkg.scripts[CHECK_SCRIPT], AC049_CRITERION);
  const rows = parseAcTable(sliceSection(repo.phaseMarkdown, SECTION_HEADING));
  assert.equal(rows.find((row) => row.ac === 'AC-049').command, `\`npm run ${CHECK_SCRIPT}\``);
});
