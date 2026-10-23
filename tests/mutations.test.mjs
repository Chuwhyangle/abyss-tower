// 变异挑战：组合校验、倍率与参数派生、同种子可复现、独立榜单与非法组合拒绝。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import {
  MUTATION_MAX,
  applyMutations,
  composeWaveModifier,
  mutationKey,
  mutationScoreMul,
  validateMutationSelection,
} from '../public/js/shared/mutations.js';
import { generateMapCandidates } from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 19200 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join(os.tmpdir(), `rtd-mutations-test-${process.pid}-${Date.now()}.db`);

let server = null;
let serverLog = '';

async function api(pathname, { method = 'GET', token = 'mut-default', body, seed } = {}) {
  const headers = { 'x-player-token': token };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (seed) headers['x-test-seed'] = seed;
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

// 真实走一遍开局 → 选图 → 放行/结算波次 → 结算，产生一条排行榜成绩。
async function play({ token, mode = 'normal', difficulty = 'standard', mutations, seed, waves = 2 }) {
  const start = await api('/api/runs', {
    method: 'POST',
    token,
    seed,
    body: mutations ? { mode, difficulty, mutations } : { mode, difficulty },
  });
  assert.equal(start.status, 200, `开局失败：${JSON.stringify(start.data)}`);
  const runId = start.data.runId;

  const map = await api(`/api/runs/${runId}/map`, {
    method: 'POST',
    token,
    body: { index: 0 },
  });
  assert.equal(map.status, 200);

  for (let wave = 1; wave <= waves; wave += 1) {
    const served = await api(`/api/runs/${runId}/wave`, { method: 'POST', token, body: {} });
    assert.equal(served.status, 200);
    const cleared = await api(`/api/runs/${runId}/clear`, {
      method: 'POST',
      token,
      body: { wave },
    });
    assert.equal(cleared.status, 200);
  }

  const finished = await api(`/api/runs/${runId}/finish`, {
    method: 'POST',
    token,
    body: { waveReached: waves, kills: waves * 10, goldLeft: 0, baseHp: 20 },
  });
  assert.equal(finished.status, 200, `结算失败：${JSON.stringify(finished.data)}`);
  return { start: start.data, finish: finished.data };
}

before(async () => {
  server = spawn(process.execPath, ['--no-warnings', 'server/index.mjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DB_PATH: DB,
      AUTH_ENABLED: '0',
      ALLOW_TEST_SEED: '1',
      DB_BACKUP: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => {
    serverLog += chunk;
  });
  server.stderr.on('data', (chunk) => {
    serverLog += chunk;
  });

  for (let i = 0; i < 100; i += 1) {
    if (server.exitCode != null) break;
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return;
    } catch {
      /* 等待服务启动 */
    }
    await sleep(100);
  }
  throw new Error(`测试服务启动失败：${serverLog}`);
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

// ---------- 组合校验 ----------

test('合法组合按 id 规范排序，与选择顺序无关', () => {
  const first = validateMutationSelection(['no_reroll', 'famine']);
  const second = validateMutationSelection('famine,no_reroll');
  assert.equal(first.ok, true);
  assert.deepEqual(first.ids, ['famine', 'no_reroll']);
  assert.deepEqual(second.ids, first.ids);
  assert.equal(mutationKey(first.ids), 'famine,no_reroll');
});

test('非法组合被拒绝', () => {
  assert.equal(validateMutationSelection([]).ok, false);
  assert.equal(validateMutationSelection(['famine', 'famine']).ok, false);
  assert.equal(validateMutationSelection(['bogus']).ok, false);
  assert.equal(
    validateMutationSelection(['enemy_might', 'famine', 'fragile_base', 'no_reroll']).ok,
    false
  );
  const atMax = validateMutationSelection(['enemy_might', 'famine', 'fragile_base']);
  assert.equal(atMax.ids.length, MUTATION_MAX);
  assert.equal(atMax.ok, true);
});

// ---------- 倍率与参数派生 ----------

test('分数倍率随变异增加且结果固定', () => {
  const one = mutationScoreMul(['famine']);
  const two = mutationScoreMul(['famine', 'enemy_might']);
  assert.ok(one > 1);
  assert.ok(two > one);
  assert.equal(two, mutationScoreMul(['enemy_might', 'famine']));
  assert.equal(mutationScoreMul([]), 1);
});

test('变异只调整既有开局参数并保持底线', () => {
  const applied = applyMutations(
    { startingGold: 260, baseHp: 20, maxRerolls: 1, towersUnlocked: ['arrow', 'cannon', 'frost'] },
    ['famine', 'fragile_base', 'no_reroll', 'narrow_towers']
  );
  assert.equal(applied.startingGold, 180);
  assert.equal(applied.baseHp, 15);
  assert.equal(applied.maxRerolls, 0);
  assert.deepEqual(applied.towersUnlocked, ['arrow', 'cannon']);
  assert.equal(applied.hpMul, 1);
  assert.equal(applied.speedMul, 1);

  const clamped = applyMutations(
    { startingGold: 120, baseHp: 10, maxRerolls: 3, towersUnlocked: ['arrow'] },
    ['famine', 'fragile_base']
  );
  assert.equal(clamped.startingGold, 100);
  assert.equal(clamped.baseHp, 8);
});

// ---------- 同种子可复现 ----------

test('同种子 + 同变异组合生成完全一致的波次', () => {
  const candidates = generateMapCandidates('test-mutation-seed', 3);
  const meta = candidates[0].meta;
  const ids = ['enemy_might', 'famine'];
  const modifier = composeWaveModifier(meta.modifier, ids);
  const first = generateWave(
    'test-mutation-seed',
    5,
    'standard',
    { portalCount: meta.portalCount || 1, modifier },
    { endless: false }
  );
  const second = generateWave(
    'test-mutation-seed',
    5,
    'standard',
    { portalCount: meta.portalCount || 1, modifier: composeWaveModifier(meta.modifier, ids) },
    { endless: false }
  );
  assert.deepEqual(first, second);

  const plain = generateWave(
    'test-mutation-seed',
    5,
    'standard',
    { portalCount: meta.portalCount || 1, modifier: meta.modifier },
    { endless: false }
  );
  assert.ok(first.hpMul > plain.hpMul, '敌军强化应提高敌人生命倍率');
});

// ---------- 服务端：建局、拒绝与独立榜 ----------

test('变异开局只使用既有参数并写入规则集', async () => {
  const { start } = await play({
    token: 'mut-create-0001',
    mode: 'mutated',
    mutations: ['no_reroll', 'famine', 'narrow_towers'],
    seed: 'create-a',
    waves: 1,
  });
  assert.equal(start.mode, 'mutated');
  assert.equal(start.boardKey, 'mutated:famine,narrow_towers,no_reroll');
  assert.deepEqual(
    start.mutations.map((item) => item.id),
    ['famine', 'narrow_towers', 'no_reroll']
  );
  assert.equal(start.mutationScoreMul, mutationScoreMul(['famine', 'narrow_towers', 'no_reroll']));
  assert.equal(start.startingGold, 180);
  assert.equal(start.maxRerolls, 0);
  assert.deepEqual(start.towersUnlocked, ['arrow', 'cannon']);
  assert.equal(start.ruleset.mutations.key, 'famine,narrow_towers,no_reroll');
  assert.deepEqual(start.ruleset.mutations.ids, ['famine', 'narrow_towers', 'no_reroll']);
});

test('非法变异组合建局返回 400', async () => {
  const unknown = await api('/api/runs', {
    method: 'POST',
    token: 'mut-invalid-0001',
    body: { mode: 'mutated', difficulty: 'standard', mutations: ['nope'] },
  });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.data.code, 'INVALID_MUTATION_COMBO');

  const duplicated = await api('/api/runs', {
    method: 'POST',
    token: 'mut-invalid-0002',
    body: { mode: 'mutated', difficulty: 'standard', mutations: ['famine', 'famine'] },
  });
  assert.equal(duplicated.status, 400);

  const missing = await api('/api/runs', {
    method: 'POST',
    token: 'mut-invalid-0003',
    body: { mode: 'mutated', difficulty: 'standard' },
  });
  assert.equal(missing.status, 400);
});

test('变异榜与普通榜互不混合', async () => {
  const normalRun = await play({
    token: 'mut-board-normal',
    mode: 'normal',
    seed: 'board-normal',
    waves: 2,
  });
  const mutatedRun = await play({
    token: 'mut-board-mutated',
    mode: 'mutated',
    mutations: ['enemy_might', 'famine'],
    seed: 'board-mutated',
    waves: 3,
  });

  const normal = await api('/api/leaderboard?mode=normal&size=50', { token: 'mut-board-normal' });
  assert.equal(normal.status, 200);
  assert.equal(normal.data.mode, 'normal');
  assert.equal(normal.data.total, 1);
  assert.equal(normal.data.entries.length, 1);
  assert.equal(normal.data.entries[0].score, normalRun.finish.score);
  assert.equal(normal.data.me.best.score, normalRun.finish.score);

  const mutated = await api(
    '/api/leaderboard?mode=mutated&mutations=famine,enemy_might&size=50',
    { token: 'mut-board-mutated' }
  );
  assert.equal(mutated.status, 200);
  assert.equal(mutated.data.mode, 'mutated');
  assert.equal(mutated.data.day, 'enemy_might,famine');
  assert.equal(mutated.data.total, 1);
  assert.equal(mutated.data.entries.length, 1);
  assert.equal(mutated.data.mutations.length, 2);
  // 各自榜上的成绩就是本模式结算的分数，互不串榜。
  assert.equal(mutated.data.entries[0].score, mutatedRun.finish.score);
  assert.equal(mutated.data.me.best.score, mutatedRun.finish.score);

  // 换一个组合就是另一张榜，不会看到已有组合的成绩。
  const otherCombo = await api(
    '/api/leaderboard?mode=mutated&mutations=famine,fragile_base',
    { token: 'mut-board-mutated' }
  );
  assert.equal(otherCombo.status, 200);
  assert.equal(otherCombo.data.total, 0);
});

test('变异榜查询同样拒绝非法组合', async () => {
  const missing = await api('/api/leaderboard?mode=mutated');
  assert.equal(missing.status, 400);
  assert.equal(missing.data.code, 'INVALID_MUTATION_COMBO');

  const unknown = await api('/api/leaderboard?mode=mutated&mutations=unknown');
  assert.equal(unknown.status, 400);

  // 合法组合按规范顺序落到同一张榜。
  const canonical = await api('/api/leaderboard?mode=mutated&mutations=narrow_towers,famine');
  assert.equal(canonical.status, 200);
  assert.equal(canonical.data.day, 'famine,narrow_towers');
});

test('同种子 + 同变异组合在服务端产生一致波次', async () => {
  const tokenA = 'mut-seed-a';
  const tokenB = 'mut-seed-b';
  const mutations = ['enemy_might', 'fragile_base'];
  const first = await api('/api/runs', {
    method: 'POST',
    token: tokenA,
    seed: 'repeatable',
    body: { mode: 'mutated', difficulty: 'standard', mutations },
  });
  const second = await api('/api/runs', {
    method: 'POST',
    token: tokenB,
    seed: 'repeatable',
    body: { mode: 'mutated', difficulty: 'standard', mutations },
  });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.data.seed, second.data.seed);

  for (const [token, run] of [
    [tokenA, first.data],
    [tokenB, second.data],
  ]) {
    const map = await api(`/api/runs/${run.runId}/map`, {
      method: 'POST',
      token,
      body: { index: 0 },
    });
    assert.equal(map.status, 200);
  }

  const waveA = await api(`/api/runs/${first.data.runId}/wave`, {
    method: 'POST',
    token: tokenA,
    body: {},
  });
  const waveB = await api(`/api/runs/${second.data.runId}/wave`, {
    method: 'POST',
    token: tokenB,
    body: {},
  });
  assert.equal(waveA.status, 200);
  assert.equal(waveB.status, 200);
  assert.deepEqual(waveA.data.wave, waveB.data.wave);
});
