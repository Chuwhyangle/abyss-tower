// 开局信物三选一与第 3 波起保底升级卡（AC-056）：
//   - rollStarterOffers 的确定性、三派系不重复、不含中立、全是 Ⅰ 级普通新卡；
//   - rollRelicOffers 在 wave >= 3 且有「已拥有未满级」遗物时必含一张升级卡，否则行为不变；
//   - 服务端 create 权威下发信物候选、chooseStarter 幂等/锁定/校验、serialize 透出已选状态。
// 候选由服务端按 ${seed}:starter:${mode} 派生（docs/PHASE_ROGUE2.md §9），客户端不得自造。
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RELIC_BY_ID,
  normalizeRelicStates,
  rollRelicOffers,
  rollStarterOffers,
} from '../public/js/shared/data.js';
import { factionPoints, relicFaction } from '../public/js/shared/factions.js';
import { startServer } from './test-server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VALID_FACTIONS = ['fire', 'frost', 'venom', 'storm', 'warden'];

// ---------- rollStarterOffers（§8.1） ----------

test('信物三选一：三个不同派系、不含中立、全是 Ⅰ 级普通新卡', () => {
  const offers = rollStarterOffers('starter-unit-seed', 'normal');
  assert.equal(offers.length, 3);
  assert.equal(new Set(offers.map((offer) => offer.id)).size, 3, '三件信物互不相同');

  const factions = offers.map((offer) => RELIC_BY_ID[offer.id]?.faction);
  assert.equal(new Set(factions).size, 3, '必须来自三个不同派系');
  assert.ok(factions.every((faction) => VALID_FACTIONS.includes(faction)), '不得含中立或未知派系');

  for (const offer of offers) {
    assert.equal(offer.kind, 'relic');
    assert.equal(offer.fromLevel, 0, '信物是新遗物，无前置等级');
    assert.equal(offer.toLevel, 1, '信物是 Ⅰ 级');
    assert.equal(RELIC_BY_ID[offer.id].rarity, 'common', '入门信物是普通稀有度');
  }
});

test('同一 seedKey 可复现，不同 seedKey 各自稳定', () => {
  const first = rollStarterOffers('s1:starter:normal', 'normal');
  assert.deepEqual(rollStarterOffers('s1:starter:normal', 'normal'), first);
  const second = rollStarterOffers('s2:starter:normal', 'normal');
  assert.deepEqual(rollStarterOffers('s2:starter:normal', 'normal'), second);
  // 每日同组玩家共享同一种子 ⇒ 同一组候选（确定性由上方 deepEqual 保证）。
  assert.deepEqual(rollStarterOffers('day-seed:starter:daily', 'daily'), rollStarterOffers('day-seed:starter:daily', 'daily'));
});

test('选中信物后对应派系 +1 点', () => {
  const relicId = rollStarterOffers('starter-point-seed', 'normal')[0].id;
  const faction = relicFaction(relicId);
  assert.ok(VALID_FACTIONS.includes(faction), `信物 ${relicId} 应有非中立派系`);
  assert.equal(factionPoints(normalizeRelicStates([{ id: relicId, level: 1 }]))[faction], 1);
});

// ---------- rollRelicOffers 第 3 波保底升级卡（§8.1/§10.1） ----------

test('第 3 波起，存在已拥有未满级遗物时首卡必为该遗物的升级卡', () => {
  const offers = rollRelicOffers('upgrade-seed', [{ id: 'sharp', level: 2 }], 3, 3);
  assert.equal(offers.length, 3);
  assert.equal(offers[0].kind, 'relic');
  assert.equal(offers[0].id, 'sharp');
  assert.equal(offers[0].fromLevel, 2);
  assert.equal(offers[0].toLevel, 3);
});

test('多个可升级遗物时任选其一作为保底首卡，且后续不重复', () => {
  const states = [
    { id: 'sharp', level: 1 },
    { id: 'eagle', level: 2 },
  ];
  const offers = rollRelicOffers('multi-upgrade-seed', states, 3, 3);
  const first = offers[0];
  assert.equal(first.kind, 'relic');
  assert.ok(['sharp', 'eagle'].includes(first.id), `首卡应是可升级遗物之一，实际 ${first.id}`);
  assert.ok(first.fromLevel >= 1);
  assert.equal(first.toLevel, first.fromLevel + 1);
  // 保底升级卡从池中移除，不会在同一组里重复出现同一件遗物。
  assert.equal(new Set(offers.map((offer) => offer.id)).size, 3);
});

