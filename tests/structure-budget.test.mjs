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
  LUMA_GRID,
  VARIANT_TOLERANCE,
  checkBaseline,
  compareFrames,
  expectedCoverage,
  frameKey,
  gridDistance,
  serializeBaseline,
  statsWithinTolerance,
  toBaselineFrames,
  validateBaseline,
  writeBaseline,
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
import {
  checkBaseline as checkDeterminismBaseline,
  writeBaseline as writeDeterminismBaseline,
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
  const grid = Array.from({ length: LUMA_GRID * LUMA_GRID }, () => 12.3456);
  const frame = (key, hash) => ({ key, width: 1, height: 1, pixelHash: hash, meanLuma: 12.3456, stdLuma: 2.5, levels: 9, lumaGrid: grid });
  const frames = toBaselineFrames([frame('b@desktop/x', 'h2'), frame('a@desktop/x', 'h1')]);
  assert.deepEqual(frames.map((item) => item.key), ['a@desktop/x', 'b@desktop/x']);
  // 统计值按 3 位小数落盘：同一张图两次采集写出同样的字节。
  assert.equal(frames[0].meanLuma, 12.346);
  assert.equal(frames[0].lumaGrid[0], 12.346);
  assert.throws(
    () => toBaselineFrames([frame('same', 'h1'), frame('same', 'h2')]),
    /帧键重复/
  );
});

test('负对照：基线缺帧 / 帧乱序 / 条目缺亮度网格都判红', (t) => {
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

  const noGrid = { ...document, frames: document.frames.map((frame) => ({ ...frame, lumaGrid: [] })) };
  assert.match(validateBaseline(noGrid).problems.join('\n'), /帧条目不完整/);
});

test('逐帧对照：缺失 / 多出 / 漂移三类都判红', (t) => {
  const grid = Array.from({ length: LUMA_GRID * LUMA_GRID }, () => 20);
  const frame = (key, hash, extra = {}) => ({
    key, width: 10, height: 10, pixelHash: hash, meanLuma: 40, stdLuma: 30, levels: 31, lumaGrid: grid, ...extra,
  });
  const baseline = [frame('probe@desktop/0', 'a'), frame('probe@desktop/1', 'b')];

  const identical = compareFrames({ baselineFrames: baseline, currentFrames: baseline });
  assert.equal(identical.ok, true);
  assert.deepEqual(identical.exact, ['probe@desktop/0', 'probe@desktop/1']);

  const missing = compareFrames({ baselineFrames: baseline, currentFrames: baseline.slice(1) });
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.missing, ['probe@desktop/0']);

  const extra = compareFrames({ baselineFrames: baseline.slice(1), currentFrames: baseline });
  assert.equal(extra.ok, false);
  assert.deepEqual(extra.extra, ['probe@desktop/0']);

  const drifted = compareFrames({
    baselineFrames: baseline,
    currentFrames: [...baseline.slice(1), frame('probe@desktop/0', 'c', { lumaGrid: grid.map(() => 40) })],
  });
  assert.equal(drifted.ok, false);
  assert.deepEqual(drifted.drifted.map((item) => item.key), ['probe@desktop/0']);
  assert.equal(drifted.drifted[0].reason, 'luma-grid');
});

test('渲染变体容忍：网格与统计都在容差内才算变体，否则算漂移', (t) => {
  const grid = Array.from({ length: LUMA_GRID * LUMA_GRID }, () => 20);
  const base = { key: 'k', width: 10, height: 10, pixelHash: 'base', meanLuma: 40, stdLuma: 30, levels: 31, lumaGrid: grid };
  // 实测跨进程变体的网格单元差 ≤0.01：远低于容差，判为「渲染变体」而不是漂移。
  const variantGrid = grid.map((value, index) => (index === 0 ? value + 0.01 : value));
  const variant = { ...base, pixelHash: 'other', lumaGrid: variantGrid };
  const tolerated = compareFrames({ baselineFrames: [base], currentFrames: [variant] });
  assert.equal(tolerated.ok, true);
  assert.deepEqual(tolerated.variants.map((item) => item.key), ['k']);
  assert.deepEqual(tolerated.drifted, []);

  // 网格差超限（画面结构变了）→ 漂移。
  const shifted = { ...base, pixelHash: 'other', lumaGrid: grid.map((value) => value + VARIANT_TOLERANCE.maxCellDelta * 3) };
  const shiftedVerdict = compareFrames({ baselineFrames: [base], currentFrames: [shifted] });
  assert.equal(shiftedVerdict.ok, false);
  assert.equal(shiftedVerdict.drifted[0].reason, 'luma-grid');

  // 网格几乎不动但画面统计变了（配色/亮度整体偏移）→ 漂移。
  const recolored = { ...base, pixelHash: 'other', lumaGrid: variantGrid, meanLuma: base.meanLuma + 2 };
  const recoloredVerdict = compareFrames({ baselineFrames: [base], currentFrames: [recolored] });
  assert.equal(recoloredVerdict.ok, false);
  assert.equal(recoloredVerdict.drifted[0].reason, 'stats');

  // levels 少一档（配色被合并）同样算漂移。
  assert.equal(statsWithinTolerance(base, { ...base, levels: base.levels - 1 }), false);
  assert.equal(statsWithinTolerance(base, { ...base, stdLuma: base.stdLuma + 0.1 }), true);
});

