// 本周挑战：ISO 周键、派生稳定、独立榜单与每周次数上限。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { allocatePort, waitForHealth } from './test-server.mjs';

import {
  WEEKLY_MODIFIER_COUNT,
  WEEKLY_SKILL_LEVEL,
  isWeekKey,
  weekKey,
  weeklyChallenge,
  weeklySeed,
} from '../public/js/shared/scoring.js';
import { MAP_MODIFIERS, generateMapCandidates } from '../public/js/shared/mapgen.js';
import { TOWER_ORDER } from '../public/js/shared/data.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = await allocatePort();
const BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join(os.tmpdir(), `rtd-weekly-test-${process.pid}-${Date.now()}.db`);
const TOKEN = 'weekly-test-token-0001';

let server = null;
let serverLog = '';

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

function startWeekly(difficulty = 'roam') {
  return api('/api/runs', { method: 'POST', body: { mode: 'weekly', difficulty } });
}

function finish(runId) {
  return api(`/api/runs/${runId}/finish`, {
    method: 'POST',
    body: { waveReached: 0, kills: 0, goldLeft: 0, baseHp: 17 },
  });
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

  await waitForHealth({ base: BASE, port: PORT, child: server, log: () => serverLog });
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

test('ISO 周键：周一为一周开始，跨年归属 ISO 周年', () => {
  assert.equal(weekKey(new Date(2025, 11, 28)), '2025-W52'); // 周日
  assert.equal(weekKey(new Date(2025, 11, 29)), '2026-W01'); // 周一，跨年
  assert.equal(weekKey(new Date(2026, 0, 1)), '2026-W01');
  assert.equal(weekKey(new Date(2026, 0, 4)), '2026-W01'); // 周日
  assert.equal(weekKey(new Date(2026, 0, 5)), '2026-W02'); // 周一
  assert.equal(weekKey(new Date(2020, 11, 31)), '2020-W53');
  assert.equal(weekKey(new Date(2021, 0, 1)), '2020-W53'); // 跨年回落到上一 ISO 年
  assert.equal(weekKey(new Date(2024, 11, 29)), '2024-W52');
  assert.equal(weekKey(new Date(2024, 11, 30)), '2025-W01');

  assert.ok(isWeekKey('2026-W01'));
  assert.ok(isWeekKey('2020-W53'));
  assert.ok(!isWeekKey('2025-W53'));
  assert.ok(!isWeekKey('2026-W00'));
  assert.ok(!isWeekKey('2026-01'));
  assert.ok(!isWeekKey(''));
  assert.throws(() => weeklySeed('2026-01'), TypeError);
  assert.throws(() => weekKey(new Date('not-a-date')), TypeError);
});

test('同一周派生结果稳定，周词缀来自现有集合并与首张候选地图一致', () => {
  const challenge = weeklyChallenge(new Date(2026, 9, 21));
  // 同一 ISO 周的任意一天（周一 / 周日）派生完全一致。
  assert.deepEqual(challenge, weeklyChallenge(new Date(2026, 9, 19)));
  assert.deepEqual(challenge, weeklyChallenge(new Date(2026, 9, 25)));
  assert.equal(challenge.week, '2026-W43');
  assert.equal(challenge.seed, 'weekly-2026-W43');
  assert.equal(weeklySeed(challenge.week), challenge.seed);
  assert.deepEqual(challenge.rules, {
    towers: 'all',
    skillLevel: WEEKLY_SKILL_LEVEL,
    maxRerolls: 1,
  });

  assert.equal(challenge.modifiers.length, WEEKLY_MODIFIER_COUNT);
  const allowed = new Map(MAP_MODIFIERS.map((modifier) => [modifier.id, modifier]));
  const modifier = challenge.modifiers[0];
  const source = allowed.get(modifier.id);
  assert.ok(source, `未知词缀：${modifier.id}`);
  assert.equal(modifier.name, source.name);
  assert.equal(modifier.desc, source.desc);
  assert.equal(modifier.color, source.color);

  // 开局候选由同一种子派生，首图词缀即周词缀。
  const candidates = generateMapCandidates(challenge.seed, 3);
  assert.equal(candidates.length, 3);
  assert.equal(candidates[0].modifier.id, modifier.id);
});

test('本周挑战开局参数同周同账号可复现', async () => {
  const challenge = weeklyChallenge();
  const first = await startWeekly();
  assert.equal(first.status, 200);
  assert.equal(first.data.mode, 'weekly');
  assert.equal(first.data.seed, challenge.seed);
  assert.equal(first.data.day, challenge.week);
  assert.equal(first.data.weekly.week, challenge.week);
  assert.equal(first.data.weekly.seed, challenge.seed);
  assert.deepEqual(
    first.data.weekly.modifiers.map((item) => item.id),
    challenge.modifiers.map((item) => item.id)
  );
  // 固定规则：全塔开放、固定技能等级、固定资源与刷新次数。
  assert.equal(first.data.skill.level, WEEKLY_SKILL_LEVEL);
  assert.equal(first.data.startingGold, 260);
  assert.equal(first.data.baseHp, 20);
  assert.equal(first.data.maxRerolls, 1);
  assert.deepEqual([...first.data.towersUnlocked].sort(), [...TOWER_ORDER].sort());
  assert.equal(first.data.candidates.length, 3);
  assert.equal(first.data.candidates[0].modifier.id, challenge.modifiers[0].id);
  assert.equal(first.data.weeklyAttemptsLeft, 3);
  assert.equal((await finish(first.data.runId)).status, 200);

  const second = await startWeekly('standard');
  assert.equal(second.status, 200);
  for (const key of ['seed', 'startingGold', 'baseHp', 'maxRerolls', 'day']) {
    assert.equal(second.data[key], first.data[key], `${key} 应可复现`);
  }
  assert.deepEqual(second.data.skill, first.data.skill);
  assert.deepEqual(
    second.data.candidates.map((candidate) => [candidate.archetype, candidate.modifier?.id]),
    first.data.candidates.map((candidate) => [candidate.archetype, candidate.modifier?.id])
  );
  assert.equal((await finish(second.data.runId)).status, 200);
});

test('本周榜独立：不混入每日/普通榜，跨周隔离', async () => {
  const challenge = weeklyChallenge();
  const board = await api('/api/leaderboard?mode=weekly');
  assert.equal(board.status, 200);
  assert.equal(board.data.mode, 'weekly');
  assert.equal(board.data.week, challenge.week);
  assert.equal(board.data.day, challenge.week);
  assert.ok(board.data.entries.length >= 1);
  assert.ok(board.data.entries.some((entry) => entry.isMe));

  for (const mode of ['daily', 'normal']) {
    const other = await api(`/api/leaderboard?mode=${mode}`);
    assert.equal(other.status, 200);
    assert.equal(other.data.mode, mode);
    assert.ok(
      !other.data.entries.some((entry) => entry.isMe),
      `${mode} 榜不应出现本周挑战成绩`
    );
  }

  // 指定历史周：周键隔离，不返回本周成绩。
  const past = await api('/api/leaderboard?mode=weekly&day=2025-W10');
  assert.equal(past.status, 200);
  assert.equal(past.data.week, '2025-W10');
  assert.equal(past.data.entries.length, 0);

  // 非法周键回退本周。
  const fallback = await api('/api/leaderboard?mode=weekly&day=not-a-week');
  assert.equal(fallback.data.week, challenge.week);
});

test('每周次数上限生效，且不影响其他模式', async () => {
  // 前一个用例已完成 2 次本周挑战。
  const third = await startWeekly();
  assert.equal(third.status, 200);
  assert.equal(third.data.weeklyAttemptsLeft, 1);
  const finished = await finish(third.data.runId);
  assert.equal(finished.status, 200);
  assert.equal(finished.data.weeklyAttemptsLeft, 0);

  const blocked = await startWeekly();
  assert.equal(blocked.status, 429);

  // 周挑战次数用完不影响普通模式建局。
  const normal = await api('/api/runs', { method: 'POST', body: { mode: 'normal' } });
  assert.equal(normal.status, 200);
  assert.equal(normal.data.mode, 'normal');
  await api(`/api/runs/${normal.data.runId}/abandon`, { method: 'POST', body: {} });
});
