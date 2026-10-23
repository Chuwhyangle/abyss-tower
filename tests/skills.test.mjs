// 主动技能服务端测试：解锁、升级经济、原子扣费、满级、每日规则集、ruleset 冻结、结算幂等。
// 使用独立端口 + 临时数据库；测试进程直连同一个 SQLite 文件做少量数据准备。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { dayKey } from '../public/js/shared/scoring.js';
import { SKILLS, TOWER_ORDER, skillStats } from '../public/js/shared/data.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 19200 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join(os.tmpdir(), `rtd-skills-test-${process.pid}-${Date.now()}.db`);

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

function readCores(accountId) {
  return dbModule.getCores(accountId);
}

async function playWaves(token, runId, maxWave = 30) {
  const map = await api(`/api/runs/${runId}/map`, { method: 'POST', token, body: { index: 0 } });
  assert.equal(map.status, 200);
  for (let wave = 1; wave <= maxWave; wave++) {
    const served = await api(`/api/runs/${runId}/wave`, { method: 'POST', token, body: {} });
    assert.equal(served.status, 200);
    assert.equal(served.data.wave.index, wave);
    const cleared = await api(`/api/runs/${runId}/clear`, {
      method: 'POST',
      token,
      body: { wave },
    });
    assert.equal(cleared.status, 200);
  }
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

  // 同一个临时库：WAL 下允许多连接，仅用于准备星核/统计。
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

test('初始状态：极光可用、其余锁定、费用与数值来自共享数据', async () => {
  const token = newToken('skill-init');
  const listed = await api('/api/skills', { token });
  assert.equal(listed.status, 200);
  assert.equal(listed.data.wallet.cores, 0);
  assert.equal(listed.data.selected, null);
  assert.equal(listed.data.skills.length, 3);

  const [aurora, meteor, chrono] = listed.data.skills;
  assert.equal(aurora.id, 'aurora');
  assert.equal(aurora.unlocked, true);
  assert.equal(aurora.level, 1);
  assert.equal(aurora.nextCost, 10);
  assert.equal(aurora.canUpgrade, false); // 星核不足
  assert.deepEqual(aurora.stats, skillStats('aurora', 1));
  assert.equal(aurora.color, SKILLS.aurora.color);

  for (const skill of [meteor, chrono]) {
    assert.equal(skill.unlocked, false);
    assert.equal(skill.level, 1);
    assert.match(skill.unlockHint, /首次通关/);
  }
  assert.equal(meteor.unlockHint, '首次通关「漫游」');
  assert.equal(chrono.unlockHint, '首次通关「远征」');

  const upgradeLocked = await api('/api/skills/upgrade', {
    method: 'POST',
    token,
    body: { skillId: 'meteor' },
  });
  assert.equal(upgradeLocked.status, 403);
  assert.equal(upgradeLocked.data.code, 'SKILL_LOCKED');

  const selectLocked = await api('/api/skills/select', {
    method: 'POST',
    token,
    body: { skillId: 'chrono' },
  });
  assert.equal(selectLocked.status, 403);
  assert.equal(selectLocked.data.code, 'SKILL_LOCKED');

  const invalid = await api('/api/skills/upgrade', {
    method: 'POST',
    token,
    body: { skillId: 'nope' },
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.data.code, 'INVALID_SKILL');

  const invalidRun = await api('/api/runs', {
    method: 'POST',
    token,
    body: { mode: 'normal', difficulty: 'standard', skillId: 'nope' },
  });
  assert.equal(invalidRun.status, 400);
  assert.equal(invalidRun.data.code, 'INVALID_SKILL');

  const lockedRun = await api('/api/runs', {
    method: 'POST',
    token,
    body: { mode: 'normal', difficulty: 'standard', skillId: 'meteor' },
  });
  assert.equal(lockedRun.status, 403);
  assert.equal(lockedRun.data.code, 'SKILL_LOCKED');
});

test('升级：原子扣费、费用曲线、expectedLevel、满级', async () => {
  const token = newToken('skill-up');
  const accountId = await accountIdOf(token);
  setCores(accountId, 0);

  const poor = await api('/api/skills/upgrade', {
    method: 'POST',
    token,
    body: { skillId: 'aurora' },
  });
  assert.equal(poor.status, 400);
  assert.equal(poor.data.code, 'INSUFFICIENT_CORES');

  setCores(accountId, 1000);
  const first = await api('/api/skills/upgrade', {
    method: 'POST',
    token,
    body: { skillId: 'aurora', expectedLevel: 1 },
  });
  assert.equal(first.status, 200);
  assert.deepEqual(first.data.upgraded, { skillId: 'aurora', from: 1, to: 2, cost: 10 });
  assert.equal(first.data.wallet.cores, 990);
  const aurora = first.data.skills.find((skill) => skill.id === 'aurora');
  assert.equal(aurora.level, 2);
  assert.equal(aurora.nextCost, 15);
  assert.equal(aurora.canUpgrade, true);
  assert.deepEqual(aurora.stats, skillStats('aurora', 2));

  const conflict = await api('/api/skills/upgrade', {
    method: 'POST',
    token,
    body: { skillId: 'aurora', expectedLevel: 1 },
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.data.code, 'LEVEL_CONFLICT');
  assert.equal(readCores(accountId), 990);

  // 升到 10 级：总花费 615。
  for (let level = 2; level < 10; level++) {
    const stepped = await api('/api/skills/upgrade', {
      method: 'POST',
      token,
      body: { skillId: 'aurora', expectedLevel: level },
    });
    assert.equal(stepped.status, 200);
    assert.equal(stepped.data.upgraded.to, level + 1);
  }
  assert.equal(readCores(accountId), 1000 - 615);

  const maxed = await api('/api/skills', { token });
  const maxedAurora = maxed.data.skills.find((skill) => skill.id === 'aurora');
  assert.equal(maxedAurora.level, 10);
  assert.equal(maxedAurora.nextCost, null);
  assert.equal(maxedAurora.canUpgrade, false);
  assert.deepEqual(maxedAurora.stats, skillStats('aurora', 10));

  const over = await api('/api/skills/upgrade', {
    method: 'POST',
    token,
    body: { skillId: 'aurora' },
  });
  assert.equal(over.status, 409);
  assert.equal(over.data.code, 'MAX_LEVEL');
  assert.equal(readCores(accountId), 385);

  // 数据落点：player_progress(type='skill', key=<skillId>)。
  const stored = dbModule.db
    .prepare(
      `SELECT progress_type, value_num FROM player_progress
        WHERE account_id = ? AND progress_key = 'aurora'`
    )
    .get(accountId);
  assert.equal(stored.progress_type, 'skill');
  assert.equal(stored.value_num, 10);
});

test('并发升级：余额只够一次时只成功一次（无双花）', async () => {
  const token = newToken('skill-race');
  const accountId = await accountIdOf(token);
  setCores(accountId, 15);

  const results = await Promise.all(
    Array.from({ length: 6 }, () =>
      api('/api/skills/upgrade', { method: 'POST', token, body: { skillId: 'aurora' } })
    )
  );
  const ok = results.filter((result) => result.status === 200);
  const failed = results.filter((result) => result.status !== 200);
  assert.equal(ok.length, 1);
  assert.equal(ok[0].data.upgraded.from, 1);
  assert.equal(ok[0].data.upgraded.to, 2);
  assert.equal(failed.length, 5);
  for (const result of failed) {
    assert.equal(result.data.code, 'INSUFFICIENT_CORES');
  }
  assert.equal(readCores(accountId), 5);

  const listed = await api('/api/skills', { token });
  const aurora = listed.data.skills.find((skill) => skill.id === 'aurora');
  assert.equal(aurora.level, 2);
});

test('选择与解锁：保存选择、首通派生覆盖老账号', async () => {
  const token = newToken('skill-select');
  const accountId = await accountIdOf(token);

  const selected = await api('/api/skills/select', {
    method: 'POST',
    token,
    body: { skillId: 'aurora' },
  });
  assert.equal(selected.status, 200);
  assert.deepEqual(selected.data, { selected: 'aurora' });

  const listed = await api('/api/skills', { token });
  assert.equal(listed.data.selected, 'aurora');

  // 数据落点：player_progress(type='skill', key='selected', state_json)。
  const storedSelection = dbModule.db
    .prepare(
      `SELECT progress_type, state_json FROM player_progress
        WHERE account_id = ? AND progress_key = 'selected'`
    )
    .get(accountId);
  assert.equal(storedSelection.progress_type, 'skill');
  assert.deepEqual(JSON.parse(storedSelection.state_json), { id: 'aurora' });

  // 上线前已通关的老账号：没有 player_unlocks 记录，但 player_stats 有 roam 胜场。
  dbModule.db
    .prepare(
      `INSERT INTO player_stats (account_id, stat_key, scope_key, value_num, updated_at)
       VALUES (?, 'wins', 'difficulty:roam', 1, ?)
       ON CONFLICT(account_id, stat_key, scope_key) DO UPDATE SET value_num = 1`
    )
    .run(accountId, Date.now());

  const derived = await api('/api/skills', { token });
  const meteor = derived.data.skills.find((skill) => skill.id === 'meteor');
  assert.equal(meteor.unlocked, true);
  const chrono = derived.data.skills.find((skill) => skill.id === 'chrono');
  assert.equal(chrono.unlocked, false);

  const capped = await api('/api/runs', {
    method: 'POST',
    token,
    body: { mode: 'normal', difficulty: 'standard', skillId: 'meteor' },
  });
  assert.equal(capped.status, 200);
  assert.deepEqual(capped.data.skill, { id: 'meteor', level: 1 });
});

test('每日挑战：固定规则集、任意技能固定 5 级、v2 榜单', async () => {
  const token = newToken('skill-daily');
  const started = await api('/api/runs', {
    method: 'POST',
    token,
    body: { mode: 'daily', difficulty: 'roam', skillId: 'chrono' },
  });
  assert.equal(started.status, 200);
  assert.equal(started.data.startingGold, 260);
  assert.equal(started.data.baseHp, 20);
  assert.equal(started.data.maxRerolls, 1);
  assert.equal(started.data.relics.length, 0);
  assert.deepEqual(started.data.towersUnlocked, TOWER_ORDER);
  assert.deepEqual(started.data.skill, { id: 'chrono', level: 5 });
  assert.equal(started.data.ruleset.v, 1);
  assert.deepEqual(started.data.ruleset.meta, { startGold: 260, baseHp: 20, maxRerolls: 1 });
  assert.equal(started.data.ruleset.daily.ruleset, 'daily-v2');
  assert.deepEqual(started.data.ruleset.skill, { id: 'chrono', level: 5 });

  const runId = started.data.runId;
  const info = await api(`/api/runs/${runId}`, { token });
  assert.equal(info.status, 200);
  assert.deepEqual(info.data.run.ruleset, started.data.ruleset);
  assert.deepEqual(info.data.run.skill, { id: 'chrono', level: 5 });
  assert.deepEqual(info.data.run.towersUnlocked, TOWER_ORDER);
  assert.equal(info.data.run.maxRerolls, 1);

  const active = await api('/api/runs/active', { token });
  assert.deepEqual(active.data.run.ruleset, started.data.ruleset);

  const row = dbModule.db.prepare('SELECT board_key, ruleset_json FROM runs WHERE id = ?').get(runId);
  const day = dayKey();
  assert.equal(row.board_key, `daily:${day}:v2`);
  assert.deepEqual(JSON.parse(row.ruleset_json), started.data.ruleset);

  // 每日固定 1 次刷新：即便账号买了“命运骰子”也不生效。
  await api(`/api/runs/${runId}/map`, { method: 'POST', token, body: { index: 0 } });
  await api(`/api/runs/${runId}/wave`, { method: 'POST', token, body: {} });
  await api(`/api/runs/${runId}/clear`, { method: 'POST', token, body: { wave: 1 } });
  const relics = await api(`/api/runs/${runId}/relics`, { method: 'POST', token, body: {} });
  assert.equal(relics.status, 200);
  assert.equal(relics.data.maxRerolls, 1);
});

test('ruleset 冻结：局内升级不影响进行中的局，新局读取最新等级', async () => {
  const token = newToken('skill-freeze');
  const accountId = await accountIdOf(token);
  setCores(accountId, 100);

  const started = await api('/api/runs', {
    method: 'POST',
    token,
    body: { mode: 'normal', difficulty: 'standard', skillId: 'aurora' },
  });
  assert.equal(started.status, 200);
  assert.deepEqual(started.data.skill, { id: 'aurora', level: 1 });
  assert.deepEqual(started.data.ruleset.meta, { startGold: 260, baseHp: 20, maxRerolls: 1 });

  const upgraded = await api('/api/skills/upgrade', {
    method: 'POST',
    token,
    body: { skillId: 'aurora', expectedLevel: 1 },
  });
  assert.equal(upgraded.status, 200);

  const info = await api(`/api/runs/${started.data.runId}`, { token });
  assert.deepEqual(info.data.run.skill, { id: 'aurora', level: 1 });
  assert.deepEqual(info.data.run.ruleset.skill, { id: 'aurora', level: 1 });

  const next = await api('/api/runs', {
    method: 'POST',
    token,
    body: { mode: 'normal', difficulty: 'standard', skillId: 'aurora' },
  });
  assert.equal(next.status, 200);
  assert.deepEqual(next.data.skill, { id: 'aurora', level: 2 });
});

test('结算幂等与首通授予：重复 finish 只发一次，失败不授予', async () => {
  const token = newToken('skill-finish');
  const accountId = await accountIdOf(token);

  const lost = await api('/api/runs', {
    method: 'POST',
    token,
    body: { mode: 'normal', difficulty: 'roam', skillId: 'aurora' },
  });
  await playWaves(token, lost.data.runId, 4);
  const lostFinish = await api(`/api/runs/${lost.data.runId}/finish`, {
    method: 'POST',
    token,
    body: { waveReached: 4, kills: 200, goldLeft: 100, baseHp: 0 },
  });
  assert.equal(lostFinish.status, 200);
  assert.equal(lostFinish.data.victory, false);
  assert.equal(lostFinish.data.coresEarned, 0); // 清波 < 5 不给星核
  assert.deepEqual(lostFinish.data.unlockedSkills, []);

  // 通关「远征」：授予时之终章。
  const runId = (
    await api('/api/runs', {
      method: 'POST',
      token,
      body: { mode: 'normal', difficulty: 'standard', skillId: 'aurora' },
    })
  ).data.runId;
  await playWaves(token, runId, 30);

  const [first, second] = await Promise.all([
    api(`/api/runs/${runId}/finish`, {
      method: 'POST',
      token,
      body: { waveReached: 30, kills: 3000, goldLeft: 1000, baseHp: 20 },
    }),
    api(`/api/runs/${runId}/finish`, {
      method: 'POST',
      token,
      body: { waveReached: 30, kills: 3000, goldLeft: 1000, baseHp: 20 },
    }),
  ]);
  const statuses = [first.status, second.status].sort();
  assert.deepEqual(statuses, [200, 409]);
  const winner = first.status === 200 ? first : second;
  const loser = first.status === 200 ? second : first;
  assert.equal(winner.data.victory, true);
  assert.ok(winner.data.coresEarned > 0);
  assert.deepEqual(winner.data.unlockedSkills, [{ id: 'chrono', name: SKILLS.chrono.name }]);
  assert.equal(loser.data.code, 'RUN_FINISHED');

  const coresAfter = readCores(accountId);
  assert.equal(coresAfter, winner.data.coresEarned);
  assert.equal(winner.data.totalCores, coresAfter);

  const repeat = await api(`/api/runs/${runId}/finish`, {
    method: 'POST',
    token,
    body: { waveReached: 30, kills: 3000, goldLeft: 1000, baseHp: 20 },
  });
  assert.equal(repeat.status, 409);
  assert.equal(repeat.data.code, 'RUN_FINISHED');
  assert.equal(readCores(accountId), coresAfter);

  const unlockRows = dbModule.db
    .prepare("SELECT unlock_id FROM player_unlocks WHERE account_id = ? AND unlock_id LIKE 'skill_%'")
    .all(accountId);
  assert.deepEqual(unlockRows.map((row) => row.unlock_id), ['skill_chrono']);

  const profile = await api('/api/profile', { token });
  assert.equal(profile.data.profile.stats.byDifficulty.standard.wins, 1);
  assert.equal(profile.data.profile.stats.runs, 2);

  const listed = await api('/api/skills', { token });
  const chrono = listed.data.skills.find((skill) => skill.id === 'chrono');
  assert.equal(chrono.unlocked, true);

  // 通关「漫游」：授予星陨。
  const roamRunId = (
    await api('/api/runs', {
      method: 'POST',
      token,
      body: { mode: 'normal', difficulty: 'roam', skillId: 'chrono' },
    })
  ).data.runId;
  await playWaves(token, roamRunId, 30);
  const roamWin = await api(`/api/runs/${roamRunId}/finish`, {
    method: 'POST',
    token,
    body: { waveReached: 30, kills: 3000, goldLeft: 1000, baseHp: 20 },
  });
  assert.equal(roamWin.status, 200);
  assert.equal(roamWin.data.victory, true);
  assert.deepEqual(roamWin.data.unlockedSkills, [{ id: 'meteor', name: SKILLS.meteor.name }]);
  assert.ok(roamWin.data.coresEarned > 0); // 漫游满通也有星核（0.65 倍）
});
