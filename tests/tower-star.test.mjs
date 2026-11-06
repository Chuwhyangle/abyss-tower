// 塔升星：星级纯函数边界、升星消耗星核的持久化与接口接线。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { TOWERS } from '../public/js/shared/data.js';
import {
  TOWER_STAR_MAX,
  TOWER_STAR_COST,
  normalizeTowerStars,
  towerStarOf,
  towerStarTowerIds,
  towerStarUpCost,
} from '../public/js/shared/data/unlocks.js';
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
  return { cookie: setCookie.split(';')[0], accountId: data.profile.accountId };
}

function openDb() {
  const db = new DatabaseSync(server.dbPath);
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

function grantCores(accountId, amount) {
  const db = openDb();
  try {
    db.prepare(
      `INSERT INTO player_wallets (account_id, currency_id, balance, updated_at)
       VALUES (?, 'cores', ?, ?)
       ON CONFLICT(account_id, currency_id) DO UPDATE SET
         balance = balance + excluded.balance, updated_at = excluded.updated_at`
    ).run(accountId, Math.max(0, Math.floor(amount)), Date.now());
  } finally {
    db.close();
  }
}

function grantUnlock(accountId, unlockId) {
  const db = openDb();
  try {
    db.prepare(
      `INSERT OR IGNORE INTO player_unlocks (account_id, unlock_id, unlocked_at, meta)
       VALUES (?, ?, ?, '{}')`
    ).run(accountId, unlockId, Date.now());
  } finally {
    db.close();
  }
}

function readCores(accountId) {
  const db = openDb();
  try {
    const row = db
      .prepare("SELECT balance FROM player_wallets WHERE account_id = ? AND currency_id = 'cores'")
      .get(accountId);
    return Math.max(0, Math.floor(Number(row?.balance) || 0));
  } finally {
    db.close();
  }
}

before(async () => {
  server = await startTestServer();
});

after(async () => {
  await server?.stop();
});

test('升星花费按星级逐级递增，满级封顶', () => {
  assert.deepEqual(TOWER_STAR_COST, { 2: 30, 3: 60, 4: 120, 5: 240 });
  assert.equal(TOWER_STAR_MAX, 5);
  assert.equal(towerStarUpCost(1), 30);
  assert.equal(towerStarUpCost(2), 60);
  assert.equal(towerStarUpCost(4), 240);
  assert.equal(towerStarUpCost(5), null);
  assert.equal(towerStarUpCost(99), null);
  assert.equal(towerStarUpCost(0), 30, '非法星级回退 1★ 后按 1★ 计费');
  assert.equal(towerStarUpCost('x'), 30);
});

test('可升星塔只含可解锁塔，基础免费塔不参与', () => {
  const ids = towerStarTowerIds();
  assert.deepEqual(ids, ['arc', 'poison', 'banner', 'shock', 'sniper']);
  for (const id of ids) {
    assert.ok(TOWERS[id].unlock, `${id} 应引用解锁项`);
  }
  for (const id of ['arrow', 'cannon', 'frost']) {
    assert.ok(!ids.includes(id), `${id} 基础塔不应可升星`);
  }
});

test('星级归一化：脏输入收敛到合法星级集合', () => {
  assert.deepEqual(normalizeTowerStars(null), { stars: {} });
  assert.deepEqual(normalizeTowerStars('junk'), { stars: {} });
  assert.deepEqual(normalizeTowerStars({ stars: { arc: 9, arrow: 3 } }), { stars: { arc: 5 } });
  assert.deepEqual(normalizeTowerStars({ stars: { arc: 0, sniper: 2 } }), { stars: { sniper: 2 } });
  assert.equal(towerStarOf({ stars: { arc: 3 } }, 'arc'), 3);
  assert.equal(towerStarOf({ stars: {} }, 'arc'), 1);
  assert.equal(towerStarOf(null, 'arc'), 1);
});

test('未登录不能读取或升星', async () => {
  assert.equal((await api('/api/tower-star')).status, 401);
  assert.equal(
    (await api('/api/tower-star/upgrade', { method: 'POST', body: { towerId: 'arc' } })).status,
    401
  );
});

test('新账号无星级、无星核，所有可升星塔均未拥有', async () => {
  const username = `tstar${Date.now().toString(36).slice(-8)}`;
  const registered = await register(username);
  cookie = registered.cookie;
  accountId = registered.accountId;
  assert.ok(accountId);

  const { status, data } = await jsonApi('/api/tower-star');
  assert.equal(status, 200);
  assert.equal(data.cores, 0);
  assert.deepEqual(data.stars, {});
  assert.equal(data.towers.length, towerStarTowerIds().length);
  for (const tower of data.towers) {
    assert.equal(tower.owned, false);
    assert.equal(tower.star, 1);
    assert.equal(tower.maxStar, TOWER_STAR_MAX);
    assert.equal(typeof tower.cost, 'number');
    assert.equal(tower.canUpgrade, false);
  }
});

test('未拥有/基础塔升星被拒绝', async () => {
  const locked = await jsonApi('/api/tower-star/upgrade', {
    method: 'POST',
    body: { towerId: 'arc' },
  });
  assert.equal(locked.status, 403);
  assert.equal(locked.data.code, 'TOWER_LOCKED');

  const base = await jsonApi('/api/tower-star/upgrade', {
    method: 'POST',
    body: { towerId: 'arrow' },
  });
  assert.equal(base.status, 400);
  assert.equal(base.data.code, 'INVALID_TOWER');

  const unknown = await jsonApi('/api/tower-star/upgrade', {
    method: 'POST',
    body: { towerId: 'no_such_tower' },
  });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.data.code, 'INVALID_TOWER');
});

