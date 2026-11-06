// 单局地图变化（P1-10）：本局随机词缀的词缀池复用、seed 派生确定性、trait 保留与数值叠加。
// 纯函数部分直接测 shared/mapgen；服务端权威与客户端只渲染部分用隔离服务（startServer + 固定 seed）验证。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startServer } from './test-server.mjs';

import {
  MAP_MODIFIERS,
  MODIFIER_BY_ID,
  applySeedModifier,
  generateMapCandidates,
  seedMapModifier,
} from '../public/js/shared/mapgen.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = path.join(os.tmpdir(), `rtd-map-variety-${process.pid}-${Date.now()}.db`);
const MODIFIER_IDS = new Set(MAP_MODIFIERS.map((modifier) => modifier.id));
const EXPECTED_TRAITS = { canyon: null, twin: 'trade', ring: 'echo' };

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

let server = null;
let BASE = '';

async function api(pathname, { method = 'GET', token, body, seed } = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      'x-player-token': token,
      ...(seed ? { 'x-test-seed': seed } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

async function createRun(token, { seed, body = { mode: 'normal', difficulty: 'roam' } } = {}) {
  const res = await api('/api/runs', { method: 'POST', token, body, seed });
  assert.equal(res.status, 200, `建局失败：${JSON.stringify(res.data)}`);
  return res.data;
}

function chooseMap(token, runId, index) {
  return api(`/api/runs/${runId}/map`, { method: 'POST', token, body: { index } });
}

function startWave(token, runId) {
  return api(`/api/runs/${runId}/wave`, { method: 'POST', token });
}

before(async () => {
  server = await startServer({
    cwd: ROOT,
    dbPath: DB,
    seedHeader: true,
    env: { AUTH_ENABLED: '0' },
  });
  BASE = server.base;
});

after(() => {
  if (server) server.kill('SIGTERM');
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(`${DB}${suffix}`, { force: true });
    } catch {
      /* ignore */
    }
  }
});

test('seedMapModifier：同 seed 确定，且只从 12 条词缀池里挑', () => {
  assert.deepEqual(seedMapModifier('seed-x'), seedMapModifier('seed-x'), '同 seed 必须逐字段一致');
  const seen = new Set();
  for (let i = 0; i < 32; i++) {
    const modifier = seedMapModifier(`seed-${i}`);
    assert.ok(MODIFIER_IDS.has(modifier.id), `${modifier.id} 必须在 MAP_MODIFIERS 池内`);
    seen.add(modifier.id);
  }
  assert.ok(seen.size > 1, '词缀池必须实际被复用：不同 seed 应覆盖多条词缀');
});

test('applySeedModifier：保留 trait id、不污染原图、词缀记入 meta.seedModifier', () => {
  const rich = MODIFIER_BY_ID.rich;
  for (const [index, id] of ['canyon', 'twin', 'ring'].entries()) {
    const raw = generateMapCandidates('x', 3)[index];
    const before = JSON.stringify(raw);
    const out = applySeedModifier(raw, rich);

    assert.equal(out.meta.modifier?.id ?? null, EXPECTED_TRAITS[id], `${id} 的 trait id 必须保持不变`);
    assert.equal(out.meta.seedModifier.id, 'rich', '叠加的词缀 id 记入 meta.seedModifier');
    assert.equal(out.meta.portalCount, raw.meta.portalCount, '词缀不得改变固定几何的入口数');
    assert.equal(JSON.stringify(raw), before, 'applySeedModifier 不得修改原图');
    assert.ok(!('seedModifier' in raw.meta), '原候选不应带 seedModifier');
  }
});

