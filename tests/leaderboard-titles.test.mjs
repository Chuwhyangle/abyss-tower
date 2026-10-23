// 排行榜称号展示：有/无称号、已删除账号、跨赛季，且旧响应字段不缺失。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 20000 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join(os.tmpdir(), `rtd-lb-titles-${process.pid}-${Date.now()}.db`);

// 必须在导入 db 模块前指向测试库，导入会建立连接并执行迁移。
process.env.DB_PATH = DB;
process.env.DB_BACKUP = '0';
const { seasonBounds, seasonOf } = await import('../server/db/leaderboard.mjs');

const TOKENS = {
  titled: 'titles-alpha-0001',
  plain: 'titles-beta-0001',
  doomed: 'titles-gamma-0001',
};

const TITLE_NAME = '全能指挥官';
const DOOMED_NAME = '已删除玩家';
const currentSeason = seasonOf();

function shiftSeason(season, delta) {
  const [year, month] = season.split('-').map(Number);
  const index = year * 12 + (month - 1) + delta;
  const nextYear = Math.floor(index / 12);
  const nextMonth = (index % 12) + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
}

const prevSeason = shiftSeason(currentSeason, -1);

function seasonMidpoint(season) {
  const bounds = seasonBounds(season);
  return bounds.start + 12 * 60 * 60 * 1000;
}

let server = null;
let serverLog = '';
let db = null;
const scores = new Map();
const accounts = new Map();

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

// 真实走一遍开局 → 选图 → 放行/结算波次 → 结算，产生一条排行榜成绩。
async function play(token, { waves = 1 } = {}) {
  const start = await api('/api/runs', {
    method: 'POST',
    token,
    body: { mode: 'normal', difficulty: 'standard' },
  });
  assert.equal(start.status, 200, `开局失败：${JSON.stringify(start.data)}`);
  const runId = start.data.runId;

  assert.equal(
    (await api(`/api/runs/${runId}/map`, { method: 'POST', token, body: { index: 0 } })).status,
    200
  );
  for (let wave = 1; wave <= waves; wave += 1) {
    assert.equal(
      (await api(`/api/runs/${runId}/wave`, { method: 'POST', token, body: {} })).status,
      200
    );
    assert.equal(
      (await api(`/api/runs/${runId}/clear`, { method: 'POST', token, body: { wave } })).status,
      200
    );
  }
  const finished = await api(`/api/runs/${runId}/finish`, {
    method: 'POST',
    token,
    body: { waveReached: waves, kills: waves * 10, goldLeft: 0, baseHp: 20 },
  });
  assert.equal(finished.status, 200, `结算失败：${JSON.stringify(finished.data)}`);
  return { ...finished.data, runId };
}

// 旧 token 模式下的账号 id 是服务端生成的，只能从对局落库后反查。
function accountForRun(runId) {
  const row = db
    .prepare('SELECT account_id FROM leaderboard_entries WHERE run_id = ? ORDER BY id DESC LIMIT 1')
    .get(runId);
  assert.ok(row, `未找到对局 ${runId} 的榜单项`);
  return row.account_id;
}

