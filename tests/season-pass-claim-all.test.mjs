// 赛季通行证一键领取：部分已领只补剩余、重复点击幂等、事务失败整批回滚、接口与界面接线。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { allocatePort, waitForHealth } from './test-server.mjs';

import { SEASON_PASS_MILESTONES } from '../public/js/shared/season-pass.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UNIT_DB = path.join(os.tmpdir(), `rtd-claim-all-unit-${process.pid}-${Date.now()}.db`);
const SERVER_DB = path.join(os.tmpdir(), `rtd-claim-all-server-${process.pid}-${Date.now()}.db`);
const PORT = await allocatePort();
const BASE = `http://127.0.0.1:${PORT}`;

const PARTIAL_TOKEN = 'claim-all-partial-01';
const ALL_TOKEN = 'claim-all-everything-01';
const ROLLBACK_TOKEN = 'claim-all-rollback-01';
const EMPTY_TOKEN = 'claim-all-empty-01';

const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const SEASON_PASS_UI = read('public/js/ui/season-pass.js');
const SEASON_PASS_ROUTES = read('server/routes/season-pass.mjs');

let db = null;
let createProfile = null;
let getCores = null;
let getSeasonShards = null;
let seasonPassSummary = null;
let claimSeasonPassMilestone = null;
let claimAllSeasonPassMilestones = null;
let seasonOf = null;
let seasonBounds = null;

let server = null;
let serverLog = '';
let inSeasonAt = 0;

function removeDb(file) {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(`${file}${suffix}`, { force: true });
    } catch {
      /* ignore */
    }
  }
}

function insertFinishedRun(handle, { id, accountId, score = 50000, createdAt = inSeasonAt }) {
  handle
    .prepare(
      `INSERT INTO runs
         (id, account_id, mode, board_key, difficulty, seed, day, content_version,
          ruleset_json, waves_served, cleared_waves, map_choice, relics, offers,
          rerolls_used, status, victory, score, wave_reached, kills, duration_ms,
          result_json, created_at, finished_at)
       VALUES (?, ?, 'normal', 'normal', 'standard', ?, '2026-10-24', 'v1.4-map2', ?, 20, 20, -1, '[]', '{}',
               0, 'finished', 1, ?, 20, 100, 60000, ?, ?, ?)`
    )
    .run(
      id,
      accountId,
      `seed-${id}`,
      JSON.stringify({ meta: { baseHp: 20 } }),
      score,
      JSON.stringify({ baseHp: 20 }),
      createdAt,
      createdAt + 60000
    );
}

