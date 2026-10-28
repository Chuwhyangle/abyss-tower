// 结构预算门禁 + 两块「行为不变」见证的正/负对照。
// 正对照在真实仓库上跑；负对照全部在临时 fixture 树上跑——这样「预算调低一行必红」这类断言
// 不依赖真实仓库当前的某个文件恰好卡在预算线上。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  BUDGETS,
  DEBT_DIR,
  countLines,
  findCycles,
  isDataExempt,
  loadDebt,
  runCheck,
} from '../scripts/structure-budget.mjs';
import {
  BASELINE_FILE as PARITY_BASELINE,
  compareFrameSets,
  expectedCoverage,
  frameKey,
  serializeBaseline,
  toBaselineFrames,
  validateBaseline,
} from '../scripts/visual-parity.mjs';
import {
  ARTIFACTS,
  BASELINE_FILE as DETERMINISM_BASELINE,
  SEEDS,
  compareRecords,
  hashesFromArtifacts,
  serializeBaseline as serializeDeterminismBaseline,
  validateBaseline as validateDeterminismBaseline,
} from '../scripts/check-sim-determinism.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUDGET_SCRIPT = path.join(ROOT, 'scripts/structure-budget.mjs');

function tempRoot(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'abyss-structure-budget-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

// 生成恰好 lineCount 行的 JS 文件（以换行结尾，与 wc -l 同口径）。
const sized = (lineCount, body = 'export const value = 1;') =>
  `${Array.from({ length: lineCount }, () => body).join('\n')}\n`;

function runBudget(args) {
  return spawnSync(process.execPath, ['--no-warnings', BUDGET_SCRIPT, ...args], { encoding: 'utf8' });
}

function debtFile(owner, entries) {
  return JSON.stringify({ entries }, null, 2);
}

// ── 正对照：真实仓库 ────────────────────────────────────────────────────────

test('真实仓库结构预算通过（超限文件全部登记债务）', (t) => {
  const result = runBudget(['--check']);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /structure-budget: OK/);
});

test('真实仓库的行数预算与 PHASE_REFACTOR §5 一致', (t) => {
  assert.equal(BUDGETS.runtime.maxLines, 600);
  assert.equal(BUDGETS.tool.maxLines, 800);
  assert.deepEqual([...BUDGETS.runtime.roots], ['public/js', 'server']);
  assert.deepEqual([...BUDGETS.tool.roots], ['scripts', 'tests']);
});

test('债务登记按任务一份文件，条目 owner 与文件名一致', (t) => {
  const { entries, problems, files } = loadDebt(ROOT);
  assert.deepEqual(problems, []);
  assert.ok(files.length > 0, '应至少有一个债务文件');
  assert.ok(entries.size > 0, '应至少登记一条债务');
  for (const entry of entries.values()) {
    assert.equal(path.join(ROOT, DEBT_DIR, `${entry.owner}.json`), path.join(ROOT, DEBT_DIR, entry.file));
    assert.ok(fs.existsSync(path.join(ROOT, 'tasks', `${entry.owner}.md`)), `owner ${entry.owner} 任务不存在`);
    const limit = entry.path.startsWith('scripts/') || entry.path.startsWith('tests/')
      ? BUDGETS.tool.maxLines
      : BUDGETS.runtime.maxLines;
    assert.ok(entry.maxLines > limit, `${entry.path} 的债务上限必须高于常规预算`);
  }
});

test('countLines 与 wc -l 同口径（末尾换行不额外计行）', (t) => {
  assert.equal(countLines(''), 0);
  assert.equal(countLines('a'), 1);
  assert.equal(countLines('a\n'), 1);
  assert.equal(countLines('a\nb\n'), 2);
  assert.equal(countLines('a\nb'), 2);
});

// ── 负对照：行数预算 ────────────────────────────────────────────────────────

