// 抽卡数据层测试：稀有度映射、池/概率/价格/保底/碎片常量、rollGacha 确定性抽取、
// 迁移 0012 幂等、drawGachaInTx 单事务落库、unlock 增量购买不清掉抽卡授予的塔。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { TOWER_RARITY, RARITY_BY_STAR, RARITY_LABELS } from '../public/js/shared/data/towers-rarity.js';
import {
  GACHA_POOL_TOWER_IDS,
  GACHA_PRICE,
  GACHA_PITY,
  GACHA_RATES,
  GACHA_SHARDS,
  rollGacha,
} from '../public/js/shared/data/gacha.js';
import { TOWERS, TOWER_ORDER } from '../public/js/shared/data.js';
import { RNG } from '../public/js/shared/rng.js';
import { startServer } from './test-server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 注入式随机源：按给定序列出数，便于对边界做确定性断言。
function queueRng(floats) {
  let i = 0;
  return { float: () => (i < floats.length ? floats[i++] : 0.5) };
}

function newToken(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function api(base, pathname, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${base}${pathname}`, {
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

test('塔稀有度映射与冻结表 §1 一致（8 塔、档位、池资格、战斗数值不漂移）', () => {
  assert.deepEqual(Object.keys(TOWER_RARITY).sort(), [...TOWER_ORDER].sort());
  assert.equal(TOWER_RARITY.sniper.star, 6);
  assert.equal(TOWER_RARITY.sniper.rarity, 'legendary');
  assert.equal(TOWER_RARITY.arc.star, 5);
  assert.equal(TOWER_RARITY.arc.rarity, 'epic');
  assert.equal(TOWER_RARITY.banner.star, 4);
  assert.equal(TOWER_RARITY.banner.rarity, 'rare');
  assert.equal(TOWER_RARITY.poison.star, 3);
  assert.equal(TOWER_RARITY.shock.star, 3);
  assert.equal(TOWER_RARITY.poison.rarity, 'common');
  assert.equal(TOWER_RARITY.shock.rarity, 'common');
  for (const id of ['arrow', 'cannon', 'frost']) {
    assert.equal(TOWER_RARITY[id].star, 1, `${id} 应为 1★`);
    assert.equal(TOWER_RARITY[id].rarity, 'basic');
    assert.equal(TOWER_RARITY[id].poolable, false, `${id} 免费不进池`);
  }
  for (const id of ['sniper', 'arc', 'banner', 'poison', 'shock']) {
    assert.equal(TOWER_RARITY[id].poolable, true, `${id} 应可抽`);
  }
  assert.equal(RARITY_BY_STAR[6], 'legendary');
  assert.equal(RARITY_LABELS.legendary, '传说');
  // 稀有度只做展示分层：战斗数值仍来自 towers.js，未耦合稀有度。
  assert.equal(TOWERS.sniper.cost, 145);
  assert.equal(TOWERS.arrow.unlock, undefined, '免费塔护栏不得被稀有度破坏');
});

test('抽卡配置常量与冻结表 §2-3 一致', () => {
  assert.deepEqual(GACHA_RATES, { 6: 0.05, 5: 0.12, 4: 0.28, 3: 0.55 });
  assert.deepEqual(GACHA_PRICE, { single: 15, ten: 150 });
  assert.deepEqual(GACHA_PITY, { softStart: 30, softStep: 0.02, hardCap: 60 });
  assert.deepEqual(GACHA_SHARDS, { 6: 40, 5: 20, 4: 10, 3: 5 });
  assert.deepEqual(GACHA_POOL_TOWER_IDS, ['sniper', 'arc', 'banner', 'poison', 'shock']);
});

test('rollGacha 权重：6/5/4/3 边界由注入随机数精确判定', () => {
  // 6★：float < 0.05
  const six = rollGacha(queueRng([0.04, 0.0]), 1, [], 0);
  assert.equal(six.results[0].star, 6);
  assert.equal(six.results[0].towerId, 'sniper');
  assert.equal(six.results[0].rarity, 'legendary');
  assert.equal(six.pity6, 0);

  // 5★：6★ 判定 0.9 不中，档位 roll = 0.10*0.95 = 0.095 < 0.12
  const five = rollGacha(queueRng([0.9, 0.10, 0.0]), 1, [], 0);
  assert.equal(five.results[0].star, 5);
  assert.equal(five.results[0].towerId, 'arc');

  // 4★：0.30*0.95 = 0.285，落在 [0.12, 0.40)
  const four = rollGacha(queueRng([0.9, 0.30, 0.0]), 1, [], 0);
  assert.equal(four.results[0].star, 4);
  assert.equal(four.results[0].towerId, 'banner');

  // 3★：0.90*0.95 = 0.855 ≥ 0.40，float 0.0 选第一个 3★ 塔（poison）
  const three = rollGacha(queueRng([0.9, 0.90, 0.0]), 1, [], 0);
  assert.equal(three.results[0].star, 3);
  assert.equal(three.results[0].towerId, 'poison');
});

test('rollGacha 软/硬保底：30 抽后 +2%、60 抽必出', () => {
  // pity=29（第 30 抽）仍是基础 5%，float 0.06 不中 6★
  const at29 = rollGacha(queueRng([0.06, 0.90, 0.0]), 1, [], 29);
  assert.notEqual(at29.results[0].star, 6);
  assert.equal(at29.pity6, 30);

  // pity=30（第 31 抽）概率 7%，float 0.06 命中 6★
  const at30 = rollGacha(queueRng([0.06, 0.0]), 1, [], 30);
  assert.equal(at30.results[0].star, 6);
  assert.equal(at30.pity6, 0);

  // pity=59（第 60 抽）硬保底，即便 float 0.99 也必出
  const at59 = rollGacha(queueRng([0.99, 0.0]), 1, [], 59);
  assert.equal(at59.results[0].star, 6);
  assert.equal(at59.pity6, 0);
});

test('rollGacha 十连保底：全 3★ 时末位强制升档 4★', () => {
  // 每抽 3★ 消耗 3 个随机数（6★ 判定 0.9、档位 0.9、选塔 0.0），共 30 个；末位升档再耗 1 个。
  const floats = [];
  for (let i = 0; i < 10; i += 1) floats.push(0.9, 0.9, 0.0);
  floats.push(0.0);
  const roll = rollGacha(queueRng(floats), 10, [], 0);
  assert.equal(roll.results.length, 10);
  for (let i = 0; i < 9; i += 1) assert.equal(roll.results[i].star, 3);
  assert.equal(roll.results[9].star, 4);
  assert.equal(roll.results[9].towerId, 'banner');
  assert.equal(roll.results[9].isNew, true);
  assert.equal(roll.pity6, 10);
});

test('rollGacha 首 6★ 必未拥有、重复转碎片', () => {
  const fresh = rollGacha(queueRng([0.04, 0.0]), 1, [], 0);
  assert.equal(fresh.results[0].towerId, 'sniper');
  assert.equal(fresh.results[0].isNew, true);
  assert.equal(fresh.results[0].shards, 0);

  const dupe6 = rollGacha(queueRng([0.04, 0.0]), 1, ['sniper'], 0);
  assert.equal(dupe6.results[0].towerId, 'sniper');
  assert.equal(dupe6.results[0].isNew, false);
  assert.equal(dupe6.results[0].shards, 40);

  const dupe5 = rollGacha(queueRng([0.9, 0.10, 0.0]), 1, ['arc'], 0);
  assert.equal(dupe5.results[0].shards, 20);
  const dupe4 = rollGacha(queueRng([0.9, 0.30, 0.0]), 1, ['banner'], 0);
  assert.equal(dupe4.results[0].shards, 10);
  const dupe3 = rollGacha(queueRng([0.9, 0.90, 0.0]), 1, ['poison', 'shock'], 0);
  assert.equal(dupe3.results[0].shards, 5);
});

test('rollGacha 同种子同结果（确定性可复现）', () => {
  const a = rollGacha(new RNG('gacha-seed'), 10, ['arc'], 5);
  const b = rollGacha(new RNG('gacha-seed'), 10, ['arc'], 5);
  assert.deepEqual(a, b);
  assert.equal(a.results.length, 10);
});

test('rollGacha 权重统计：固定种子下 6★ 占比与 5/4/3 相对比例落在目标区间', () => {
  const rng = new RNG('gacha-weights');
  let pity = 0;
  const tiers = { 6: 0, 5: 0, 4: 0, 3: 0 };
  const N = 30000;
  for (let i = 0; i < N; i += 1) {
    const { results, pity6 } = rollGacha(rng, 1, [], pity);
    tiers[results[0].star] += 1;
    pity = pity6;
  }
  const rate6 = tiers[6] / N;
  assert.ok(rate6 >= 0.04 && rate6 <= 0.09, `6★ 占比越界：${rate6}`);
  const non6 = tiers[5] + tiers[4] + tiers[3];
  assert.ok(Math.abs(tiers[5] / non6 - 12 / 95) < 0.02, `5★ 相对比例漂移：${tiers[5] / non6}`);
  assert.ok(Math.abs(tiers[4] / non6 - 28 / 95) < 0.02, `4★ 相对比例漂移：${tiers[4] / non6}`);
  assert.ok(Math.abs(tiers[3] / non6 - 55 / 95) < 0.02, `3★ 相对比例漂移：${tiers[3] / non6}`);
});

test('迁移 0012 可 apply 且幂等，gacha_history 带 (account_id, id DESC) 索引', async () => {
  const dbPath = path.join(os.tmpdir(), `rtd-gacha-migration-${process.pid}-${Date.now()}.db`);
  const raw = new DatabaseSync(dbPath);
  raw.exec('CREATE TABLE accounts (id TEXT PRIMARY KEY)');
  try {
    const migration = await import('../server/db/migrations/0012_gacha.mjs');
    migration.up(raw);
    migration.up(raw); // 幂等：再跑不报错
    const table = raw
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='gacha_history'")
      .get();
    assert.ok(table, 'gacha_history 表缺失');
    const index = raw
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='gacha_history' AND name='idx_gacha_history_account'"
      )
      .get();
    assert.ok(index, '缺 (account_id, id DESC) 索引');
    assert.match(index.sql, /account_id/);
    assert.match(index.sql, /id\s+DESC/);
  } finally {
    raw.close();
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.rmSync(`${dbPath}${suffix}`, { force: true });
      } catch {
        /* ignore */
      }
    }
  }
});

test('drawGachaInTx 单事务落库 + unlock 增量购买不清掉抽卡授予的塔', async () => {
  const DB = path.join(os.tmpdir(), `rtd-gacha-draw-${process.pid}-${Date.now()}.db`);
  const server = await startServer({ cwd: ROOT, dbPath: DB, env: { AUTH_ENABLED: '0' } });
  try {
    process.env.DB_PATH = DB;
    const dbModule = await import('../server/db.mjs');
    dbModule.db.exec('PRAGMA busy_timeout = 3000');

    // 迁移 0012 随启动 apply，且 up 可重复执行（幂等）。
    const versions = dbModule.db
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all()
      .map((row) => row.version);
    assert.ok(versions.includes(12), '0012 迁移未 apply');
    const migration = await import('../server/db/migrations/0012_gacha.mjs');
    migration.up(dbModule.db);

    // 通过 profile 建立 legacy 账号，得到 accountId。
    const token = newToken('gacha');
    const prof = await api(server.base, '/api/profile', { token });
    assert.equal(prof.status, 200);
    const accountId = prof.data.profile.accountId;

    dbModule.grantCores(accountId, 150);
    const draw = dbModule.drawGachaInTx(accountId, {
      count: 10,
      requestId: 'req-1',
      rng: new RNG('gacha-draw'),
    });
    assert.equal(draw.ok, true);
    assert.equal(draw.results.length, 10);
    assert.equal(dbModule.getCores(accountId), 0, '十连应扣 150 星核');
    assert.equal(dbModule.readGachaHistory(accountId, 100).length, 10, '历史应落 10 行');
    assert.equal(dbModule.readGachaPity6(accountId), draw.pity6);

    const profileAfterDraw = dbModule.getProfile(accountId);
    for (const entry of draw.results) {
      if (entry.isNew) {
        assert.ok(
          profileAfterDraw.unlocks.includes(`tower_${entry.towerId}`),
          `新塔未授予：${entry.towerId}`
        );
      }
    }

    // unlock 增量：抽卡授予的塔（这里再补一个 arc）不被 perk 购买清掉。
    dbModule.grantCores(accountId, 100);
    dbModule.grantUnlock(accountId, 'tower_arc');
    const bought = await api(server.base, '/api/unlock', {
      method: 'POST',
      token,
      body: { unlockId: 'start_gold' },
    });
    assert.equal(bought.status, 200);
    const after = await api(server.base, '/api/profile', { token });
    assert.ok(after.data.profile.unlocks.includes('tower_arc'), '抽卡授予的塔被清掉');
    assert.ok(after.data.profile.unlocks.includes('start_gold'), 'perk 未购买成功');
  } finally {
    server.kill('SIGTERM');
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.rmSync(`${DB}${suffix}`, { force: true });
      } catch {
        /* ignore */
      }
    }
  }
});

// ---------- 路由层 /api/gacha/* ----------
// 路由测试只走 HTTP + 直读同一个临时 DB（服务端 WAL，跨进程读写安全），
// 刻意不 import server/db.mjs：那是进程级单例，多个测试切换 DB_PATH 会互相串味。

async function openGachaServer() {
  const dbPath = path.join(
    os.tmpdir(),
    `rtd-gacha-api-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`
  );
  const server = await startServer({ cwd: ROOT, dbPath, env: { AUTH_ENABLED: '0' } });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA busy_timeout = 5000');
  return {
    server,
    db,
    async close() {
      try {
        db.close();
      } catch {
        /* ignore */
      }
      await server.stop();
    },
  };
}

async function newAccount(server) {
  const token = newToken('gacha-api');
  const prof = await api(server.base, '/api/profile', { token });
  assert.equal(prof.status, 200);
  return { token, accountId: prof.data.profile.accountId };
}

// 测试侧直接写钱包/保底：生产路径没有「发星核」HTTP 接口，这里把账户预置成被测状态。
function seedCores(db, accountId, balance) {
  db.prepare(
    `INSERT INTO player_wallets (account_id, currency_id, balance, updated_at)
     VALUES (?, 'cores', ?, ?)
     ON CONFLICT(account_id, currency_id) DO UPDATE SET
       balance = excluded.balance, updated_at = excluded.updated_at`
  ).run(accountId, balance, Date.now());
}

function seedPity(db, accountId, pity) {
  db.prepare(
    `INSERT INTO player_kv (account_id, namespace, key, value_json, updated_at)
     VALUES (?, 'gacha', 'pity6', ?, ?)
     ON CONFLICT(account_id, namespace, key) DO UPDATE SET
       value_json = excluded.value_json, updated_at = excluded.updated_at`
  ).run(accountId, JSON.stringify(pity), Date.now());
}

function walletBalance(db, accountId) {
  return (
    db
      .prepare("SELECT balance FROM player_wallets WHERE account_id = ? AND currency_id = 'cores'")
      .get(accountId)?.balance ?? 0
  );
}

function historyRows(db, accountId) {
  return db
    .prepare('SELECT * FROM gacha_history WHERE account_id = ? ORDER BY id ASC')
    .all(accountId);
}

test('GET /api/gacha/pool 的 rates/price 与 gacha.js 常量同源，并带余额/保底/拥有/碎片', async () => {
  const { server, db, close } = await openGachaServer();
  try {
    const { token, accountId } = await newAccount(server);
    seedCores(db, accountId, 120);
    const res = await api(server.base, '/api/gacha/pool', { token });
    assert.equal(res.status, 200);
    assert.equal(res.data.currency, 'cores');
    assert.equal(res.data.balance, 120);
    assert.deepEqual(res.data.price, GACHA_PRICE);
    assert.deepEqual(res.data.rates, GACHA_RATES);
    assert.equal(res.data.pity6, 0);
    assert.deepEqual(res.data.shards, {});
    // 免费三塔恒拥有，可抽五塔尚未拥有。
    assert.deepEqual(res.data.owned, ['arrow', 'cannon', 'frost']);
  } finally {
    await close();
  }
});

test('POST /api/gacha/draw 单抽：扣费、落库、记历史、更新保底、授予新塔', async () => {
  const { server, db, close } = await openGachaServer();
  try {
    const { token, accountId } = await newAccount(server);
    seedCores(db, accountId, 40);
    const res = await api(server.base, '/api/gacha/draw', {
      method: 'POST',
      token,
      body: { count: 1, request_id: 'single-1' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.results.length, 1);
    const [entry] = res.data.results;
    assert.deepEqual(Object.keys(entry).sort(), ['isNew', 'rarity', 'shards', 'towerId']);
    assert.ok(GACHA_POOL_TOWER_IDS.includes(entry.towerId), `出了池外塔：${entry.towerId}`);
    // 单抽扣 15，余额归零。
    assert.equal(res.data.balance, 25);
    assert.equal(walletBalance(db, accountId), 25);
    // 首次抽卡不可能重复：池塔全都未拥有，必是新塔、无碎片。
    assert.equal(entry.isNew, true);
    assert.equal(entry.shards, 0);
    // 保底：出 6★ 清零，否则 +1。
    assert.equal(res.data.pity6, entry.rarity === RARITY_BY_STAR[6] ? 0 : 1);
    // 历史落库带 request_id，供幂等重放。
    const rows = historyRows(db, accountId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].tower_id, entry.towerId);
    assert.equal(rows[0].request_id, 'single-1');
    // 新塔写进 player_unlocks（与 unlockedTowerIds 同一 key 空间）。
    const prof = await api(server.base, '/api/profile', { token });
    assert.ok(prof.data.profile.unlocks.includes(`tower_${entry.towerId}`), '新塔未授予');
  } finally {
    await close();
  }
});

test('POST /api/gacha/draw 十连：扣 150、落 10 条历史、保底计数与出货序列一致', async () => {
  const { server, db, close } = await openGachaServer();
  try {
    const { token, accountId } = await newAccount(server);
    seedCores(db, accountId, 150);
    const res = await api(server.base, '/api/gacha/draw', {
      method: 'POST',
      token,
      body: { count: 10, request_id: 'ten-1' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.results.length, 10);
    assert.equal(res.data.balance, 0, '十连应按 150 扣费');
    const rows = historyRows(db, accountId);
    assert.equal(rows.length, 10);
    assert.ok(res.data.results.every((entry) => GACHA_POOL_TOWER_IDS.includes(entry.towerId)));
    // 保底计数 = 距最近一次 6★ 的抽数（初始 0），用出货序列自洽校验。
    let pity = 0;
    for (const entry of res.data.results) {
      pity = entry.rarity === RARITY_BY_STAR[6] ? 0 : pity + 1;
    }
    assert.equal(res.data.pity6, pity);
    const prof = await api(server.base, '/api/profile', { token });
    for (const entry of res.data.results) {
      if (entry.isNew) {
        assert.ok(prof.data.profile.unlocks.includes(`tower_${entry.towerId}`), '新塔未授予');
      } else {
        assert.ok(entry.shards > 0, '重复塔应转碎片');
      }
    }
  } finally {
    await close();
  }
});

test('余额不足 / 非法次数：拒绝且不改任何状态', async () => {
  const { server, db, close } = await openGachaServer();
  try {
    const { token, accountId } = await newAccount(server);
    seedCores(db, accountId, 14);

    const single = await api(server.base, '/api/gacha/draw', {
      method: 'POST',
      token,
      body: { count: 1, request_id: 'poor-1' },
    });
    assert.equal(single.status, 400);
    assert.equal(single.data.code, 'INSUFFICIENT_CORES');

    // 15 核够单抽但不够十连：必须整单拒绝，不能扣掉零头。
    const ten = await api(server.base, '/api/gacha/draw', {
      method: 'POST',
      token,
      body: { count: 10, request_id: 'poor-10' },
    });
    assert.equal(ten.status, 400);
    assert.equal(ten.data.code, 'INSUFFICIENT_CORES');

    const invalid = await api(server.base, '/api/gacha/draw', {
      method: 'POST',
      token,
      body: { count: 3, request_id: 'bad-count' },
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.data.code, 'INVALID_COUNT');

    assert.equal(walletBalance(db, accountId), 14, '拒绝的请求不得改余额');
    assert.equal(historyRows(db, accountId).length, 0, '拒绝的请求不得落历史');
    const pool = await api(server.base, '/api/gacha/pool', { token });
    assert.equal(pool.data.pity6, 0, '拒绝的请求不得动保底');
  } finally {
    await close();
  }
});

test('request_id 幂等：同一 id 重试不重复扣费、返回首次结果；并发重试同样只扣一次', async () => {
  const { server, db, close } = await openGachaServer();
  try {
    const { token, accountId } = await newAccount(server);
    seedCores(db, accountId, 30);
    const body = { count: 1, request_id: 'retry-1' };
    const first = await api(server.base, '/api/gacha/draw', { method: 'POST', token, body });
    const second = await api(server.base, '/api/gacha/draw', { method: 'POST', token, body });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.deepEqual(second.data.results, first.data.results, '重放必须返回首次结果');
    assert.equal(second.data.balance, first.data.balance);
    assert.equal(walletBalance(db, accountId), 15, '重试不得二次扣费');
    assert.equal(historyRows(db, accountId).length, 1, '重试不得重复落库');

    // 并发重试：两个请求同时在途，仍然只有一次扣费/一次抽取。
    const raceBody = { count: 1, request_id: 'race-1' };
    const [a, b] = await Promise.all([
      api(server.base, '/api/gacha/draw', { method: 'POST', token, body: raceBody }),
      api(server.base, '/api/gacha/draw', { method: 'POST', token, body: raceBody }),
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.deepEqual(b.data.results, a.data.results);
    assert.equal(walletBalance(db, accountId), 0, '并发重试只能扣一次');
    assert.equal(historyRows(db, accountId).length, 2);

    // 换一个 request_id 才是新的一次抽取。
    const fresh = await api(server.base, '/api/gacha/draw', {
      method: 'POST',
      token,
      body: { count: 1, request_id: 'retry-2' },
    });
    assert.equal(fresh.status, 400, '余额已用完，新 id 不会重放旧结果');
    assert.equal(fresh.data.code, 'INSUFFICIENT_CORES');
    assert.equal(historyRows(db, accountId).length, 2);
  } finally {
    await close();
  }
});

test('硬保底 60 抽：pity6=59 时下一抽必出 6★，且首个 6★ 必未拥有', async () => {
  const { server, db, close } = await openGachaServer();
  try {
    const { token, accountId } = await newAccount(server);
    seedCores(db, accountId, 15);
    seedPity(db, accountId, GACHA_PITY.hardCap - 1);
    const res = await api(server.base, '/api/gacha/draw', {
      method: 'POST',
      token,
      body: { count: 1, request_id: 'pity-1' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.results[0].rarity, RARITY_BY_STAR[6]);
    assert.equal(res.data.results[0].isNew, true, '首个 6★ 必未拥有');
    assert.equal(res.data.pity6, 0, '出 6★ 后保底清零');
    const rows = historyRows(db, accountId);
    assert.equal(rows[0].rarity, RARITY_BY_STAR[6]);
  } finally {
    await close();
  }
});

test('GET /api/gacha/history 脱敏、按时间倒序、limit 生效', async () => {
  const { server, db, close } = await openGachaServer();
  try {
    const { token, accountId } = await newAccount(server);
    seedCores(db, accountId, 30);
    const first = await api(server.base, '/api/gacha/draw', {
      method: 'POST',
      token,
      body: { count: 1, request_id: 'hist-1' },
    });
    const second = await api(server.base, '/api/gacha/draw', {
      method: 'POST',
      token,
      body: { count: 1, request_id: 'hist-2' },
    });
    const res = await api(server.base, '/api/gacha/history', { token });
    assert.equal(res.status, 200);
    assert.equal(res.data.history.length, 2);
    const [latest, earlier] = res.data.history;
    assert.deepEqual(Object.keys(latest).sort(), ['drawnAt', 'isNew', 'rarity', 'shards', 'towerId']);
    assert.equal(latest.towerId, second.data.results[0].towerId, '倒序：最新一条在最前');
    assert.equal(earlier.towerId, first.data.results[0].towerId);
    assert.ok(latest.drawnAt >= earlier.drawnAt);
    // 脱敏：不下发账号/请求标识。
    const text = JSON.stringify(res.data);
    assert.ok(!text.includes(accountId), '历史泄漏了 account_id');
    assert.ok(!text.includes('request_id'), '历史泄漏了 request_id');

    const limited = await api(server.base, '/api/gacha/history?limit=1', { token });
    assert.equal(limited.data.history.length, 1);
    assert.equal(limited.data.history[0].towerId, latest.towerId);
  } finally {
    await close();
  }
});
