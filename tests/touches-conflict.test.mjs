import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  analyze,
  extractTouches,
  findConflicts,
  formatReport,
  parseStatus,
  parseTaskId,
  parseTouch,
  ROOT,
} from '../scripts/touches-conflict.mjs';

const SCRIPT = path.join(ROOT, 'scripts', 'touches-conflict.mjs');

function taskFile({ id, status = 'ready', touches = [] }) {
  const touchLines = touches
    .map((t) => (typeof t === 'string' ? `- \`${t}\`` : `- \`${t.path}\`${t.isNew ? ' (new)' : ''}`))
    .join('\n');
  return `---\nid: ${id}\nstatus: ${status}\n---\n## Touches\n\n${touchLines}\n`;
}

function makeFixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'touches-conflict-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

const runCli = (args, root) =>
  spawnSync(process.execPath, ['--no-warnings', SCRIPT, ...args], { encoding: 'utf8', cwd: root ?? ROOT });

// ── 解析 ────────────────────────────────────────────────────────────────

test('parseTouch 保留 (new) 标注并剥离路径', () => {
  assert.deepEqual(parseTouch('`scripts/touches-conflict.mjs` (new)'), {
    path: 'scripts/touches-conflict.mjs',
    isNew: true,
  });
  assert.deepEqual(parseTouch('`public/js/ui.js`'), { path: 'public/js/ui.js', isNew: false });
  // 复合标注：半角 (new) + 全角说明，仍判为 new（与 anti-drift 同口径）。
  assert.deepEqual(parseTouch('`tests/x.test.mjs` (new)（新增测试）'), {
    path: 'tests/x.test.mjs',
    isNew: true,
  });
});

test('extractTouches 返回 { path, isNew } 且容忍缺失 Touches 区', () => {
  const markdown = taskFile({
    id: 'X',
    touches: ['docs/OWNERSHIP.md (new)', 'scripts/test-changed.mjs'],
  });
  assert.deepEqual(extractTouches(markdown), [
    { path: 'docs/OWNERSHIP.md', isNew: true },
    { path: 'scripts/test-changed.mjs', isNew: false },
  ]);
  assert.deepEqual(extractTouches('## Proposal\n\n文字\n'), []);
});

test('parseStatus / parseTaskId 读 frontmatter，缺失时兜底', () => {
  assert.equal(parseStatus('---\nid: Y\nstatus: needs-human\n---\n'), 'needs-human');
  assert.equal(parseStatus('无 frontmatter'), '');
  assert.equal(parseTaskId('---\nid: Z\nstatus: ready\n---\n', 'fallback'), 'Z');
  assert.equal(parseTaskId('无 frontmatter', 'fallback'), 'fallback');
});

// ── 冲突判定 ────────────────────────────────────────────────────────────

test('两个 ready 任务申明同一非 new 文件 => 冲突', () => {
  const tasks = [
    { id: 'A', status: 'ready', touches: [{ path: 'scripts/test-changed.mjs', isNew: false }] },
    { id: 'B', status: 'ready', touches: [{ path: 'scripts/test-changed.mjs', isNew: false }] },
  ];
  const { ready, conflicts } = findConflicts(tasks);
  assert.equal(ready, 2);
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0].file, 'scripts/test-changed.mjs');
  assert.deepEqual(conflicts[0].pairs, [['A', 'B']]);
});

test('一个 new 一个非 new 申明同一文件也算冲突', () => {
  const tasks = [
    { id: 'A', status: 'ready', touches: [{ path: 'x.js', isNew: true }] },
    { id: 'B', status: 'ready', touches: [{ path: 'x.js', isNew: false }] },
  ];
  assert.equal(findConflicts(tasks).conflicts.length, 1);
});

test('两个任务都标 (new) 的同一路径不算冲突', () => {
  const tasks = [
    { id: 'A', status: 'ready', touches: [{ path: 'x.js', isNew: true }] },
    { id: 'B', status: 'ready', touches: [{ path: 'x.js', isNew: true }] },
  ];
  assert.equal(findConflicts(tasks).conflicts.length, 0);
});

test('只统计 ready 任务：todo/done 与 ready 重叠不判冲突', () => {
  const tasks = [
    { id: 'A', status: 'ready', touches: [{ path: 'x.js', isNew: false }] },
    { id: 'B', status: 'todo', touches: [{ path: 'x.js', isNew: false }] },
    { id: 'C', status: 'done', touches: [{ path: 'x.js', isNew: false }] },
  ];
  const { ready, conflicts } = findConflicts(tasks);
  assert.equal(ready, 1);
  assert.equal(conflicts.length, 0);
});

