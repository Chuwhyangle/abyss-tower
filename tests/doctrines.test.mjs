// 教义（§6）：五条塔专精的纯函数验收 + 战斗行为路由 + 快照往返 + 未选教义的确定性（gap-ac-059）。
// 断言口径与 docs/PHASE_ROGUE2.md §6.1 / §6.2 / §8.2 / §8.3 / §8.4 的冻结约束逐条对齐。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DOCTRINE_IDS,
  DOCTRINE_MAX_PER_RUN,
  DOCTRINE_BY_TOWER_TYPE,
  TOWER_TYPE_DOCTRINE,
  DOCTRINES,
  normalizeDoctrineIds,
  applyDoctrine,
  doctrineTowerType,
} from '../public/js/shared/doctrines.js';
import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { SAVE_VERSION, toSnapshot, validateSnapshot, normalizeSnapshot } from '../public/js/shared/snapshot.js';

const EPS = 1e-9;
const ALMOST = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < EPS, `${message || ''} 期望 ${expected}，实际 ${actual}`);

function withFixedNow(now, fn) {
  const realNow = Date.now;
  Date.now = () => now;
  try {
    return fn();
  } finally {
    Date.now = realNow;
  }
}

function makeSim({ relics = [], doctrines = [], seed = 'doctrine-test-seed' } = {}) {
  return new Simulation({
    map: generateMap(seed),
    seed,
    difficulty: 'standard',
    gold: 100000,
    baseHp: 20,
    maxBaseHp: 20,
    relics: relics.map((id) => ({ id, level: 1 })),
    towers: [],
    unlockedTowers: ['arrow', 'cannon', 'frost', 'arc', 'poison'],
    startedAt: 1700000000000,
    rogue2: { doctrines },
    onSave: () => {},
  });
}

function addTower(sim, type = 'arrow', level = 0) {
  const tower = sim.makeTower(type, 5, 5, level, 0);
  sim.towers.push(tower);
  return tower;
}

// 生成一名可精确控制位置/护甲/减速状态的敌人（复用 spawnEnemy 的字段初始化）。
function addEnemy(sim, { x = 0, y = 0, armor = 0, slowUntil = 0 } = {}) {
  sim.spawnEnemy('grunt');
  const enemy = sim.enemies[sim.enemies.length - 1];
  Object.assign(enemy, { hp: 100000, maxHp: 100000, armor, boss: false, dead: false, slowUntil, poisonUntil: 0, poisonDps: 0, x, y });
  return enemy;
}