test('gridDistance：单元最大差与平均差同口径', () => {
  const left = [10, 10, 10, 10];
  assert.deepEqual(gridDistance(left, left), { maxCellDelta: 0, meanCellDelta: 0 });
  const right = [12, 10, 10, 10];
  assert.deepEqual(gridDistance(left, right), { maxCellDelta: 2, meanCellDelta: 0.5 });
});

test('视觉基线的每一帧都带亮度网格与画面统计（变体判定的判据来源）', (t) => {
  const document = JSON.parse(fs.readFileSync(path.join(ROOT, PARITY_BASELINE), 'utf8'));
  for (const frame of document.frames) {
    assert.equal(typeof frame.pixelHash, 'string');
    assert.equal(typeof frame.meanLuma, 'number');
    assert.equal(typeof frame.stdLuma, 'number');
    assert.ok(frame.levels > 0, `${frame.key} 的 levels 必须为正`);
    assert.equal(frame.lumaGrid.length, LUMA_GRID * LUMA_GRID);
    assert.ok(frame.lumaGrid.every((value) => Number.isFinite(value)), `${frame.key} 的亮度网格必须是数字`);
  }
});

// ── 端到端：注入假采集器跑完整的写基线 / 对照流程（不需要真浏览器与真模拟）─────────

// 覆盖口径要求每个「场景/视口」与「scenario/视口」都至少一帧；假采集器按这份定义造帧。
function fakeParityEntries({ gridShift = 0 } = {}) {
  const coverage = expectedCoverage();
  const grid = () => Array.from({ length: LUMA_GRID * LUMA_GRID }, (_, index) => 20 + (index === 0 ? gridShift : 0));
  const entry = (key) => ({
    key, width: 100, height: 80, pixelHash: `hash-${key}-${gridShift}`, meanLuma: 33, stdLuma: 21, levels: 30, lumaGrid: grid(),
  });
  return [
    ...coverage.sceneViewports.map(([scene, viewport]) => entry(`${scene}@${viewport}/${scene}`)),
    ...coverage.scenarios.flatMap((scenario) => coverage.scenarioViewports.map((viewport) => entry(`${scenario}@${viewport}/f1`))),
  ];
}

const fakeCollect = (entries) => async () => entries;

test('视觉见证端到端：写基线 → 同采集器对照通过 → 漂移/缺帧判红', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abyss-visual-parity-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const baselinePath = path.join(dir, 'baseline.json');
  const entries = fakeParityEntries();

  const written = await writeBaseline({ baselinePath, collect: fakeCollect(entries) });
  assert.equal(written.frames, SCENE_VIEWPORT_PAIRS + SCENARIO_COUNT * 2);
  const document = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  assert.deepEqual(validateBaseline(document).problems, []);

  const clean = await checkBaseline({ baselinePath, collect: fakeCollect(entries) });
  assert.equal(clean.ok, true, JSON.stringify(clean.comparison?.drifted));
  assert.equal(clean.comparison.exact.length, entries.length);

  const moved = await checkBaseline({ baselinePath, collect: fakeCollect(fakeParityEntries({ gridShift: 5 })) });
  assert.equal(moved.ok, false);
  assert.equal(moved.comparison.drifted.length, entries.length);

  const short = await checkBaseline({ baselinePath, collect: fakeCollect(entries.slice(1)) });
  assert.equal(short.ok, false);
  assert.equal(short.comparison.missing.length, 1);
});

test('视觉见证端到端：基线缺失 / 无法解析都给出可读原因', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abyss-visual-parity-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const missing = await checkBaseline({ baselinePath: path.join(dir, 'nope.json'), collect: fakeCollect([]) });
  assert.equal(missing.ok, false);
  assert.match(missing.problems[0], /基线不存在/);

  const brokenPath = path.join(dir, 'broken.json');
  fs.writeFileSync(brokenPath, '{ not json');
  const broken = await checkBaseline({ baselinePath: brokenPath, collect: fakeCollect([]) });
  assert.equal(broken.ok, false);
  assert.match(broken.problems[0], /无法解析/);
});

test('确定性见证端到端：写基线 → 对照通过 → 哈希变化判红', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abyss-sim-determinism-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const baselinePath = path.join(dir, 'baseline.json');
  const records = Object.fromEntries(SEEDS.map((seed) => [seed, { events: `e-${seed}`, rng: `r-${seed}`, state: `s-${seed}` }]));
  const collect = (value) => async () => value;

  const written = await writeDeterminismBaseline({ baselinePath, collect: collect(records) });
  assert.equal(written.seeds, SEEDS.length);
  assert.equal((await checkDeterminismBaseline({ baselinePath, collect: collect(records) })).ok, true);

  const drifted = { ...records, [SEEDS[0]]: { ...records[SEEDS[0]], rng: 'changed' } };
  const verdict = await checkDeterminismBaseline({ baselinePath, collect: collect(drifted) });
  assert.equal(verdict.ok, false);
  assert.match(verdict.problems[0], /rng 哈希不同/);
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
