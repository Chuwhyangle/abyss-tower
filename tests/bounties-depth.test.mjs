// 悬赏深度：40+ 目标池、三档难度分层、每周一次刷新、同周期可复现与旧进度保留。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import {
  BOUNTIES_PER_PERIOD,
  BOUNTY_BY_ID,
  BOUNTY_METRICS,
  BOUNTY_PERIODS,
  BOUNTY_POOL,
  BOUNTY_REFRESH_LIMIT,
  BOUNTY_REWARDS,
  BOUNTY_TEMPLATES,
  BOUNTY_TIERS,
  BOUNTY_TIER_LABELS,
  bountyPeriodKey,
  bountyProgress,
  bountyReward,
  deriveBounties,
} from '../public/js/shared/bounties.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UNIT_DB = path.join(os.tmpdir(), `rtd-bounty-depth-unit-${process.pid}-${Date.now()}.db`);
const SERVER_DB = path.join(os.tmpdir(), `rtd-bounty-depth-server-${process.pid}-${Date.now()}.db`);
const PORT = 18800 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;

const REFRESH_TOKEN = 'bounty-depth-refresh-01';
const PRESERVE_TOKEN = 'bounty-depth-preserve-01';
const API_TOKEN = 'bounty-depth-api-0001';

// 固定在 2026-10-21（周三）中午，避免跨日/跨周抖动。
const NOW = new Date(2026, 9, 21, 12, 0, 0).getTime();
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const read = (relative) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const BOUNTIES_UI = read('public/js/bounties-ui.js');

let db = null;
let createProfile = null;
let bountySummary = null;
let refreshBounties = null;

let server = null;
let serverLog = '';

function removeDb(file) {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(`${file}${suffix}`, { force: true });
    } catch {
      /* ignore */
    }
  }
}

function insertFinishedRun({
  id,
  accountId,
  difficulty = 'standard',
  victory = 1,
  wave = 30,
  kills = 200,
  score = 50000,
  baseHpStart = 20,
  baseHpLeft = 20,
  createdAt = NOW,
}) {
  db.prepare(
    `INSERT INTO runs
       (id, account_id, mode, board_key, difficulty, seed, day, content_version,
        ruleset_json, waves_served, cleared_waves, map_choice, relics, offers,
        rerolls_used, status, victory, score, wave_reached, kills, duration_ms,
        result_json, created_at, finished_at)
     VALUES (?, ?, 'normal', 'normal', ?, ?, ?, 'v1.4-map2', ?, ?, ?, -1, '[]', '{}',
             0, 'finished', ?, ?, ?, ?, 60000, ?, ?, ?)`
  ).run(
    id,
    accountId,
    difficulty,
    `seed-${id}`,
    '2026-10-21',
    JSON.stringify({ meta: { baseHp: baseHpStart } }),
    wave,
    wave,
    victory ? 1 : 0,
    score,
    wave,
    kills,
    JSON.stringify({ baseHp: baseHpLeft }),
    createdAt,
    createdAt + 60000
  );
}

function seedAccount(accountId) {
  const now = NOW;
  db.prepare(
    `INSERT INTO accounts (id, kind, created_at, updated_at)
     VALUES (?, 'unclaimed', ?, ?)`
  ).run(accountId, now, now);
  createProfile(accountId);
}

