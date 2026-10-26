// 主海克斯「遗物吞噬者」：开局基地生命上限 +5、遗物四选一、刷新免费且次数 +2，
// 但每拿一件遗物（含开局遗物与升级）基地生命上限 -1（最低 1），当前生命不超过新上限。
// 模块级断言走真实 Simulation 管线（onRunInit / addRelic）；钩子级断言走 HexRuntime；
// 末尾一段起真实 HTTP 服务验证服务端 relicOffers/serialize 读到同一组钩子。
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { HEX_BY_ID, offerHexes } from '../public/js/shared/hexes.js';
import { HexRuntime } from '../public/js/shared/hexes/runtime.js';
import relicDevourer from '../public/js/shared/hexes/relic-devourer.js';
import { allocatePort, waitForHealth } from './test-server.mjs';

const HEX = 'relic_devourer';
const SEED = 'hex-relic-devourer-seed';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function makeSim({ hex = HEX, relics = [], baseHp = 20, maxBaseHp = 20, restored = false, hexState = null } = {}) {
  return new Simulation({
    map: generateMap(SEED),
    seed: SEED,
    difficulty: 'standard',
    gold: 100,
    baseHp,
    maxBaseHp,
    relics,
    towers: [],
    hex,
    hexState,
    restored,
    onToast: () => {},
  });
}

test('模块已实现：implemented=true、注册表指向同一对象、scoreMul=1.10', () => {
  assert.equal(relicDevourer.id, HEX);
  assert.equal(relicDevourer.implemented, true);
  assert.equal(relicDevourer.scoreMul, 1.1);
  assert.equal(HEX_BY_ID[HEX], relicDevourer, '注册表指向同一模块');
  for (const name of ['onRunInit', 'onRelicGained', 'relicOfferCount', 'relicRerollCost', 'relicRerollBonus']) {
    assert.equal(typeof relicDevourer.hooks[name], 'function', `钩子 ${name}`);
  }
});

test('onRunInit：基地生命上限与当前生命同时 +5（含非默认开局生命）', () => {
  const plain = makeSim({ hex: null });
  assert.equal(plain.maxBaseHp, 20);
  assert.equal(plain.baseHp, 20);

  const sim = makeSim();
  assert.equal(sim.maxBaseHp, 25, '20 + 5');
  assert.equal(sim.baseHp, 25, '当前生命同增');
  assert.equal(sim.hexState.devoured, 0);

  // 变异/难度把开局生命改小时同样只 +5。
  const low = makeSim({ baseHp: 10, maxBaseHp: 10 });
  assert.equal(low.maxBaseHp, 15);
  assert.equal(low.baseHp, 15);
});

test('开局自带遗物（start_relic 解锁）每件同样扣 1 上限', () => {
  const sim = makeSim({
    relics: [
      { id: 'sharp', level: 1 },
      { id: 'quickdraw', level: 1 },
    ],
  });
  assert.equal(sim.maxBaseHp, 23, '20 + 5 - 2');
  assert.equal(sim.baseHp, 23);
  assert.equal(sim.hexState.devoured, 2);
});

test('读档不重放 onRunInit：上限与生命从快照恢复', () => {
  const restored = makeSim({
    baseHp: 22,
    maxBaseHp: 23,
    relics: [{ id: 'sharp', level: 1 }],
    restored: true,
    hexState: { devoured: 1 },
  });
  assert.equal(restored.maxBaseHp, 23, '不再 +5');
  assert.equal(restored.baseHp, 22, '当前生命保持快照值');
  assert.equal(restored.hexState.devoured, 1);
});

test('每获得一件遗物上限 -1，当前生命 clamp 到新上限', () => {
  const sim = makeSim();
  assert.equal(sim.addRelic('sharp').applied, true);
  assert.equal(sim.maxBaseHp, 24);
  assert.equal(sim.baseHp, 24, '满血时跟随上限下降');
  assert.equal(sim.hexState.devoured, 1);

  // 残血：只 clamp，不回血。
  sim.baseHp = 12;
  assert.equal(sim.addRelic('quickdraw').applied, true);
  assert.equal(sim.maxBaseHp, 23);
  assert.equal(sim.baseHp, 12, '当前生命不超过新上限，但也不会被抬高');

  // 升级同一件遗物也是一次「拿」，同样 -1。
  assert.equal(sim.addRelic('sharp').applied, true);
  assert.equal(sim.maxBaseHp, 22);
  assert.equal(sim.baseHp, 12);
  assert.equal(sim.hexState.devoured, 3);
});

test('当前生命高于新上限时被 clamp', () => {
  const sim = makeSim();
  sim.baseHp = 25;
  sim.maxBaseHp = 25;
  assert.equal(sim.addRelic('sharp').applied, true);
  assert.equal(sim.maxBaseHp, 24);
  assert.equal(sim.baseHp, 24);
});

test('上限最低 1：降到 1 后不再扣，生命不低于 1', () => {
  const sim = makeSim();
  sim.maxBaseHp = 2;
  sim.baseHp = 2;
  assert.equal(sim.addRelic('sharp').applied, true);
  assert.equal(sim.maxBaseHp, 1);
  assert.equal(sim.baseHp, 1);

  // 已到 1 时继续拿遗物：上限不再下探，生命保持 1。
  assert.equal(sim.addRelic('quickdraw').applied, true);
  assert.equal(sim.maxBaseHp, 1);
  assert.equal(sim.baseHp, 1);
  assert.equal(sim.hexState.devoured, 2, '计数仍然记录');
});