test('同一任务重复申明同一文件只记一次，不误报', () => {
  const tasks = [
    {
      id: 'A',
      status: 'ready',
      touches: [
        { path: 'x.js', isNew: false },
        { path: 'x.js', isNew: false },
      ],
    },
  ];
  assert.equal(findConflicts(tasks).conflicts.length, 0);
});

test('三任务共享一文件产出两两重叠矩阵（3 对）', () => {
  const tasks = ['A', 'B', 'C'].map((id) => ({
    id,
    status: 'ready',
    touches: [{ path: 'scripts/test-changed.mjs', isNew: false }],
  }));
  const { conflicts } = findConflicts(tasks);
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0].pairs, [['A', 'B'], ['A', 'C'], ['B', 'C']]);
});

// ── 报告与 CLI ──────────────────────────────────────────────────────────

test('formatReport 无冲突时报 OK 并含 ready/扫描计数', () => {
  const report = formatReport({ conflicts: [], ready: 1, scanned: 1 });
  assert.match(report, /touches-conflict: OK/);
  assert.match(report, /ready 1 个/);
});

test('formatReport 有冲突时报出文件名与任务', () => {
  const report = formatReport({
    conflicts: [
      {
        file: 'scripts/test-changed.mjs',
        pairs: [['A', 'B']],
        tasks: [
          { id: 'A', isNew: false },
          { id: 'B', isNew: false },
        ],
      },
    ],
    ready: 2,
    scanned: 2,
  });
  assert.match(report, /scripts\/test-changed\.mjs/);
  assert.match(report, /A\n/);
  assert.match(report, /B\n/);
});

test('CLI 有冲突时 exit 1 并打印冲突文件', (t) => {
  const root = makeFixture(t, {
    'tasks/a.md': taskFile({ id: 'A', touches: ['scripts/test-changed.mjs'] }),
    'tasks/b.md': taskFile({ id: 'B', touches: ['scripts/test-changed.mjs'] }),
  });
  const cli = runCli(['--root', root], ROOT);
  assert.equal(cli.status, 1, cli.stdout + cli.stderr);
  assert.match(cli.stdout, /scripts\/test-changed\.mjs/);
  assert.match(cli.stdout, /A\n/);
  assert.match(cli.stdout, /B\n/);
});

test('CLI 无冲突时 exit 0', (t) => {
  const root = makeFixture(t, {
    'tasks/a.md': taskFile({ id: 'A', touches: ['public/js/a.js'] }),
    'tasks/b.md': taskFile({ id: 'B', touches: ['public/js/b.js (new)'] }),
  });
  const cli = runCli(['--root', root], ROOT);
  assert.equal(cli.status, 0, cli.stdout + cli.stderr);
  assert.match(cli.stdout, /OK/);
});

test('CLI --json 输出机器可读结构', (t) => {
  const root = makeFixture(t, {
    'tasks/a.md': taskFile({ id: 'A', touches: ['x.js'] }),
    'tasks/b.md': taskFile({ id: 'B', touches: ['x.js'] }),
  });
  const cli = runCli(['--root', root, '--json'], ROOT);
  assert.equal(cli.status, 1);
  const parsed = JSON.parse(cli.stdout);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.ready, 2);
  assert.deepEqual(parsed.conflicts[0].file, 'x.js');
  assert.deepEqual(parsed.conflicts[0].pairs, [['A', 'B']]);
});

test('空任务库 / 缺失任务目录按「无法判定」exit 2，绝不静默通过', (t) => {
  const empty = makeFixture(t, { 'tasks/.keep': '' });
  const emptyCli = runCli(['--root', empty], ROOT);
  assert.equal(emptyCli.status, 2);
  assert.match(emptyCli.stderr, /没有任何 \.md/);

  const missing = makeFixture(t, { 'README.md': '# fixture\n' });
  const missingCli = runCli(['--root', missing], ROOT);
  assert.equal(missingCli.status, 2);
  assert.match(missingCli.stderr, /任务目录不存在/);
});

// ── 真实仓库一致性（不硬编码具体文件，避免耦合活任务库）──────────────────

test('CLI 对真实仓库的退出码与 analyze 的冲突判定一致', () => {
  const result = analyze(ROOT);
  assert.equal(result.evaluated, true);
  assert.ok(result.scanned > 0, '应扫描到任务文件');
  const cli = runCli([], ROOT);
  assert.equal(cli.status, result.ok ? 0 : 1, cli.stdout + cli.stderr);
});

test('OWNERSHIP.md 覆盖六条主要 lane', () => {
  const markdown = fs.readFileSync(path.join(ROOT, 'docs', 'OWNERSHIP.md'), 'utf8');
  for (const lane of ['内容 lane', 'sim lane', 'UI 外壳 lane', 'render 外壳 lane', '服务端 lane', 'i18n lane']) {
    assert.match(markdown, new RegExp(lane), `OWNERSHIP.md 缺少 ${lane}`);
  }
});
