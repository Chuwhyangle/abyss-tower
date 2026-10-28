// 地图 2.0 × 主海克斯总验收：三图 × 十海克斯组合矩阵、计分倍率、每日/本周同组候选、
// 旧存档与旧回放恢复，确认两套系统一起工作且不破坏既有模式。
// 对应 QA-001 的验收标准：node --test tests/acceptance-map-hex.test.mjs
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { Simulation } from '../public/js/sim.js';
import { getDifficulty } from '../public/js/shared/data.js';
import { FIXED_MAPS, FIXED_MAP_BY_ID } from '../public/js/shared/maps/index.js';
import { generateWave } from '../public/js/shared/waves.js';
import { generateMap, legacyGenerateMap } from '../public/js/shared/mapgen.js';
import { HEXES, HEX_BY_ID, offerHexes } from '../public/js/shared/hexes.js';
import { computeOutcome, dayKey, hexScoreMul, weekKey } from '../public/js/shared/scoring.js';
import { SAVE_VERSION, validateSnapshot } from '../public/js/shared/snapshot.js';
import { validateSave } from '../public/js/shared/save.js';
import { decodeRun } from '../public/js/shared/replay.js';
import { ROOT, startTestServer } from './harness.mjs';

const START_GOLD = 2000;
const START_HP = 2000;
const STARTER_TOWERS = 3;
const WAVES_PER_RUN = 5;
const MAX_STEPS_PER_WAVE = 60 * 240;
// 每个组合用独立的确定性种子；结果只由地图 id 与海克斯 id 决定。
const seedFor = (id) => `qa-${id}`;

function buildSim(map, hexId) {
  return new Simulation({
    map,
    seed: seedFor(`${map.id}-${hexId}`),
    difficulty: 'standard',
    gold: START_GOLD,
    baseHp: START_HP,
    maxBaseHp: START_HP,
    relics: [],
    towers: [],
    hex: hexId,
  });
}

// 在地图自带的可建造格里放下起始塔；one_tower 只能建 1 座，其余放满 3 座。
function placeStarterTowers(sim, map) {
  let placed = 0;
  for (let r = 0; r < map.buildable.length && placed < STARTER_TOWERS; r += 1) {
    const row = map.buildable[r];
    for (let c = 0; c < row.length && placed < STARTER_TOWERS; c += 1) {
      if (!row[c]) continue;
      if (sim.placeTower('arrow', c, r)) placed += 1;
    }
  }
  return placed;
}

function firstBuildableCell(map) {
  for (let r = 0; r < map.buildable.length; r += 1) {
    const row = map.buildable[r];
    for (let c = 0; c < row.length; c += 1) {
      if (row[c]) return { c, r };
    }
  }
  throw new Error(`${map.id} 没有可建造格`);
}

// 战斗中的数值合法性：敌人/投射物位置与生命不得出现 NaN 或负数。
function assertLiveNumbers(sim, label) {
  for (const enemy of sim.enemies) {
    assert.ok(Number.isFinite(enemy.hp) && enemy.hp >= 0, `${label} 敌人生命非法`);
    assert.ok(Number.isFinite(enemy.x) && Number.isFinite(enemy.y), `${label} 敌人坐标非法`);
    assert.ok(Number.isFinite(enemy.progress), `${label} 敌人进度非法`);
  }
  for (const proj of sim.projectiles) {
    assert.ok(Number.isFinite(proj.x) && Number.isFinite(proj.y), `${label} 投射物坐标非法`);
    assert.ok(Number.isFinite(proj.dmg) && proj.dmg >= 0, `${label} 投射物伤害非法`);
  }
  for (const ally of sim.allies) {
    if (ally.hp != null) assert.ok(Number.isFinite(ally.hp) && ally.hp >= 0, `${label} 召唤物生命非法`);
    assert.ok(Number.isFinite(ally.x) && Number.isFinite(ally.y), `${label} 召唤物坐标非法`);
  }
}

