// 天赋树与永久强化（AC-063 + 三层重做阶段 0）：天赋被动真实折叠进确定性 sim（非只测函数），
// 零投入与不传天赋逐字节一致；三层节点表（数值/解锁/质变）+ unlocks 正交通道、
// 归一化/投入记账、player_kv 持久化与快照兼容。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';
import {
  TALENT_BY_ID,
  TALENT_CATEGORIES,
  TALENT_MECHANICS,
  TALENT_ORDER,
  TALENT_TIERS,
  investTalent,
  normalizeTalent,
  talentEffect,
  talentMods,
  talentUnlocks,
} from '../public/js/shared/data/meta.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UNIT_DB = path.join(os.tmpdir(), `rtd-meta-tree-unit-${process.pid}-${Date.now()}.db`);

let createAccount = null;
let readTalent = null;
let writeTalent = null;
let readLegacy = null;
let grantLegacyInTx = null;
let TalentRoutes = null;

function removeDb(file) {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(`${file}${suffix}`, { force: true });
    } catch {
      /* ignore */
    }
  }
}

before(async () => {
  process.env.DB_PATH = UNIT_DB;
  process.env.DB_BACKUP = '0';
  await import('../server/db/index.mjs');
  ({ createAccount, readTalent, writeTalent } = await import('../server/db/accounts.mjs'));
  ({ readLegacy, grantLegacyInTx } = await import('../server/db/legacy.mjs'));
  ({ TalentRoutes } = await import('../server/routes/talent.mjs'));
});

after(() => {
  removeDb(UNIT_DB);
});

// 薄路由测试用假上下文：只捕获 json/fail 调用与 readJson 请求体，不拉起 HTTP 服务。
function fakeCtx(token, body = {}) {
  const calls = [];
  return {
    token,
    calls,
    async readJson() {
      return body;
    },
    json(status, data) {
      calls.push({ kind: 'json', status, data });
      return true;
    },
    fail(status, message, code = null) {
      calls.push({ kind: 'fail', status, message, code });
      return true;
    },
  };
}

function makeSim({ talent } = {}) {
  const seed = 'meta-tree-seed';
  const map = generateMap(seed);
  const sim = new Simulation({
    map,
    seed,
    difficulty: 'standard',
    gold: 5000,
    baseHp: 50,
    maxBaseHp: 50,
    relics: [{ id: 'crit', level: 2 }],
    skill: { id: 'aurora', level: 5 },
    unlockedTowers: ['arrow', 'cannon', 'frost'],
    talent,
    onToast: () => {},
  });
  const cells = [];
  for (let r = 0; r < map.rows; r += 1) {
    for (let c = 0; c < map.cols; c += 1) {
      if (sim.canBuild(c, r)) cells.push([c, r]);
    }
  }
  const types = ['arrow', 'cannon', 'frost'];
  for (let i = 0; i < Math.min(4, cells.length); i += 1) {
    sim.placeTower(types[i % types.length], cells[i][0], cells[i][1]);
  }
  return { sim, map, seed };
}

function playScriptedWaves(sim, map, seed, waves = 2) {
  for (let wave = 1; wave <= waves; wave += 1) {
    const def = generateWave(
      seed,
      wave,
      'standard',
      { portalCount: map.meta?.portalCount || 1, modifier: map.meta?.modifier || null },
      { endless: false }
    );
    assert.equal(sim.beginWave(def), true, `第 ${wave} 波应可开始`);
    let steps = 0;
    while (sim.phase === 'wave' && steps < 30 * 240) {
      if (sim.isSkillReady()) sim.castSkill();
      sim.update(1 / 30);
      steps += 1;
    }
  }
}

function normalizedState(sim) {
  const snapshot = sim.toSnapshot();
  delete snapshot.savedAt;
  delete snapshot.startedAt;
  return {
    snapshot,
    hud: sim.getHud(),
    stats: sim.towers.map((tower) => sim.statsFor(tower)),
  };
}