test('负对照：预算调到文件行数以下 1 行必红', (t) => {
  const root = tempRoot(t, { 'public/js/edge.js': sized(10) });
  const green = runBudget(['--check', '--root', root, '--budget-lines', '10']);
  assert.equal(green.status, 0, green.stderr);
  const red = runBudget(['--check', '--root', root, '--budget-lines', '9']);
  assert.equal(red.status, 1);
  assert.match(red.stderr, /over-budget/);
  assert.match(red.stderr, /public\/js\/edge\.js/);
});

test('负对照：工具目录预算同样生效（tests 与 scripts 用 800 行口径）', (t) => {
  const root = tempRoot(t, { 'tests/big.test.mjs': sized(20) });
  assert.equal(runBudget(['--check', '--root', root]).status, 0);
  assert.equal(runBudget(['--check', '--root', root, '--budget-tool-lines', '19']).status, 1);
});

// ── 正/负对照：债务登记 ─────────────────────────────────────────────────────

test('正对照：超限文件被债务条目覆盖后转绿', (t) => {
  const root = tempRoot(t, {
    'public/js/big.js': sized(30),
    'tasks/some-owner.md': '---\nid: some-owner\n---\n',
    [`${DEBT_DIR}/some-owner.json`]: debtFile('some-owner', [
      { path: 'public/js/big.js', maxLines: 30, owner: 'some-owner' },
    ]),
  });
  const result = runBudget(['--check', '--root', root, '--budget-lines', '10']);
  assert.equal(result.status, 0, result.stderr);
});

test('负对照：债务上限被超出必红', (t) => {
  const root = tempRoot(t, {
    'public/js/big.js': sized(30),
    'tasks/some-owner.md': '---\nid: some-owner\n---\n',
    [`${DEBT_DIR}/some-owner.json`]: debtFile('some-owner', [
      { path: 'public/js/big.js', maxLines: 29, owner: 'some-owner' },
    ]),
  });
  const result = runBudget(['--check', '--root', root, '--budget-lines', '10']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /debt-exceeded/);
});

test('负对照：债务 owner 任务不存在必红', (t) => {
  const root = tempRoot(t, {
    'public/js/big.js': sized(30),
    [`${DEBT_DIR}/ghost-owner.json`]: debtFile('ghost-owner', [
      { path: 'public/js/big.js', maxLines: 30, owner: 'ghost-owner' },
    ]),
  });
  const result = runBudget(['--check', '--root', root, '--budget-lines', '10']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /debt-owner-missing/);
});

test('负对照：债务文件名与条目 owner 不一致必红（一个任务一个文件）', (t) => {
  const root = tempRoot(t, {
    'public/js/big.js': sized(30),
    'tasks/owner-a.md': '---\nid: owner-a\n---\n',
    [`${DEBT_DIR}/owner-a.json`]: debtFile('owner-a', [
      { path: 'public/js/big.js', maxLines: 30, owner: 'owner-b' },
    ]),
  });
  const result = runBudget(['--check', '--root', root, '--budget-lines', '10']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /debt-owner-mismatch/);
});

test('负对照：条目指向已还清的文件必红（债务已还清就该删）', (t) => {
  const root = tempRoot(t, {
    'public/js/small.js': sized(5),
    'tasks/some-owner.md': '---\nid: some-owner\n---\n',
    [`${DEBT_DIR}/some-owner.json`]: debtFile('some-owner', [
      { path: 'public/js/small.js', maxLines: 30, owner: 'some-owner' },
    ]),
  });
  const result = runBudget(['--check', '--root', root]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /debt-stale/);
});

test('负对照：条目指向不存在的文件必红', (t) => {
  const root = tempRoot(t, {
    'public/js/real.js': sized(5),
    'tasks/some-owner.md': '---\nid: some-owner\n---\n',
    [`${DEBT_DIR}/some-owner.json`]: debtFile('some-owner', [
      { path: 'public/js/gone.js', maxLines: 30, owner: 'some-owner' },
    ]),
  });
  const result = runBudget(['--check', '--root', root]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /debt-unknown-path/);
});

