// 悬赏任务：周期派生稳定、进度计算、边界时区、幂等领取与非法领取拒绝。
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
  BOUNTY_PERIODS,
  BOUNTY_REWARDS,
  bountyPeriodBounds,
  bountyPeriodKey,
  bountyProgress,
  bountyReward,
  deriveBounties,
} from '../public/js/shared/bounties.js';
import { weekKey } from '../public/js/shared/scoring.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UNIT_DB = path.join(os.tmpdir(), `rtd-bounties-unit-${process.pid}-${Date.now()}.db`);
const SERVER_DB = path.join(os.tmpdir(), `rtd-bounties-server-${process.pid}-${Date.now()}.db`);
const PORT = 19700 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'bounties-test-token-01';
const EMPTY_TOKEN = 'bounties-test-token-02';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const BOUNTIES_UI = read('public/js/bounties-ui.js');
const INDEX_HTML = read('public/index.html');

let db = null;
let createProfile = null;
let getCores = null;
let bountySummary = null;
let claimBounty = null;

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

// 直接写入已完成对局，覆盖进度计算所需字段（与结算写入的形状一致）。
function insertFinishedRun({
  id,
  accountId = TOKEN,
  difficulty = 'standard',
  victory = 1,
  wave = 30,
  kills = 200,
  score = 50000,
  baseHpStart = 20,
  baseHpLeft = 20,
  createdAt = Date.now(),
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
    '2026-10-24',
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
  const now = Date.now();
  db.prepare(
    `INSERT INTO accounts (id, kind, created_at, updated_at)
     VALUES (?, 'unclaimed', ?, ?)`
  ).run(accountId, now, now);
  createProfile(accountId);
}

async function api(pathname, { method = 'GET', token = TOKEN } = {}) {
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
  ({ createProfile, getCores } = await import('../server/db.mjs'));
  ({ bountySummary, claimBounty } = await import('../server/db/bounties.mjs'));

  seedAccount(TOKEN);
  seedAccount(EMPTY_TOKEN);

  // 三局完整通关：runs / wins / maxKills / maxWave / maxScore / flawless 等指标均达成。
  for (let i = 0; i < 3; i++) insertFinishedRun({ id: `run-${i}` });
  // 再加一局深渊通关：让「通关深渊」类目标也能完成，避免每日目标随派生结果不可领取。
  insertFinishedRun({ id: 'run-abyss', difficulty: 'abyss' });

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

test('同一周期派生稳定，且目标数、目标池与奖励集中定义', () => {
  for (const period of BOUNTY_PERIODS) {
    const key = bountyPeriodKey(period);
    const first = deriveBounties(period, key);
    const second = deriveBounties(period, key);
    assert.deepEqual(first, second, `${period} 派生不稳定`);
    assert.equal(first.length, BOUNTIES_PER_PERIOD);
    assert.equal(new Set(first.map((item) => item.id)).size, BOUNTIES_PER_PERIOD);

    for (const bounty of first) {
      assert.ok(BOUNTY_BY_ID[bounty.id], `未知目标：${bounty.id}`);
      assert.equal(bounty.period, period);
      assert.equal(bounty.periodKey, key);
      assert.equal(bounty.reward, bountyReward(period, bounty.tier));
      assert.ok(bounty.reward >= BOUNTY_REWARDS[period]);
      assert.ok(bounty.target > 0);
      assert.ok(bounty.desc.includes(String(bounty.target)));
    }
  }
});

test('周期键与区间使用服务器本地时区', () => {
  const local = new Date(2026, 9, 24, 15, 30, 0);
  const ts = local.getTime();

  assert.equal(bountyPeriodKey('daily', ts), '2026-10-24');
  assert.equal(bountyPeriodKey('weekly', ts), weekKey(local));
  assert.equal(bountyPeriodKey('season', ts), '2026-10');

  const day = bountyPeriodBounds('daily', ts);
  assert.equal(day.start, new Date(2026, 9, 24).getTime());
  assert.equal(day.end, new Date(2026, 9, 25).getTime());

  const week = bountyPeriodBounds('weekly', ts);
  assert.equal(new Date(week.start).getDay(), 1, '周区间应从本地周一零点开始');
  assert.equal(new Date(week.start).getHours(), 0);
  assert.equal(week.end - week.start, 7 * 24 * 60 * 60 * 1000);
  assert.ok(ts >= week.start && ts < week.end);

  const season = bountyPeriodBounds('season', ts);
  assert.equal(season.start, new Date(2026, 9, 1).getTime());
  assert.equal(season.end, new Date(2026, 10, 1).getTime());

  assert.equal(bountyPeriodKey('unknown', ts), null);
  assert.equal(bountyPeriodBounds('unknown', ts), null);
});

test('进度指标只依赖既有对局数据', () => {
  const runs = [
    { victory: true, difficulty: 'abyss', waveReached: 30, kills: 200, score: 90000, baseHpStart: 20, baseHpLeft: 20 },
    { victory: false, difficulty: 'standard', waveReached: 12, kills: 50, score: 12000, baseHpStart: 20, baseHpLeft: 0 },
    { victory: true, difficulty: 'standard', waveReached: 22, kills: 90, score: 30000, baseHpStart: 20, baseHpLeft: 15 },
  ];
  const at = (metric, target = 1_000_000) => bountyProgress({ metric, target }, runs);

  assert.deepEqual(at('runs'), { current: 3, target: 1_000_000 });
  assert.deepEqual(at('wins'), { current: 2, target: 1_000_000 });
  assert.deepEqual(at('maxKills'), { current: 200, target: 1_000_000 });
  assert.deepEqual(at('maxWave'), { current: 30, target: 1_000_000 });
  assert.deepEqual(at('maxScore'), { current: 90000, target: 1_000_000 });
  assert.deepEqual(at('totalKills'), { current: 340, target: 1_000_000 });
  assert.deepEqual(at('flawlessWins'), { current: 1, target: 1_000_000 });
  assert.deepEqual(at('abyssWins'), { current: 1, target: 1_000_000 });

  // 进度封顶到目标值，缺失指标返回 0。
  assert.deepEqual(at('totalKills', 100), { current: 100, target: 100 });
  assert.deepEqual(bountyProgress({ metric: 'missing', target: 5 }, runs), {
    current: 0,
    target: 5,
  });
});

test('汇总返回三个周期，每个周期三个目标并落库进度', () => {
  const summary = bountySummary(TOKEN);
  assert.equal(summary.periods.length, BOUNTY_PERIODS.length);

  for (const period of summary.periods) {
    assert.ok(BOUNTY_PERIODS.includes(period.period));
    assert.equal(period.key, bountyPeriodKey(period.period));
    assert.equal(period.bounties.length, BOUNTIES_PER_PERIOD);
    for (const bounty of period.bounties) {
      assert.equal(bounty.reward, bountyReward(period.period, bounty.tier));
      assert.equal(bounty.claimed, false);
      const row = db
        .prepare(
          `SELECT target, progress, claimed_at FROM account_bounties
            WHERE account_id = ? AND period = ? AND period_key = ? AND bounty_id = ?`
        )
        .get(TOKEN, period.period, period.key, bounty.id);
      assert.ok(row, `${period.period}/${bounty.id} 未落库`);
      assert.equal(Number(row.target), bounty.target);
      assert.equal(Number(row.progress), bounty.progress);
      assert.equal(row.claimed_at, null);
    }
  }

  // 既有对局足够让至少一个每日目标完成（唯一无法用标准通关完成的是深渊通关）。
  const daily = summary.periods.find((period) => period.period === 'daily');
  assert.ok(daily.bounties.some((bounty) => bounty.complete), '每日目标无一完成');
});

test('领取发放星核，重复领取不重复发放', () => {
  const summary = bountySummary(TOKEN);
  const daily = summary.periods.find((period) => period.period === 'daily');
  const target = daily.bounties.find((bounty) => bounty.complete);
  assert.ok(target, '没有可领取的每日悬赏');
  assert.equal(target.claimed, false);

  const before = getCores(TOKEN);
  const first = claimBounty(TOKEN, target.id);
  assert.equal(first.ok, true);
  assert.equal(first.claimed, true);
  assert.equal(first.alreadyClaimed, false);
  assert.equal(first.awarded, target.reward);
  assert.equal(first.balance, before + target.reward);
  assert.equal(getCores(TOKEN), before + target.reward);

  const second = claimBounty(TOKEN, target.id);
  assert.equal(second.ok, true);
  assert.equal(second.claimed, false);
  assert.equal(second.alreadyClaimed, true);
  assert.equal(second.awarded, 0);
  assert.equal(getCores(TOKEN), before + target.reward, '重复领取重复发放了星核');

  const row = db
    .prepare(
      `SELECT claimed_at FROM account_bounties
        WHERE account_id = ? AND period = 'daily' AND period_key = ? AND bounty_id = ?`
    )
    .get(TOKEN, daily.key, target.id);
  assert.ok(row.claimed_at, '领取状态未落库');

  const after = bountySummary(TOKEN);
  const refreshed = after.periods
    .find((period) => period.period === 'daily')
    .bounties.find((bounty) => bounty.id === target.id);
  assert.equal(refreshed.claimed, true);
  assert.equal(refreshed.claimedAt, row.claimed_at);
});

test('未完成的目标与未知目标拒绝领取', () => {
  const summary = bountySummary(EMPTY_TOKEN);
  const daily = summary.periods.find((period) => period.period === 'daily');
  const anyBounty = daily.bounties[0];
  assert.equal(anyBounty.complete, false);

  const before = getCores(EMPTY_TOKEN);
  const incomplete = claimBounty(EMPTY_TOKEN, anyBounty.id);
  assert.equal(incomplete.ok, false);
  assert.equal(incomplete.code, 'BOUNTY_INCOMPLETE');
  assert.equal(getCores(EMPTY_TOKEN), before);

  const unknown = claimBounty(EMPTY_TOKEN, 'not-a-real-bounty');
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, 'UNKNOWN_BOUNTY');
});

test('接口：未登录 401，登录后返回周期结构且提单拒绝非法目标', async () => {
  const anonymous = await api('/api/bounties', { token: null });
  assert.equal(anonymous.status, 401);

  const listed = await api('/api/bounties');
  assert.equal(listed.status, 200);
  assert.deepEqual(
    listed.data.periods.map((period) => period.period),
    BOUNTY_PERIODS
  );
  for (const period of listed.data.periods) {
    assert.equal(period.bounties.length, BOUNTIES_PER_PERIOD);
    for (const bounty of period.bounties) {
      assert.ok(bounty.title);
      assert.equal(typeof bounty.progress, 'number');
      assert.equal(typeof bounty.target, 'number');
    }
  }

  const again = await api('/api/bounties');
  assert.deepEqual(
    again.data.periods.map((period) => period.bounties.map((bounty) => bounty.id)),
    listed.data.periods.map((period) => period.bounties.map((bounty) => bounty.id))
  );

  const missing = await api('/api/bounties/not-a-real-bounty/claim', { method: 'POST' });
  assert.equal(missing.status, 404);
  assert.equal(missing.data.code, 'UNKNOWN_BOUNTY');

  const incompleteBounty = listed.data.periods[0].bounties[0];
  const rejected = await api(`/api/bounties/${incompleteBounty.id}/claim`, { method: 'POST' });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.data.code, 'BOUNTY_INCOMPLETE');
});

test('大厅悬赏面板：入口、容器、进度与领取接线齐备', () => {
  assert.match(INDEX_HTML, /id="btn-bounties"/, '大厅缺少悬赏入口');
  assert.match(INDEX_HTML, /id="bounties-panel"/, '缺少悬赏面板容器');
  assert.match(INDEX_HTML, /src="\/js\/bounties-ui\.js"/, '悬赏面板脚本未加载');

  assert.match(BOUNTIES_UI, /#bounties-list/, '缺少悬赏列表容器');
  assert.match(BOUNTIES_UI, /function escapeHtml/, '缺少 HTML 转义');
  assert.match(BOUNTIES_UI, /role="progressbar"/, '进度条缺少可访问性角色');
  assert.match(BOUNTIES_UI, /data-claim=/, '缺少领取按钮标记');
  assert.match(BOUNTIES_UI, /\/api\/bounties\//, '领取未走悬赏接口');
  assert.match(BOUNTIES_UI, /credentials: 'same-origin'/, '请求未携带同源凭据');
  assert.match(BOUNTIES_UI, /response\.status === 401/, '未处理未登录');
  assert.match(BOUNTIES_UI, /item\.claimed/, '未展示领取状态');
});