test('applySeedModifier：hpMul/goldMul/rangeMul/scoreMul 按乘数折叠，extraPortal 不生效', () => {
  const rich = MODIFIER_BY_ID.rich; // hpMul 1.1, goldMul 1.2, scoreMul 0.95
  // twin 固定 trait 是 trade（hpMul 1.08, goldMul 1.1, scoreMul 1）。
  const twinRaw = generateMapCandidates('x', 3)[1];
  const twin = applySeedModifier(twinRaw, rich);
  assert.equal(twin.meta.modifier.id, 'trade');
  assert.equal(twin.meta.modifier.hpMul, round3(1.08 * 1.1));
  assert.equal(twin.meta.modifier.goldMul, round3(1.1 * 1.2));
  assert.equal(twin.meta.modifier.scoreMul, round3(1 * 0.95));

  // canyon 无 trait，数值只由词缀本身决定；meta.scoreMul 折叠进固定图 0.95。
  const canyonRaw = generateMapCandidates('x', 3)[0];
  const canyon = applySeedModifier(canyonRaw, rich);
  assert.equal(canyon.meta.modifier?.id ?? null, null);
  assert.equal(canyon.meta.modifier.hpMul, round3(1.1));
  assert.equal(canyon.meta.modifier.goldMul, round3(1.2));
  assert.equal(canyon.meta.scoreMul, Math.round(Math.max(0.9, Math.min(1.25, 0.95 * 0.95)) * 100) / 100);

  // extraPortal 只对旧随机 carve 的布局有意义，固定几何不变。
  const rift = MODIFIER_BY_ID.rift; // extraPortal 1
  const riftCanyon = applySeedModifier(canyonRaw, rift);
  assert.equal(riftCanyon.meta.portalCount, canyonRaw.meta.portalCount, '固定图入口数不得随 extraPortal 变化');
});

test('不同词缀会改变同一张图的有效数值（词缀生效的直接证据）', () => {
  const raw = generateMapCandidates('x', 3)[0]; // canyon，无 trait
  const rich = applySeedModifier(raw, MODIFIER_BY_ID.rich); // hpMul 1.1
  const armored = applySeedModifier(raw, MODIFIER_BY_ID.armored); // hpMul 1.18
  assert.notEqual(rich.meta.modifier.hpMul, armored.meta.modifier.hpMul);
  assert.equal(armored.meta.modifier.hpMul, round3(1.18));
});

test('建局：返回 mapModifier 且落库，候选保持原始（客户端不自行派生）', async () => {
  const token = 'mapvar-start';
  const start = await createRun(token, { seed: 'mapvar-1' });
  const expected = seedMapModifier('test-mapvar-1');

  assert.ok(MODIFIER_IDS.has(start.mapModifier.id), 'mapModifier 必须来自词缀池');
  assert.deepEqual(start.mapModifier, expected, 'mapModifier 由 seed 确定性派生');
  assert.equal(start.ruleset.mapModifier.id, expected.id, '词缀必须落库到 ruleset');
  // 开局候选仍是原始固定图：词缀只在选图后由服务端叠加，客户端拿到的是服务端权威结果。
  assert.equal(start.candidates[1].meta.modifier?.id, 'trade');
  assert.ok(!('seedModifier' in start.candidates[1].meta), '开局候选不应带 seedModifier');
});

test('选图：mapMeta 叠加词缀数值，trait id 保持不变', async () => {
  const token = 'mapvar-pick';
  const start = await createRun(token, { seed: 'mapvar-2' });
  const expected = seedMapModifier('test-mapvar-2');

  const picked = await chooseMap(token, start.runId, 1); // twin
  assert.equal(picked.status, 200);
  assert.equal(picked.data.mapMeta.modifier.id, 'trade', 'trait id 不得被词缀覆盖');
  assert.equal(picked.data.mapMeta.seedModifier.id, expected.id);
  assert.equal(picked.data.mapMeta.modifier.hpMul, round3(1.08 * expected.hpMul));
  assert.equal(picked.data.mapMeta.modifier.goldMul, round3(1.1 * expected.goldMul));
});

test('同 seed 的两次建局词缀一致，选图后的波次仍带固定 trait', async () => {
  const a = await createRun('mapvar-det-a', { seed: 'mapvar-3' });
  const b = await createRun('mapvar-det-b', { seed: 'mapvar-3' });
  assert.deepEqual(a.mapModifier, b.mapModifier, '同 seed 词缀必须一致');

  const picked = await chooseMap('mapvar-det-a', a.runId, 1);
  assert.equal(picked.status, 200);
  const served = await startWave('mapvar-det-a', a.runId);
  assert.equal(served.status, 200);
  assert.equal(served.data.wave.modifierId, 'trade', '波次词缀仍由固定 trait 标识');
});