async function api(pathname, { method = 'GET', token = API_TOKEN } = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers: token ? { 'x-player-token': token } : {},
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

before(async () => {
  process.env.DB_PATH = UNIT_DB;
  process.env.DB_BACKUP = '0';
  ({ db } = await import('../server/db/index.mjs'));
  ({ createProfile } = await import('../server/db.mjs'));
  ({ bountySummary, refreshBounties } = await import('../server/db/bounties.mjs'));

  seedAccount(REFRESH_TOKEN);
  seedAccount(PRESERVE_TOKEN);

  // 本周内的对局：普通/深渊各若干局，供进度指标使用。
  insertFinishedRun({ id: 'depth-run-0', accountId: REFRESH_TOKEN });
  insertFinishedRun({ id: 'depth-run-1', accountId: REFRESH_TOKEN, difficulty: 'abyss' });

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

test('目标池扩到 40+，三档难度各有足够候选且 id 唯一', () => {
  assert.ok(BOUNTY_POOL.length >= 40, `目标池只有 ${BOUNTY_POOL.length} 条`);
  assert.equal(BOUNTY_POOL.length, BOUNTY_TEMPLATES.length * BOUNTY_TIERS.length);
  assert.equal(new Set(BOUNTY_POOL.map((item) => item.id)).size, BOUNTY_POOL.length);

  for (const tier of BOUNTY_TIERS) {
    const candidates = BOUNTY_POOL.filter((item) => item.tier === tier);
    assert.ok(candidates.length >= BOUNTIES_PER_PERIOD, `${tier} 候选不足`);
    for (const item of candidates) {
      assert.equal(BOUNTY_BY_ID[item.id], item);
      assert.equal(item.tier, tier);
      assert.ok(item.targets.daily > 0 && item.targets.weekly > 0 && item.targets.season > 0);
    }
  }
});

test('难度分层：同模板目标递增，奖励与难度挂钩且集中定义', () => {
  for (const template of BOUNTY_TEMPLATES) {
    for (const period of BOUNTY_PERIODS) {
      const normal = BOUNTY_BY_ID[template.key].targets[period];
      const challenge = BOUNTY_BY_ID[`${template.key}:challenge`].targets[period];
      const extreme = BOUNTY_BY_ID[`${template.key}:extreme`].targets[period];
      assert.ok(normal < challenge && challenge < extreme, `${template.key}/${period} 目标未递增`);
    }
  }

  for (const period of BOUNTY_PERIODS) {
    const normal = bountyReward(period, 'normal');
    const challenge = bountyReward(period, 'challenge');
    const extreme = bountyReward(period, 'extreme');
    assert.equal(normal, BOUNTY_REWARDS[period]);
    assert.ok(challenge > normal && extreme > challenge, `${period} 奖励未随难度递增`);
  }

  for (const period of BOUNTY_PERIODS) {
    const key = bountyPeriodKey(period, NOW);
    for (const bounty of deriveBounties(period, key)) {
      assert.equal(bounty.reward, bountyReward(period, bounty.tier));
      assert.equal(bounty.tierLabel, BOUNTY_TIER_LABELS[bounty.tier]);
    }
  }
});

test('每个周期三档各一条，同代数可复现，刷新后代数必换集合', () => {
  for (const period of BOUNTY_PERIODS) {
    const key = bountyPeriodKey(period, NOW);
    const first = deriveBounties(period, key, 0);
    const again = deriveBounties(period, key, 0);
    assert.deepEqual(first, again, `${period} 同代数派生不稳定`);
    assert.equal(first.length, BOUNTY_TIERS.length);
    assert.deepEqual(
      first.map((bounty) => bounty.tier),
      BOUNTY_TIERS
    );

    for (const bounty of first) {
      assert.ok(BOUNTY_BY_ID[bounty.id], `未知目标：${bounty.id}`);
      assert.equal(bounty.period, period);
      assert.equal(bounty.periodKey, key);
      assert.ok(bounty.desc.includes(String(bounty.target)));
    }

    const refreshed = deriveBounties(period, key, 1);
    assert.notDeepEqual(
      refreshed.map((bounty) => bounty.id),
      first.map((bounty) => bounty.id),
      `${period} 刷新代数未改变集合`
    );
    assert.deepEqual(
      deriveBounties(period, key, 1).map((bounty) => bounty.id),
      refreshed.map((bounty) => bounty.id)
    );
  }
});

test('进度指标可由既有对局字段计算，覆盖新增目标', () => {
  const runs = [
    { victory: true, difficulty: 'abyss', waveReached: 30, kills: 200, score: 90000, baseHpStart: 20, baseHpLeft: 20 },
    { victory: true, difficulty: 'standard', waveReached: 22, kills: 90, score: 12000, baseHpStart: 20, baseHpLeft: 15 },
    { victory: false, difficulty: 'standard', waveReached: 12, kills: 50, score: 40000, baseHpStart: 20, baseHpLeft: 0 },
  ];
  const at = (metric) => bountyProgress({ metric, target: 1_000_000 }, runs).current;

  assert.equal(at('abyssRuns'), 1);
  assert.equal(at('standardWins'), 1);
  assert.equal(at('bigScoreRuns'), 2);
  assert.equal(at('deepRuns'), 2);
  assert.equal(at('totalScore'), 142000);
  assert.equal(at('totalWaves'), 64);
  for (const template of BOUNTY_TEMPLATES) {
    assert.equal(typeof BOUNTY_METRICS[template.metric], 'function', `缺少指标 ${template.metric}`);
  }
});

test('每周刷新限一次：首次成功、再次拒绝、跨周重置', () => {
  const before = bountySummary(REFRESH_TOKEN, NOW);
  assert.equal(before.refresh.limit, BOUNTY_REFRESH_LIMIT);
  assert.equal(before.refresh.used, 0);
  assert.equal(before.refresh.remaining, 1);
  const weeklyBefore = before.periods.find((period) => period.period === 'weekly');

  const first = refreshBounties(REFRESH_TOKEN, NOW);
  assert.equal(first.ok, true);
  assert.equal(first.refreshCount, 1);
  assert.equal(first.remaining, 0);
  const weeklyAfter = first.summary.periods.find((period) => period.period === 'weekly');
  assert.notDeepEqual(
    weeklyAfter.bounties.map((bounty) => bounty.id),
    weeklyBefore.bounties.map((bounty) => bounty.id),
    '刷新后周悬赏集合未变化'
  );

  const second = refreshBounties(REFRESH_TOKEN, NOW);
  assert.equal(second.ok, false);
  assert.equal(second.code, 'REFRESH_LIMIT');
  assert.equal(second.remaining, 0);

  const listed = bountySummary(REFRESH_TOKEN, NOW);
  assert.equal(listed.refresh.used, 1);
  assert.equal(listed.refresh.remaining, 0);

  const nextWeek = refreshBounties(REFRESH_TOKEN, NOW + WEEK_MS);
  assert.equal(nextWeek.ok, true, '跨周后应重新获得一次刷新');
  assert.equal(nextWeek.refreshCount, 1);
});

test('刷新不删除旧行：已领取状态与历史进度原样保留', () => {
  const key = bountyPeriodKey('weekly', NOW);
  const claimedAt = NOW - 5000;
  db.prepare(
    `INSERT INTO account_bounties
       (account_id, period, period_key, bounty_id, target, progress, claimed_at, updated_at)
     VALUES (?, 'weekly', ?, 'veteran', 8, 9, ?, ?)`
  ).run(PRESERVE_TOKEN, key, claimedAt, claimedAt);

  const result = refreshBounties(PRESERVE_TOKEN, NOW);
  assert.equal(result.ok, true);

  const row = db
    .prepare(
      `SELECT target, progress, claimed_at FROM account_bounties
        WHERE account_id = ? AND period = 'weekly' AND period_key = ? AND bounty_id = 'veteran'`
    )
    .get(PRESERVE_TOKEN, key);
  assert.ok(row, '刷新后旧行被删除');
  assert.equal(Number(row.progress), 9);
  assert.equal(Number(row.claimed_at), claimedAt);
});

test('接口：刷新一次成功、第二次 409、未登录 401', async () => {
  const anonymous = await api('/api/bounties/refresh', { method: 'POST', token: null });
  assert.equal(anonymous.status, 401);

  const listed = await api('/api/bounties');
  assert.equal(listed.status, 200);
  assert.equal(listed.data.refresh.remaining, 1);
  const weeklyBefore = listed.data.periods.find((period) => period.period === 'weekly');

  const refreshed = await api('/api/bounties/refresh', { method: 'POST' });
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.data.ok, true);
  assert.equal(refreshed.data.summary.refresh.remaining, 0);
  const weeklyAfter = refreshed.data.summary.periods.find((period) => period.period === 'weekly');
  assert.notDeepEqual(
    weeklyAfter.bounties.map((bounty) => bounty.id),
    weeklyBefore.bounties.map((bounty) => bounty.id)
  );

  const again = await api('/api/bounties/refresh', { method: 'POST' });
  assert.equal(again.status, 409);
  assert.equal(again.data.code, 'REFRESH_LIMIT');
});

test('大厅悬赏面板：刷新按钮、确认与接口接线齐备', () => {
  assert.match(BOUNTIES_UI, /data-refresh=/, '缺少刷新按钮标记');
  assert.match(BOUNTIES_UI, /\/api\/bounties\/refresh/, '刷新未走悬赏接口');
  assert.match(BOUNTIES_UI, /window\.confirm/, '刷新缺少确认');
  assert.match(BOUNTIES_UI, /credentials: 'same-origin'/, '刷新请求未携带同源凭据');
  assert.match(BOUNTIES_UI, /本周已刷新/, '缺少已刷新状态');
  assert.match(BOUNTIES_UI, /tierLabel/, '未展示难度分层');
});
