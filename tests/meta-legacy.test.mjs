// 跨局传承（AC-064）：产出规则、与星核分账、重复结算防护、快照/旧档兼容。
// 纯函数（legacyYield / normalizeLegacy）与 DB 持久化（grant/spend/read）分层验证。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DB_PATH = path.join(os.tmpdir(), `rtd-meta-legacy-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = DB_PATH;
process.env.DB_BACKUP = '0';

// 纯函数（不 import DB，可静态导入）。
import { LEGACY_MATERIALS, legacyYield, normalizeLegacy } from '../public/js/shared/data/meta.js';
import { computeOutcome } from '../public/js/shared/scoring.js';

// DB 层：静态 import 会被提升到 process.env.DB_PATH 赋值之前，故必须动态导入。
let db;
let createAccount;
let createProfile;
let getCores;
let grantCores;
let transaction;
let readLegacy;
let grantLegacyInTx;
let spendLegacyInTx;

before(async () => {
  ({ db } = await import('../server/db/index.mjs'));
  ({ createAccount } = await import('../server/db/accounts.mjs'));
  ({ createProfile, getCores, grantCores, transaction } = await import('../server/db.mjs'));
  ({ readLegacy, grantLegacyInTx, spendLegacyInTx } = await import('../server/db/legacy.mjs'));
});

after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(`${DB_PATH}${suffix}`, { force: true });
    } catch {
      /* ignore */
    }
  }
});

function seedAccount(username) {
  const account = createAccount({ kind: 'registered', username });
  createProfile(account.id);
  return account.id;
}

test('normalizeLegacy：旧档/损坏输入收敛到零材料，bank 恒等于 materials 求和', () => {
  assert.deepEqual(normalizeLegacy(null), { materials: {}, bank: 0 });
  assert.deepEqual(normalizeLegacy(undefined), { materials: {}, bank: 0 });
  assert.deepEqual(normalizeLegacy({}), { materials: {}, bank: 0 });
  assert.deepEqual(normalizeLegacy('garbage'), { materials: {}, bank: 0 });
  assert.deepEqual(normalizeLegacy({ materials: { legacy_core: 7 } }), {
    materials: { legacy_core: 7 },
    bank: 7,
  });
  // 损坏的 bank 字段被重算，不参与双计；未知材料 id 被丢弃。
  assert.deepEqual(normalizeLegacy({ materials: { legacy_core: 3, bogus: 99 }, bank: 999 }), {
    materials: { legacy_core: 3 },
    bank: 3,
  });
  assert.deepEqual(normalizeLegacy({ materials: { legacy_core: -5 } }), {
    materials: {},
    bank: 0,
  });
});

test('legacyYield：确定性、无 RNG，按波次/击杀/通关表现线性产出', () => {
  const a = legacyYield({ waveReached: 10, kills: 42, victory: false });
  const b = legacyYield({ waveReached: 10, kills: 42, victory: false });
  assert.deepEqual(a, b, '同输入必须逐字节一致');
  assert.deepEqual(a, { materials: { legacy_core: 14 }, bank: 14 });
  assert.equal(legacyYield({ waveReached: 3, kills: 0, victory: false }).bank, 3);
  assert.equal(legacyYield({ waveReached: 30, kills: 200, victory: true }).bank, 55);
  assert.deepEqual(legacyYield({}), { materials: {}, bank: 0 });
  assert.deepEqual(legacyYield(null), { materials: {}, bank: 0 });
});

test('legacyYield 与星核分账：两套独立公式，产出互不混用', () => {
  const run = {
    waveReached: 18,
    kills: 120,
    goldLeft: 900,
    baseHp: 40,
    difficulty: 'standard',
    mode: 'normal',
  };
  const outcome = computeOutcome(run);
  const legacy = legacyYield(run);
  assert.ok(outcome.cores > 0, '星核按 scoring 公式产出');
  assert.ok(legacy.bank > 0, '传承材料按 legacyYield 产出');
  // 星核走 scoring.computeOutcome 的 cores，传承走 meta.js 的 legacyYield，两者口径不同且独立。
  assert.notEqual(outcome.cores, legacy.bank);
  assert.equal(outcome.cores, computeOutcome(run).cores);
  assert.equal(legacy.bank, legacyYield(run).bank);
});

test('LEGACY_MATERIALS 定义表完整且可索引', () => {
  assert.ok(Array.isArray(LEGACY_MATERIALS) && LEGACY_MATERIALS.length >= 1);
  for (const material of LEGACY_MATERIALS) {
    assert.ok(material.id, '材料必须带 id');
    assert.ok(material.name, '材料必须带 name');
    assert.ok(material.source, '材料必须带 source');
    assert.ok(material.sink, '材料必须带 sink');
  }
});

test('传承持久化：grant/spend/read 对账，与星核 wallet 分账', () => {
  const id = seedAccount('legacy-wallet');

  assert.deepEqual(readLegacy(id), { materials: {}, bank: 0 });
  assert.equal(getCores(id), 0);

  // grant 走 player_kv('meta','legacy')，星核走 player_wallets('cores')，两者互不影响。
  const afterGrant = transaction(() => grantLegacyInTx(id, 30));
  assert.equal(afterGrant.bank, 30);
  assert.equal(afterGrant.materials.legacy_core, 30);
  assert.equal(getCores(id), 0, '发放传承材料不得改动星核余额');

  grantCores(id, 40);
  assert.equal(getCores(id), 40);
  assert.equal(readLegacy(id).bank, 30, '发放星核不得改动传承材料余额');

  // spend 余额充足时扣减，不足时拒绝且一行都不改。
  assert.equal(transaction(() => spendLegacyInTx(id, 12)), true);
  assert.equal(readLegacy(id).bank, 18);
  assert.equal(transaction(() => spendLegacyInTx(id, 999)), false);
  assert.equal(readLegacy(id).bank, 18);
});

test('重复结算防护：grant 只加一次、bank 与 materials 恒一致、零额是空操作', () => {
  const id = seedAccount('legacy-reconcile');

  // 两次独立 grant 累加，而不是覆盖；每次只加指定额度。
  transaction(() => grantLegacyInTx(id, 20));
  transaction(() => grantLegacyInTx(id, 20));
  const state = readLegacy(id);
  assert.equal(state.bank, 40);
  assert.equal(state.materials.legacy_core, 40);

  // 零额 / 负额是空操作，不产生重复计数。
  transaction(() => grantLegacyInTx(id, 0));
  transaction(() => grantLegacyInTx(id, -7));
  assert.equal(readLegacy(id).bank, 40);

  // 直接读库核对：bank 与 materials 求和一致（机械可检）。
  const row = db
    .prepare(
      "SELECT value_json FROM player_kv WHERE account_id = ? AND namespace = 'meta' AND key = 'legacy'"
    )
    .get(id);
  const persisted = JSON.parse(row.value_json);
  assert.equal(persisted.bank, persisted.materials.legacy_core);
});
