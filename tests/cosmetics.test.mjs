// 成就奖励：称号/头像框。奖励定义合法性、未解锁不可选、选择持久化与旧档案兼容。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  ACHIEVEMENTS,
  COSMETIC_FRAMES,
  COSMETIC_TITLES,
} from '../public/js/shared/achievements.js';
import { startTestServer } from './harness.mjs';

let server = null;
let cookie = '';
let accountId = '';

function api(pathname, { method = 'GET', body } = {}) {
  return fetch(`${server.base}${pathname}`, {
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
  const response = await fetch(`${server.base}/api/auth/register`, {
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
  assert.equal((await jsonApi(`/api/runs/${runId}/map`, { method: 'POST', body: { index: 0 } })).status, 200);
  assert.equal((await jsonApi(`/api/runs/${runId}/wave`, { method: 'POST', body: {} })).status, 200);
  assert.equal((await jsonApi(`/api/runs/${runId}/clear`, { method: 'POST', body: { wave: 1 } })).status, 200);
  const finished = await jsonApi(`/api/runs/${runId}/finish`, {
    method: 'POST',
    body: { waveReached: 1, kills: 10, goldLeft: 0, baseHp: 20 },
  });
  assert.equal(finished.status, 200);
  return finished;
}

function openDb() {
  const db = new DatabaseSync(server.dbPath);
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

function cosmeticKeys(db, id) {
  return db
    .prepare('SELECT key FROM player_kv WHERE account_id = ? AND namespace = ?')
    .all(id, 'cosmetics')
    .map((row) => row.key);
}

before(async () => {
  server = await startTestServer();
});

after(async () => {
  await server?.stop();
});

test('奖励定义集中在成就表且引用合法', () => {
  const titleSources = new Set();
  const frameSources = new Set();
  let rewarded = 0;

  for (const achievement of ACHIEVEMENTS) {
    if (!achievement.reward) continue;
    rewarded += 1;
    const { title, frame } = achievement.reward;
    assert.ok(title || frame, `成就 ${achievement.id} 的奖励为空`);
    if (title) {
      assert.ok(COSMETIC_TITLES[title], `成就 ${achievement.id} 引用了未知称号 ${title}`);
      assert.equal(COSMETIC_TITLES[title].id, title);
      titleSources.add(title);
    }
    if (frame) {
      assert.ok(COSMETIC_FRAMES[frame], `成就 ${achievement.id} 引用了未知头像框 ${frame}`);
      assert.equal(COSMETIC_FRAMES[frame].id, frame);
      assert.match(COSMETIC_FRAMES[frame].color, /^#[0-9a-f]{6}$/i, `头像框 ${frame} 颜色不合法`);
      frameSources.add(frame);
    }
  }

  assert.ok(rewarded >= 8, `带奖励的成就过少：${rewarded}`);
  for (const id of Object.keys(COSMETIC_TITLES)) {
    assert.ok(titleSources.has(id), `称号 ${id} 没有授予它的成就`);
  }
  for (const id of Object.keys(COSMETIC_FRAMES)) {
    assert.ok(frameSources.has(id), `头像框 ${id} 没有授予它的成就`);
  }
});

test('未登录不能读取或修改外观', async () => {
  assert.equal((await api('/api/profile/cosmetics')).status, 401);
  assert.equal((await api('/api/profile/cosmetics', { method: 'PUT', body: { title: 'wanderer' } })).status, 401);
});

test('新账号默认无称号且全部外观未解锁', async () => {
  const username = `cos${Date.now().toString(36).slice(-8)}`;
  const registered = await register(username);
  cookie = registered.cookie;
  accountId = registered.data.profile.accountId;
  assert.ok(accountId);

  const { status, data } = await jsonApi('/api/profile/cosmetics');
  assert.equal(status, 200);
  assert.deepEqual(data.selected, { title: null, frame: null });
  assert.ok(data.titles.length >= 8, `称号目录过少：${data.titles.length}`);
  assert.ok(data.frames.length >= 6, `头像框目录过少：${data.frames.length}`);
  for (const kind of ['titles', 'frames']) {
    for (const item of data[kind]) {
      assert.equal(typeof item.id, 'string');
      assert.equal(typeof item.name, 'string');
      assert.equal(typeof item.unlocked, 'boolean');
      assert.equal(typeof item.achievementId, 'string');
      assert.equal(typeof item.achievementTitle, 'string');
      assert.equal(item.unlocked, false, `${item.id} 不应在新账号解锁`);
    }
  }
  for (const frame of data.frames) assert.match(frame.color, /^#[0-9a-f]{6}$/i);
});

test('未解锁的称号与头像框无法通过接口选择', async () => {
  const title = await jsonApi('/api/profile/cosmetics', { method: 'PUT', body: { title: 'wanderer' } });
  assert.equal(title.status, 403);
  assert.equal(title.data.code, 'TITLE_LOCKED');

  const frame = await jsonApi('/api/profile/cosmetics', { method: 'PUT', body: { frame: 'bronze' } });
  assert.equal(frame.status, 403);
  assert.equal(frame.data.code, 'FRAME_LOCKED');

  const unknownTitle = await jsonApi('/api/profile/cosmetics', { method: 'PUT', body: { title: 'no_such_title' } });
  assert.equal(unknownTitle.status, 400);
  assert.equal(unknownTitle.data.code, 'UNKNOWN_TITLE');

  const unknownFrame = await jsonApi('/api/profile/cosmetics', { method: 'PUT', body: { frame: 'no_such_frame' } });
  assert.equal(unknownFrame.status, 400);
  assert.equal(unknownFrame.data.code, 'UNKNOWN_FRAME');

  const empty = await jsonApi('/api/profile/cosmetics', { method: 'PUT', body: {} });
  assert.equal(empty.status, 400);
  assert.equal(empty.data.code, 'NO_COSMETIC_CHANGES');

  const invalid = await jsonApi('/api/profile/cosmetics', { method: 'PUT', body: { title: 42 } });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.data.code, 'INVALID_COSMETIC');

  const after = await jsonApi('/api/profile/cosmetics');
  assert.deepEqual(after.data.selected, { title: null, frame: null });
});

test('解锁成就后授予称号，选择可持久化且写入 player_kv', async () => {
  const finished = await playOneRun();
  assert.ok(finished.data.unlockedAchievements.includes('first_run'));

  const listed = await jsonApi('/api/profile/cosmetics');
  const wanderer = listed.data.titles.find((item) => item.id === 'wanderer');
  assert.ok(wanderer, '目录缺少 wanderer');
  assert.equal(wanderer.unlocked, true);
  assert.equal(wanderer.achievementId, 'first_run');

  const selected = await jsonApi('/api/profile/cosmetics', { method: 'PUT', body: { title: 'wanderer' } });
  assert.equal(selected.status, 200);
  assert.deepEqual(selected.data.selected, { title: 'wanderer', frame: null });

  const reread = await jsonApi('/api/profile/cosmetics');
  assert.deepEqual(reread.data.selected, { title: 'wanderer', frame: null });

  const db = openDb();
  try {
    const keys = cosmeticKeys(db, accountId);
    assert.ok(keys.includes('title:wanderer'), `player_kv 缺少称号解锁记录：${keys.join(',')}`);
    assert.ok(keys.includes('selected'), 'player_kv 缺少选择记录');
  } finally {
    db.close();
  }
});

test('旧档案兼容：没有 player_kv 记录时仍按已解锁成就展示，选择默认无称号', async () => {
  // 模拟功能上线前已解锁成就的老档案：清空外观 KV，只保留成就记录。
  const db = openDb();
  try {
    db.prepare('DELETE FROM player_kv WHERE account_id = ? AND namespace = ?').run(accountId, 'cosmetics');
  } finally {
    db.close();
  }

  const listed = await jsonApi('/api/profile/cosmetics');
  assert.equal(listed.status, 200);
  const wanderer = listed.data.titles.find((item) => item.id === 'wanderer');
  assert.equal(wanderer.unlocked, true, '旧档案应通过成就记录派生解锁');
  assert.deepEqual(listed.data.selected, { title: null, frame: null });

  const reselected = await jsonApi('/api/profile/cosmetics', { method: 'PUT', body: { title: 'wanderer' } });
  assert.equal(reselected.status, 200);
  assert.equal(reselected.data.selected.title, 'wanderer');

  const cleared = await jsonApi('/api/profile/cosmetics', { method: 'PUT', body: { title: null } });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.data.selected.title, null);
});
