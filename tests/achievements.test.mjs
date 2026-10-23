// 成就系统：注册登录 → 完成一局 → 解锁「首次远征」；重复结算不重复插入；接口结构正确。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { ACHIEVEMENT_BY_ID } from '../public/js/shared/achievements.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEGACY_IDS = [
  'first_run',
  'first_win',
  'win_roam',
  'win_standard',
  'win_abyss',
  'all_difficulties',
  'boss_slayer',
  'wave_10',
  'wave_20',
  'wave_30',
  'kills_100',
  'kills_1000',
  'kills_5000',
  'runs_10',
  'runs_50',
  'wins_5',
  'wins_20',
  'score_5000',
  'score_10000',
  'relic_max',
  'relic_max_3',
  'relic_collector',
  'daily_first',
  'daily_win',
  'daily_5',
  'speedrun',
  'achievement_10',
  'achievement_20',
];
const GROUPS = new Set(['clear', 'build', 'challenge', 'collect']);
const RARITIES = new Set(['common', 'rare', 'epic']);
const PORT = 19600 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `rtd-achievements-${process.pid}-${Date.now()}.db`);

let server = null;
let serverLog = '';
let cookie = '';
let accountId = '';

function api(pathname, { method = 'GET', body } = {}) {
  return fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function jsonApi(pathname, options) {
  const response = await api(pathname, options);
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

async function register(username) {
  const response = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'rtd-test-password' }),
  });
  const data = await response.json();
  assert.equal(response.status, 201, `注册失败：${JSON.stringify(data)}`);
  const setCookie = response.headers.getSetCookie?.()[0] || response.headers.get('set-cookie') || '';
  return { cookie: setCookie.split(';')[0], data };
}

async function playOneRun() {
  const started = await jsonApi('/api/runs', {
    method: 'POST',
    body: { mode: 'normal', difficulty: 'standard' },
  });
  assert.equal(started.status, 200);
  const runId = started.data.runId;

  const map = await jsonApi(`/api/runs/${runId}/map`, { method: 'POST', body: { index: 0 } });
  assert.equal(map.status, 200);

  const wave = await jsonApi(`/api/runs/${runId}/wave`, { method: 'POST', body: {} });
  assert.equal(wave.status, 200);

  const clear = await jsonApi(`/api/runs/${runId}/clear`, {
    method: 'POST',
    body: { wave: 1 },
  });
  assert.equal(clear.status, 200);

  const finished = await jsonApi(`/api/runs/${runId}/finish`, {
    method: 'POST',
    body: { waveReached: 1, kills: 10, goldLeft: 0, baseHp: 20 },
  });
  assert.equal(finished.status, 200);
  return finished;
}

