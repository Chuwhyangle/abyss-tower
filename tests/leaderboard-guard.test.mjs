// 排行榜反作弊基线测试：门槛边界、可疑标记、拒绝入榜事件与正常成绩零影响。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 19700 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join(os.tmpdir(), `rtd-lb-guard-${process.pid}-${Date.now()}.db`);

// 必须在导入 db 模块前指向测试库，导入会建立连接并执行迁移。
process.env.DB_PATH = DB;
process.env.DB_BACKUP = '0';
const { db } = await import('../server/db/index.mjs');
const { LEADERBOARD_GUARD, recordLeaderboardEntry, validateLeaderboardEntry } = await import(
  '../server/db/leaderboard.mjs'
);
const { computeOutcome } = await import('../public/js/shared/scoring.js');
const { DIFFICULTIES } = await import('../public/js/shared/data.js');

const UNIT_ACCOUNT = 'guard-unit-account';

let server = null;
let serverLog = '';

async function api(pathname, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers['x-player-token'] = token;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

// 真实走一遍开局 → 选图 → 放行/结算波次，返回 runId 供结算断言。
async function play(token, waves) {
  const start = await api('/api/runs', { method: 'POST', token, body: { mode: 'normal' } });
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
  return runId;
}

async function finish(token, runId, body) {
  return api(`/api/runs/${runId}/finish`, { method: 'POST', token, body });
}

function entryRow(runId) {
  return db.prepare('SELECT * FROM leaderboard_entries WHERE run_id = ?').get(runId);
}

// 匿名 token 会映射到随机账号 id，按对局反查真实账号再取事件。
function eventRows(runId, type) {
  const run = db.prepare('SELECT account_id FROM runs WHERE id = ?').get(runId);
  if (!run) return [];
  return db
    .prepare('SELECT payload FROM player_events WHERE account_id = ? AND event_type = ?')
    .all(run.account_id, type);
}

function insertRunRow(id, accountId) {
  db.prepare(
    `INSERT INTO runs (id, account_id, mode, board_key, difficulty, seed, day, created_at)
     VALUES (?, ?, 'normal', 'normal', 'standard', 'guard-seed', '2026-10-24', ?)`
  ).run(id, accountId, Date.now());
}

test('规则集中定义，门槛与击杀上限由共享常量推导', () => {
  assert.equal(LEADERBOARD_GUARD.highWave, 20);
  assert.equal(LEADERBOARD_GUARD.minDurationMsForHighWave, 3 * 60 * 1000);
  assert.ok(LEADERBOARD_GUARD.killsPerWave > 0);
  assert.ok(LEADERBOARD_GUARD.minScoreMul < LEADERBOARD_GUARD.maxScoreMul);
});

test('时长门槛：高波次且不足 3 分钟拒绝，边界与低波次不误伤', () => {
  const base = { score: 30000, kills: 400 };
  const rejected = validateLeaderboardEntry({
    ...base,
    wave: 20,
    durationMs: LEADERBOARD_GUARD.minDurationMsForHighWave - 1,
  });
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.reason, 'duration_too_short');

  const atBoundary = validateLeaderboardEntry({
    ...base,
    wave: 20,
    durationMs: LEADERBOARD_GUARD.minDurationMsForHighWave,
  });
  assert.equal(atBoundary.accepted, true);

  assert.equal(validateLeaderboardEntry({ ...base, wave: 19, durationMs: 1000 }).accepted, true);
  assert.equal(
    validateLeaderboardEntry({ ...base, wave: 30, durationMs: 60_000 }).accepted,
    false
  );
});

test('击杀超上限：钳制到理论上限并标记 suspect，恰好上限不标记', () => {
  const wave = 10;
  const maxKills = wave * LEADERBOARD_GUARD.killsPerWave + LEADERBOARD_GUARD.killsFlat;
  const score = 60_000;

  const atLimit = validateLeaderboardEntry({ wave, kills: maxKills, durationMs: 600_000, score });
  assert.equal(atLimit.accepted, true);
  assert.equal(atLimit.suspect, false);
  assert.equal(atLimit.kills, maxKills);

  const over = validateLeaderboardEntry({
    wave,
    kills: maxKills + 1,
    durationMs: 600_000,
    score,
  });
  assert.equal(over.accepted, true);
  assert.equal(over.suspect, true);
  assert.equal(over.kills, maxKills);
  assert.deepEqual(over.flags, ['kills_clamped']);
});

test('分数与波次/击杀明显不符标记 suspect', () => {
  const wave = 10;
  const kills = 500;
  const outcome = computeOutcome({
    waveReached: wave,
    wavesServed: wave,
    kills,
    goldLeft: 800,
    baseHp: 20,
    difficulty: 'standard',
    scoreMul: 1,
    mode: 'normal',
  });

  const clean = validateLeaderboardEntry({
    wave,
    kills,
    durationMs: 600_000,
    score: outcome.score,
  });
  assert.equal(clean.accepted, true);
  assert.equal(clean.suspect, false);
  assert.equal(clean.reason, null);

  const tooHigh = validateLeaderboardEntry({
    wave,
    kills,
    durationMs: 600_000,
    score: 10_000_000,
  });
  assert.equal(tooHigh.suspect, true);
  assert.deepEqual(tooHigh.flags, ['score_too_high']);

  const tooLow = validateLeaderboardEntry({ wave, kills, durationMs: 600_000, score: 1 });
  assert.equal(tooLow.suspect, true);
  assert.deepEqual(tooLow.flags, ['score_too_low']);
});

