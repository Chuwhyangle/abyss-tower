// 每日挑战：日期派生、词缀组合、连续参与天数与每日次数上限。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startServer } from './test-server.mjs';

import {
  dailyChallenge,
  dailySeed,
  dailyStreak,
  dayKey,
  isDayKey,
  shiftDay,
} from '../public/js/shared/scoring.js';
import { FIXED_TRAITS } from '../public/js/shared/maps/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let PORT = 0;
let BASE = '';
const DB = path.join(os.tmpdir(), `rtd-daily-test-${process.pid}-${Date.now()}.db`);
const TOKEN = 'daily-test-token-0001';

const DAYS = Array.from({ length: 14 }, (_, index) => shiftDay('2026-10-20', index));

let server = null;

async function api(pathname, { method = 'GET', body } = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      'x-player-token': TOKEN,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

function startDaily(difficulty = 'roam') {
  return api('/api/runs', { method: 'POST', body: { mode: 'daily', difficulty } });
}

before(async () => {
  server = await startServer({
    cwd: ROOT,
    dbPath: DB,
    env: { AUTH_ENABLED: '0' },
  });
  PORT = server.port;
  BASE = server.base;
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

test('同一日期派生结果稳定', () => {
  const first = dailyChallenge('2026-10-23');
  const second = dailyChallenge('2026-10-23');
  assert.deepEqual(first, second);
  assert.equal(first.day, '2026-10-23');
  assert.equal(first.seed, 'daily-2026-10-23');
  assert.equal(dailySeed('2026-10-23'), first.seed);
});

test('不同日期派生不同种子，词缀固定为地图 trait', () => {
  const seeds = new Set(DAYS.map((day) => dailyChallenge(day).seed));
  assert.equal(seeds.size, DAYS.length);

  // 固定地图后，词缀不再随日期变化：始终是 twin/ring 的固定 trait。
  const combos = new Set(
    DAYS.map((day) => dailyChallenge(day).modifiers.map((modifier) => modifier.id).join(','))
  );
  assert.equal(combos.size, 1, '固定地图的 trait 不随日期变化');
  assert.equal([...combos][0], 'trade,echo');
});

test('词缀组合来自固定地图 trait 且不重复', () => {
  const allowed = new Map(FIXED_TRAITS.map((modifier) => [modifier.id, modifier]));
  for (const day of DAYS) {
    const { modifiers } = dailyChallenge(day);
    assert.equal(modifiers.length, FIXED_TRAITS.length);
    const ids = modifiers.map((modifier) => modifier.id);
    assert.equal(new Set(ids).size, ids.length, `词缀重复：${ids.join(',')}`);
    for (const modifier of modifiers) {
      const source = allowed.get(modifier.id);
      assert.ok(source, `未知词缀：${modifier.id}`);
      assert.equal(modifier.name, source.name);
      assert.equal(modifier.desc, source.desc);
      assert.equal(modifier.color, source.color);
    }
  }
});

test('日期使用服务器本地时区，跨午夜边界正确', () => {
  assert.equal(dayKey(new Date(2026, 9, 22, 23, 59, 59, 999)), '2026-10-22');
  assert.equal(dayKey(new Date(2026, 9, 23, 0, 0, 0, 0)), '2026-10-23');
  assert.equal(dayKey(new Date(2026, 0, 1, 0, 0, 0, 0)), '2026-01-01');
  assert.equal(dayKey(new Date(2026, 11, 31, 23, 59, 59, 999)), '2026-12-31');

  // 与运行环境的本地日历一致（而非 UTC 日期）。
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const localFormat = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  for (const instant of [
    Date.UTC(2026, 9, 22, 15, 59, 59),
    Date.UTC(2026, 9, 22, 16, 0, 0),
    Date.UTC(2026, 9, 23, 15, 59, 59),
  ]) {
    const date = new Date(instant);
    assert.equal(dayKey(date), localFormat.format(date));
  }

  assert.ok(isDayKey('2026-02-28'));
  assert.ok(!isDayKey('2026-02-30'));
  assert.ok(!isDayKey('2026-2-3'));
  assert.ok(!isDayKey(''));
  assert.throws(() => dailySeed('2026-13-01'), TypeError);
  assert.throws(() => shiftDay('not-a-day', 1), TypeError);
});

test('连续参与天数按日历连续计算', () => {
  assert.equal(dailyStreak([], '2026-10-23'), 0);
  assert.equal(dailyStreak(['2026-10-23'], '2026-10-23'), 1);
  assert.equal(dailyStreak(['2026-10-21', '2026-10-22', '2026-10-23'], '2026-10-23'), 3);
  // 今天尚未参与时，从昨天向前保留连续记录。
  assert.equal(dailyStreak(['2026-10-21', '2026-10-22'], '2026-10-23'), 2);
  // 断档只统计最近一段。
  assert.equal(dailyStreak(['2026-10-20', '2026-10-22', '2026-10-23'], '2026-10-23'), 2);
  // 跨月连续。
  assert.equal(dailyStreak(['2026-09-30', '2026-10-01'], '2026-10-01'), 2);
  // 未来日期不计入当前连续天数。
  assert.equal(dailyStreak(['2026-10-25'], '2026-10-23'), 0);
});

test('每日挑战开局参数可复现，每日次数上限生效', async () => {
  const session = await api('/api/session', { method: 'POST', body: {} });
  assert.equal(session.status, 200);
  const challenge = dailyChallenge(dayKey());
  assert.equal(session.data.dailyAttemptsLeft, 3);
  assert.equal(session.data.daily.seed, challenge.seed);
  assert.equal(session.data.daily.streak, 0);

  let dailySeedSeen = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const started = await startDaily('roam');
    assert.equal(started.status, 200);
    assert.equal(started.data.mode, 'daily');
    assert.equal(started.data.seed, challenge.seed);
    assert.equal(started.data.daily.seed, challenge.seed);
    assert.equal(started.data.daily.day, dayKey());
    assert.deepEqual(
      started.data.daily.modifiers.map((modifier) => modifier.id),
      challenge.modifiers.map((modifier) => modifier.id)
    );
    // 当日词缀与固定候选地图的 trait 一致（canyon 无 trait，不计入）。
    assert.deepEqual(
      started.data.candidates.map((candidate) => candidate.modifier?.id).filter(Boolean),
      challenge.modifiers.map((modifier) => modifier.id)
    );
    // 开局即计入连续参与天数。
    assert.equal(started.data.daily.streak, 1);
    if (dailySeedSeen == null) dailySeedSeen = started.data.seed;
    else assert.equal(started.data.seed, dailySeedSeen);

    const finished = await api(`/api/runs/${started.data.runId}/finish`, {
      method: 'POST',
      body: { waveReached: 0, kills: 0, goldLeft: 0, baseHp: 17 },
    });
    assert.equal(finished.status, 200);
    assert.equal(finished.data.dailyAttemptsLeft, 3 - attempt);
  }

  const blocked = await startDaily('roam');
  assert.equal(blocked.status, 429);

  const after = await api('/api/session', { method: 'POST', body: {} });
  assert.equal(after.data.dailyAttemptsLeft, 0);
  assert.equal(after.data.daily.streak, 1);

  // 排行榜结构不变：每日榜仍按 (mode=daily, day) 合并三档难度。
  const board = await api('/api/leaderboard?mode=daily');
  assert.equal(board.status, 200);
  assert.equal(board.data.mode, 'daily');
  assert.equal(board.data.day, dayKey());
  assert.ok(board.data.entries.length >= 1);
});