before(async () => {
  server = spawn(process.execPath, ['--no-warnings', 'server/index.mjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DB_PATH,
      AUTH_ENABLED: '1',
      REGISTRATION_MODE: 'open',
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

after(async () => {
  if (server && server.exitCode == null) {
    server.kill('SIGTERM');
    for (let i = 0; i < 40 && server.exitCode == null; i++) await sleep(50);
    if (server.exitCode == null) server.kill('SIGKILL');
  }
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(`${DB_PATH}${suffix}`, { force: true });
    } catch {
      /* ignore */
    }
  }
});

test('未登录不能读取成就', async () => {
  const response = await api('/api/achievements');
  assert.equal(response.status, 401);
});

test('注册登录后完成一局，解锁「首次远征」', async () => {
  const username = `ach${Date.now().toString(36).slice(-8)}`;
  const registered = await register(username);
  cookie = registered.cookie;
  accountId = registered.data.profile.accountId;
  assert.ok(accountId);

  const finished = await playOneRun();
  assert.ok(Array.isArray(finished.data.unlockedAchievements));
  assert.ok(
    finished.data.unlockedAchievements.includes('first_run'),
    `结算应解锁 first_run，实际：${finished.data.unlockedAchievements.join(',')}`
  );

  const { status, data } = await jsonApi('/api/achievements');
  assert.equal(status, 200);
  assert.ok(data.total >= 30, `成就定义至少 30 条，实际 ${data.total}`);
  assert.equal(data.achievements.length, data.total);
  assert.equal(data.unlockedCount, data.achievements.filter((item) => item.unlocked).length);
  assert.ok(Array.isArray(data.groups) && data.groups.length === 4, '应返回四个成就分组');

  for (const item of data.achievements) {
    assert.equal(typeof item.id, 'string');
    assert.equal(typeof item.title, 'string');
    assert.equal(typeof item.desc, 'string');
    assert.equal(typeof item.condition, 'string');
    assert.equal(typeof item.unlocked, 'boolean');
    assert.ok(item.unlockedAt === null || typeof item.unlockedAt === 'number');
    assert.ok(GROUPS.has(item.group), `非法分组：${item.group}`);
    assert.equal(typeof item.groupName, 'string');
    assert.ok(RARITIES.has(item.rarity), `非法稀有度：${item.rarity}`);
    assert.equal(typeof item.rarityName, 'string');
    assert.equal(typeof item.hidden, 'boolean');
    if (item.progress !== null) {
      assert.ok(Number.isInteger(item.progress.current));
      assert.ok(Number.isInteger(item.progress.target));
      assert.ok(item.progress.current >= 0 && item.progress.current <= item.progress.target);
    }
  }

  // 旧成就 id 必须保留，历史解锁记录才不会失联。
  for (const id of LEGACY_IDS) {
    assert.ok(ACHIEVEMENT_BY_ID[id], `旧成就定义缺失：${id}`);
    assert.ok(data.achievements.some((item) => item.id === id), `接口缺少旧成就：${id}`);
  }

  // 未解锁的隐藏成就只返回占位，描述不得出现在响应里。
  const hidden = data.achievements.filter((item) => item.hidden);
  assert.ok(hidden.length >= 1, '应至少有一条隐藏成就');
  const lockedHidden = hidden.filter((item) => !item.unlocked);
  assert.ok(lockedHidden.length >= 1, '测试账号不应已解锁全部隐藏成就');
  const payload = JSON.stringify(data);
  for (const item of lockedHidden) {
    assert.equal(item.title, '???');
    assert.equal(item.desc, '');
    assert.equal(item.condition, '???');
    assert.equal(item.progress, null);
    assert.ok(!payload.includes(ACHIEVEMENT_BY_ID[item.id].desc), '隐藏成就描述泄漏');
  }

  const firstRun = data.achievements.find((item) => item.id === 'first_run');
  assert.ok(firstRun);
  assert.equal(firstRun.unlocked, true);
  assert.equal(typeof firstRun.unlockedAt, 'number');
});

test('重复结算不重复插入，且第二次结算不重复上报首胜成就', async () => {
  const finished = await playOneRun();
  assert.equal(finished.status, 200);
  assert.ok(
    !finished.data.unlockedAchievements.includes('first_run'),
    '已解锁的成就不应在后续结算中重复上报'
  );

  const { status, data } = await jsonApi('/api/achievements');
  assert.equal(status, 200);
  assert.equal(data.unlockedCount, data.achievements.filter((item) => item.unlocked).length);

  // 停掉服务后直接查库，确认同一账号同一成就只有一条记录，且重复调用写入仍保持幂等。
  server.kill('SIGTERM');
  for (let i = 0; i < 40 && server.exitCode == null; i++) await sleep(50);
  if (server.exitCode == null) server.kill('SIGKILL');
  server = null;

  process.env.DB_PATH = DB_PATH;
  process.env.DB_BACKUP = '0';
  const { db } = await import('../server/db/index.mjs');
  const { unlockAchievements } = await import('../server/db/achievements.mjs');

  const migrations = db
    .prepare('SELECT version FROM schema_migrations ORDER BY version')
    .all()
    .map((row) => row.version);
  assert.ok(migrations.includes(2), '应已应用 0002 成就迁移');

  const count = () =>
    db
      .prepare(
        "SELECT COUNT(*) AS c FROM account_achievements WHERE account_id = ? AND achievement_id = 'first_run'"
      )
      .get(accountId).c;
  assert.equal(count(), 1);

  const context = {
    run: {
      mode: 'normal',
      difficulty: 'standard',
      victory: false,
      waveReached: 1,
      kills: 10,
      score: 0,
      durationMs: 1000,
      relics: [],
    },
    stats: {
      runs: 2,
      kills: 20,
      wins: 0,
      byDifficulty: {
        roam: { bestWave: 0, bestScore: 0, wins: 0, runs: 0 },
        standard: { bestWave: 1, bestScore: 0, wins: 0, runs: 2 },
        abyss: { bestWave: 0, bestScore: 0, wins: 0, runs: 0 },
      },
    },
  };
  unlockAchievements(accountId, context);
  unlockAchievements(accountId, context);
  assert.equal(count(), 1, '重复写入后 first_run 仍只有一条');
});
