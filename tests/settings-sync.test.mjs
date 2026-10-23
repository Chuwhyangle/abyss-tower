// 设置云同步：合并优先级、损坏回退、2 秒节流、体积上限与未登录行为。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import {
  DEFAULT_SETTINGS,
  QUALITY_PRESETS,
  SETTINGS_KEY,
  SETTINGS_MAX_BYTES,
  SETTINGS_SYNC_DELAY_MS,
  SETTINGS_UPDATED_KEY,
  SettingsSync,
  loadSettings,
  mergeSettings,
  readSettingsUpdatedAt,
  resolveRemoteSettings,
  saveSettings,
  settingsPayloadBytes,
} from '../public/js/settings.js';
import { registerAndLogin, startTestServer } from './harness.mjs';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    dump: () => Object.fromEntries(data),
  };
}

// ---------- 纯合并规则 ----------

test('合并以服务端为准，服务端缺失或非法的字段保留本地值', () => {
  const local = { ...QUALITY_PRESETS.low, music: false, sfxVolume: 20 };
  const merged = mergeSettings(local, {
    fps: 60,
    dpr: 7,
    decorations: 'full',
    sfxVolume: '',
  });
  assert.equal(merged.fps, 60);
  assert.equal(merged.dpr, local.dpr, '非法 dpr 回退本地值');
  assert.equal(merged.decorations, 'full');
  assert.equal(merged.music, false, '服务端未携带的键保留本地值');
  assert.equal(merged.sfxVolume, 20, '空音量回退本地值');
});

test('损坏的远端数据回退默认设置', () => {
  const merged = mergeSettings({ fps: 60 }, '{not json');
  assert.deepEqual(merged, { ...DEFAULT_SETTINGS, fps: 60 });
  const resolved = resolveRemoteSettings({
    local: QUALITY_PRESETS.high,
    localUpdatedAt: 5,
    remote: { settings: 'broken', updatedAt: 99 },
  });
  assert.equal(resolved.action, 'push');
  assert.equal(resolved.settings.fps, 60);
});

test('最近修改优先：远端更新拉取，本地更新写回', () => {
  const newerRemote = resolveRemoteSettings({
    local: QUALITY_PRESETS.low,
    localUpdatedAt: 100,
    remote: { settings: { fps: 60, dpr: 2 }, updatedAt: 200 },
  });
  assert.equal(newerRemote.action, 'pull');
  assert.equal(newerRemote.updatedAt, 200);
  assert.equal(newerRemote.settings.fps, 60);
  assert.equal(newerRemote.settings.decorations, QUALITY_PRESETS.low.decorations);

  const newerLocal = resolveRemoteSettings({
    local: QUALITY_PRESETS.high,
    localUpdatedAt: 300,
    remote: { settings: { fps: 30 }, updatedAt: 200 },
  });
  assert.equal(newerLocal.action, 'push');
  assert.equal(newerLocal.settings.fps, 60);

  // 首次登录（本地从未修改）以服务端为准。
  const firstLogin = resolveRemoteSettings({
    local: DEFAULT_SETTINGS,
    localUpdatedAt: 0,
    remote: { settings: { fps: 60 }, updatedAt: 1 },
  });
  assert.equal(firstLogin.action, 'pull');
  assert.equal(firstLogin.settings.fps, 60);

  // 服务端为空时把本地设置写回，完成首次播种。
  const empty = resolveRemoteSettings({ local: DEFAULT_SETTINGS, localUpdatedAt: 0, remote: null });
  assert.equal(empty.action, 'push');
  assert.deepEqual(empty.settings, DEFAULT_SETTINGS);
});