test('真实结算分数在所有难度/地图倍率/模式下都不被误伤', () => {
  for (const difficulty of Object.keys(DIFFICULTIES)) {
    for (const scoreMul of [0.9, 1.0, 1.25]) {
      for (const mode of ['normal', 'endless']) {
        for (const wave of [1, 5, 20, 30]) {
          const kills = wave * 100;
          const outcome = computeOutcome({
            waveReached: wave,
            wavesServed: wave,
            kills,
            goldLeft: 0,
            baseHp: 0,
            difficulty,
            scoreMul,
            mode,
          });
          const result = validateLeaderboardEntry({
            wave,
            kills,
            durationMs: 10 * 60 * 1000,
            score: outcome.score,
          });
          const label = `${difficulty}/${scoreMul}/${mode}/${wave}`;
          assert.equal(result.accepted, true, label);
          assert.equal(result.suspect, false, label);
        }
      }
    }
  }
});

before(async () => {
  db.prepare(
    `INSERT INTO accounts (id, kind, created_at, updated_at) VALUES (?, 'registered', ?, ?)`
  ).run(UNIT_ACCOUNT, Date.now(), Date.now());

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

  for (let i = 0; i < 100; i += 1) {
    if (server.exitCode != null) break;
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) break;
    } catch {
      /* 等待服务启动 */
    }
    await sleep(100);
  }
  if (server.exitCode != null) throw new Error(`测试服务启动失败：${serverLog}`);
});

after(async () => {
  try {
    db.close();
  } catch {
    /* ignore */
  }
  if (server && server.exitCode == null) server.kill('SIGTERM');
  for (let i = 0; i < 30 && server && server.exitCode == null; i += 1) await sleep(50);
  if (server && server.exitCode == null) server.kill('SIGKILL');
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(`${DB}${suffix}`, { force: true });
    } catch {
      /* ignore */
    }
  }
});

test('正常成绩写入排行榜，记录结构与改动前一致', () => {
  insertRunRow('guard-run-normal', UNIT_ACCOUNT);
  recordLeaderboardEntry({
    accountId: UNIT_ACCOUNT,
    displayName: '正常玩家',
    runId: 'guard-run-normal',
    mode: 'normal',
    day: '2026-10-24',
    difficulty: 'standard',
    score: 12_345,
    durationMs: 600_000,
    wave: 5,
    kills: 50,
    victory: false,
    contentVersion: 'v1.4-map2',
  });
  const row = entryRow('guard-run-normal');
  assert.ok(row, '正常成绩应写入排行榜');
  assert.equal(row.score, 12_345);
  assert.equal(row.duration_ms, 600_000);
  assert.deepEqual(JSON.parse(row.metrics_json), { wave: 5, kills: 50, victory: 0 });
});

test('可疑成绩写入 suspect 标记，不改表结构', () => {
  insertRunRow('guard-run-suspect', UNIT_ACCOUNT);
  recordLeaderboardEntry({
    accountId: UNIT_ACCOUNT,
    displayName: '可疑玩家',
    runId: 'guard-run-suspect',
    mode: 'normal',
    day: '2026-10-24',
    difficulty: 'standard',
    score: 60_000,
    durationMs: 600_000,
    wave: 10,
    kills: 6_000,
    victory: false,
    suspect: true,
    contentVersion: 'v1.4-map2',
  });
  const row = entryRow('guard-run-suspect');
  assert.ok(row);
  assert.deepEqual(JSON.parse(row.metrics_json), {
    wave: 10,
    kills: 6_000,
    victory: 0,
    suspect: true,
  });
});

test('正常对局不受影响：入榜成功且无提示、无异常事件', async () => {
  const token = 'guard-normal-0001';
  const runId = await play(token, 3);
  const result = await finish(token, runId, {
    waveReached: 3,
    kills: 30,
    goldLeft: 0,
    baseHp: 20,
  });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.leaderboardNotice, undefined);

  const row = entryRow(runId);
  assert.ok(row, '正常对局应入榜');
  assert.deepEqual(JSON.parse(row.metrics_json), { wave: 3, kills: 30, victory: 0 });
  assert.equal(eventRows(runId, 'leaderboard_rejected').length, 0);
  assert.equal(eventRows(runId, 'leaderboard_suspect').length, 0);
});

test('高波次速通拒绝入榜：玩家不收到错误，事件留痕', async () => {
  const token = 'guard-short-0001';
  const runId = await play(token, 20);
  const result = await finish(token, runId, {
    waveReached: 20,
    kills: 200,
    goldLeft: 0,
    baseHp: 20,
  });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(typeof result.data.leaderboardNotice, 'string');
  assert.match(result.data.leaderboardNotice, /排行榜/);

  assert.equal(entryRow(runId), undefined, '被拒成绩不得入榜');
  const events = eventRows(runId, 'leaderboard_rejected');
  assert.equal(events.length, 1);
  assert.equal(JSON.parse(events[0].payload).reason, 'duration_too_short');
});

test('高波次正常时长成绩照常入榜', async () => {
  const token = 'guard-slow-0001';
  const runId = await play(token, 20);
  // 把开局时间前移 4 分钟，模拟真实耗时超过时长门槛。
  const shifted = db
    .prepare('UPDATE runs SET created_at = created_at - ? WHERE id = ?')
    .run(4 * 60 * 1000, runId);
  assert.equal(shifted.changes, 1);

  const result = await finish(token, runId, {
    waveReached: 20,
    kills: 200,
    goldLeft: 0,
    baseHp: 20,
  });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.leaderboardNotice, undefined);

  const row = entryRow(runId);
  assert.ok(row, '满足时长门槛的高波次成绩应入榜');
  assert.deepEqual(JSON.parse(row.metrics_json), { wave: 20, kills: 200, victory: 0 });
  assert.equal(eventRows(runId, 'leaderboard_rejected').length, 0);
});