// ── 数据豁免与纯度 ─────────────────────────────────────────────────────────

test('数据豁免：i18n / migrations / *-data.js 不参与行数预算', (t) => {
  const root = tempRoot(t, {
    'public/js/shared/i18n/zz-ZZ.js': sized(900, "  'a.b': '文本',"),
    'server/db/migrations/9999_fixture.mjs': sized(900),
    'public/js/render/enemy-data.js': sized(900),
  });
  assert.equal(isDataExempt('public/js/shared/i18n/zz-ZZ.js'), true);
  assert.equal(isDataExempt('server/db/migrations/9999_fixture.mjs'), true);
  assert.equal(isDataExempt('public/js/render/enemy-data.js'), true);
  assert.equal(isDataExempt('public/js/render/enemy-renderer.js'), false);
  const result = runBudget(['--check', '--root', root]);
  assert.equal(result.status, 0, result.stderr);
});

test('负对照：数据模块 import 运行时模块必红', (t) => {
  const root = tempRoot(t, {
    'public/js/render/tower-renderer.js': 'export const draw = () => {};\n',
    'public/js/render/enemy-data.js': "import { draw } from './tower-renderer.js';\nexport const drawEnemy = draw;\n",
  });
  const result = runBudget(['--check', '--root', root]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /data-impurity/);
  assert.match(result.stderr, /enemy-data\.js/);
});

test('正对照：数据模块只依赖其他数据模块时通过', (t) => {
  const root = tempRoot(t, {
    'public/js/shared/data.js': 'export const TILE = 32;\n',
    'public/js/render/enemy-tables-data.js': "import { TILE } from '../shared/data.js';\nexport const SPEEDS = [TILE];\n",
    'public/js/render/enemy-data.js': "import { SPEEDS } from './enemy-tables-data.js';\nexport const SPEED = SPEEDS[0];\n",
  });
  const result = runBudget(['--check', '--root', root]);
  assert.equal(result.status, 0, result.stderr);
});

// ── 导入环 ─────────────────────────────────────────────────────────────────

test('负对照：人为构造的 import 环必红', (t) => {
  const root = tempRoot(t, {
    'public/js/a.js': "import { b } from './b.js';\nexport const a = b + 1;\n",
    'public/js/b.js': "import { a } from './a.js';\nexport const b = a + 1;\n",
  });
  const result = runBudget(['--check', '--root', root]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[cycle\]/);
});

test('Tarjan 判出多节点环与自环，且不误报有向无环图', (t) => {
  const nodes = ['a', 'b', 'c', 'd'];
  const acyclic = [
    { from: 'a', to: 'b', specifier: './b.js', line: 1 },
    { from: 'a', to: 'c', specifier: './c.js', line: 2 },
    { from: 'b', to: 'd', specifier: './d.js', line: 1 },
    { from: 'c', to: 'd', specifier: './d.js', line: 1 },
  ];
  assert.deepEqual(findCycles(nodes, acyclic), []);
  const withCycle = [...acyclic, { from: 'd', to: 'a', specifier: './a.js', line: 1 }];
  assert.deepEqual(findCycles(nodes, withCycle), [['a', 'b', 'c', 'd']]);
  assert.deepEqual(findCycles(['self'], [{ from: 'self', to: 'self', specifier: './self.js', line: 1 }]), [['self']]);
});

// ── 视觉像素基线 ───────────────────────────────────────────────────────────

const SCENE_VIEWPORT_PAIRS = 10; // 5 场景 × 各自两个视口
const SCENARIO_COUNT = 16;