test('保存设置记录本地修改时间，节流写回携带该时间', async () => {
  const storage = memoryStorage();
  saveSettings({ ...QUALITY_PRESETS.high }, storage, { updatedAt: 1234 });
  assert.equal(readSettingsUpdatedAt(storage), 1234);
  assert.equal(JSON.parse(storage.dump()[SETTINGS_KEY]).fps, 60);

  const calls = [];
  const timers = [];
  const sync = new SettingsSync({
    api: {
      async saveSettings(settings, updatedAt) {
        calls.push({ settings, updatedAt });
        return { ok: true };
      },
    },
    storage,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimer: () => {},
    delayMs: SETTINGS_SYNC_DELAY_MS,
  });

  sync.push({ ...QUALITY_PRESETS.low, fps: 60 });
  sync.push({ ...QUALITY_PRESETS.high });
  sync.push({ ...QUALITY_PRESETS.high, showFps: true });

  assert.equal(calls.length, 0, '节流窗口内不发请求');
  assert.equal(timers.length, 1, '多次修改只保留一个定时器');
  assert.equal(timers[0].ms, SETTINGS_SYNC_DELAY_MS);

  timers[0].fn();
  await sync.lastFlush;
  assert.equal(calls.length, 1, '一个节流窗口只发一次请求');
  assert.equal(calls[0].settings.fps, 60);
  assert.equal(calls[0].settings.showFps, true, '发送最后一次修改');
  assert.equal(calls[0].updatedAt, 1234);
});

test('同步失败只影响同步本身，不抛出错误', async () => {
  const storage = memoryStorage();
  const sync = new SettingsSync({
    api: {
      async settings() {
        throw new Error('offline');
      },
    },
    storage,
  });
  await assert.doesNotReject(sync.pull());
  assert.equal(await sync.pull(), null);
  assert.deepEqual(loadSettings(storage), DEFAULT_SETTINGS);

  const pushSync = new SettingsSync({
    api: {
      async saveSettings() {
        throw new Error('offline');
      },
    },
    storage,
    setTimer: () => 1,
    clearTimer: () => {},
  });
  pushSync.push(QUALITY_PRESETS.high);
  await assert.doesNotReject(pushSync.flush());
  assert.equal(await pushSync.flush(), null);
});

test('拉取远端更新后落盘并通知界面', async () => {
  const storage = memoryStorage({
    [SETTINGS_KEY]: JSON.stringify(QUALITY_PRESETS.low),
    [SETTINGS_UPDATED_KEY]: '100',
  });
  let applied = null;
  const sync = new SettingsSync({
    api: {
      async settings() {
        return {
          settings: { fps: 60, dpr: 2, decorations: 'full', floaters: 'all' },
          updatedAt: 200,
        };
      },
    },
    storage,
    onChange: (settings) => {
      applied = settings;
    },
  });
  const result = await sync.pull();
  assert.equal(result.fps, 60);
  assert.equal(result.glow, false, '远端缺失字段沿用本地');
  assert.deepEqual(applied, result);
  assert.deepEqual(loadSettings(storage), result);
  assert.equal(readSettingsUpdatedAt(storage), 200);
});

test('登录后的同步不阻塞进入游戏', () => {
  const source = readFileSync(
    new URL('../public/js/app/controller.js', import.meta.url),
    'utf8'
  );
  assert.match(source, /this\.settingsSync\.pull\(\)\.catch/);
  assert.doesNotMatch(source, /await this\.settingsSync\.pull/);
});

// ---------- 服务端接口 ----------

let server = null;
let session = null;

