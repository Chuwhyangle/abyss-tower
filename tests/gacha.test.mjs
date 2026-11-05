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
