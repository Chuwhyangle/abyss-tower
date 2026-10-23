// 无尽模式：第 30 波后继续生成、曲线硬上限、独立计分与独立排行榜、旧存档兼容。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { BALANCE } from '../public/js/shared/config.js';
import { MAX_WAVE } from '../public/js/shared/data.js';
import { ENDLESS_SCORE_MUL, computeOutcome } from '../public/js/shared/scoring.js';
import { validateSnapshot } from '../public/js/shared/snapshot.js';
import { ENDLESS, generateWave } from '../public/js/shared/waves.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED = 'endless-test-seed';

test('无尽波次：第 30 波后继续生成，普通模式仍然封顶', () => {
  const normal30 = generateWave(SEED, MAX_WAVE, 'standard');
  const normal31 = generateWave(SEED, MAX_WAVE + 1, 'standard');
  assert.equal(normal30.index, MAX_WAVE);
  assert.equal(normal30.finalBoss, true);
  assert.equal(normal31.index, MAX_WAVE);
  assert.equal(normal31.finalBoss, true, '普通模式的第 31 次请求仍是最终波');

  const endless31 = generateWave(SEED, MAX_WAVE + 1, 'standard', {}, { endless: true });
  assert.equal(endless31.index, MAX_WAVE + 1);
  assert.equal(endless31.endless, true);
  assert.equal(endless31.finalBoss, false, '无尽模式没有最终波通关');
  assert.ok(endless31.hpMul >= normal30.hpMul);
});

test('无尽曲线：难度递增但存在硬上限', () => {
  let previous = 0;
  for (let wave = 1; wave <= ENDLESS.maxIndex; wave += 1) {
    const hp = generateWave(SEED, wave, 'standard', {}, { endless: true }).hpMul;
    if (wave <= ENDLESS.hpCapWave) {
      assert.ok(hp >= previous, `第 ${wave} 波血量倍率回退`);
      previous = hp;
    }
  }

  const capped = generateWave(SEED, ENDLESS.hpCapWave, 'standard', {}, { endless: true });
  const far = generateWave(SEED, 400, 'standard', {}, { endless: true });
  assert.equal(far.hpMul, capped.hpMul, '血量曲线封顶后不再增长');
  assert.ok(far.speedMul <= ENDLESS.speedCap);
  assert.ok(far.totalCount <= BALANCE.maxCount, `数量超上限：${far.totalCount}`);

  const extreme = generateWave(SEED, 100000, 'standard', {}, { endless: true });
  assert.equal(extreme.index, ENDLESS.maxIndex, '波次号收敛到硬上限');
  assert.equal(extreme.hpMul, capped.hpMul);
});

test('无尽波次：同种子可复现', () => {
  for (const difficulty of ['roam', 'standard', 'abyss']) {
    const a = generateWave(SEED, 77, difficulty, { portalCount: 2 }, { endless: true });
    const b = generateWave(SEED, 77, difficulty, { portalCount: 2 }, { endless: true });
    assert.deepEqual(a, b);
  }
});

test('无尽结算：不计通关，使用独立倍率；普通结算保持不变', () => {
  const normal = computeOutcome({
    waveReached: MAX_WAVE,
    wavesServed: MAX_WAVE,
    kills: 3000,
    goldLeft: 1000,
    baseHp: 20,
    difficulty: 'standard',
  });
  const expectedNormalRaw =
    MAX_WAVE * 1000 + 3000 * 8 + 1000 * 2 + 20 * 150 + 10000;
  assert.equal(normal.victory, true);
  assert.equal(normal.rawScore, expectedNormalRaw);
  assert.equal(normal.score, expectedNormalRaw);

  const endless = computeOutcome({
    waveReached: 40,
    wavesServed: 40,
    kills: 4000,
    goldLeft: 1000,
    baseHp: 0,
    difficulty: 'standard',
    mode: 'endless',
  });
  assert.equal(endless.victory, false, '第 30 波后死亡不算通关');
  assert.equal(
    endless.score,
    Math.round((40 * 1000 + 4000 * 8 + 1000 * 2) * ENDLESS_SCORE_MUL)
  );

  const exactly30 = computeOutcome({
    waveReached: MAX_WAVE,
    wavesServed: MAX_WAVE,
    kills: 0,
    goldLeft: 0,
    baseHp: 0,
    difficulty: 'standard',
    mode: 'endless',
  });
  assert.equal(exactly30.victory, false);
});

test('旧存档兼容：普通档仍按 30 波收敛，无尽档保留更高波次', () => {
  const base = {
    version: 4,
    runId: 'run',
    seed: 'seed',
    difficulty: 'standard',
    wave: 45,
    clearedWave: 45,
    pendingDraft: false,
    gold: 100,
    kills: 0,
    baseHp: 10,
    maxBaseHp: 20,
    relics: [],
    towers: [],
  };
  const endless = validateSnapshot({ ...base, mode: 'endless' });
  assert.equal(endless.ok, true);
  assert.equal(endless.snapshot.mode, 'endless');
  assert.equal(endless.snapshot.clearedWave, 45);

  const normal = validateSnapshot({ ...base, mode: 'normal' });
  assert.equal(normal.ok, true);
  assert.equal(normal.snapshot.mode, 'normal');
  assert.equal(normal.snapshot.clearedWave, MAX_WAVE);
});

