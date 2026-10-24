// 榜单异常标记测试：可疑成绩透出标记与玩家口径说明，正常成绩不带标记，
// 说明文案不含内部阈值/规则名，排序不因标记改变。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { allocatePort, waitForHealth } from './test-server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = await allocatePort();
const BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join(os.tmpdir(), `rtd-lb-suspect-${process.pid}-${Date.now()}.db`);
const TOKEN = 'lb-suspect-0001';

// 必须在导入 db 模块前指向测试库，导入会建立连接并执行迁移。
process.env.DB_PATH = DB;
process.env.DB_BACKUP = '0';
const { db } = await import('../server/db/index.mjs');
const { boardKeyFor, recordLeaderboardEntry, validateLeaderboardEntry } = await import(
  '../server/db/leaderboard.mjs'
);
const { computeRawScore, dayKey } = await import('../public/js/shared/scoring.js');

const DAY = dayKey();

let server = null;
let serverLog = '';

function seedAccount(id) {
  const now = Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO accounts (id, kind, created_at, updated_at)
     VALUES (?, 'registered', ?, ?)`
  ).run(id, now, now);
}

// 与结算路径一致：先过基线反作弊，再用判定结果写榜（可疑标记随 metrics 落库）。
function seedEntry({ accountId, runId, score, wave, kills, durationMs = 300_000 }) {
  seedAccount(accountId);
  const now = Date.now();
  db.prepare(
    `INSERT INTO runs (id, account_id, mode, board_key, difficulty, seed, day, created_at)
     VALUES (?, ?, 'daily', ?, 'standard', ?, ?, ?)`
  ).run(runId, accountId, boardKeyFor('daily', DAY), runId, DAY, now);
  const guard = validateLeaderboardEntry({ score, wave, kills, durationMs });
  assert.equal(guard.accepted, true, `${accountId} 应能入榜`);
  recordLeaderboardEntry({
    accountId,
    displayName: accountId,
    runId,
    mode: 'daily',
    day: DAY,
    difficulty: 'standard',
    score,
    durationMs,
    wave,
    kills: guard.kills,
    victory: false,
    suspect: guard.suspect,
    contentVersion: 'test',
  });
  return guard;
}

const entriesByUrl = async (query = '') => {
  const response = await fetch(`${BASE}/api/leaderboard?mode=daily&day=${DAY}&limit=10${query}`, {
    headers: { 'x-player-token': TOKEN },
  });
  const data = await response.json().catch(() => null);
  assert.equal(response.status, 200, JSON.stringify(data));
  return data;
};

before(async () => {
  // 高分且明显超出理论上限 → 可疑；正常成绩保持干净。
  const suspect = seedEntry({
    accountId: 'suspect-cheat',
    runId: 'suspect-run-1',
    score: 9_999_999,
    wave: 8,
    kills: 900,
  });
  assert.equal(suspect.suspect, true);
  const clean = seedEntry({
    accountId: 'suspect-clean',
    runId: 'suspect-run-2',
    // 按计分公式取一个合法的中间值，确保落在反作弊上下限之内。
    score: computeRawScore({ waveReached: 3, kills: 12, goldLeft: 0, baseHp: 0, victory: false }),
    wave: 3,
    kills: 12,
  });
  assert.equal(clean.suspect, false);

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

  await waitForHealth({ base: BASE, port: PORT, child: server, log: () => serverLog });
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

test('可疑成绩透出标记与说明，正常成绩不带标记', async () => {
  const data = await entriesByUrl();
  const suspect = data.entries.find((entry) => entry.name === 'suspect-cheat');
  const clean = data.entries.find((entry) => entry.name === 'suspect-clean');

  assert.ok(suspect, '可疑成绩应在榜上');
  assert.equal(suspect.suspect, true);
  assert.equal(typeof suspect.suspectReason, 'string');
  assert.ok(suspect.suspectReason.length > 0);

  assert.ok(clean, '正常成绩应在榜上');
  assert.equal(clean.suspect, false);
  assert.equal(clean.suspectReason, null);
});

test('标记不改变排序：可疑成绩按分数正常占位', async () => {
  const data = await entriesByUrl();
  assert.deepEqual(
    data.entries.map((entry) => entry.name),
    ['suspect-cheat', 'suspect-clean'],
    '榜单顺序应与分数一致，可疑标记不参与排序'
  );
  assert.equal(data.entries[0].rank, 1);
  assert.equal(data.entries[1].rank, 2);
});

test('玩家说明不含内部阈值或规则名', async () => {
  const data = await entriesByUrl();
  const reasons = data.entries
    .filter((entry) => entry.suspect)
    .map((entry) => entry.suspectReason);
  assert.ok(reasons.length > 0);
  for (const reason of reasons) {
    assert.doesNotMatch(reason, /\d/, `说明不应包含具体阈值：${reason}`);
    assert.doesNotMatch(reason, /[a-z_]/i, `说明不应包含内部规则名：${reason}`);
  }
  const payload = JSON.stringify(data.entries);
  assert.doesNotMatch(payload, /score_too_high|score_too_low|kills_clamped|duration_too_short/);
});

test('前端只在可疑成绩上渲染徽标与说明', () => {
  const source = fs.readFileSync(path.join(ROOT, 'public/js/leaderboard-ui.js'), 'utf8');
  assert.match(source, /entry\.suspect/, '徽标应由服务端标记驱动');
  assert.match(source, /lb-suspect/, '应渲染可疑徽标');
  assert.match(source, /suspectReason/, '徽标应带规则级说明');
  assert.match(source, /标有「待复核」/, '应给玩家一句整体说明');
  // 说明文案里不允许出现内部阈值常量或规则名。
  const copy = source.match(/待复核[\s\S]*?参与排名。/)?.[0] || '';
  assert.ok(copy.length > 0);
  assert.doesNotMatch(copy, /\d/);
});