function assertStableState(sim, label) {
  assert.ok(Number.isFinite(sim.gold) && sim.gold >= 0, `${label} 金币非法`);
  assert.ok(Number.isFinite(sim.baseHp) && sim.baseHp > 0, `${label} 基地生命非法`);
  assert.ok(Number.isFinite(sim.maxBaseHp), `${label} 基地生命上限非法`);
  assert.ok(Number.isInteger(sim.kills) && sim.kills >= 0, `${label} 击杀数非法`);
  for (const tower of sim.towers) {
    const stats = sim.statsFor(tower);
    for (const key of ['dmg', 'rate', 'range']) {
      assert.ok(Number.isFinite(stats[key]) && stats[key] > 0, `${label} 塔属性 ${key} 非法`);
    }
    if (tower.maxHp != null) {
      assert.ok(Number.isFinite(tower.maxHp) && tower.maxHp > 0, `${label} 塔生命上限非法`);
      assert.ok(Number.isFinite(tower.hp) && tower.hp >= 0, `${label} 塔生命非法`);
    }
  }
}

function runOneWave(sim, wave, map) {
  const label = `${map.id}/${sim.hex?.id || 'legacy'} 第 ${wave} 波`;
  const def = generateWave(sim.seed, wave, sim.difficulty, map.meta);
  assert.equal(sim.beginWave(def), true, `${label} 无法开始`);
  let steps = 0;
  while (sim.phase === 'wave' && steps < MAX_STEPS_PER_WAVE) {
    sim.update(1 / 60);
    steps += 1;
    if (steps % 60 === 0) assertLiveNumbers(sim, label);
  }
  assert.notEqual(sim.phase, 'wave', `${label} 未在 ${MAX_STEPS_PER_WAVE} 步内结束`);
}

test('三张固定图 × 十个海克斯：全部可开局并连跑 5 波', () => {
  assert.equal(FIXED_MAPS.length, 3, '固定地图必须恰好三张');
  assert.equal(HEXES.length, 10, '主海克斯必须恰好十个');
  assert.equal(FIXED_MAPS.map((map) => map.id).join(','), 'canyon,twin,ring');

  for (const map of FIXED_MAPS) {
    for (const hex of HEXES) {
      const label = `${map.id}/${hex.id}`;
      assert.equal(hex.implemented, true, `${hex.id} 未实现，不能进入总验收`);
      const sim = buildSim(map, hex.id);
      assert.equal(sim.map.id, map.id, `${label} 地图不一致`);
      assert.equal(sim.hex.id, hex.id, `${label} 海克斯未装载`);
      assert.equal(sim.hexRuntime.active, true, `${label} 海克斯运行时未激活`);

      // one_tower 的 canBuild 钩子必须真的拦住第 2 座塔。
      const expectedTowers = hex.id === 'one_tower' ? 1 : STARTER_TOWERS;
      const placed = placeStarterTowers(sim, map);
      assert.equal(placed, expectedTowers, `${label} 起始塔数量 ${placed} != ${expectedTowers}`);
      assertStableState(sim, label);

      for (let wave = 1; wave <= WAVES_PER_RUN; wave += 1) {
        runOneWave(sim, wave, map);
        assert.equal(sim.clearedWave, wave, `${label} 清波进度未推进`);
        assertStableState(sim, label);
      }
      // 第 5 波后进入事件阶段（或整备），不会卡在战斗中。
      assert.ok(['prep', 'event', 'over'].includes(sim.phase), `${label} 结束相位异常 ${sim.phase}`);

      // 海克斯状态写进快照并能通过统一校验；状态本身必须可 JSON 序列化。
      const hexState = JSON.parse(JSON.stringify(sim.hexRuntime.state));
      assert.deepEqual(sim.hexRuntime.state, hexState, `${label} hexState 不可序列化`);
      const snap = sim.toSnapshot();
      assert.equal(snap.hexId, hex.id, `${label} 快照未记录 hexId`);
      const checked = validateSnapshot(snap);
      assert.equal(checked.ok, true, `${label} 快照校验失败：${checked.reason}`);
      assert.equal(checked.warnings, undefined, `${label} 快照出现告警`);
      assert.equal(snap.version, SAVE_VERSION);
    }
  }
});