test('天赋树数据表：15 节点 / 3 层 3 类 / 字段齐全，旧 8 节点 id 保留', () => {
  assert.equal(TALENT_ORDER.length, 15);
  assert.equal(Object.keys(TALENT_BY_ID).length, 15);
  assert.deepEqual(Object.keys(TALENT_CATEGORIES).sort(), ['economy', 'skill', 'tower']);
  assert.deepEqual(Object.keys(TALENT_TIERS).sort(), ['numeric', 'qualitative', 'unlock']);
  assert.deepEqual(Object.keys(TALENT_MECHANICS).sort(), [
    'armorPierce', 'chain', 'crit', 'interest', 'relicControl', 'skillDoubleCast', 'towerCap',
  ]);

  const legacyIds = [
    'tower_atk', 'tower_range', 'tower_cost',
    'skill_cd', 'skill_power',
    'economy_gold', 'economy_interest', 'economy_kill',
  ];
  assert.ok(legacyIds.every((id) => id in TALENT_BY_ID), '旧 8 节点 id 应全部保留（零迁移）');

  for (const node of Object.values(TALENT_BY_ID)) {
    assert.equal(typeof node.id, 'string');
    assert.equal(typeof node.name, 'string');
    assert.ok(node.cost > 0, `${node.id} 应有点数成本`);
    assert.ok(node.maxRank >= 1, `${node.id} 应有等级上限`);
    assert.ok(TALENT_CATEGORIES[node.category], `${node.id} 的 category 未知`);
    assert.ok(TALENT_TIERS[node.tier], `${node.id} 的 tier 未知`);
    if (node.tier === 'numeric') {
      assert.equal(typeof node.effects, 'object', `${node.id} 数值节点应有 effects`);
      assert.ok(Object.keys(node.effects).length > 0, `${node.id} 数值节点 effects 不应为空`);
    } else {
      assert.ok(Array.isArray(node.unlocks), `${node.id} 解锁/质变节点应有 unlocks`);
      assert.ok(
        node.unlocks.every((key) => key in TALENT_MECHANICS),
        `${node.id} 的 unlocks 应全部命中机制表`
      );
    }
  }
});

test('talentEffect：按等级缩放、越界收敛、未知节点为空', () => {
  assert.equal(talentEffect('tower_atk', 2).dmgAll, 0.02);
  assert.equal(talentEffect('tower_atk', 1).dmgAll, 0.01);
  assert.deepEqual(talentEffect('tower_atk', 0), { dmgAll: 0 });
  assert.equal(talentEffect('tower_atk', 99).dmgAll, 0.03, '等级应钳到 maxRank');
  assert.equal(talentEffect('tower_range', 2).range, 0.2);
  assert.equal(talentEffect('skill_cd', 2).skillCd, -0.02);
  assert.deepEqual(talentEffect('unlock_crit', 1), {}, '解锁节点无 effects，null 防护返回空对象');
  assert.deepEqual(talentEffect('nope', 1), {});
});

test('normalizeTalent：脏输入一律收敛到零投入/合法区间', () => {
  assert.deepEqual(normalizeTalent(null), { points: 0, spent: 0, nodes: {} });
  assert.deepEqual(normalizeTalent('garbage'), { points: 0, spent: 0, nodes: {} });
  assert.deepEqual(normalizeTalent({ points: -5, nodes: { tower_atk: 99, bogus: 3 } }), {
    points: 0,
    spent: 3,
    nodes: { tower_atk: 3 },
  });
  assert.deepEqual(normalizeTalent({ points: 3, nodes: { tower_atk: 1 } }), {
    points: 3,
    spent: 1,
    nodes: { tower_atk: 1 },
  });
});

test('investTalent：只记有效投入，spent 恒等于 Σ nodes[].rank', () => {
  const state = normalizeTalent({ points: 3, nodes: { tower_range: 1 } });
  const first = investTalent(state, 'tower_range');
  assert.equal(first.ok, true);
  assert.equal(first.state.nodes.tower_range, 2);
  assert.equal(first.state.spent, 2);
  assert.deepEqual(
    first.state,
    normalizeTalent(first.state),
    '投入后的状态仍应可再归一化而不变形'
  );

  const maxed = investTalent(first.state, 'tower_range');
  assert.equal(maxed.ok, false);
  assert.equal(maxed.reason, 'maxed');

  const broke = investTalent({ points: 2, nodes: { tower_atk: 2, tower_range: 2 } }, 'skill_cd');
  assert.equal(broke.ok, false);
  assert.equal(broke.reason, 'no_points');

  const unknown = investTalent({ points: 1 }, 'nope');
  assert.equal(unknown.ok, false);
  assert.equal(unknown.reason, 'unknown_node');
});