// ---------- 服务端：续波、结算与独立排行榜 ----------

const PORT = 18800 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join(os.tmpdir(), `rtd-endless-test-${process.pid}-${Date.now()}.db`);
const TOKEN = 'endless-test-token-0001';
const OTHER = 'endless-test-token-0002';

let server = null;
let serverLog = '';

async function api(pathname, { method = 'GET', token = TOKEN, body } = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      'x-player-token': token,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

async function startRun(mode, token = TOKEN) {
  return api('/api/runs', {
    method: 'POST',
    body: { mode, difficulty: 'standard' },
    token,
  });
}

async function chooseMap(runId, token = TOKEN) {
  return api(`/api/runs/${runId}/map`, { method: 'POST', body: { index: 0 }, token });
}

async function serveWave(runId, token = TOKEN) {
  return api(`/api/runs/${runId}/wave`, { method: 'POST', body: {}, token });
}

async function clearWave(runId, wave, token = TOKEN) {
  return api(`/api/runs/${runId}/clear`, { method: 'POST', body: { wave }, token });
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

  for (let i = 0; i < 80; i++) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return;
    } catch {
      /* 等待启动 */
    }
    await sleep(100);
  }
  throw new Error(`测试服务未能启动：${serverLog}`);
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

test('服务端：无尽局可越过第 30 波，结算进入独立榜', async () => {
  const started = await startRun('endless');
  assert.equal(started.status, 200);
  assert.equal(started.data.mode, 'endless');
  const runId = started.data.runId;

  const picked = await chooseMap(runId);
  assert.equal(picked.status, 200);
  const scoreMul = picked.data.mapMeta?.scoreMul || 1;

  for (let wave = 1; wave <= MAX_WAVE; wave += 1) {
    const served = await serveWave(runId);
    assert.equal(served.status, 200);
    assert.equal(served.data.wave.index, wave);
    const cleared = await clearWave(runId, wave);
    assert.equal(cleared.status, 200);
  }

  const wave31 = await serveWave(runId);
  assert.equal(wave31.status, 200);
  assert.equal(wave31.data.wave.index, MAX_WAVE + 1);
  assert.equal(wave31.data.wave.finalBoss, false);
  assert.equal(wave31.data.replay, false);
  assert.equal((await clearWave(runId, MAX_WAVE + 1)).status, 200);

  const finished = await api(`/api/runs/${runId}/finish`, {
    method: 'POST',
    body: { waveReached: MAX_WAVE + 1, kills: 3100, goldLeft: 1200, baseHp: 0 },
  });
  assert.equal(finished.status, 200);
  assert.equal(finished.data.victory, false);
  assert.equal(finished.data.waveReached, MAX_WAVE + 1);
  const expected = computeOutcome({
    waveReached: MAX_WAVE + 1,
    wavesServed: MAX_WAVE + 1,
    kills: 3100,
    goldLeft: 1200,
    baseHp: 0,
    difficulty: 'standard',
    scoreMul,
    mode: 'endless',
  });
  assert.equal(finished.data.score, expected.score);
  assert.ok(finished.data.rank >= 1);

  const endlessBoard = await api('/api/leaderboard?mode=endless');
  assert.equal(endlessBoard.status, 200);
  assert.equal(endlessBoard.data.mode, 'endless');
  assert.equal(endlessBoard.data.total, 1);
  const entry = endlessBoard.data.entries[0];
  assert.equal(entry.wave, MAX_WAVE + 1);
  assert.equal(entry.victory, false);

  // 普通榜不含这局无尽成绩。
  const normalBoard = await api('/api/leaderboard?mode=normal');
  assert.equal(normalBoard.status, 200);
  assert.equal(normalBoard.data.total, 0);
});

test('普通模式规则不变：第 30 波后不能再放行，通关仍按旧规则结算', async () => {
  const started = await startRun('normal', OTHER);
  assert.equal(started.status, 200);
  assert.equal(started.data.mode, 'normal');
  const runId = started.data.runId;
  assert.equal((await chooseMap(runId, OTHER)).status, 200);

  for (let wave = 1; wave <= MAX_WAVE; wave += 1) {
    const served = await serveWave(runId, OTHER);
    assert.equal(served.status, 200);
    assert.equal(served.data.wave.index, wave);
    assert.equal((await clearWave(runId, wave, OTHER)).status, 200);
  }

  const afterFinal = await serveWave(runId, OTHER);
  assert.equal(afterFinal.status, 409);

  const finished = await api(`/api/runs/${runId}/finish`, {
    method: 'POST',
    token: OTHER,
    body: { waveReached: MAX_WAVE, kills: 3000, goldLeft: 1000, baseHp: 20 },
  });
  assert.equal(finished.status, 200);
  assert.equal(finished.data.victory, true);

  const normalBoard = await api('/api/leaderboard?mode=normal');
  assert.equal(normalBoard.data.total, 1);
  const endlessBoard = await api('/api/leaderboard?mode=endless');
  assert.equal(endlessBoard.data.total, 1, '无尽榜不被普通局污染');
});