test('视觉基线覆盖 5 场景 × 2 视口 + 16 scenario × 2 视口', (t) => {
  const coverage = expectedCoverage();
  assert.equal(coverage.scenes.length, 5);
  assert.equal(coverage.sceneViewports.length, SCENE_VIEWPORT_PAIRS);
  assert.equal(coverage.scenarios.length, SCENARIO_COUNT);
  assert.deepEqual(coverage.scenarioViewports, ['desktop', 'mobile-landscape']);

  const document = JSON.parse(fs.readFileSync(path.join(ROOT, PARITY_BASELINE), 'utf8'));
  const verdict = validateBaseline(document);
  assert.deepEqual(verdict.problems, []);
  assert.equal(document.frameCount, document.frames.length);
  assert.ok(document.frames.length >= SCENE_VIEWPORT_PAIRS + SCENARIO_COUNT * 2, '每个 场景/视口 与 scenario/视口 至少要有一帧');
  assert.equal(document.quality, 'high');
});

test('视觉基线不含时间戳/commit（同树两次采集必须字节一致）', (t) => {
  const raw = fs.readFileSync(path.join(ROOT, PARITY_BASELINE), 'utf8');
  for (const forbidden of ['generatedAt', 'timestamp', 'commit', 'totalMs', 'elapsedMs']) {
    assert.doesNotMatch(raw, new RegExp(forbidden), `基线里不应出现 ${forbidden}`);
  }
  const document = JSON.parse(raw);
  assert.equal(serializeBaseline({ quality: document.quality, frames: document.frames, seed: document.seed, testSeed: document.testSeed }), raw);
});

test('frameKey 与 contact sheet 同口径（weapons 组带塔型前缀）', (t) => {
  assert.equal(frameKey({ scene: 'combat', viewport: 'desktop', frameId: 'combat-contact' }), 'combat@desktop/combat-contact');
  assert.equal(
    frameKey({ scene: 'weapons', viewport: 'mobile-landscape', frameId: 'f1', towerType: 'arc' }),
    'weapons@mobile-landscape/arc-f1'
  );
});

test('toBaselineFrames 排序稳定且拒绝重复键', (t) => {
  const frames = toBaselineFrames([
    { key: 'b@desktop/x', width: 1, height: 1, pixelHash: 'h2' },
    { key: 'a@desktop/x', width: 1, height: 1, pixelHash: 'h1' },
  ]);
  assert.deepEqual(frames.map((frame) => frame.key), ['a@desktop/x', 'b@desktop/x']);
  assert.throws(
    () => toBaselineFrames([
      { key: 'same', width: 1, height: 1, pixelHash: 'h1' },
      { key: 'same', width: 1, height: 1, pixelHash: 'h2' },
    ]),
    /帧键重复/
  );
});

test('负对照：基线缺帧 / 帧乱序 / 哈希漂移都判红', (t) => {
  const document = JSON.parse(fs.readFileSync(path.join(ROOT, PARITY_BASELINE), 'utf8'));

  const short = {
    ...document,
    // 整段拿掉一个「场景@视口」的帧：覆盖口径必须发现，而不是靠帧数差额才发现。
    frames: document.frames.filter((frame) => !frame.key.startsWith('title@mobile/')),
  };
  short.frameCount = short.frames.length;
  assert.match(validateBaseline(short).problems.join('\n'), /缺少 title@mobile 的帧/);

  const unsorted = { ...document, frames: [...document.frames].reverse() };
  assert.match(validateBaseline(unsorted).problems.join('\n'), /未按 key 排序/);

  const ledger = document.frames.slice(0, 2).map((frame, index) => ({ ...frame, key: `probe@desktop/${index}`, pixelHash: `new${index}` }));
  const baseline = document.frames.slice(0, 2).map((frame, index) => ({ ...frame, key: `probe@desktop/${index}`, pixelHash: `old${index}` }));
  const comparison = compareFrameSets(baseline, ledger);
  assert.equal(comparison.ok, false);
  assert.equal(comparison.mismatched.length, 2);

  const missing = compareFrameSets(baseline, ledger.slice(1));
  assert.deepEqual(missing.missing, ['probe@desktop/0']);
  const extra = compareFrameSets(baseline.slice(1), ledger);
  assert.deepEqual(extra.extra, ['probe@desktop/0']);
});

