// V22-004 技能养成 × 成就联动：升级/选择触发成就、幂等、未解锁技能不触发、判定失败不影响技能接口。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import {
  ACHIEVEMENTS,
  ACHIEVEMENT_BY_ID,
  ACHIEVEMENT_GROUPS,
  evaluateAchievements,
} from '../public/js/shared/achievements.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 19500 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join(os.tmpdir(), `rtd-ach-skills-${process.pid}-${Date.now()}.db`);

let server = null;
let serverLog = '';
let dbModule = null;

async function api(pathname, { method = 'GET', token, body } = {}) {
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

function newToken(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function accountIdOf(token) {
  const profile = await api('/api/profile', { token });
  assert.equal(profile.status, 200);
  return profile.data.profile.accountId;
}

function setCores(accountId, balance) {
  dbModule.db
    .prepare(
      `INSERT INTO player_wallets (account_id, currency_id, balance, updated_at)
       VALUES (?, 'cores', ?, ?)
       ON CONFLICT(account_id, currency_id) DO UPDATE SET
         balance = excluded.balance, updated_at = excluded.updated_at`
    )
    .run(accountId, Math.max(0, Math.floor(balance)), Date.now());
}

function achievementIds(accountId) {
  return dbModule.db
    .prepare('SELECT achievement_id FROM account_achievements WHERE account_id = ? ORDER BY achievement_id')
    .all(accountId)
    .map((row) => row.achievement_id);
}

function grantUnlock(accountId, unlockId) {
  dbModule.db
    .prepare(
      `INSERT OR IGNORE INTO player_unlocks (account_id, unlock_id, unlocked_at, meta)
       VALUES (?, ?, ?, '{}')`
    )
    .run(accountId, unlockId, Date.now());
}

async function upgrade(token, skillId, expectedLevel) {
  return api('/api/skills/upgrade', {
    method: 'POST',
    token,
    body: expectedLevel == null ? { skillId } : { skillId, expectedLevel },
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

  for (let i = 0; i < 80; i++) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) break;
    } catch {
      /* 等待启动 */
    }
    await sleep(100);
  }
  if (!server || server.exitCode != null) throw new Error(`测试服务未能启动：${serverLog}`);
  const health = await fetch(`${BASE}/api/health`).catch(() => null);
  if (!health?.ok) throw new Error(`测试服务未能启动：${serverLog}`);

  process.env.DB_PATH = DB;
  dbModule = await import('../server/db.mjs');
  dbModule.db.exec('PRAGMA busy_timeout = 3000');
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

test('定义：旧成就 id 保留，技能成就归入构筑分组', () => {
  const ids = ACHIEVEMENTS.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length, '成就 id 必须唯一');
  for (const legacy of ['first_run', 'hidden_no_relic_win', 'achievement_30', 'kills_1000']) {
    assert.ok(ACHIEVEMENT_BY_ID[legacy], `旧成就丢失：${legacy}`);
  }
  assert.deepEqual(
    ACHIEVEMENT_GROUPS.map((group) => group.id),
    ['clear', 'build', 'challenge', 'collect'],
    '不新增分组，保持旧客户端分组兼容'
  );
  const skillItems = ACHIEVEMENTS.filter((item) => item.id.startsWith('skill_'));
  assert.ok(skillItems.every((item) => item.group === 'build'));
  const skillIds = skillItems.map((item) => item.id);
  assert.deepEqual(skillIds.sort(), [
    'skill_abyss_win',
    'skill_all_unlocked',
    'skill_level_5',
    'skill_max',
    'skill_select',
    'skill_unlock_chrono',
    'skill_unlock_meteor',
  ]);
});

test('纯判定：技能上下文驱动技能成就，重复评估不再新增', () => {
  const ctx = {
    run: null,
    stats: null,
    dailyRuns: 0,
    dailyWins: 0,
    skills: {
      levels: { aurora: 5, meteor: 1, chrono: 1 },
      unlocked: { aurora: true, meteor: true, chrono: false },
      selected: 'aurora',
    },
    skillAbyssWins: 1,
    unlocked: new Set(),
  };
  const added = evaluateAchievements(ctx);
  for (const id of [
    'skill_select',
    'skill_unlock_meteor',
    'skill_level_5',
    'skill_abyss_win',
  ]) {
    assert.ok(added.includes(id), `未解锁 ${id}，实际：${added.join(',')}`);
  }
  assert.ok(!added.includes('skill_unlock_chrono'));
  assert.ok(!added.includes('skill_all_unlocked'));
  assert.ok(!added.includes('skill_max'));

  const again = evaluateAchievements({ ...ctx, unlocked: new Set(added) });
  assert.deepEqual(again, []);
});

test('升级触发技能成就，到达满级只解锁一次', async () => {
  const token = newToken('ach-up');
  const accountId = await accountIdOf(token);
  setCores(accountId, 1000);

  let unlockedAtFive = null;
  for (let level = 1; level < 5; level++) {
    const result = await upgrade(token, 'aurora', level);
    assert.equal(result.status, 200);
    assert.equal(result.data.upgraded.to, level + 1);
    unlockedAtFive = result.data.unlockedAchievements;
  }
  assert.ok(unlockedAtFive.includes('skill_level_5'), `实际：${unlockedAtFive.join(',')}`);
  assert.ok(!unlockedAtFive.includes('skill_max'));

  let unlockedAtMax = null;
  for (let level = 5; level < 10; level++) {
    const result = await upgrade(token, 'aurora', level);
    assert.equal(result.status, 200);
    unlockedAtMax = result.data.unlockedAchievements;
  }
  assert.ok(unlockedAtMax.includes('skill_max'), `实际：${unlockedAtMax.join(',')}`);

  // 满级后的重复请求直接 409，不会再触发任何判定。
  const over = await upgrade(token, 'aurora');
  assert.equal(over.status, 409);
  assert.equal(over.data.code, 'MAX_LEVEL');

  const ids = achievementIds(accountId);
  assert.equal(ids.filter((id) => id === 'skill_level_5').length, 1);
  assert.equal(ids.filter((id) => id === 'skill_max').length, 1);
});

test('选择技能触发 skill_select，重复选择不重复解锁', async () => {
  const token = newToken('ach-select');
  const accountId = await accountIdOf(token);

  const first = await api('/api/skills/select', {
    method: 'POST',
    token,
    body: { skillId: 'aurora' },
  });
  assert.equal(first.status, 200);
  assert.deepEqual(first.data, { selected: 'aurora' });
  assert.deepEqual(achievementIds(accountId), ['skill_select']);

  const second = await api('/api/skills/select', {
    method: 'POST',
    token,
    body: { skillId: 'aurora' },
  });
  assert.equal(second.status, 200);
  assert.deepEqual(achievementIds(accountId), ['skill_select']);
});

test('未解锁技能不触发成就；解锁后才计入', async () => {
  const token = newToken('ach-lock');
  const accountId = await accountIdOf(token);
  setCores(accountId, 1000);

  const locked = await upgrade(token, 'meteor');
  assert.equal(locked.status, 403);
  assert.equal(locked.data.code, 'SKILL_LOCKED');
  assert.deepEqual(achievementIds(accountId), []);

  grantUnlock(accountId, 'skill_meteor');
  const meteorUp = await upgrade(token, 'meteor');
  assert.equal(meteorUp.status, 200);
  assert.ok(meteorUp.data.unlockedAchievements.includes('skill_unlock_meteor'));
  assert.ok(!meteorUp.data.unlockedAchievements.includes('skill_unlock_chrono'));
  assert.ok(!meteorUp.data.unlockedAchievements.includes('skill_all_unlocked'));

  grantUnlock(accountId, 'skill_chrono');
  const chronoUp = await upgrade(token, 'chrono');
  assert.equal(chronoUp.status, 200);
  assert.ok(chronoUp.data.unlockedAchievements.includes('skill_unlock_chrono'));
  assert.ok(chronoUp.data.unlockedAchievements.includes('skill_all_unlocked'));
});

test('带技能通关深渊才解锁 skill_abyss_win', async () => {
  const now = Date.now();
  const insertRun = dbModule.db.prepare(
    `INSERT INTO runs
       (id, account_id, mode, difficulty, seed, day, status, victory, score,
        wave_reached, kills, duration_ms, ruleset_json, created_at, finished_at)
     VALUES (?, ?, 'normal', 'abyss', ?, '2026-10-23', 'finished', 1, 5000,
        30, 3000, 600000, ?, ?, ?)`
  );

  const winnerToken = newToken('ach-abyss');
  const winnerId = await accountIdOf(winnerToken);
  setCores(winnerId, 100);
  insertRun.run(
    `abyss-skill-${now}`,
    winnerId,
    'seed-skill',
    JSON.stringify({ v: 1, skill: { id: 'aurora', level: 3 } }),
    now,
    now
  );

  const upgraded = await upgrade(winnerToken, 'aurora', 1);
  assert.equal(upgraded.status, 200);
  assert.ok(upgraded.data.unlockedAchievements.includes('skill_abyss_win'));

  const summary = await api('/api/achievements', { token: winnerToken });
  assert.equal(summary.status, 200);
  const buildGroup = summary.data.groups.find((group) => group.id === 'build');
  const skillItems = summary.data.achievements.filter((item) => item.id.startsWith('skill_'));
  assert.equal(skillItems.length, 7);
  assert.ok(skillItems.every((item) => item.group === 'build'));
  assert.ok(buildGroup && buildGroup.total >= 7);
  const abyssWin = summary.data.achievements.find((item) => item.id === 'skill_abyss_win');
  assert.equal(abyssWin.unlocked, true);
  assert.deepEqual(abyssWin.progress, { current: 1, target: 1 });

  // 同一难度的旧局没有携带技能：不计入深渊演武。
  const plainToken = newToken('ach-abyss-plain');
  const plainId = await accountIdOf(plainToken);
  setCores(plainId, 100);
  insertRun.run(`abyss-plain-${now}`, plainId, 'seed-plain', '{}', now, now);
  const plainUp = await upgrade(plainToken, 'aurora', 1);
  assert.equal(plainUp.status, 200);
  assert.ok(!plainUp.data.unlockedAchievements.includes('skill_abyss_win'));
});

test('成就落库失败时技能接口仍然成功，恢复后补发', async () => {
  const token = newToken('ach-fail');
  const accountId = await accountIdOf(token);
  setCores(accountId, 1000);

  for (let level = 1; level < 4; level++) {
    const result = await upgrade(token, 'aurora', level);
    assert.equal(result.status, 200);
  }

  const escaped = accountId.replaceAll("'", "''");
  dbModule.db.exec(
    `CREATE TRIGGER v22_block_achievements BEFORE INSERT ON account_achievements
       WHEN NEW.account_id = '${escaped}'
       BEGIN SELECT RAISE(ABORT, 'achievement write blocked'); END;`
  );
  try {
    const blocked = await upgrade(token, 'aurora', 4);
    assert.equal(blocked.status, 200);
    assert.equal(blocked.data.upgraded.to, 5);
    assert.deepEqual(blocked.data.unlockedAchievements, []);
    assert.deepEqual(achievementIds(accountId), []);
  } finally {
    dbModule.db.exec('DROP TRIGGER IF EXISTS v22_block_achievements');
  }

  // 恢复后下一次技能操作会补发未落库的成就。
  const selected = await api('/api/skills/select', {
    method: 'POST',
    token,
    body: { skillId: 'aurora' },
  });
  assert.equal(selected.status, 200);
  assert.ok(achievementIds(accountId).includes('skill_level_5'));
});
