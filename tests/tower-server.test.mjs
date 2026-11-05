// 爬塔模式 · 阶段 1 服务端验收：tower 开局、节点图/选路校验、三类节点分流与登顶结算。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startServer } from './test-server.mjs';
import { generateTowerGraph, successors } from '../public/js/shared/tower.js';
import { generateWave } from '../public/js/shared/waves.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = path.join(os.tmpdir(), `rtd-tower-server-${process.pid}-${Date.now()}.db`);

const TOKEN = 'tower-server-test-0001';
const SEED = 'tower-server-seed';

let server = null;
let BASE = '';

async function api(pathname, { method = 'GET', token = TOKEN, body } = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      'x-player-token': token,
      'x-test-seed': SEED,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

async function startTower() {
  const started = await api('/api/runs', {
    method: 'POST',
    body: { mode: 'tower', difficulty: 'standard' },
  });
  assert.equal(started.status, 200);
  return started.data;
}

async function clearNode(runId, layer) {
  const served = await api(`/api/runs/${runId}/wave`, { method: 'POST', body: {} });
  assert.equal(served.status, 200, `第 ${layer} 层放行失败`);
  assert.equal(served.data.wave.index, layer);
  const cleared = await api(`/api/runs/${runId}/clear`, { method: 'POST', body: { wave: layer } });
  assert.equal(cleared.status, 200, `第 ${layer} 层清波失败`);
  assert.equal(cleared.data.clearedWaves, layer);
  return served.data.wave;
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

after(async () => {
  if (server) await server.stop();
});

test('tower 开局冻结 ruleset.tower.route 与难度映射；普通 run 无 tower 字段', async () => {
  const started = await startTower();
  assert.equal(started.mode, 'tower');
  assert.equal(started.boardKey, 'tower');
  assert.deepEqual(started.ruleset.tower, {
    route: { path: ['1:0'], node: '1:0' },
    difficultyMode: 'floor-equals-wave',
  });

  const info = await api(`/api/runs/${started.runId}`);
  assert.equal(info.status, 200);
  assert.equal(info.data.run.tower.node, '1:0');
  assert.deepEqual(info.data.run.tower.route, { path: ['1:0'], node: '1:0' });

  // 普通 run 向后兼容：无 tower 字段，nodes/choose 拒绝。
  const normal = await api('/api/runs', {
    method: 'POST',
    body: { mode: 'normal', difficulty: 'standard' },
  });
  assert.equal(normal.status, 200);
  assert.equal(normal.data.ruleset.tower, undefined);
  const normalInfo = await api(`/api/runs/${normal.data.runId}`);
  assert.equal(normalInfo.data.run.tower, undefined);
  const normalNodes = await api(`/api/runs/${normal.data.runId}/nodes`);
  assert.equal(normalNodes.status, 409);
  const normalChoose = await api(`/api/runs/${normal.data.runId}/choose`, {
    method: 'POST',
    body: { node: '2:0' },
  });
  assert.equal(normalChoose.status, 409);

  // tower 独立榜单：低波次成绩可入榜，且榜键独立（红线 1 三处 MODES 同步的读路径自证）。
  const low = await startTower();
  const lowFinish = await api(`/api/runs/${low.runId}/finish`, {
    method: 'POST',
    body: { waveReached: 0, kills: 0, goldLeft: 0, baseHp: 17 },
  });
  assert.equal(lowFinish.status, 200);
  assert.equal(lowFinish.data.victory, false);
  const board = await api('/api/leaderboard?mode=tower');
  assert.equal(board.status, 200);
  assert.equal(board.data.mode, 'tower');
  assert.ok(board.data.entries.some((row) => row.difficulty === 'standard'));
});

test('nodes 返回图+位置+后继；chooseNode 只接受相邻层后继且战斗节点须先清波', async () => {
  const started = await startTower();
  const runId = started.runId;
  const graph = generateTowerGraph(`test-${SEED}`);

  const nodes = await api(`/api/runs/${runId}/nodes`);
  assert.equal(nodes.status, 200);
  assert.equal(nodes.data.layers, 30);
  assert.equal(nodes.data.node.key, '1:0');
  assert.equal(nodes.data.node.type, 'fight');
  assert.ok(nodes.data.successors.length >= 1);

  // 战斗节点未清波前禁止推进（难度追击红线）。
  const notCleared = await api(`/api/runs/${runId}/choose`, {
    method: 'POST',
    body: { node: nodes.data.successors[0].key },
  });
  assert.equal(notCleared.status, 409);
  assert.equal(notCleared.data.code, 'NODE_NOT_CLEARED');

  await clearNode(runId, 1);

  // 跳层 / 列差过大 / 不存在 一律 400。
  const far = await api(`/api/runs/${runId}/choose`, { method: 'POST', body: { node: '3:0' } });
  assert.equal(far.status, 400);
  const missing = await api(`/api/runs/${runId}/choose`, { method: 'POST', body: { node: '2:9' } });
  assert.equal(missing.status, 400);

  // 合法后继推进游标。
  const nextKey = nodes.data.successors[0].key;
  const chosen = await api(`/api/runs/${runId}/choose`, { method: 'POST', body: { node: nextKey } });
  assert.equal(chosen.status, 200);
  assert.equal(chosen.data.route.node, nextKey);
  assert.equal(chosen.data.route.path.length, 2);
  assert.equal(graph.byKey.get(nextKey).layer, 2);
});

test('节点分流：fight 清波给遗物，event/merchant 无战斗无遗物，登顶 30 层结算 victory', async () => {
  const started = await startTower();
  const runId = started.runId;
  const graph = generateTowerGraph(`test-${SEED}`);

  let route = { path: ['1:0'], node: '1:0' };
  let sawFightRelic = false;
  let sawElite = false;
  let sawEvent = false;
  let sawMerchant = false;
  let sawBoss = false;

  for (let layer = 1; layer <= 30; layer++) {
    const node = graph.byKey.get(route.node);
    assert.equal(node.layer, layer);

    if (node.type === 'fight' || node.type === 'elite' || node.type === 'boss') {
      const wave = await clearNode(runId, layer);
      if (node.type === 'fight' || node.type === 'elite') {
        if (node.type === 'fight') sawFightRelic = true;
        else sawElite = true;
        const relics = await api(`/api/runs/${runId}/relics`, { method: 'POST', body: {} });
        assert.equal(relics.status, 200, `第 ${layer} 层 ${node.type} 应给遗物`);
        assert.equal(relics.data.offers.length, 3);
        const picked = await api(`/api/runs/${runId}/relic`, { method: 'POST', body: { index: 0 } });
        assert.equal(picked.status, 200);
      } else {
        // boss 不给免费遗物（首领核心是它的掉落；遗物只有 fight/elite）。
        const relics = await api(`/api/runs/${runId}/relics`, { method: 'POST', body: {} });
        assert.equal(relics.status, 409);
        assert.equal(relics.data.code, 'NO_RELIC_NODE');
      }
      if (node.type === 'elite') {
        // 服务端权威：词缀 baked 进波次（hpMul/speedMul 至少一项强于基线），奖励 ×1.5。
        const base = generateWave(`test-${SEED}`, layer, 'standard', {}, { endless: false });
        assert.ok(
          wave.hpMul > base.hpMul || wave.speedMul > base.speedMul,
          `第 ${layer} 层 elite 波次应 baked 词缀强化`
        );
        assert.equal(wave.reward, Math.round(base.reward * 1.5), `第 ${layer} 层 elite 奖励应为 ×1.5`);
      }
      if (node.type === 'boss') {
        sawBoss = true;
        assert.ok([10, 20, 30].includes(layer));
        const core = await api(`/api/runs/${runId}/bosscore`, { method: 'POST', body: {} });
        assert.equal(core.status, 200, `第 ${layer} 层 boss 应给首领核心`);
      }
    } else if (node.type === 'event') {
      sawEvent = true;
      const relics = await api(`/api/runs/${runId}/relics`, { method: 'POST', body: {} });
      assert.equal(relics.status, 409);
      assert.equal(relics.data.code, 'NO_RELIC_NODE');
      const events = await api(`/api/runs/${runId}/events`, { method: 'POST', body: {} });
      assert.equal(events.status, 200, `第 ${layer} 层 event 抵达即完成`);
      assert.equal(events.data.wave, layer);
      assert.ok(events.data.event);
      const picked = await api(`/api/runs/${runId}/event`, { method: 'POST', body: { index: 0 } });
      assert.equal(picked.status, 200);
    } else if (node.type === 'merchant') {
      sawMerchant = true;
      const relics = await api(`/api/runs/${runId}/relics`, { method: 'POST', body: {} });
      assert.equal(relics.status, 409);
      assert.equal(relics.data.code, 'NO_RELIC_NODE');
      const shop = await api(`/api/runs/${runId}/merchant`, { method: 'POST', body: {} });
      assert.equal(shop.status, 200, `第 ${layer} 层 merchant 抵达即完成`);
      assert.equal(shop.data.wave, layer);
      assert.equal(shop.data.offers.length, 3);
      assert.ok(shop.data.offers.every((offer) => offer.price >= 60));
      const buy = await api(`/api/runs/${runId}/merchant`, { method: 'POST', body: { index: 0 } });
      assert.equal(buy.status, 200);
      assert.equal(buy.data.picked, true);
      const again = await api(`/api/runs/${runId}/merchant`, { method: 'POST', body: { index: 1 } });
      assert.equal(again.status, 409);
      assert.equal(again.data.code, 'MERCHANT_LOCKED');
    }
    // 推进到下一层（末层除外）。
    if (layer < 30) {
      const next = successors(graph, route.node)[0];
      assert.ok(next, `第 ${layer} 层应有后继`);
      const chosen = await api(`/api/runs/${runId}/choose`, { method: 'POST', body: { node: next.key } });
      assert.equal(chosen.status, 200, `第 ${layer} 层选路 ${next.key} 失败`);
      route = chosen.data.route;
    }
  }

  assert.equal(sawFightRelic, true);
  assert.equal(sawElite, true);
  assert.equal(sawBoss, true);
  assert.equal(sawEvent, true);
  assert.equal(sawMerchant, true);

  // 登顶 30 层结算：victory + 独立 tower 榜。
  const finished = await api(`/api/runs/${runId}/finish`, {
    method: 'POST',
    body: { waveReached: 30, kills: 3000, goldLeft: 1000, baseHp: 20 },
  });
  assert.equal(finished.status, 200);
  assert.equal(finished.data.victory, true);
  assert.ok(finished.data.score >= 10000);

  const board = await api('/api/leaderboard?mode=tower');
  assert.equal(board.status, 200);
  assert.equal(board.data.mode, 'tower');
});