test('常量与冻结表一致（§6.1/§6.2）', () => {
  assert.deepEqual(DOCTRINE_IDS, ['bolt', 'cannon', 'frost', 'arc', 'poison']);
  assert.equal(DOCTRINE_MAX_PER_RUN, 2);
  assert.deepEqual(DOCTRINE_BY_TOWER_TYPE, {
    bolt: 'arrow',
    cannon: 'cannon',
    frost: 'frost',
    arc: 'arc',
    poison: 'poison',
  });
  for (const id of DOCTRINE_IDS) {
    const def = DOCTRINES[id];
    assert.equal(def.id, id);
    assert.equal(def.towerType, DOCTRINE_BY_TOWER_TYPE[id]);
    assert.equal(def.nameKey, `doctrine.${id}.name`);
    assert.equal(def.descKey, `doctrine.${id}.desc`);
    assert.ok(typeof def.glyph === 'string' && def.glyph.length > 0, `${id} 缺 glyph`);
    assert.ok(/^#[0-9a-f]{6}$/i.test(def.color), `${id} 颜色非法`);
    assert.equal(TOWER_TYPE_DOCTRINE[def.towerType], id);
  }
  for (const id of DOCTRINE_IDS) assert.equal(doctrineTowerType(id), DOCTRINE_BY_TOWER_TYPE[id]);
  assert.equal(doctrineTowerType('nope'), null);
});

test('normalizeDoctrineIds 收敛非法输入（§8.2）', () => {
  assert.deepEqual(normalizeDoctrineIds(['bolt', 'cannon', 'bolt', 'nope', null, 3]), ['bolt', 'cannon']);
  assert.deepEqual(normalizeDoctrineIds([]), []);
  assert.deepEqual(normalizeDoctrineIds(undefined), []);
  assert.deepEqual(normalizeDoctrineIds('bolt'), []);
});

test('applyDoctrine：五条均可选，事件字段与 §8.3 对齐', () => {
  for (const id of DOCTRINE_IDS) {
    const result = applyDoctrine({ wave: 9, doctrines: [] }, id);
    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
    assert.deepEqual(result.state, { wave: 9, doctrines: [id] });
    assert.deepEqual(result.event, {
      type: 'doctrine_chosen',
      wave: 9,
      id,
      towerType: DOCTRINE_BY_TOWER_TYPE[id],
    });
  }
  // doctrineId 可为核心选项载荷 { doctrineId }（boss-core 选项透传）。
  const viaPayload = applyDoctrine({ wave: 3, doctrines: [] }, { doctrineId: 'arc' });
  assert.equal(viaPayload.ok, true);
  assert.deepEqual(viaPayload.state.doctrines, ['arc']);
});

test('不可逆、不叠加、每局最多 2 条（§6.1）', () => {
  const first = applyDoctrine({ wave: 9, doctrines: [] }, 'bolt');
  assert.equal(first.ok, true);
  const dup = applyDoctrine({ wave: 9, doctrines: first.state.doctrines }, 'bolt');
  assert.equal(dup.ok, false);
  assert.equal(dup.reason, 'duplicate');
  assert.equal(dup.state, null);

  const second = applyDoctrine({ wave: 9, doctrines: first.state.doctrines }, 'arc');
  assert.equal(second.ok, true);
  assert.deepEqual(second.state.doctrines, ['bolt', 'arc'], '选择只追加，不替换/不重排已有顺序');

  const third = applyDoctrine({ wave: 9, doctrines: second.state.doctrines }, 'frost');
  assert.equal(third.ok, false);
  assert.equal(third.reason, 'max');
  assert.equal(third.state, null);
});

test('未知教义 id 返回 ok:false（§8.1 边界）', () => {
  const result = applyDoctrine({ wave: 1, doctrines: [] }, 'nope');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unknown');
  assert.equal(result.state, null);
});

test('快照往返：doctrines 入 rogue2 块并可恢复；旧档无 doctrines 视为空（§8.4）', () => {
  const state = {
    runId: 'run-doctrine',
    seed: 'seed-doctrine',
    mode: 'normal',
    difficulty: 'standard',
    clearedWave: 14,
    pendingDraft: false,
    gold: 200,
    baseHp: 18,
    maxBaseHp: 18,
    kills: 9,
    relics: [{ id: 'sharp', level: 2 }],
    towers: [{ type: 'arrow', c: 2, r: 3, level: 1, invested: 80 }],
    startedAt: 1700000000000,
    rogue2: { contracts: [], bonusPoints: {}, doctrines: ['bolt', 'arc'] },
  };
  const snap = withFixedNow(1700000000123, () => toSnapshot(state));
  assert.equal(snap.version, SAVE_VERSION, '有教义时写当前版本');
  assert.deepEqual(snap.rogue2.doctrines, ['bolt', 'arc']);

  const validated = validateSnapshot(snap);
  assert.equal(validated.ok, true);
  assert.deepEqual(validated.snapshot.rogue2.doctrines, ['bolt', 'arc']);
  assert.deepEqual(normalizeSnapshot(snap).rogue2.doctrines, ['bolt', 'arc']);

  // 旧存档没有 rogue2.doctrines：视为空，且不影响原有 rogue2 块字节结构。
  const oldSnap = toSnapshot({ ...state, rogue2: { contracts: [], bonusPoints: {} } });
  assert.equal(oldSnap.version, 3, '无契约无教义时保持旧版本号');
  assert.equal('rogue2' in oldSnap, false, '空 rogue2 不写块');
});

test('Simulation 教义路由：同塔类全塔生效、其他塔类不变（§6.2）', () => {
  const sim = makeSim({ doctrines: ['bolt', 'arc'] });
  assert.equal(sim.hasDoctrine('bolt'), true);
  assert.equal(sim.hasDoctrine('arc'), true);
  assert.equal(sim.hasDoctrine('cannon'), false);
  assert.equal(sim.doctrineForTower('arrow'), 'bolt');
  assert.equal(sim.doctrineForTower('arc'), 'arc');
  assert.equal(sim.doctrineForTower('cannon'), null, '未选 cannon 教义，炮台不受影响');
  assert.equal(sim.doctrineForTower('frost'), null);
  assert.equal(sim.doctrineForTower('bogus'), null);
});

test('Simulation.applyDoctrine：写入 rogue2、返回事件、超上限拒绝', () => {
  const sim = makeSim();
  const first = sim.applyDoctrine('frost');
  assert.equal(first.ok, true);
  assert.equal(first.event.towerType, 'frost');
  assert.deepEqual(sim.rogue2.doctrines, ['frost']);

  const dup = sim.applyDoctrine('frost');
  assert.equal(dup.ok, false);
  assert.equal(dup.reason, 'duplicate');

  assert.equal(sim.applyDoctrine('bolt').ok, true);
  assert.deepEqual(sim.rogue2.doctrines, ['frost', 'bolt']);

  const over = sim.applyDoctrine('arc');
  assert.equal(over.ok, false);
  assert.equal(over.reason, 'max');
  assert.deepEqual(sim.rogue2.doctrines, ['frost', 'bolt'], '超上限拒绝时不消耗选择');
});

test('冰封教义（frost）：霜塔对已减速目标 +25%，未选教义不变（§6.2）', () => {
  const plain = makeSim();
  const frosted = makeSim({ doctrines: ['frost'] });
  const a = addEnemy(plain, { slowUntil: 5 });
  const b = addEnemy(frosted, { slowUntil: 5 });
  plain.time = 1;
  frosted.time = 1;
  const base = plain.damage(a, 100, { weapon: 'frost' });
  const boosted = frosted.damage(b, 100, { weapon: 'frost' });
  ALMOST(base, 100, '未选教义无加成');
  ALMOST(boosted, 125, '冰封教义 +25%');
});

test('燃烧教义（cannon）：炮台命中附加 2s 燃烧 15%/s；其他塔类不受影响（§6.2）', () => {
  const sim = makeSim({ doctrines: ['cannon'] });
  const cannonProj = { towerType: 'cannon', dmg: 40, ignoreArmor: false, tower: null, slow: 0, slowDur: 0, dot: 0, dotDur: 0, knockback: 0 };
  const target = addEnemy(sim);
  sim.hitEnemy(target, cannonProj);
  ALMOST(target.burnDps, 6, '40 × 0.15 = 6');
  assert.equal(target.burnUntil, 2, '2 秒燃烧');

  // 教义已选，但非炮台投射物不应触发燃烧。
  const arrowProj = { ...cannonProj, towerType: 'arrow' };
  const other = addEnemy(sim);
  sim.hitEnemy(other, arrowProj);
  assert.equal(other.burnDps, 0, '非炮台投射物不附加燃烧');
  assert.equal(other.burnUntil, 0, '非炮台投射物不附加燃烧');
});

test('疫病教义（poison）：毒伤向 0.8 格内最多 2 名扩散 60%（§6.2）', () => {
  const sim = makeSim({ doctrines: ['poison'] });
  const proj = { towerType: 'poison', dmg: 10, ignoreArmor: false, tower: null, slow: 0, slowDur: 0, dot: 20, dotDur: 3, knockback: 0 };
  const target = addEnemy(sim, { x: 0, y: 0 });
  const near = addEnemy(sim, { x: 0.5, y: 0 });
  const far = addEnemy(sim, { x: 5, y: 0 });
  sim.hitEnemy(target, proj);
  ALMOST(target.poisonDps, 20, '主目标满额毒伤');
  ALMOST(near.poisonDps, 12, '近邻 20 × 0.6 = 12');
  assert.equal(near.poisonUntil, 3);
  assert.equal(far.poisonDps, 0, '0.8 格外不扩散');

  // 已选毒教义，但非毒塔投射物不应触发扩散。
  const sim2 = makeSim({ doctrines: ['poison'] });
  const target2 = addEnemy(sim2, { x: 0, y: 0 });
  const near2 = addEnemy(sim2, { x: 0.5, y: 0 });
  sim2.hitEnemy(target2, { ...proj, towerType: 'arrow' });
  assert.equal(near2.poisonDps, 0, '非毒塔投射物不扩散');
});

test('穿透教义（bolt）：弩箭命中后向近邻穿透 1 层 60% 伤害（§6.2）', () => {
  const dmg = 50;
  const makeProj = (target) => ({
    id: 1, kind: 'bolt', x: -1, y: 0, target, towerType: 'arrow', dmg,
    ignoreArmor: false, tower: null, splash: 0, slow: 0, slowDur: 0, dot: 0, dotDur: 0, knockback: 0, ttl: 4,
  });

  const withDoctrine = makeSim({ doctrines: ['bolt'] });
  const t0 = addEnemy(withDoctrine, { x: 0, y: 0 });
  const t1 = addEnemy(withDoctrine, { x: 0.5, y: 0 });
  const t1Before = t1.hp;
  withDoctrine.projectileSystem.impact(makeProj(t0));
  ALMOST(t1Before - t1.hp, dmg * 0.6, '穿透目标承受 60% 伤害');

  const plain = makeSim();
  const p0 = addEnemy(plain, { x: 0, y: 0 });
  const p1 = addEnemy(plain, { x: 0.5, y: 0 });
  const p1Before = p1.hp;
  plain.projectileSystem.impact(makeProj(p0));
  assert.equal(p1.hp, p1Before, '未选教义不穿透');
});

test('过载教义（arc）：电弧连锁 +1、连锁范围 +0.8（§6.2）', () => {
  // 4 名敌人沿直线等距分布（间距 1），无教义链 3 名，有教义链 4 名。
  const run = (doctrines) => {
    const sim = makeSim({ doctrines });
    const tower = addTower(sim, 'arc');
    const enemies = [];
    for (let i = 0; i < 4; i++) enemies.push(addEnemy(sim, { x: i, y: 0 }));
    const before = enemies.map((e) => e.hp);
    sim.fire(tower, sim.statsFor(tower), enemies[0]);
    return enemies.map((e, i) => e.hp < before[i]).filter(Boolean).length;
  };
  assert.equal(run([]), 3, '无教义：chain=3 命中 3 名');
  assert.equal(run(['arc']), 4, '过载教义：chain+1 命中 4 名');
});

test('未选教义同 seed 逐字节一致；选教义后同 seed 亦逐字节一致（确定性）', () => {
  const drive = ({ relics, doctrines }) => {
    const sim = makeSim({ relics, doctrines, seed: 'doctrine-det-seed' });
    const tower = addTower(sim, 'arrow');
    const enemies = [addEnemy(sim, { x: 0, y: 0 }), addEnemy(sim, { x: 1, y: 0 })];
    // 暴击遗物驱动 combatRng 消费 + 直接伤害 + 投射物开火，覆盖命中与 RNG 路径。
    for (let i = 0; i < 6; i++) {
      sim.dealDamage(enemies[i % 2], 10, 'arrow', { tower });
      sim.fire(tower, sim.statsFor(tower), enemies[i % 2]);
    }
    sim.rogue2 = { contracts: [], bonusPoints: {}, doctrines: sim.rogue2.doctrines };
    return withFixedNow(1700000000999, () => JSON.stringify(sim.toSnapshot()));
  };

  const relics = ['sharp', 'crit'];
  assert.equal(drive({ relics, doctrines: [] }), drive({ relics, doctrines: [] }), '未选教义逐字节一致');
  assert.equal(drive({ relics, doctrines: ['bolt'] }), drive({ relics, doctrines: ['bolt'] }), '选教义后逐字节一致');
});