test('升星扣除星核并写入星级，余额不足整段回滚，满级封顶', async () => {
  grantCores(accountId, 30);
  grantUnlock(accountId, 'tower_arc');

  const first = await jsonApi('/api/tower-star/upgrade', {
    method: 'POST',
    body: { towerId: 'arc' },
  });
  assert.equal(first.status, 200);
  assert.equal(first.data.stars.arc, 2);
  assert.equal(first.data.cores, 0);
  assert.equal(first.data.upgraded.towerId, 'arc');
  assert.equal(first.data.upgraded.from, 1);
  assert.equal(first.data.upgraded.to, 2);
  assert.equal(first.data.upgraded.cost, 30);
  assert.equal(readCores(accountId), 0);

  const broke = await jsonApi('/api/tower-star/upgrade', {
    method: 'POST',
    body: { towerId: 'arc' },
  });
  assert.equal(broke.status, 400);
  assert.equal(broke.data.code, 'INSUFFICIENT_CORES');
  assert.equal(readCores(accountId), 0, '余额不足时不得改动钱包');

  // 从 2★ 升到 5★ 需 60 + 120 + 240 = 420。
  grantCores(accountId, 420);
  for (const expected of [3, 4, 5]) {
    const upgraded = await jsonApi('/api/tower-star/upgrade', {
      method: 'POST',
      body: { towerId: 'arc' },
    });
    assert.equal(upgraded.status, 200);
    assert.equal(upgraded.data.stars.arc, expected);
  }
  assert.equal(readCores(accountId), 0);

  const maxed = await jsonApi('/api/tower-star/upgrade', {
    method: 'POST',
    body: { towerId: 'arc' },
  });
  assert.equal(maxed.status, 409);
  assert.equal(maxed.data.code, 'TOWER_STAR_MAXED');

  const listed = await jsonApi('/api/tower-star');
  assert.equal(listed.status, 200);
  assert.equal(listed.data.stars.arc, 5);
  const arc = listed.data.towers.find((tower) => tower.id === 'arc');
  assert.equal(arc.star, 5);
  assert.equal(arc.cost, null);
  assert.equal(arc.canUpgrade, false);
});
