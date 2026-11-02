// 主海克斯开局流程：服务端三选一/选择校验/快照、结算倍率、分享码与开局 UI 接线。
// 走真实 HTTP 服务（隔离端口 + 临时数据库），覆盖 RunRoutes 正则与 RunService 状态迁移。
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startServer } from './test-server.mjs';
import { computeOutcome, hexScoreMul } from '../public/js/shared/scoring.js';
import { HEXES, HEX_BY_ID, HEX_POOL_VERSION } from '../public/js/shared/hexes.js';
import { decodeRun, encodeRun } from '../public/js/shared/replay.js';
import zhCN from '../public/js/shared/i18n/zh-CN.js';
import enUS from '../public/js/shared/i18n/en-US.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let PORT = 0;
let BASE = '';
const DB = path.join(os.tmpdir(), `rtd-hex-flow-${process.pid}-${Date.now()}.db`);
const TOKEN = 'hex-flow-token-0001';
const OTHER = 'hex-flow-token-0002';
const CJK_RE = /[一-鿿]/;

const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const RUN_SOURCE = read('public/js/app/run.js');
const HEX_SELECT_SOURCE = read('public/js/ui/hex-select.js');
const API_SOURCE = read('public/js/api.js');
const STYLES = read('public/styles.css');

let server = null;

