// 同 seed 一致性证据工具的单测：一致 / 不一致 / 产物缺失三条路径，外加「RNG 序列被改动必须报红」
// 的反向断言——否则一个永远 exit 0 的空转工具也能骗过前面所有用例。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ARTIFACTS,
  ROOT,
  canonicalJson,
  compareDirectories,
  firstDifference,
  runScene,
  writeArtifacts,
} from '../scripts/feel-sim-diff.mjs';

const SCRIPT = path.join(ROOT, 'scripts', 'feel-sim-diff.mjs');
const SEED = 'visual-fixed-seed';

function runCli(args) {
  return spawnSync(process.execPath, ['--no-warnings', SCRIPT, ...args], { encoding: 'utf8' });
}

function makeTemp(t, label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `abyss-feel-sim-diff-${label}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

// 两个「同 seed 跑两遍」的产物目录：一致用例与篡改用例共用同一份基线。
async function twoRuns(t, label) {
  const left = makeTemp(t, `${label}-left`);
  const right = makeTemp(t, `${label}-right`);
  const artifacts = await runScene({ scene: 'combat', seed: SEED });
  writeArtifacts(left, artifacts);
  writeArtifacts(right, artifacts);
  return { left, right, artifacts };
}

function hashTree(dir) {
  const entries = {};
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else {
        const stat = fs.statSync(absolute);
        entries[path.relative(dir, absolute)] = `${stat.size}:${stat.mtimeMs}`;
      }
    }
  };
  walk(dir);
  return entries;
}

test('--scene combat --seed visual-fixed-seed --out 产出 events/rng/state 三份 JSON 并 exit 0', (t) => {
  const out = makeTemp(t, 'after');
  const result = runCli(['--scene', 'combat', '--seed', SEED, '--out', out]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  for (const name of ARTIFACTS) assert.ok(fs.existsSync(path.join(out, name)), `缺少产物 ${name}`);

  const events = readJson(path.join(out, 'events.json'));
  const rng = readJson(path.join(out, 'rng.json'));
  const state = readJson(path.join(out, 'state.json'));

  assert.equal(events.kind, 'feel-sim-diff/events');
  assert.equal(events.count, events.stream.length);
  assert.ok(events.count > 0, '场景必须打出伤害事件，否则证据为空');
  assert.ok(events.stream.every((entry) => entry.hpAfter != null && entry.dealt != null), '事件必须回填扣血结果');

  assert.equal(rng.kind, 'feel-sim-diff/rng');
  assert.equal(rng.totalCalls, rng.sequence.length);
  assert.ok(rng.totalCalls > 0, '场景必须消耗随机数，否则 RNG 证据为空');
  assert.equal(rng.streams.reduce((sum, stream) => sum + stream.calls, 0), rng.totalCalls);

  assert.equal(state.kind, 'feel-sim-diff/state');
  assert.match(state.hash, /^[0-9a-f]{64}$/);
  assert.ok(state.summary.clearedWave >= 1, '至少要清掉一波，终局状态才有意义');
  assert.ok(!('savedAt' in state.snapshot), 'savedAt 是墙钟字段，必须剔除');
});

test('同一源码树同 seed 跑两遍：三份产物逐项一致，diff exit 0', async (t) => {
  const { left, right, artifacts } = await twoRuns(t, 'same');
  const again = await runScene({ scene: 'combat', seed: SEED });
  assert.equal(canonicalJson(artifacts), canonicalJson(again), '两次运行的证据必须完全相同');

  const result = runCli(['--diff', left, right]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /一致/);
  assert.deepEqual(compareDirectories(left, right), { ok: true, differences: [] });
});

test('事件序列被改动：diff exit 1 且打印第一处差异', async (t) => {
  const { left, right } = await twoRuns(t, 'events');
  const file = path.join(right, 'events.json');
  const events = readJson(file);
  const index = Math.min(3, events.stream.length - 1);
  events.stream[index].dealt = (events.stream[index].dealt ?? 0) + 1;
  writeJson(file, events);

  const result = runCli(['--diff', left, right]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`events\\.json\\.stream\\[${index}\\]\\.dealt`));
  const compared = compareDirectories(left, right);
  assert.equal(compared.ok, false);
  assert.equal(compared.differences[0].path, `events.json.stream[${index}].dealt`);
});

test('反向断言：RNG 序列变化必须报红', async (t) => {
  const { left, right } = await twoRuns(t, 'rng');
  const file = path.join(right, 'rng.json');
  const rng = readJson(file);
  assert.ok(rng.sequence.length > 0, 'RNG 序列不能为空，否则这条反向断言是空的');
  const index = rng.sequence.length - 1;
  rng.sequence[index].value = (rng.sequence[index].value + 0.25) % 1;
  writeJson(file, rng);

  const result = runCli(['--diff', left, right]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`rng\\.json\\.sequence\\[${index}\\]\\.value`));
});

test('终局状态被改动：diff exit 1', async (t) => {
  const { left, right } = await twoRuns(t, 'state');
  const file = path.join(right, 'state.json');
  const state = readJson(file);
  state.live.kills += 1;
  writeJson(file, state);

  const result = runCli(['--diff', left, right]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /state\.json\.live\.kills/);
});

test('产物缺失按不一致处理：diff exit 1 且点名缺失文件', async (t) => {
  const { left } = await twoRuns(t, 'missing');
  const empty = makeTemp(t, 'missing-empty');
  const result = runCli(['--diff', left, empty]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /缺少产物/);
  assert.match(result.stderr, /events\.json/);
});

test('换 seed 即产生不同证据：工具对输入敏感，不是永远绿灯', async () => {
  const base = await runScene({ scene: 'combat', seed: SEED });
  const other = await runScene({ scene: 'combat', seed: 'feel-sim-diff-other-seed' });
  assert.notEqual(base['events.json'].hash, other['events.json'].hash);
  assert.notEqual(base['rng.json'].hash, other['rng.json'].hash);
});

test('工具只读：跑一遍不会改动 public/js/**', async () => {
  const before = hashTree(path.join(ROOT, 'public', 'js'));
  await runScene({ scene: 'combat', seed: SEED });
  assert.deepEqual(hashTree(path.join(ROOT, 'public', 'js')), before);
});

test('参数错误按用法错误退出（exit 2），不静默通过', (t) => {
  const unknownScene = runCli(['--scene', 'nope', '--out', makeTemp(t, 'bad-scene')]);
  assert.equal(unknownScene.status, 2);
  assert.match(unknownScene.stderr, /未知场景/);

  const missingOut = runCli(['--scene', 'combat']);
  assert.equal(missingOut.status, 2);
  assert.match(missingOut.stderr, /缺少 --out/);

  const unknownFlag = runCli(['--nope']);
  assert.equal(unknownFlag.status, 2);
  assert.match(unknownFlag.stderr, /未知参数/);
});

test('firstDifference 报告首个差异的路径与两侧取值', () => {
  const left = { a: [1, 2, { b: 3 }], c: 'x' };
  const right = { a: [1, 2, { b: 4 }], c: 'x' };
  assert.deepEqual(firstDifference(left, right, 'root'), { path: 'root.a[2].b', left: 3, right: 4 });
  assert.equal(firstDifference(left, { ...left }), null);
  assert.deepEqual(firstDifference([1, 2], [1, 2, 3], 'list'), { path: 'list.length', left: 2, right: 3 });
});