test('talentMods：只汇总 EFFECT_REGISTRY 已声明的键，零投入为空对象，unlocks 不进 mods', () => {
  assert.deepEqual(talentMods(null), {});
  assert.deepEqual(
    talentMods({ points: 8, nodes: { tower_atk: 2, economy_kill: 1, skill_cd: 2, skill_power: 1 } }),
    { dmgAll: 0.02, killGold: 0.2, skillCd: -0.02, skillPower: 0.01 },
    'skillCd/skillPower 已注册，应折叠进 mods 供 skill-system 消费'
  );
  assert.deepEqual(
    talentMods({ points: 2, nodes: { unlock_crit: 1, qual_tower_cap: 1 } }),
    {},
    'unlocks 走独立通道，不进 mods'
  );
});

test('talentUnlocks：聚合已解锁机制，去重且只认 TALENT_MECHANICS 键', () => {
  assert.deepEqual(talentUnlocks(null), []);
  assert.deepEqual(
    talentUnlocks({ points: 3, nodes: { unlock_crit: 1, unlock_chain: 1, qual_tower_cap: 1 } }),
    ['crit', 'chain', 'towerCap'],
    '按表序聚合解锁/质变节点'
  );
  assert.deepEqual(talentUnlocks({ points: 2, nodes: { tower_atk: 2 } }), [], '数值节点不产生 unlock');
});

test('天赋被动真实折叠进确定性 sim 的 mods 与塔属性（非只测函数）', () => {
  const { sim } = makeSim({
    talent: { points: 8, nodes: { tower_atk: 2, tower_range: 2, economy_interest: 1 } },
  });
  assert.equal(sim.mods.dmgAll, 0.02);
  assert.equal(sim.mods.range, 0.2);
  assert.equal(sim.mods.interest, 0.01);
  // 射程是稳定塔属性，应随天赋变化。
  const withRange = makeSim({ talent: { points: 2, nodes: { tower_range: 2 } } });
  const without = makeSim();
  const diff =
    withRange.sim.statsFor(withRange.sim.towers[0]).range - without.sim.statsFor(without.sim.towers[0]).range;
  assert.ok(
    Math.abs(diff - 0.2) < 1e-9,
    `tower_range 天赋应真实抬高塔的射程属性（实际 ${diff}）`
  );
});

test('零投入与不传天赋逐字节一致，同 seed 同天赋两局完全一致', () => {
  const none = makeSim();
  const zero = makeSim({ talent: { points: 10, nodes: {} } });
  const nullTalent = makeSim({ talent: null });
  assert.deepEqual(zero.sim.mods, none.sim.mods);
  assert.deepEqual(nullTalent.sim.mods, none.sim.mods);

  playScriptedWaves(none.sim, none.map, none.seed);
  playScriptedWaves(zero.sim, zero.map, zero.seed);
  assert.equal(
    JSON.stringify(normalizedState(none.sim)),
    JSON.stringify(normalizedState(zero.sim)),
    '零投入天赋的对局状态应与不传天赋逐字节一致'
  );

  const talent = { points: 8, nodes: { tower_atk: 2, economy_kill: 1, skill_cd: 2 } };
  const a = makeSim({ talent });
  const b = makeSim({ talent });
  playScriptedWaves(a.sim, a.map, a.seed);
  playScriptedWaves(b.sim, b.map, b.seed);
  assert.equal(
    JSON.stringify(normalizedState(a.sim)),
    JSON.stringify(normalizedState(b.sim)),
    '同 seed 同天赋的两次对局应逐字节一致'
  );
});

test('player_kv 持久化：写入归一化、读取回读、未知账号回退零状态', () => {
  const account = createAccount({});
  const saved = writeTalent(account.id, { points: 5, nodes: { tower_atk: 99 } });
  assert.deepEqual(saved, { points: 5, spent: 3, nodes: { tower_atk: 3 } });

  const loaded = readTalent(account.id);
  assert.deepEqual(loaded, { points: 5, spent: 3, nodes: { tower_atk: 3 } });

  assert.deepEqual(readTalent('no-such-account'), { points: 0, spent: 0, nodes: {} });
});

test('toSnapshot 不写天赋字段，快照仍与旧存档兼容', () => {
  const { sim } = makeSim({ talent: { points: 2, nodes: { tower_atk: 2 } } });
  const snapshot = sim.toSnapshot();
  assert.equal('talent' in snapshot, false, '天赋是账号级永久状态，不应混入单局快照');
  assert.equal('talentMods' in snapshot, false);
  assert.equal(typeof snapshot.seed, 'string');
});