test('十个海克斯的 scoreMul 都进入结算（与地图倍率相乘）', () => {
  const payload = {
    waveReached: 12,
    wavesServed: 12,
    kills: 300,
    goldLeft: 640,
    baseHp: 9,
    difficulty: 'standard',
    mode: 'normal',
  };
  const diffMul = getDifficulty('standard').scoreMul;
  const baseline = computeOutcome(payload);
  const seen = new Set();

  for (const map of FIXED_MAPS) {
    const mapMul = map.meta.scoreMul;
    for (const hex of HEXES) {
      const hexMul = hexScoreMul(hex.id);
      assert.equal(hexMul, hex.scoreMul, `${hex.id} 的 hexScoreMul 与定义不一致`);
      assert.ok(hexMul > 1, `${hex.id} 的 scoreMul 应大于 1`);
      seen.add(hexMul);
      const outcome = computeOutcome({ ...payload, scoreMul: mapMul * hexMul });
      const expected = Math.round(baseline.rawScore * diffMul * mapMul * hexMul);
      assert.equal(outcome.score, expected, `${map.id}/${hex.id} 结算倍率未按乘积进入`);
      assert.ok(outcome.score > Math.round(baseline.rawScore * diffMul * mapMul));
    }
  }
  assert.ok(seen.size > 1, '十个海克斯的倍率不应完全相同');
  // 旧 run 没有 hex：一律按 1.0，结算与改动前一致。
  assert.equal(hexScoreMul(null), 1);
  assert.equal(hexScoreMul(''), 1);
  assert.equal(hexScoreMul('not-a-hex'), 1);

  // 服务端 settle 必须真的调用 hexScoreMul 并乘进 scoreMul（光有公式不算接线）。
  const source = fs.readFileSync(
    path.join(ROOT, 'server/services/run-settlement.mjs'),
    'utf8'
  );
  assert.match(source, /hexScoreMul\(hex\?\.id\)/, '服务端未读取海克斯倍率');
  assert.match(
    source,
    /scoreMul:\s*\(mapMeta\?\.scoreMul \|\| 1\) \* mutationMul \* hexMul/,
    '服务端未把海克斯倍率乘进结算'
  );
});

let server = null;

before(async () => {
  // 回退到 x-player-token 身份模式：同组玩家用不同 token 开局，才能比较候选是否一致。
  server = await startTestServer({ env: { AUTH_ENABLED: '0' } });
});

after(async () => {
  if (server) await server.stop();
});

async function createRun(token, mode) {
  const response = await fetch(`${server.base}/api/runs`, {
    method: 'POST',
    headers: { 'x-player-token': token, 'content-type': 'application/json' },
    body: JSON.stringify({ mode, difficulty: 'standard' }),
  });
  const data = await response.json().catch(() => null);
  assert.equal(response.status, 200, `创建 ${mode} 远征失败：${JSON.stringify(data)}`);
  return data;
}

function assertOffersShape(data, mode) {
  assert.equal(data.hex, null, `${mode} 未选择前不应有已选海克斯`);
  assert.equal(data.hexOffers.length, 3, `${mode} 候选必须三选一`);
  assert.equal(new Set(data.hexOffers).size, 3, `${mode} 候选不得重复`);
  for (const id of data.hexOffers) assert.ok(HEX_BY_ID[id], `${mode} 候选含未知海克斯 ${id}`);
}

test('每日/本周同组 offers 一致，且与纯函数派生结果相同', async () => {
  const stamp = `${process.pid}-${Date.now()}`;
  const dailyA = await createRun(`qa-daily-a-${stamp}`, 'daily');
  const dailyB = await createRun(`qa-daily-b-${stamp}`, 'daily');
  assertOffersShape(dailyA, 'daily');
  assertOffersShape(dailyB, 'daily');
  assert.deepEqual(dailyA.hexOffers, dailyB.hexOffers, '同一天的每日挑战候选必须一致');
  assert.deepEqual(dailyA.hexOffers, offerHexes(`daily:${dayKey()}`, 3, 'daily'));

  const weeklyA = await createRun(`qa-weekly-a-${stamp}`, 'weekly');
  const weeklyB = await createRun(`qa-weekly-b-${stamp}`, 'weekly');
  assertOffersShape(weeklyA, 'weekly');
  assertOffersShape(weeklyB, 'weekly');
  assert.deepEqual(weeklyA.hexOffers, weeklyB.hexOffers, '同一周的每周挑战候选必须一致');
  assert.deepEqual(weeklyA.hexOffers, offerHexes(`weekly:${weekKey()}`, 3, 'weekly'));
});