// 与资料页一致：先解锁 title:<id>，再写入 selected。
function equipTitle(accountId, title) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO player_kv (account_id, namespace, key, value_json, updated_at)
     VALUES (?, 'cosmetics', ?, ?, ?)
     ON CONFLICT(account_id, namespace, key) DO UPDATE SET
       value_json = excluded.value_json, updated_at = excluded.updated_at`
  ).run(accountId, `title:${title}`, JSON.stringify({ unlockedAt: now }), now);
  db.prepare(
    `INSERT INTO player_kv (account_id, namespace, key, value_json, updated_at)
     VALUES (?, 'cosmetics', 'selected', ?, ?)
     ON CONFLICT(account_id, namespace, key) DO UPDATE SET
       value_json = excluded.value_json, updated_at = excluded.updated_at`
  ).run(accountId, JSON.stringify({ title }), now);
}

function moveEntryToSeason(score, season) {
  db.prepare('UPDATE leaderboard_entries SET created_at = ? WHERE score = ?').run(
    seasonMidpoint(season),
    score
  );
}

function findMe(data) {
  return (data.entries || []).find((entry) => entry.isMe) || null;
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

  db = new DatabaseSync(DB);
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');

  const titled = await play(TOKENS.titled, { waves: 5 });
  scores.set('titled', titled.score);
  accounts.set('titled', accountForRun(titled.runId));

  const plain = await play(TOKENS.plain, { waves: 3 });
  scores.set('plain', plain.score);
  accounts.set('plain', accountForRun(plain.runId));

  assert.equal(
    (await api('/api/session', { method: 'POST', token: TOKENS.doomed, body: { name: DOOMED_NAME } }))
      .status,
    200
  );
  const doomed = await play(TOKENS.doomed, { waves: 2 });
  scores.set('doomed', doomed.score);
  accounts.set('doomed', accountForRun(doomed.runId));

  equipTitle(accounts.get('titled'), 'commander');
});

after(async () => {
  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
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

test('有称号的玩家展示称号，其他玩家 title 为 null', async () => {
  const titled = await api(`/api/leaderboard?mode=normal&size=50&season=${currentSeason}`, {
    token: TOKENS.titled,
  });
  assert.equal(titled.status, 200);

  const mine = findMe(titled.data);
  assert.ok(mine, '未找到当前账号的榜单项');
  assert.equal(mine.title, TITLE_NAME);

  const plain = await api(`/api/leaderboard?mode=normal&size=50&season=${currentSeason}`, {
    token: TOKENS.plain,
  });
  const plainEntry = findMe(plain.data);
  assert.ok(plainEntry, '未找到无称号账号的榜单项');
  assert.equal(plainEntry.title, null);
});

test('旧响应字段不缺失，称号不参与排序', async () => {
  const board = await api(`/api/leaderboard?mode=normal&size=50&season=${currentSeason}`, {
    token: TOKENS.titled,
  });
  const entry = findMe(board.data);
  assert.ok(entry);

  for (const field of [
    'name',
    'difficulty',
    'wave',
    'score',
    'kills',
    'victory',
    'durationMs',
    'contentVersion',
    'createdAt',
    'rank',
    'isMe',
    'title',
  ]) {
    assert.ok(field in entry, `响应字段缺失：${field}`);
  }

  const order = board.data.entries.map((item) => item.score);
  const sorted = [...order].sort((a, b) => b - a);
  assert.deepEqual(order, sorted, '排行榜应只按成绩降序');
});

test('已删除账号从排行榜消失且不影响其他条目', async () => {
  const before = await api(`/api/leaderboard?mode=normal&size=50&season=${currentSeason}`, {
    token: TOKENS.plain,
  });
  assert.ok(before.data.entries.some((entry) => entry.name === DOOMED_NAME));

  db.prepare('DELETE FROM accounts WHERE id = ?').run(accounts.get('doomed'));

  const after = await api(`/api/leaderboard?mode=normal&size=50&season=${currentSeason}`, {
    token: TOKENS.plain,
  });
  assert.equal(after.status, 200);
  assert.equal(after.data.total, before.data.total - 1);
  assert.ok(!after.data.entries.some((entry) => entry.name === DOOMED_NAME));
  assert.ok(after.data.entries.every((entry) => entry.title !== undefined));
});

test('跨赛季查询仍展示当前称号', async () => {
  moveEntryToSeason(scores.get('titled'), prevSeason);

  const prev = await api(`/api/leaderboard?mode=normal&size=50&season=${prevSeason}`, {
    token: TOKENS.titled,
  });
  assert.equal(prev.status, 200);
  assert.equal(prev.data.season, prevSeason);

  const entry = findMe(prev.data);
  assert.ok(entry, '跨赛季榜未找到当前账号');
  assert.equal(entry.title, TITLE_NAME);

  const current = await api(`/api/leaderboard?mode=normal&size=50&season=${currentSeason}`, {
    token: TOKENS.titled,
  });
  assert.equal(findMe(current.data), null, '成绩已移入上一赛季，当前赛季不应再出现');
});