// ── 模拟确定性基线 ─────────────────────────────────────────────────────────

test('确定性基线覆盖 3 个 seed 的 events/rng/state 三份哈希', (t) => {
  const document = JSON.parse(fs.readFileSync(path.join(ROOT, DETERMINISM_BASELINE), 'utf8'));
  const verdict = validateDeterminismBaseline(document);
  assert.deepEqual(verdict.problems, []);
  assert.deepEqual([...SEEDS].sort(), document.seeds);
  assert.equal(SEEDS.length, 3);
  for (const seed of SEEDS) {
    assert.deepEqual(Object.keys(document.records[seed]).sort(), [...ARTIFACTS].sort());
    for (const name of ARTIFACTS) assert.match(document.records[seed][name], /^[0-9a-f]{64}$/);
  }
  const raw = fs.readFileSync(path.join(ROOT, DETERMINISM_BASELINE), 'utf8');
  assert.equal(serializeDeterminismBaseline(JSON.parse(raw)), raw);
  for (const forbidden of ['generatedAt', 'timestamp', 'commit']) {
    assert.doesNotMatch(raw, new RegExp(forbidden));
  }
});

test('负对照：确定性基线缺 seed / 少哈希都判红', (t) => {
  const document = JSON.parse(fs.readFileSync(path.join(ROOT, DETERMINISM_BASELINE), 'utf8'));
  const missingSeed = { ...document, records: { ...document.records } };
  delete missingSeed.records[SEEDS[1]];
  assert.match(validateDeterminismBaseline(missingSeed).problems.join('\n'), /缺少 seed/);

  const brokenHash = JSON.parse(JSON.stringify(document));
  delete brokenHash.records[SEEDS[0]].rng;
  assert.match(validateDeterminismBaseline(brokenHash).problems.join('\n'), /缺少 rng 哈希/);
});

test('确定性对照：哈希不同 / seed 多出 / seed 缺失都判红', (t) => {
  const base = { s1: { events: 'a', rng: 'b', state: 'c' } };
  assert.equal(compareRecords(base, { s1: { events: 'a', rng: 'b', state: 'c' } }).ok, true);
  const drifted = compareRecords(base, { s1: { events: 'a', rng: 'changed', state: 'c' } });
  assert.equal(drifted.ok, false);
  assert.match(drifted.problems[0], /rng 哈希不同/);
  assert.match(compareRecords(base, { s1: base.s1, s2: base.s1 }).problems[0], /多出 seed s2/);
  assert.match(compareRecords(base, {}).problems[0], /缺少 seed s1/);
});

test('产物缺哈希时报错，而不是静默写成空值', (t) => {
  assert.deepEqual(hashesFromArtifacts({ 'events.json': { hash: 'e' }, 'rng.json': { hash: 'r' }, 'state.json': { hash: 's' } }), {
    events: 'e',
    rng: 'r',
    state: 's',
  });
  assert.throws(() => hashesFromArtifacts({ 'events.json': { hash: 'e' } }), /rng\.json/);
});

// ── runCheck 直调（不经 CLI）──────────────────────────────────────────────

test('runCheck 返回可读的统计与违规清单', (t) => {
  const root = tempRoot(t, { 'public/js/big.js': sized(12), 'public/js/ok.js': sized(3) });
  const result = runCheck({ root, budgets: { ...BUDGETS, runtime: { ...BUDGETS.runtime, maxLines: 10 } } });
  assert.equal(result.ok, false);
  assert.equal(result.files, 2);
  assert.equal(result.counted.runtime, 2);
  assert.deepEqual(result.violations.map((violation) => violation.kind), ['over-budget']);
  assert.equal(result.violations[0].path, 'public/js/big.js');
});