async function api(pathname, { method = 'GET', token = TOKEN, body, headers } = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      'x-player-token': token,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(headers || {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

function createRun(token = TOKEN, mode = 'normal', difficulty = 'roam', seed) {
  return api('/api/runs', {
    method: 'POST',
    body: { mode, difficulty },
    token,
    headers: seed !== undefined ? { 'x-test-seed': seed } : undefined,
  });
}

// 走完开局：选海克斯（可选）→ 选第 1 张图 → 放行并清掉第 1 波。
async function playFirstWave(token, { hexId, data: existing } = {}) {
  const data = existing || (await createRun(token)).data;
  if (!existing) assert.ok(data.runId, JSON.stringify(data));
  if (hexId !== undefined) {
    const chosen = await api(`/api/runs/${data.runId}/hex`, {
      method: 'POST',
      body: { hexId },
      token,
    });
    assert.equal(chosen.status, 200, JSON.stringify(chosen.data));
  }
  const map = await api(`/api/runs/${data.runId}/map`, {
    method: 'POST',
    body: { index: 0 },
    token,
  });
  assert.equal(map.status, 200, JSON.stringify(map.data));
  const wave = await api(`/api/runs/${data.runId}/wave`, { method: 'POST', body: {}, token });
  assert.equal(wave.status, 200, JSON.stringify(wave.data));
  const cleared = await api(`/api/runs/${data.runId}/clear`, {
    method: 'POST',
    body: { wave: 1 },
    token,
  });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.data));
  return { data, map: map.data, wave: wave.data };
}

before(async () => {
  server = await startServer({
    cwd: ROOT,
    dbPath: DB,
    env: { AUTH_ENABLED: '0', ALLOW_TEST_SEED: '1' },
  });
  PORT = server.port;
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

test('create 返回 3 个海克斯候选，每日挑战同组所有人一致', async () => {
  const mine = await createRun(TOKEN, 'daily');
  const theirs = await createRun(OTHER, 'daily');
  assert.equal(mine.status, 200, JSON.stringify(mine.data));
  assert.equal(theirs.status, 200, JSON.stringify(theirs.data));

  for (const data of [mine.data, theirs.data]) {
    assert.equal(data.hex, null, '未选择前不应有已选海克斯');
    assert.equal(data.hexPoolVersion, HEX_POOL_VERSION);
    assert.equal(data.hexOffers.length, 3);
    assert.equal(new Set(data.hexOffers).size, 3, '候选不得重复');
    for (const id of data.hexOffers) assert.ok(HEX_BY_ID[id], `未知海克斯 ${id}`);
  }
  // 每日挑战同一天同组：所有人拿到同一组候选。
  assert.deepEqual(mine.data.hexOffers, theirs.data.hexOffers);

  // 普通局按本局种子派生，但同样恒为三个可用候选。
  const normal = await createRun(TOKEN, 'normal');
  assert.equal(normal.data.hexOffers.length, 3);
  for (const id of normal.data.hexOffers) assert.ok(HEX_BY_ID[id]);
});

test('选择海克斯：非法 id 400、重复选择幂等、选后不可改且快照可见', async () => {
  const created = await createRun(TOKEN);
  const { runId, hexOffers: offers } = created.data;

  const invalid = await api(`/api/runs/${runId}/hex`, {
    method: 'POST',
    body: { hexId: 'not-a-real-hex' },
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.data.code, 'INVALID_HEX');

  const notOffered = HEXES.find((hex) => !offers.includes(hex.id));
  const outside = await api(`/api/runs/${runId}/hex`, {
    method: 'POST',
    body: { hexId: notOffered.id },
  });
  assert.equal(outside.status, 400, '不在本次三选一里的海克斯必须拒绝');

  const picked = offers[0];
  const chosen = await api(`/api/runs/${runId}/hex`, {
    method: 'POST',
    body: { hexId: picked },
  });
  assert.equal(chosen.status, 200, JSON.stringify(chosen.data));
  assert.equal(chosen.data.hex.id, picked);
  assert.equal(chosen.data.hex.poolVersion, HEX_POOL_VERSION);
  assert.deepEqual(chosen.data.hex.offers, offers);
  assert.equal(chosen.data.alreadyChosen, false);

  // 重复选择同一 id：幂等 200，不改写。
  const again = await api(`/api/runs/${runId}/hex`, {
    method: 'POST',
    body: { hexId: picked },
  });
  assert.equal(again.status, 200);
  assert.equal(again.data.alreadyChosen, true);
  assert.equal(again.data.hex.id, picked);

  // 选后不可改：换一个同样在候选里的 id 也一律 409。
  const swap = await api(`/api/runs/${runId}/hex`, {
    method: 'POST',
    body: { hexId: offers[1] },
  });
  assert.equal(swap.status, 409);
  assert.equal(swap.data.code, 'HEX_LOCKED');

  // serialize 与 active 都带 hex / hexOffers，且 offers 保持原样。
  const info = await api(`/api/runs/${runId}`);
  assert.equal(info.data.run.hex.id, picked);
  assert.deepEqual(info.data.run.hex.offers, offers);
  assert.deepEqual(info.data.run.hexOffers, offers);
  assert.equal(info.data.run.ruleset.hex.id, picked);

  const active = await api('/api/runs/active');
  assert.equal(active.data.run.id, runId);
  assert.equal(active.data.run.hex.id, picked);
  assert.deepEqual(active.data.run.hexOffers, offers);
});

test('刷新恢复：不重复消耗、不换 offers，波次回传同一海克斯', async () => {
  const created = await createRun(TOKEN);
  const { runId, hexOffers: offers } = created.data;

  // 刷新时机 1：还没选海克斯 → active 仍给出同一组 offers。
  const before1 = await api('/api/runs/active');
  assert.deepEqual(before1.data.run.hexOffers, offers);
  assert.equal(before1.data.run.hex, null);

  const picked = offers[2];
  const chosen = await api(`/api/runs/${runId}/hex`, {
    method: 'POST',
    body: { hexId: picked },
  });
  assert.equal(chosen.status, 200);

  // 刷新时机 2：已选海克斯还没选图 → 同一组 offers、同一个已选 id。
  const before2 = await api('/api/runs/active');
  assert.equal(before2.data.run.hex.id, picked);
  assert.deepEqual(before2.data.run.hexOffers, offers);

  // 选择地图并放行波次后，serveWave 仍然从 ruleset 回传海克斯。
  await api(`/api/runs/${runId}/map`, { method: 'POST', body: { index: 1 } });
  const wave = await api(`/api/runs/${runId}/wave`, { method: 'POST', body: {} });
  assert.equal(wave.status, 200, JSON.stringify(wave.data));
  assert.equal(wave.data.hex.id, picked);
});

test('遗物候选与刷新费用走共享海克斯钩子（默认值 3 / 25）', async () => {
  const created = await createRun(TOKEN, 'normal', 'roam', 'relic-default');
  const { runId, hexOffers: offers } = created.data;
  // 本用例只验证「不改遗物参数的海克斯」走默认值 3 / 25 / 1：
  // 黄金律法（HEX-007）刷新半价、遗物吞噬者（HEX-008）改候选数/刷新费/次数，
  // 分别由 tests/hex-golden-law.test.mjs 与 tests/hex-relic-devourer.test.mjs 覆盖。
  const relicHooks = ['onRelicGained', 'relicOfferCount', 'relicRerollCost', 'relicRerollBonus'];
  const plainHex = offers.find(
    (id) => !relicHooks.some((name) => typeof HEX_BY_ID[id]?.hooks?.[name] === 'function')
  );
  assert.ok(plainHex, `三选一应含一张不改遗物默认值的海克斯：${offers.join(',')}`);
  await api(`/api/runs/${runId}/hex`, { method: 'POST', body: { hexId: plainHex } });
  await api(`/api/runs/${runId}/map`, { method: 'POST', body: { index: 0 } });
  await api(`/api/runs/${runId}/wave`, { method: 'POST', body: {} });
  await api(`/api/runs/${runId}/clear`, { method: 'POST', body: { wave: 1 } });

  const relics = await api(`/api/runs/${runId}/relics`, { method: 'POST', body: {} });
  assert.equal(relics.status, 200, JSON.stringify(relics.data));
  assert.equal(relics.data.offerCount, 3);
  assert.equal(relics.data.offers.length, 3);
  assert.equal(relics.data.rerollCost, 25);
  assert.equal(relics.data.maxRerolls, 1);
});

test('结算按 hex.scoreMul 乘分，回放与分享码 round-trip 带 hexId', async () => {
  const created = await createRun(TOKEN);
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const picked = created.data.hexOffers[0];
  const { data, map } = await playFirstWave(TOKEN, { hexId: picked, data: created.data });
  const mapMul = map.mapMeta?.scoreMul || 1;

  const finished = await api(`/api/runs/${data.runId}/finish`, {
    method: 'POST',
    body: { waveReached: 1, kills: 0, goldLeft: 0, baseHp: 20 },
  });
  assert.equal(finished.status, 200, JSON.stringify(finished.data));
  assert.equal(finished.data.hexId, picked);

  const expected = computeOutcome({
    waveReached: 1,
    wavesServed: 1,
    kills: 0,
    goldLeft: 0,
    baseHp: 20,
    difficulty: 'roam',
    scoreMul: mapMul * hexScoreMul(picked),
    mode: 'normal',
  });
  assert.equal(finished.data.score, expected.score);
  // 选择的海克斯必须真的带来倍率（候选里存在 scoreMul > 1 的定义）。
  assert.ok(HEX_BY_ID[picked].scoreMul > 1);
  assert.ok(mapMul * hexScoreMul(picked) > mapMul);

  // 回放摘要与结果都记录 hexId。
  const replay = await api(`/api/replays/${finished.data.replayId}`);
  assert.equal(replay.status, 200);
  assert.equal(replay.data.replay.hex.id, picked);
  assert.equal(replay.data.replay.result.hexId, picked);

  // 分享码 round-trip：编码 hexId，解码后字段一致。
  const code = encodeRun({
    seed: data.seed,
    mapChoice: 0,
    difficulty: 'roam',
    mode: 'normal',
    hexId: picked,
  });
  assert.match(code, /^RTD2\./);
  const decoded = decodeRun(code);
  assert.equal(decoded.ok, true);
  assert.equal(decoded.run.hexId, picked);
  assert.equal(encodeRun(decoded.run), code);

  // 旧码（v1，无 h 字段）仍可导入，hexId 为 null。
  const legacy = decoded.run;
  const v1Payload = {
    v: 1,
    s: legacy.seed,
    m: legacy.mapChoice,
    d: legacy.difficulty,
    o: legacy.mode,
    r: [],
    e: [],
  };
  const v1Body = Buffer.from(JSON.stringify(v1Payload), 'utf8').toString('base64url');
  const fnv = (text) => {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  };
  const old = decodeRun(`RTD1.${v1Body}.${fnv(v1Body)}`);
  assert.equal(old.ok, true);
  assert.equal(old.run.hexId, null);
});

test('无 hex 的旧 run 仍可结算，分数按 1.0', async () => {
  const { data, map } = await playFirstWave(TOKEN);
  const mapMul = map.mapMeta?.scoreMul || 1;

  const finished = await api(`/api/runs/${data.runId}/finish`, {
    method: 'POST',
    body: { waveReached: 1, kills: 0, goldLeft: 0, baseHp: 20 },
  });
  assert.equal(finished.status, 200, JSON.stringify(finished.data));
  assert.equal(finished.data.hexId, null);

  const expected = computeOutcome({
    waveReached: 1,
    wavesServed: 1,
    kills: 0,
    goldLeft: 0,
    baseHp: 20,
    difficulty: 'roam',
    scoreMul: mapMul,
    mode: 'normal',
  });
  assert.equal(finished.data.score, expected.score);

  const replay = await api(`/api/replays/${finished.data.replayId}`);
  assert.equal(replay.status, 200);
  assert.equal(replay.data.replay.hex, null);
  assert.equal(replay.data.replay.result.hexId, null);
});

test('开局 UI 接线：create → hex → map → beginGame，卡片/徽标/中英文案齐全', () => {
  // 客户端顺序：建局后先走海克斯三选一，确认后再进入选图。
  const createAt = RUN_SOURCE.indexOf('startSelectionFlow(data)');
  const hexFlowAt = RUN_SOURCE.indexOf('showHexSelectFlow(data, data.hexOffers)');
  const chooseAt = RUN_SOURCE.indexOf('this.api.chooseHex(');
  const mapAt = RUN_SOURCE.indexOf('showMapSelectFlow(next, candidates)');
  assert.ok(createAt > 0 && hexFlowAt > createAt, 'startRun 应先进入海克斯三选一');
  assert.ok(chooseAt > hexFlowAt, '选择流程应调用 chooseHex');
  assert.ok(mapAt > chooseAt, '海克斯确认后才进入选图');
  assert.match(API_SOURCE, /chooseHex\(id, hexId\)/);
  assert.match(API_SOURCE, /\/hex/);

  // 刷新恢复：active 未选海克斯时回到三选一，已选时恢复同一组 offers。
  assert.match(RUN_SOURCE, /!run\.hex && run\.hexOffers\?\.length/);
  assert.match(RUN_SOURCE, /showHexSelectFlow\(data, run\.hexOffers\)/);
  // 局内运行时要拿到 hex/hexState，续玩快照才能恢复海克斯。
  assert.match(RUN_SOURCE, /hex: hexId/);
  assert.match(RUN_SOURCE, /hexState: snapshot\?\.hexState/);
  // 徽标：HUD/标题页共用 updateHexBadge。
  assert.match(RUN_SOURCE, /this\.ui\.updateHexBadge\(hexId\)/);

  // 三选一面板：名称/图标/定位标签/强项/代价/scoreMul + 确认不可返回。
  for (const snippet of [
    'hex-card',
    'hex-glyph',
    'hex-tag',
    'hex-pitch',
    'hex-tradeoff',
    'hex-score',
    'btn-confirm-hex',
    'dataset.tip',
  ]) {
    assert.ok(HEX_SELECT_SOURCE.includes(snippet), `hex-select 缺少 ${snippet}`);
  }
  assert.match(HEX_SELECT_SOURCE, /closable: false/, '确认后不可返回');
  assert.match(HEX_SELECT_SOURCE, /updateHexBadge/);

  // 双语：每个海克斯与面板文案在中英字典里都存在，英文无中文残留。
  const uiKeys = [
    'hex.eyebrow',
    'hex.title',
    'hex.note',
    'hex.confirm',
    'hex.confirmPick',
    'hex.confirmNote',
    'hex.abandon',
    'hex.downside',
    'hex.pick',
    'hex.score',
  ];
  for (const key of uiKeys) {
    assert.equal(typeof zhCN[key], 'string', `zh-CN 缺少 ${key}`);
    assert.equal(typeof enUS[key], 'string', `en-US 缺少 ${key}`);
  }
  for (const hex of HEXES) {
    for (const field of ['name', 'pitch', 'downside', 'tags']) {
      const key = `hex.${hex.id}.${field}`;
      assert.equal(typeof zhCN[key], 'string', `zh-CN 缺少 ${key}`);
      assert.equal(typeof enUS[key], 'string', `en-US 缺少 ${key}`);
      assert.doesNotMatch(enUS[key], CJK_RE, `en-US ${key} 仍是中文`);
    }
  }

  // 样式：选择卡片与徽标都有独立样式。
  for (const selector of ['.hex-cards', '.hex-card', '.hex-tradeoff', '.hex-badge', '.hex-badge-mul']) {
    assert.ok(STYLES.includes(selector), `styles.css 缺少 ${selector}`);
  }
});