test('没有可升级遗物时（wave >= 3）不保底，行为与今天一致', () => {
  // 无已拥有遗物 ⇒ 无可升级对象 ⇒ 首卡不强制为升级卡。
  const offers = rollRelicOffers('no-upgrade-seed', [], 3, 5);
  assert.equal(offers.length, 3);
  assert.ok(offers.every((offer) => offer.kind !== 'relic' || offer.fromLevel === 0), '全是新卡');
});

test('wave < 3 时即使有可升级遗物也不强插升级卡', () => {
  const offers = rollRelicOffers('wave2-seed', [{ id: 'sharp', level: 2 }], 3, 2);
  assert.equal(offers.length, 3);
  assert.equal(new Set(offers.map((offer) => offer.id)).size, 3);
});

// ---------- 服务端：create / chooseStarter / serialize ----------

const SEED = 'starter-fixed-001';
const TOKEN = 'starter-token-0001';
const DB = path.join(os.tmpdir(), `rtd-starter-${process.pid}-${Date.now()}.db`);

let server = null;
let BASE = '';

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

before(async () => {
  server = await startServer({
    cwd: ROOT,
    dbPath: DB,
    seedHeader: true,
    env: { AUTH_ENABLED: '0' },
  });
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

test('服务端 create 权威下发信物候选，与本地算法逐字一致，且遗物包为空', async () => {
  const created = await fetch(`${BASE}/api/runs`, {
    method: 'POST',
    headers: {
      'x-player-token': TOKEN,
      'x-test-seed': SEED,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ mode: 'normal', difficulty: 'standard' }),
  });
  const data = await created.json();
  assert.equal(created.status, 200, JSON.stringify(data));

  const expected = rollStarterOffers(`test-${SEED}:starter:normal`, 'normal').map((offer) => offer.id);
  assert.deepEqual(data.starter.offers, expected, '服务端候选与本地 rollStarterOffers 一致');
  assert.equal(data.starter.picked, null);
  assert.deepEqual(data.relics, [], '选信物前遗物包为空');
  assert.deepEqual(data.ruleset.rogue2.starter.offers, expected, '候选持久化到 ruleset.rogue2.starter');
});

test('chooseStarter：选中后遗物入包、picked 写入并透出 serialize；非法/换选/重复各有边界', async () => {
  const created = await fetch(`${BASE}/api/runs`, {
    method: 'POST',
    headers: {
      'x-player-token': TOKEN,
      'x-test-seed': SEED,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ mode: 'normal', difficulty: 'standard' }),
  });
  const data = await created.json();
  assert.equal(created.status, 200, JSON.stringify(data));
  const runId = data.runId;
  const offers = data.starter.offers;
  assert.equal(offers.length, 3);

  // 未选择时，不在候选里的 id 直接 400。
  const bogus = await api(`/api/runs/${runId}/starter`, { method: 'POST', body: { relicId: 'not-a-relic' } });
  assert.equal(bogus.status, 400, JSON.stringify(bogus.data));

  // 选中第一件：遗物入包 + 派系点由遗物等级决定（1 点）。
  const pickId = offers[0];
  const chosen = await api(`/api/runs/${runId}/starter`, { method: 'POST', body: { relicId: pickId } });
  assert.equal(chosen.status, 200, JSON.stringify(chosen.data));
  assert.equal(chosen.data.starter.picked, pickId);
  assert.deepEqual(chosen.data.relics, [{ id: pickId, level: 1 }]);

  // 换选另一件 → 409 锁定。
  const swap = await api(`/api/runs/${runId}/starter`, { method: 'POST', body: { relicId: offers[1] } });
  assert.equal(swap.status, 409, JSON.stringify(swap.data));

  // 重复选同一件 → 幂等返回 alreadyChosen。
  const again = await api(`/api/runs/${runId}/starter`, { method: 'POST', body: { relicId: pickId } });
  assert.equal(again.status, 200, JSON.stringify(again.data));
  assert.equal(again.data.alreadyChosen, true);
  assert.deepEqual(again.data.relics, [{ id: pickId, level: 1 }]);

  // serialize（GET run）透出已选状态，供刷新恢复不重复发信物。
  const info = await api(`/api/runs/${runId}`);
  assert.equal(info.status, 200, JSON.stringify(info.data));
  assert.equal(info.data.run.starter.picked, pickId);
  assert.deepEqual(info.data.run.relics, [{ id: pickId, level: 1 }]);
});