function seedAccount(accountId) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO accounts (id, kind, created_at, updated_at)
     VALUES (?, 'unclaimed', ?, ?)`
  ).run(accountId, now, now);
  createProfile(accountId);
}

function claimRows(accountId, season) {
  return db
    .prepare(
      `SELECT milestone_id, claimed_at FROM account_season_pass_claims
        WHERE account_id = ? AND season = ?
        ORDER BY claimed_at ASC, milestone_id ASC`
    )
    .all(accountId, season);
}

async function api(pathname, { method = 'GET', token = null, body = null } = {}) {
  const headers = token ? { 'x-player-token': token } : {};
  if (body != null) headers['content-type'] = 'application/json';
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

function legacyAccountId(handle, token) {
  const aliasHash = crypto.createHash('sha256').update(token).digest('hex');
  const row = handle
    .prepare(
      `SELECT account_id FROM account_aliases
        WHERE provider = 'legacy_token' AND alias_hash = ?`
    )
    .get(aliasHash);
  return row?.account_id || null;
}

before(async () => {
  process.env.DB_PATH = UNIT_DB;
  process.env.DB_BACKUP = '0';
  ({ db } = await import('../server/db/index.mjs'));
  ({ createProfile, getCores } = await import('../server/db.mjs'));
  ({
    claimAllSeasonPassMilestones,
    claimSeasonPassMilestone,
    getSeasonShards,
    seasonPassSummary,
  } = await import('../server/db/season_pass.mjs'));
  ({ seasonOf, seasonBounds } = await import('../server/db/leaderboard.mjs'));

  const bounds = seasonBounds(seasonOf());
  inSeasonAt = Math.max(bounds.start + 1, Math.min(Date.now(), bounds.end - 60_000));

  seedAccount(PARTIAL_TOKEN);
  insertFinishedRun(db, { id: 'ca-partial', accountId: PARTIAL_TOKEN, score: 60000 });
  seedAccount(ALL_TOKEN);
  insertFinishedRun(db, { id: 'ca-all', accountId: ALL_TOKEN, score: 180000 });
  seedAccount(ROLLBACK_TOKEN);
  insertFinishedRun(db, { id: 'ca-rollback', accountId: ROLLBACK_TOKEN, score: 180000 });
  seedAccount(EMPTY_TOKEN);

  server = spawn(process.execPath, ['--no-warnings', 'server/index.mjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DB_PATH: SERVER_DB,
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

after(() => {
  if (server) server.kill('SIGTERM');
  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
  removeDb(UNIT_DB);
  removeDb(SERVER_DB);
});

test('部分已领取时一键领取只发放剩余里程碑', () => {
  const [first, second, third] = SEASON_PASS_MILESTONES;
  const season = seasonOf();

  const firstClaim = claimSeasonPassMilestone(PARTIAL_TOKEN, first.id);
  assert.equal(firstClaim.ok, true);
  assert.equal(firstClaim.claimed, true);

  const beforeCores = getCores(PARTIAL_TOKEN);
  const beforeShards = getSeasonShards(PARTIAL_TOKEN);
  const beforeRows = claimRows(PARTIAL_TOKEN, season);
  assert.equal(beforeRows.length, 1);

  const result = claimAllSeasonPassMilestones(PARTIAL_TOKEN);
  assert.equal(result.ok, true);
  assert.equal(result.claimedCount, 2);
  assert.equal(result.alreadyClaimed, false);
  assert.deepEqual(
    result.awarded.map((item) => item.id),
    [second.id, third.id],
    '一键领取重复发放了已领取里程碑或漏发剩余里程碑'
  );
  assert.equal(getCores(PARTIAL_TOKEN), beforeCores + (third.reward.cores || 0));
  assert.equal(getSeasonShards(PARTIAL_TOKEN), beforeShards + (second.reward.shards || 0));

  const afterRows = claimRows(PARTIAL_TOKEN, season);
  assert.equal(afterRows.length, 3);
  const originalFirst = beforeRows[0];
  const keptFirst = afterRows.find((row) => row.milestone_id === first.id);
  assert.equal(keptFirst.claimed_at, originalFirst.claimed_at, '已领取记录的领取时间被改写');
});

test('重复点击一键领取不重复发放', () => {
  const season = seasonOf();
  const cores = getCores(ALL_TOKEN);
  const shards = getSeasonShards(ALL_TOKEN);

  const firstPass = claimAllSeasonPassMilestones(ALL_TOKEN);
  assert.equal(firstPass.ok, true);
  assert.equal(firstPass.claimedCount, SEASON_PASS_MILESTONES.length);
  assert.equal(getCores(ALL_TOKEN), cores + 120);
  assert.equal(getSeasonShards(ALL_TOKEN), shards + 15);

  const secondPass = claimAllSeasonPassMilestones(ALL_TOKEN);
  assert.equal(secondPass.ok, true);
  assert.equal(secondPass.claimedCount, 0);
  assert.equal(secondPass.alreadyClaimed, true);
  assert.deepEqual(secondPass.awarded, []);
  assert.equal(getCores(ALL_TOKEN), cores + 120, '重复点击重复发放了星核');
  assert.equal(getSeasonShards(ALL_TOKEN), shards + 15, '重复点击重复发放了皮肤碎片');
  assert.equal(claimRows(ALL_TOKEN, season).length, SEASON_PASS_MILESTONES.length);
});

test('无未领取里程碑时一键领取是空操作', () => {
  const result = claimAllSeasonPassMilestones(EMPTY_TOKEN);
  assert.equal(result.ok, true);
  assert.equal(result.claimedCount, 0);
  assert.equal(result.alreadyClaimed, true);
  assert.equal(getCores(EMPTY_TOKEN), 0);
});

test('发放中途失败时整批回滚，不留下半领取状态', () => {
  const [first, last] = [SEASON_PASS_MILESTONES[0], SEASON_PASS_MILESTONES.at(-1)];
  const season = seasonOf();

  const firstClaim = claimSeasonPassMilestone(ROLLBACK_TOKEN, first.id);
  assert.equal(firstClaim.ok, true);

  const beforeCores = getCores(ROLLBACK_TOKEN);
  const beforeShards = getSeasonShards(ROLLBACK_TOKEN);
  const beforeRows = claimRows(ROLLBACK_TOKEN, season);

  // 在最后一个里程碑落领取行前制造数据库错误，验证整个事务回滚。
  db.exec(`
    CREATE TRIGGER v45_claim_all_fail
    BEFORE INSERT ON account_season_pass_claims
    WHEN NEW.account_id = '${ROLLBACK_TOKEN}' AND NEW.milestone_id = '${last.id}'
    BEGIN
      SELECT RAISE(ABORT, 'simulated claim-all failure');
    END;
  `);

  try {
    assert.throws(
      () => claimAllSeasonPassMilestones(ROLLBACK_TOKEN),
      /simulated claim-all failure/
    );
  } finally {
    db.exec('DROP TRIGGER v45_claim_all_fail');
  }

  assert.equal(getCores(ROLLBACK_TOKEN), beforeCores, '回滚后星核被改动');
  assert.equal(getSeasonShards(ROLLBACK_TOKEN), beforeShards, '回滚后皮肤碎片被改动');
  assert.deepEqual(
    claimRows(ROLLBACK_TOKEN, season),
    beforeRows,
    '回滚后仍有里程碑处于已领取状态'
  );

  // 错误解除后可继续一键领取剩余里程碑，说明回滚没有破坏幂等键。
  const retry = claimAllSeasonPassMilestones(ROLLBACK_TOKEN);
  assert.equal(retry.ok, true);
  assert.equal(retry.claimedCount, SEASON_PASS_MILESTONES.length - 1);
  assert.ok(retry.awarded.some((item) => item.id === last.id));
});

test('接口：未登录拒绝，空进度幂等成功，部分领取后只补剩余', async () => {
  const anonymous = await api('/api/season-pass/claim-all', { method: 'POST' });
  assert.equal(anonymous.status, 401);

  const empty = await api('/api/season-pass/claim-all', {
    method: 'POST',
    token: EMPTY_TOKEN,
  });
  assert.equal(empty.status, 200);
  assert.equal(empty.data.claimedCount, 0);
  assert.equal(empty.data.alreadyClaimed, true);

  const serverDb = new DatabaseSync(SERVER_DB);
  try {
    serverDb.exec('PRAGMA busy_timeout = 5000;');

    await api('/api/season-pass', { token: ALL_TOKEN });
    const allAccountId = legacyAccountId(serverDb, ALL_TOKEN);
    assert.ok(allAccountId, '未创建旧令牌账号');
    insertFinishedRun(serverDb, { id: 'ca-http-all', accountId: allAccountId, score: 180000 });

    const claimed = await api('/api/season-pass/claim-all', { method: 'POST', token: ALL_TOKEN });
    assert.equal(claimed.status, 200);
    assert.equal(claimed.data.claimedCount, SEASON_PASS_MILESTONES.length);
    assert.equal(claimed.data.wallet.cores, 120);
    assert.equal(claimed.data.wallet.shards, 15);

    const again = await api('/api/season-pass/claim-all', { method: 'POST', token: ALL_TOKEN });
    assert.equal(again.status, 200);
    assert.equal(again.data.claimedCount, 0);
    assert.equal(again.data.wallet.cores, 120, '接口重复点击重复发放');

    const summary = await api('/api/season-pass', { token: ALL_TOKEN });
    assert.equal(summary.status, 200);
    assert.equal(summary.data.claimableCount, 0);
    assert.equal(summary.data.claimedCount, SEASON_PASS_MILESTONES.length);

    await api('/api/season-pass', { token: PARTIAL_TOKEN });
    const partialAccountId = legacyAccountId(serverDb, PARTIAL_TOKEN);
    insertFinishedRun(serverDb, {
      id: 'ca-http-partial',
      accountId: partialAccountId,
      score: 60000,
    });
    const single = await api('/api/season-pass/claim', {
      method: 'POST',
      token: PARTIAL_TOKEN,
      body: { id: SEASON_PASS_MILESTONES[0].id },
    });
    assert.equal(single.status, 200);
    assert.equal(single.data.claimed, true);

    const rest = await api('/api/season-pass/claim-all', {
      method: 'POST',
      token: PARTIAL_TOKEN,
    });
    assert.equal(rest.status, 200);
    assert.equal(rest.data.claimedCount, 2);
    assert.equal(rest.data.wallet.cores, 60);
    assert.equal(rest.data.wallet.shards, 5);
  } finally {
    serverDb.close();
  }
});

test('一键领取按钮、角标与减少动效接线齐备', () => {
  assert.match(SEASON_PASS_ROUTES, /'\/api\/season-pass\/claim-all'/, '缺少一键领取路由');
  assert.match(SEASON_PASS_ROUTES, /claimAllSeasonPassMilestones/, '路由未调用一键领取逻辑');
  assert.match(SEASON_PASS_ROUTES, /claimAll\(ctx\)/, '缺少一键领取处理器');

  assert.match(SEASON_PASS_UI, /\/api\/season-pass\/claim-all/, '界面未调用一键领取接口');
  assert.match(SEASON_PASS_UI, /season-pass-claim-all-btn/, '缺少一键领取按钮');
  assert.match(SEASON_PASS_UI, /button\.disabled = count === 0/, '无未领取时按钮未禁用');
  assert.match(SEASON_PASS_UI, /claimableCount/, '未展示未领取总数');
  assert.match(SEASON_PASS_UI, /season-pass-badge/, '入口缺少未领取角标');
  assert.match(SEASON_PASS_UI, /prefers-reduced-motion/, '未处理减少动效偏好');
  assert.match(SEASON_PASS_UI, /data-milestone/, '领取动效缺少里程碑定位标记');
  assert.match(SEASON_PASS_UI, /\.animate\(/, '缺少领取动效');
  assert.match(SEASON_PASS_UI, /credentials: 'same-origin'/, '请求未携带同源凭据');
});