test('旧快照（v3 · 无海克斯 · 随机地图）可恢复并继续跑波', () => {
  const legacyMap = legacyGenerateMap('legacy-save-seed');
  // 旧存档的随机地图与固定 canyon 是不同几何：必须走 legacy carve，而不是偷换成固定图。
  assert.notDeepEqual(legacyMap.pathCells, FIXED_MAP_BY_ID.canyon.pathCells);
  const cell = firstBuildableCell(legacyMap);
  const oldSnapshot = {
    version: 3,
    runId: 'legacy-run',
    seed: 'legacy-save-seed',
    mode: 'normal',
    difficulty: 'standard',
    wave: 4,
    clearedWave: 4,
    pendingDraft: false,
    gold: 320,
    baseHp: 15,
    maxBaseHp: 20,
    kills: 88,
    relics: [{ id: 'sharp', level: 2 }],
    towers: [{ type: 'arrow', c: cell.c, r: cell.r, level: 1, invested: 80 }],
    skill: null,
    startedAt: 1700000000000,
    savedAt: 1700000000000,
    // 地图 2.0 之前的随机图：archetype 合法，但没有 ruleset.mapPool / hex。
    mapId: 'triple',
    mapChoice: 1,
  };

  const restored = validateSave(oldSnapshot);
  assert.equal(restored.ok, true, `旧快照被拒绝：${restored.reason}`);
  assert.equal(restored.snapshot.hexId, undefined, '旧快照不应凭空获得海克斯');
  assert.equal(restored.snapshot.mapId, 'triple', '旧地图标识应保留');
  assert.equal(restored.snapshot.mapChoice, 1);

  const snap = restored.snapshot;
  const sim = new Simulation({
    map: legacyMap,
    seed: snap.seed,
    difficulty: snap.difficulty,
    runId: snap.runId,
    mode: snap.mode,
    gold: snap.gold,
    baseHp: snap.baseHp,
    maxBaseHp: snap.maxBaseHp,
    relics: snap.relics,
    towers: snap.towers,
    wave: snap.clearedWave,
    clearedWave: snap.clearedWave,
    kills: snap.kills,
    restored: true,
    hex: null,
    hexState: null,
  });
  assert.equal(sim.hex, null, '旧快照恢复后不应有海克斯定义');
  assert.equal(sim.hexRuntime.active, false, '旧快照恢复后海克斯运行时必须停用');
  assert.equal(sim.towers.length, 1, '旧快照的塔应恢复');

  // 旧档继续玩：第 5 波不得因为缺少 hex 字段崩溃。
  runOneWave(sim, 5, legacyMap);
  assert.equal(sim.clearedWave, 5);
  assertStableState(sim, 'legacy-save');

  // 旧档回写仍是旧字节结构：没有 hexId/hexState，版本不因总验收升级。
  const next = sim.toSnapshot();
  assert.ok(!('hexId' in next), '无海克斯的旧局不应写 hexId');
  assert.ok(!('hexState' in next), '无海克斯的旧局不应写 hexState');
  assert.equal(next.version, 3);
  assert.equal(validateSnapshot(next).ok, true);
});

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function legacyReplayCode(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `RTD1.${body}.${fnv1a(body).toString(16).padStart(8, '0')}`;
}

test('旧回放（RTD1 · 随机地图 · 无海克斯）可解码并复现开局', () => {
  const code = legacyReplayCode({
    v: 1,
    s: 'legacy-replay-seed',
    m: 2,
    d: 'standard',
    o: 'normal',
    r: [['sharp', 2]],
    e: [],
  });
  const decoded = decodeRun(code);
  assert.equal(decoded.ok, true, `旧回放解码失败：${decoded.code}`);
  assert.equal(decoded.run.hexId, null, '旧回放没有主海克斯字段');
  assert.equal(decoded.run.mapChoice, 2);
  assert.equal(decoded.run.seed, 'legacy-replay-seed');

  // 旧回放没有 ruleset.mapPool：按 legacy 随机 carve 重建地图，模拟层照常可开局。
  const map = legacyGenerateMap(decoded.run.seed);
  const sim = new Simulation({
    map,
    seed: decoded.run.seed,
    difficulty: decoded.run.difficulty,
    mode: decoded.run.mode,
    relics: decoded.run.relics,
    towers: [],
    hex: decoded.run.hexId,
    hexState: null,
  });
  assert.equal(sim.hexRuntime.active, false);
  runOneWave(sim, 1, map);
  assert.equal(sim.clearedWave, 1);

  // 固定地图入口仍然稳定：generateMap 永远给 canyon，不受旧种子影响。
  assert.equal(generateMap(decoded.run.seed).id, 'canyon');
});