test('talent 路由：读取返回天赋、传承余额、15 节点视图与已生效 mods', () => {
  const account = createAccount({});
  grantLegacyInTx(account.id, 5);
  writeTalent(account.id, { points: 3, nodes: { tower_atk: 1 } });

  const ctx = fakeCtx(account.id);
  const routes = new TalentRoutes();
  routes.list(ctx);

  assert.equal(ctx.calls.length, 1);
  const res = ctx.calls[0];
  assert.equal(res.kind, 'json');
  assert.equal(res.status, 200);
  assert.equal(res.data.wallet.legacyCores, 5, '传承之核余额应来自 legacy 材料');
  assert.equal(res.data.talent.nodes.tower_atk, 1);
  assert.equal(res.data.nodes.length, 15, '三层 15 节点视图应齐全');
  const atk = res.data.nodes.find((node) => node.id === 'tower_atk');
  assert.equal(atk.rank, 1);
  assert.equal(atk.maxed, false);
  assert.ok(atk.canInvest, '余额充足且未满级应可投入');
  assert.equal(res.data.mods.dmgAll, 0.01, 'mods 应折叠 tower_atk 的 dmgAll');
});

test('talent 路由：投入节点扣传承之核并持久化，余额不足/满级/未知节点分路径拒绝', async () => {
  const account = createAccount({});
  grantLegacyInTx(account.id, 5);
  const routes = new TalentRoutes();

  const invest = async (nodeId) => {
    const ctx = fakeCtx(account.id, { nodeId });
    await routes.invest(ctx);
    return ctx.calls[0];
  };

  // tower_atk cost=2：投入扣 2 颗核，rank +1，points += cost、spent += 1。
  const first = await invest('tower_atk');
  assert.equal(first.kind, 'json');
  assert.equal(first.status, 200);
  assert.equal(first.data.wallet.legacyCores, 3);
  assert.equal(first.data.talent.nodes.tower_atk, 1);
  assert.equal(first.data.talent.points, 2);
  assert.equal(first.data.talent.spent, 1);
  assert.deepEqual(first.data.invested, { nodeId: 'tower_atk', from: 0, to: 1, cost: 2 });

  // tower_range cost=1、maxRank=2：两投后满级。
  const r1 = await invest('tower_range');
  assert.equal(r1.kind, 'json');
  assert.equal(r1.data.talent.nodes.tower_range, 1);
  assert.equal(r1.data.wallet.legacyCores, 2);
  const r2 = await invest('tower_range');
  assert.equal(r2.data.talent.nodes.tower_range, 2);
  assert.equal(r2.data.wallet.legacyCores, 1);

  // 已满级：拒绝，不再扣材料。
  const maxed = await invest('tower_range');
  assert.equal(maxed.kind, 'fail');
  assert.equal(maxed.status, 409);
  assert.equal(maxed.code, 'MAXED');
  assert.equal(readLegacy(account.id).materials.legacy_core, 1, '满级拒绝不得扣材料');

  // 花掉最后一颗核。
  const spend = await invest('economy_gold');
  assert.equal(spend.kind, 'json');
  assert.equal(spend.data.wallet.legacyCores, 0);

  // 余额不足：拒绝，一行都不改。
  const broke = await invest('skill_cd');
  assert.equal(broke.kind, 'fail');
  assert.equal(broke.status, 400);
  assert.equal(broke.code, 'INSUFFICIENT_LEGACY');
  assert.equal(readTalent(account.id).nodes.skill_cd, undefined, '余额不足不得写入节点');

  // 未知节点：拒绝。
  const unknown = await invest('nope');
  assert.equal(unknown.kind, 'fail');
  assert.equal(unknown.status, 400);
  assert.equal(unknown.code, 'INVALID_NODE');
});

test('talent 路由：投入失败（余额不足）不扣材料也不改天赋', async () => {
  const account = createAccount({});
  const routes = new TalentRoutes();

  const beforeLegacy = readLegacy(account.id);
  const beforeTalent = readTalent(account.id);

  const ctx = fakeCtx(account.id, { nodeId: 'tower_atk' });
  await routes.invest(ctx);

  assert.equal(ctx.calls[0].kind, 'fail');
  assert.equal(ctx.calls[0].code, 'INSUFFICIENT_LEGACY');
  assert.deepEqual(readLegacy(account.id), beforeLegacy, '失败后传承状态不变');
  assert.deepEqual(readTalent(account.id), beforeTalent, '失败后天赋状态不变');
});