function api(pathname, { method = 'GET', body, auth = true } = {}) {
  return fetch(`${server.base}${pathname}`, {
    method,
    headers: {
      ...(auth && session ? { cookie: session.rawCookie } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }).then(async (response) => ({
    status: response.status,
    data: await response.json().catch(() => null),
  }));
}

before(async () => {
  server = await startTestServer();
  session = await registerAndLogin(server.base, { username: 'syncuser1' });
});

after(async () => {
  await server?.stop();
});

test('未登录读取或写入设置返回 401', async () => {
  const read = await api('/api/profile/settings', { auth: false });
  assert.equal(read.status, 401);
  assert.equal(read.data.code, 'AUTH_REQUIRED');

  const write = await api('/api/profile/settings', {
    method: 'PUT',
    auth: false,
    body: { settings: QUALITY_PRESETS.low, updatedAt: 1 },
  });
  assert.equal(write.status, 401);
});

test('首次读取为空，写入后跨设备读回归一化设置', async () => {
  const empty = await api('/api/profile/settings');
  assert.equal(empty.status, 200);
  assert.equal(empty.data.settings, null);
  assert.equal(empty.data.updatedAt, 0);

  const saved = await api('/api/profile/settings', {
    method: 'PUT',
    body: { settings: { ...QUALITY_PRESETS.high }, updatedAt: 1000 },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.settings.fps, 60);
  assert.equal(saved.data.updatedAt, 1000);
  assert.equal(saved.data.conflict, false);

  const read = await api('/api/profile/settings');
  assert.deepEqual(read.data.settings, saved.data.settings);
  assert.equal(read.data.updatedAt, 1000);
});

test('非法字段归一化，未知字段不落库', async () => {
  const saved = await api('/api/profile/settings', {
    method: 'PUT',
    body: {
      settings: {
        fps: 45,
        dpr: 3,
        decorations: 'ultra',
        floaters: 'key',
        glow: 'yes',
        sfxVolume: 999,
        extra: 'drop-me',
      },
      updatedAt: 1500,
    },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.settings.fps, 30);
  assert.equal(saved.data.settings.dpr, 1);
  assert.equal(saved.data.settings.decorations, 'light');
  assert.equal(saved.data.settings.glow, false);
  assert.equal(saved.data.settings.sfxVolume, 100);
  assert.equal(saved.data.settings.extra, undefined);

  const read = await api('/api/profile/settings');
  assert.equal(read.data.settings.extra, undefined);
  assert.equal(read.data.settings.floaters, 'key');
});

test('较旧的写入返回服务端版本且不覆盖（最近修改优先）', async () => {
  const stale = await api('/api/profile/settings', {
    method: 'PUT',
    body: { settings: { ...QUALITY_PRESETS.low }, updatedAt: 1200 },
  });
  assert.equal(stale.status, 200);
  assert.equal(stale.data.conflict, true);
  assert.equal(stale.data.updatedAt, 1500);
  assert.equal(stale.data.settings.fps, 30);
  assert.equal(stale.data.settings.floaters, 'key');

  const read = await api('/api/profile/settings');
  assert.equal(read.data.updatedAt, 1500);
  assert.equal(read.data.settings.floaters, 'key', '旧写入没有覆盖服务端');
});

test('设置体积超过上限被拒绝', async () => {
  const oversized = { ...QUALITY_PRESETS.low, junk: 'x'.repeat(SETTINGS_MAX_BYTES) };
  assert.ok(settingsPayloadBytes(oversized) > SETTINGS_MAX_BYTES);
  const response = await api('/api/profile/settings', {
    method: 'PUT',
    body: { settings: oversized, updatedAt: 2000 },
  });
  assert.equal(response.status, 413);
  assert.equal(response.data.code, 'SETTINGS_TOO_LARGE');

  const read = await api('/api/profile/settings');
  assert.equal(read.data.updatedAt, 1500, '被拒绝的写入不改变服务端状态');
});

test('存储损坏时读回空值，随后写入可修复', async () => {
  const db = new DatabaseSync(server.dbPath);
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.prepare("UPDATE player_kv SET value_json = '{bad json' WHERE namespace = 'settings'").run();
  } finally {
    db.close();
  }

  const corrupt = await api('/api/profile/settings');
  assert.equal(corrupt.status, 200);
  assert.equal(corrupt.data.settings, null);
  assert.equal(corrupt.data.corrupt, true);

  const repaired = await api('/api/profile/settings', {
    method: 'PUT',
    body: { settings: { ...QUALITY_PRESETS.high }, updatedAt: 3000 },
  });
  assert.equal(repaired.status, 200);
  assert.equal(repaired.data.settings.fps, 60);

  const read = await api('/api/profile/settings');
  assert.equal(read.data.corrupt, false);
  assert.equal(read.data.settings.fps, 60);
});