test('事件奖励遗物同样触发（applyOffer 的遗物奖励路径）', () => {
  const sim = makeSim();
  const result = sim.applyOffer({ kind: 'relic', id: 'bounty', toLevel: 1 });
  assert.equal(result.applied, true);
  assert.equal(sim.maxBaseHp, 24, '奖励遗物也 -1');
  assert.equal(sim.baseHp, 24);
  assert.ok(sim.relics.some((relic) => relic.id === 'bounty'));
});

test('四选一、刷新免费、刷新次数 +2 经 HexRuntime 暴露', () => {
  const sim = makeSim();
  assert.equal(sim.hexRuntime.relicOfferCount(3), 4, '基础 3 → 4');
  assert.equal(sim.hexRuntime.relicRerollCost(25, 0), 0, '刷新免费');
  assert.equal(sim.hexRuntime.relicRerollBonus(1), 3, '基础 1 次 → 3 次');
  assert.equal(sim.hexRuntime.relicRerollBonus(3), 5, '解锁 +2 后 → 5 次');

  // 同一个钩子不经 Simulation 也成立（服务端 hexRuntimeFor 用裸 HexRuntime）。
  const bare = new HexRuntime(HEX);
  assert.equal(bare.relicOfferCount(3), 4);
  assert.equal(bare.relicRerollCost(25, 5), 0);
  assert.equal(bare.relicRerollBonus(1), 3);

  // 无海克斯时运行时回退默认值。
  const none = new HexRuntime(null);
  assert.equal(none.relicOfferCount(3), 3);
  assert.equal(none.relicRerollCost(25, 0), 25);
  assert.equal(none.relicRerollBonus(1), 1);
});

test('无海克斯时行为完全不变', () => {
  const sim = makeSim({ hex: null });
  assert.equal(sim.hex, null);
  assert.equal(sim.hexRuntime.active, false);
  assert.deepEqual(sim.hexState, {});
  assert.equal(sim.maxBaseHp, 20);
  assert.equal(sim.baseHp, 20);

  assert.equal(sim.addRelic('sharp').applied, true);
  assert.equal(sim.maxBaseHp, 20, '无海克斯不扣上限');
  assert.equal(sim.baseHp, 20);
});

// ---------- 服务端：relicOffers / serialize 读到同一组钩子 ----------

const PORT = await allocatePort();
const BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join(os.tmpdir(), `rtd-hex-devourer-${process.pid}-${Date.now()}.db`);
const TOKEN = 'hex-devourer-token-0001';

let server = null;
let serverLog = '';

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

// 开局三选一依赖已实现池洗牌：按服务端同一算法（hexOfferSeed → run:<seed>）找一个能抽到
// 遗物吞噬者的固定种子，避免依赖随机 create 的运气。
function fixedSeedOfferingDevourer() {
  for (let i = 0; i < 50; i += 1) {
    const seed = `devourer-${i}`;
    const offers = offerHexes(`run:test-${seed}`, 3, 'normal');
    if (offers.includes(HEX)) return { seed, offers };
  }
  throw new Error('找不到能抽到遗物吞噬者的固定种子');
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
      ALLOW_TEST_SEED: '1',
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
  await waitForHealth({ base: BASE, port: PORT, child: server, log: () => serverLog });
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

test('服务端：遗物吞噬者局拿到 4 选 1、免费刷新、3 次刷新额度', async () => {
  const fixed = fixedSeedOfferingDevourer();
  const created = await fetch(`${BASE}/api/runs`, {
    method: 'POST',
    headers: {
      'x-player-token': TOKEN,
      'x-test-seed': fixed.seed,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ mode: 'normal', difficulty: 'roam' }),
  });
  const data = await created.json();
  assert.equal(created.status, 200, JSON.stringify(data));
  assert.deepEqual(data.hexOffers, fixed.offers, '固定种子下服务端三选一与本地算法一致');
  assert.ok(data.hexOffers.includes(HEX));

  const runId = data.runId;
  const chosen = await api(`/api/runs/${runId}/hex`, {
    method: 'POST',
    body: { hexId: HEX },
  });
  assert.equal(chosen.status, 200, JSON.stringify(chosen.data));
  await api(`/api/runs/${runId}/map`, { method: 'POST', body: { index: 0 } });
  await api(`/api/runs/${runId}/wave`, { method: 'POST', body: {} });
  await api(`/api/runs/${runId}/clear`, { method: 'POST', body: { wave: 1 } });

  const relics = await api(`/api/runs/${runId}/relics`, { method: 'POST', body: {} });
  assert.equal(relics.status, 200, JSON.stringify(relics.data));
  assert.equal(relics.data.offerCount, 4, '四选一');
  assert.equal(relics.data.offers.length, 4);
  assert.equal(relics.data.rerollCost, 0, '刷新免费');
  assert.equal(relics.data.maxRerolls, 3, '基础 1 次 + 2');
  assert.equal(relics.data.rerollsUsed, 0);

  // 免费刷新在服务端放行（费用 0 且额度未用完）。
  const rerolled = await api(`/api/runs/${runId}/relics`, { method: 'POST', body: { reroll: true } });
  assert.equal(rerolled.status, 200, JSON.stringify(rerolled.data));
  assert.equal(rerolled.data.rerollsUsed, 1);
  assert.equal(rerolled.data.rerollCost, 0);
  assert.equal(rerolled.data.maxRerolls, 3);

  // serialize 同样带上海克斯加码后的刷新额度（刷新恢复后的 HUD 一致）。
  const info = await api(`/api/runs/${runId}`);
  assert.equal(info.status, 200, JSON.stringify(info.data));
  assert.equal(info.data.run.maxRerolls, 3);
  assert.equal(info.data.run.hex.id, HEX);
});
