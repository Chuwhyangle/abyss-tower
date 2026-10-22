// 服务端接口测试：启动独立端口 + 临时数据库，覆盖开局/波次/遗物/结算/排行/每日/通关。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { clampFinishPayload, computeOutcome } from '../public/js/shared/scoring.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 18600 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join(os.tmpdir(), `rtd-api-test-${process.pid}-${Date.now()}.db`);
const TOKEN = 'api-test-token-0001';
const OTHER = 'api-test-token-0002';

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

async function startRun(mode, difficulty, token = TOKEN) {
  return api('/api/runs', { method: 'POST', body: { mode, difficulty }, token });
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

test('静态页面与资源可访问', async () => {
  const index = await fetch(`${BASE}/`);
  assert.equal(index.status, 200);
  const html = await index.text();
  assert.match(html, /渊塔守卫/);

  const script = await fetch(`${BASE}/js/main.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /javascript/);
});

test('会话、开局、波次、遗物、结算与排行榜', async () => {
  const health = await api('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.ok, true);

  const session = await api('/api/session', { method: 'POST', body: {} });
  assert.equal(session.status, 200);
  assert.equal(session.data.profile.unlocks.length, 0);
  assert.equal(session.data.dailyAttemptsLeft, 3);

  const started = await startRun('normal', 'abyss');
  assert.equal(started.status, 200);
  assert.equal(started.data.difficulty, 'abyss');
  assert.equal(started.data.startingGold, 240); // 260 - 20
  assert.equal(started.data.baseHp, 17); // 20 - 3
  assert.equal(started.data.difficultyConfig.hpMul, 1.18);
  assert.equal(started.data.candidates.length, 3);
  const runId = started.data.runId;

  const noMapWave = await api(`/api/runs/${runId}/wave`, { method: 'POST', body: {} });
  assert.equal(noMapWave.status, 409);

  const pickedMap = await api(`/api/runs/${runId}/map`, {
    method: 'POST',
    body: { index: 0 },
  });
  assert.equal(pickedMap.status, 200);
  assert.equal(pickedMap.data.map.cols, 22);
  assert.equal(pickedMap.data.map.spawns.length, pickedMap.data.mapMeta.portalCount);

  const wave = await api(`/api/runs/${runId}/wave`, { method: 'POST', body: {} });
  assert.equal(wave.status, 200);
  assert.equal(wave.data.wave.index, 1);
  assert.equal(wave.data.replay, false);
  assert.ok(wave.data.wave.hpMul > 1);

  // 战斗中刷新后再次请求：重放第 1 波，不推进波次。
  const replay = await api(`/api/runs/${runId}/wave`, { method: 'POST', body: {} });
  assert.equal(replay.status, 200);
  assert.equal(replay.data.replay, true);
  assert.equal(replay.data.wave.index, 1);
  assert.equal(replay.data.clearedWaves, 0);
  assert.equal(replay.data.wavesServed, 1);

  const cleared = await api(`/api/runs/${runId}/clear`, {
    method: 'POST',
    body: { wave: 1 },
  });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.data.clearedWaves, 1);

  const duplicateClear = await api(`/api/runs/${runId}/clear`, {
    method: 'POST',
    body: { wave: 1 },
  });
  assert.equal(duplicateClear.status, 200);
  assert.equal(duplicateClear.data.duplicate, true);

  const relics = await api(`/api/runs/${runId}/relics`, { method: 'POST', body: {} });
  assert.equal(relics.status, 200);
  assert.equal(relics.data.offers.length, 3);
  assert.equal(relics.data.wave, 1);
  assert.equal(relics.data.rerollsUsed, 0);
  assert.equal(relics.data.maxRerolls, 1);

  const reroll = await api(`/api/runs/${runId}/relics`, {
    method: 'POST',
    body: { reroll: true },
  });
  assert.equal(reroll.status, 200);
  assert.equal(reroll.data.rerollsUsed, 1);
  assert.equal(reroll.data.offers.length, 3);

  assert.ok(reroll.data.offers.every((offer) => offer.kind));
  const pickOffer = reroll.data.offers[0];
  const pick = await api(`/api/runs/${runId}/relic`, {
    method: 'POST',
    body: { index: 0 },
  });
  assert.equal(pick.status, 200);
  assert.equal(pick.data.relics.length, 1);
  assert.equal(pick.data.relics[0].level, 1);
  if (pickOffer.kind === 'relic') assert.equal(pick.data.applied.id, pickOffer.id);

  const duplicatePick = await api(`/api/runs/${runId}/relic`, {
    method: 'POST',
    body: { index: 0 },
  });
  assert.equal(duplicatePick.status, 409);

  const wave2 = await api(`/api/runs/${runId}/wave`, { method: 'POST', body: {} });
  assert.equal(wave2.status, 200);
  assert.equal(wave2.data.wave.index, 2);
  assert.equal(wave2.data.replay, false);
  assert.equal(wave2.data.clearedWaves, 1);
  assert.equal(wave2.data.wavesServed, 2);

  const info = await api(`/api/runs/${runId}`);
  assert.equal(info.status, 200);
  assert.equal(info.data.run.clearedWaves, 1);
  assert.equal(info.data.run.wavesServed, 2);
  assert.equal(info.data.run.inProgress, true);

  const body = {
    waveReached: 999,
    kills: 999999,
    goldLeft: 999999,
    baseHp: 999,
  };
  const finished = await api(`/api/runs/${runId}/finish`, { method: 'POST', body });
  assert.equal(finished.status, 200);
  assert.equal(finished.data.victory, false);
  assert.equal(finished.data.waveReached, 1);
  assert.equal(finished.data.difficulty, 'abyss');

  const clamped = clampFinishPayload(body, 1);
  const expected = computeOutcome({
    ...clamped,
    wavesServed: 1,
    difficulty: 'abyss',
    scoreMul: pickedMap.data.mapMeta.scoreMul,
  });
  assert.equal(finished.data.score, expected.score);
  assert.equal(finished.data.coresEarned, expected.cores);
  assert.ok(finished.data.rank >= 1);

  const repeat = await api(`/api/runs/${runId}/finish`, { method: 'POST', body });
  assert.equal(repeat.status, 409);

  const foreign = await api(`/api/runs/${runId}`, { token: OTHER });
  assert.equal(foreign.status, 404);

  const leaderboard = await api('/api/leaderboard?mode=normal');
  assert.equal(leaderboard.status, 200);
  assert.ok(leaderboard.data.entries.length >= 1);
  const entry = leaderboard.data.entries.find((row) => row.difficulty === 'abyss');
  assert.ok(entry);
  assert.equal(entry.victory, false);

  const unlock = await api('/api/unlock', { method: 'POST', body: { unlockId: 'tower_arc' } });
  assert.equal(unlock.status, 400); // 星核不足
});

test('通关校验：必须清空第 30 波，途中死亡/重放不算通关', async () => {
  async function serve(runId, wave) {
    const response = await api(`/api/runs/${runId}/wave`, { method: 'POST', body: {} });
    assert.equal(response.status, 200);
    assert.equal(response.data.wave.index, wave);
    assert.equal(response.data.wave.finalBoss, wave === 30);
    return response.data;
  }

  async function clear(runId, wave) {
    const response = await api(`/api/runs/${runId}/clear`, {
      method: 'POST',
      body: { wave },
    });
    assert.equal(response.status, 200);
    assert.equal(response.data.clearedWaves, wave);
  }

  const unfinished = await startRun('normal', 'standard');
  assert.equal(unfinished.status, 200);
  const unfinishedId = unfinished.data.runId;
  const unfinishedMap = await api(`/api/runs/${unfinishedId}/map`, {
    method: 'POST',
    body: { index: 0 },
  });
  assert.equal(unfinishedMap.status, 200);
  for (let wave = 1; wave <= 29; wave++) {
    await serve(unfinishedId, wave);
    await clear(unfinishedId, wave);
  }
  await serve(unfinishedId, 30);
  // 最终波进行中刷新：重放第 30 波，波次不推进。
  const finalReplay = await serve(unfinishedId, 30);
  assert.equal(finalReplay.replay, true);
  assert.equal(finalReplay.clearedWaves, 29);

  const diedAtFinal = await api(`/api/runs/${unfinishedId}/finish`, {
    method: 'POST',
    body: { waveReached: 30, kills: 2800, goldLeft: 1000, baseHp: 0 },
  });
  assert.equal(diedAtFinal.status, 200);
  assert.equal(diedAtFinal.data.victory, false);
  assert.equal(diedAtFinal.data.waveReached, 29); // 进行中的第 30 波未被服务端算作已清

  const started = await startRun('normal', 'standard');
  assert.equal(started.status, 200);
  const runId = started.data.runId;
  await api(`/api/runs/${runId}/map`, { method: 'POST', body: { index: 0 } });

  for (let wave = 1; wave <= 30; wave++) {
    const served = await serve(runId, wave);
    assert.equal(served.replay, false);
    if (wave === 5) {
      const replay = await serve(runId, 5);
      assert.equal(replay.replay, true);
      assert.equal(replay.wave.index, 5);
    }
    await clear(runId, wave);
  }

  const afterFinal = await api(`/api/runs/${runId}/wave`, { method: 'POST', body: {} });
  assert.equal(afterFinal.status, 409);

  const finished = await api(`/api/runs/${runId}/finish`, {
    method: 'POST',
    body: { waveReached: 30, kills: 3000, goldLeft: 1000, baseHp: 20 },
  });
  assert.equal(finished.status, 200);
  assert.equal(finished.data.victory, true);
  assert.ok(finished.data.score >= 10000);
  assert.ok(finished.data.coresEarned > 0);

  const profile = await api('/api/profile');
  assert.ok(profile.data.profile.stats.byDifficulty.standard.wins >= 1);
});

test('每日挑战：自选难度、三次结算上限', async () => {
  let dailySeed = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const started = await startRun('daily', 'roam');
    assert.equal(started.status, 200);
    assert.equal(started.data.mode, 'daily');
    assert.equal(started.data.difficulty, 'roam');
    if (dailySeed == null) dailySeed = started.data.seed;
    else assert.equal(started.data.seed, dailySeed);

    if (attempt === 1) {
      // 重放同一波不额外消耗每日次数
      await api(`/api/runs/${started.data.runId}/map`, {
        method: 'POST',
        body: { index: 0 },
      });
      const wave = await api(`/api/runs/${started.data.runId}/wave`, {
        method: 'POST',
        body: {},
      });
      assert.equal(wave.data.wave.index, 1);
      const replay = await api(`/api/runs/${started.data.runId}/wave`, {
        method: 'POST',
        body: {},
      });
      assert.equal(replay.data.replay, true);
      await api(`/api/runs/${started.data.runId}/clear`, {
        method: 'POST',
        body: { wave: 1 },
      });
    }

    const finished = await api(`/api/runs/${started.data.runId}/finish`, {
      method: 'POST',
      body: { waveReached: attempt === 1 ? 1 : 0, kills: 0, goldLeft: 0, baseHp: 17 },
    });
    assert.equal(finished.status, 200);
    assert.equal(finished.data.dailyAttemptsLeft, 3 - attempt);
  }

  const blocked = await startRun('daily', 'roam');
  assert.equal(blocked.status, 429);

  const board = await api('/api/leaderboard?mode=daily');
  assert.equal(board.status, 200);
  assert.ok(board.data.entries.length >= 1);
});
