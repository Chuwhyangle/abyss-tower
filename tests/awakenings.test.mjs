// 觉醒（§7）：四条 Ⅲ 级遗物行为词条的纯函数验收 + 战斗行为路由 + 快照往返 + 未觉醒的确定性（gap-ac-060）。
// 断言口径与 docs/PHASE_ROGUE2.md §7.1 / §7.2 / §8.1 / §8.2 / §8.3 / §8.4 的冻结约束逐条对齐。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AWAKENING_IDS,
  AWAKENINGS,
  awakeningFor,
  normalizeAwakenings,
  applyAwakening,
} from '../public/js/shared/awakenings.js';
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

function makeSim({ relics = [], awakenings = [], seed = 'awakening-test-seed' } = {}) {
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
    rogue2: { awakenings },
    onSave: () => {},
  });
}

function addTower(sim, type = 'arrow', level = 0) {
  const tower = sim.makeTower(type, 5, 5, level, 0);
  sim.towers.push(tower);
  return tower;
}

// 生成一名可精确控制位置/护甲/减速/中毒状态的敌人（复用 spawnEnemy 的字段初始化）。
function addEnemy(sim, { x = 0, y = 0, armor = 0, slowUntil = 0 } = {}) {
  sim.spawnEnemy('grunt');
  const enemy = sim.enemies[sim.enemies.length - 1];
  Object.assign(enemy, { hp: 100000, maxHp: 100000, armor, boss: false, dead: false, slowUntil, poisonUntil: 0, poisonDps: 0, x, y });
  return enemy;
}

test('常量与冻结表一致（§7.2/§8.1）', () => {
  assert.deepEqual(AWAKENING_IDS, ['sharp-pierce', 'powder-ignite', 'frostheart-shatter', 'toxin-spread']);
  for (const id of AWAKENING_IDS) {
    const def = AWAKENINGS[id];
    assert.equal(def.id, id);
    assert.equal(def.nameKey, `awakening.${id}.name`);
    assert.equal(def.descKey, `awakening.${id}.desc`);
  }
  assert.equal(awakeningFor('sharp').id, 'sharp-pierce');
  assert.equal(awakeningFor('powder').relicId, 'powder');
  assert.equal(awakeningFor('frostheart').id, 'frostheart-shatter');
  assert.equal(awakeningFor('toxin').id, 'toxin-spread');
  assert.equal(awakeningFor('nope'), null);
});

test('normalizeAwakenings 收敛非法输入（§8.2）', () => {
  assert.deepEqual(
    normalizeAwakenings([{ relicId: 'sharp', id: 'sharp-pierce' }, { id: 'powder-ignite' }, { relicId: 'sharp', id: 'sharp-pierce' }, { id: 'nope' }, null, 3]),
    [{ relicId: 'sharp', id: 'sharp-pierce' }, { relicId: 'powder', id: 'powder-ignite' }]
  );
  assert.deepEqual(normalizeAwakenings([]), []);
  assert.deepEqual(normalizeAwakenings(undefined), []);
  assert.deepEqual(normalizeAwakenings('sharp'), []);
});

test('applyAwakening：四条均可选，事件字段与 §8.3 对齐', () => {
  const map = { sharp: 'sharp-pierce', powder: 'powder-ignite', frostheart: 'frostheart-shatter', toxin: 'toxin-spread' };
  for (const [relicId, id] of Object.entries(map)) {
    const result = applyAwakening({ wave: 9, awakenings: [] }, relicId);
    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
    assert.deepEqual(result.state, { wave: 9, awakenings: [{ relicId, id }] });
    assert.deepEqual(result.event, { type: 'awakening_gained', wave: 9, relicId, id });
  }
  // relicId 可为核心选项载荷 { relicId }（boss-core 选项透传）。
  const viaPayload = applyAwakening({ wave: 3, awakenings: [] }, { relicId: 'powder' });
  assert.equal(viaPayload.ok, true);
  assert.deepEqual(viaPayload.state.awakenings, [{ relicId: 'powder', id: 'powder-ignite' }]);
});

test('不可逆、同一遗物最多 1 条、不消耗原遗物（§7.1）', () => {
  const first = applyAwakening({ wave: 9, awakenings: [] }, 'sharp');
  assert.equal(first.ok, true);
  const dup = applyAwakening({ wave: 9, awakenings: first.state.awakenings }, 'sharp');
  assert.equal(dup.ok, false);
  assert.equal(dup.reason, 'duplicate');
  assert.equal(dup.state, null);

  // 同一遗物不重复，但不同遗物各自一条。
  const second = applyAwakening({ wave: 9, awakenings: first.state.awakenings }, 'toxin');
  assert.equal(second.ok, true);
  assert.deepEqual(second.state.awakenings, [
    { relicId: 'sharp', id: 'sharp-pierce' },
    { relicId: 'toxin', id: 'toxin-spread' },
  ]);
});

test('未知遗物 id 返回 ok:false（§8.1 边界）', () => {
  const result = applyAwakening({ wave: 1, awakenings: [] }, 'nope');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unknown');
  assert.equal(result.state, null);
});

test('快照往返：awakenings 入 rogue2 块并可恢复；旧档无 awakenings 视为空（§8.4）', () => {
  const state = {
    runId: 'run-awakening',
    seed: 'seed-awakening',
    mode: 'normal',
    difficulty: 'standard',
    clearedWave: 14,
    pendingDraft: false,
    gold: 200,
    baseHp: 18,
    maxBaseHp: 18,
    kills: 9,
    relics: [{ id: 'sharp', level: 3 }],
    towers: [{ type: 'arrow', c: 2, r: 3, level: 1, invested: 80 }],
    startedAt: 1700000000000,
    rogue2: { contracts: [], bonusPoints: {}, doctrines: [], awakenings: [{ relicId: 'sharp', id: 'sharp-pierce' }] },
  };
  const snap = withFixedNow(1700000000123, () => toSnapshot(state));
  assert.equal(snap.version, SAVE_VERSION, '有觉醒时写当前版本');
  assert.deepEqual(snap.rogue2.awakenings, [{ relicId: 'sharp', id: 'sharp-pierce' }]);

  const validated = validateSnapshot(snap);
  assert.equal(validated.ok, true);
  assert.deepEqual(validated.snapshot.rogue2.awakenings, [{ relicId: 'sharp', id: 'sharp-pierce' }]);
  assert.deepEqual(normalizeSnapshot(snap).rogue2.awakenings, [{ relicId: 'sharp', id: 'sharp-pierce' }]);

  // 旧存档没有 rogue2.awakenings：视为空，且不影响原有 rogue2 块字节结构。
  const oldSnap = toSnapshot({ ...state, rogue2: { contracts: [], bonusPoints: {}, doctrines: [] } });
  assert.equal(oldSnap.version, 3, '无契约无教义无觉醒时保持旧版本号');
  assert.equal('rogue2' in oldSnap, false, '空 rogue2 不写块');
});

test('Simulation 觉醒路由：hasAwakening 只对绑定遗物生效（§7.1）', () => {
  const sim = makeSim({ awakenings: [{ relicId: 'sharp', id: 'sharp-pierce' }] });
  assert.equal(sim.hasAwakening('sharp'), true);
  assert.equal(sim.hasAwakening('powder'), false);
  assert.equal(sim.hasAwakening('nope'), false);
});

test('Simulation.applyAwakening：写入 rogue2、返回事件、失败不消耗选择', () => {
  const sim = makeSim();
  const first = sim.applyAwakening('sharp');
  assert.equal(first.ok, true);
  assert.equal(first.event.id, 'sharp-pierce');
  assert.equal(first.event.relicId, 'sharp');
  assert.deepEqual(sim.rogue2.awakenings, [{ relicId: 'sharp', id: 'sharp-pierce' }]);

  const dup = sim.applyAwakening('sharp');
  assert.equal(dup.ok, false);
  assert.equal(dup.reason, 'duplicate');

  const unknown = sim.applyAwakening('nope');
  assert.equal(unknown.ok, false);
  assert.equal(unknown.reason, 'unknown');
  assert.deepEqual(sim.rogue2.awakenings, [{ relicId: 'sharp', id: 'sharp-pierce' }], '失败不消耗选择');
});

test('锐穿觉醒（sharp-pierce）：弩塔每第 6 发穿透 2 个目标，各 60% 伤害（§7.2）', () => {
  const sim = makeSim({ awakenings: [{ relicId: 'sharp', id: 'sharp-pierce' }] });
  const tower = addTower(sim, 'arrow');
  const dmg = sim.statsFor(tower).dmg;
  const t0 = addEnemy(sim, { x: 0, y: 0 });
  const t1 = addEnemy(sim, { x: 0.5, y: 0 });
  const t2 = addEnemy(sim, { x: 1.0, y: 0 });

  const fireShot = () => {
    sim.fire(tower, sim.statsFor(tower), t0);
    const proj = sim.projectiles.pop();
    sim.projectileSystem.impact(proj);
  };

  for (let i = 0; i < 5; i++) fireShot();
  const t1Before = t1.hp;
  const t2Before = t2.hp;
  fireShot(); // 第 6 发
  ALMOST(t1Before - t1.hp, dmg * 0.6, '第 1 个穿透目标承受 60%');
  ALMOST(t2Before - t2.hp, dmg * 0.6, '第 2 个穿透目标承受 60%');
});

test('锐穿觉醒（sharp-pierce）：未觉醒时第 6 发不穿透（§7.2）', () => {
  const sim = makeSim();
  const tower = addTower(sim, 'arrow');
  const t0 = addEnemy(sim, { x: 0, y: 0 });
  const t1 = addEnemy(sim, { x: 0.5, y: 0 });

  for (let i = 0; i < 6; i++) {
    sim.fire(tower, sim.statsFor(tower), t0);
    const proj = sim.projectiles.pop();
    sim.projectileSystem.impact(proj);
  }
  assert.equal(t1.hp, 100000, '未觉醒时第 6 发不穿透');
});

test('引燃觉醒（powder-ignite）：炮台命中同一目标 5 次后燃烧 2s，每秒 20% 攻击力（§7.2）', () => {
  const sim = makeSim({ awakenings: [{ relicId: 'powder', id: 'powder-ignite' }] });
  const proj = { towerType: 'cannon', dmg: 40, ignoreArmor: false, tower: null, slow: 0, slowDur: 0, dot: 0, dotDur: 0, knockback: 0 };
  const target = addEnemy(sim);
  for (let i = 0; i < 4; i++) {
    sim.hitEnemy(target, proj);
    assert.equal(target.burnDps, 0, '前 4 次命中不点燃');
  }
  sim.hitEnemy(target, proj); // 第 5 次
  ALMOST(target.burnDps, 40 * 0.2, '40 × 0.2 = 8');
  assert.equal(target.burnUntil, 2, '2 秒燃烧');

  // 未觉醒时同 5 次命中不点燃。
  const plain = makeSim();
  const other = addEnemy(plain);
  for (let i = 0; i < 5; i++) plain.hitEnemy(other, proj);
  assert.equal(other.burnDps, 0, '未觉醒不点燃');
});

test('霜爆觉醒（frostheart-shatter）：被减速目标死亡冻结 1.2 格内敌人 0.4s（§7.2）', () => {
  const sim = makeSim({ awakenings: [{ relicId: 'frostheart', id: 'frostheart-shatter' }] });
  sim.time = 10;
  const dying = addEnemy(sim, { x: 0, y: 0, slowUntil: 20 });
  const near = addEnemy(sim, { x: 0.5, y: 0 });
  const far = addEnemy(sim, { x: 5, y: 0 });
  sim.killEnemy(dying);
  assert.equal(near.freezeUntil, 10.4, '1.2 格内冻结 0.4s');
  assert.equal(far.freezeUntil, 0, '1.2 格外不冻结');
});

test('霜爆觉醒（frostheart-shatter）：未被减速死亡或未觉醒时不冻结（§7.2）', () => {
  const sim = makeSim({ awakenings: [{ relicId: 'frostheart', id: 'frostheart-shatter' }] });
  sim.time = 10;
  const dying = addEnemy(sim, { x: 0, y: 0, slowUntil: 0 }); // 未被减速
  const near = addEnemy(sim, { x: 0.5, y: 0 });
  sim.killEnemy(dying);
  assert.equal(near.freezeUntil, 0, '未被减速死亡不冻结');

  const plain = makeSim();
  plain.time = 10;
  const p = addEnemy(plain, { x: 0, y: 0, slowUntil: 20 });
  const pnear = addEnemy(plain, { x: 0.5, y: 0 });
  plain.killEnemy(p);
  assert.equal(pnear.freezeUntil, 0, '未觉醒不冻结');
});

test('催化觉醒（toxin-spread）：中毒死亡传播 1 层，最多 3 跳（§7.2）', () => {
  const sim = makeSim({ awakenings: [{ relicId: 'toxin', id: 'toxin-spread' }] });
  sim.time = 10;
  const a = addEnemy(sim, { x: 0, y: 0 });
  const b = addEnemy(sim, { x: 0.5, y: 0 });
  const c = addEnemy(sim, { x: 1.0, y: 0 });
  const d = addEnemy(sim, { x: 1.5, y: 0 });
  const e = addEnemy(sim, { x: 2.0, y: 0 });
  Object.assign(a, { poisonDps: 20, poisonUntil: 15 });

  sim.killEnemy(a); // 第 1 跳：a → b
  ALMOST(b.poisonDps, 20, '传播 1 层');
  assert.equal(b.poisonHop, 1);
  assert.equal(c.poisonDps, 0, '每次只传播 1 个目标');

  sim.killEnemy(b); // 第 2 跳：b → c
  ALMOST(c.poisonDps, 20);
  assert.equal(c.poisonHop, 2);

  sim.killEnemy(c); // 第 3 跳：c → d
  ALMOST(d.poisonDps, 20);
  assert.equal(d.poisonHop, 3);

  sim.killEnemy(d); // hop 3 落地后不再传播
  assert.equal(e.poisonDps, 0, '第 4 跳不传播（最多 3 跳）');
});

test('催化觉醒（toxin-spread）：未觉醒或未中毒死亡不传播（§7.2）', () => {
  const plain = makeSim();
  plain.time = 10;
  const a = addEnemy(plain, { x: 0, y: 0 });
  const b = addEnemy(plain, { x: 0.5, y: 0 });
  Object.assign(a, { poisonDps: 20, poisonUntil: 15 });
  plain.killEnemy(a);
  assert.equal(b.poisonDps, 0, '未觉醒不传播');

  const sim = makeSim({ awakenings: [{ relicId: 'toxin', id: 'toxin-spread' }] });
  sim.time = 10;
  const c = addEnemy(sim, { x: 0, y: 0 });
  const d = addEnemy(sim, { x: 0.5, y: 0 });
  sim.killEnemy(c); // c 未中毒
  assert.equal(d.poisonDps, 0, '未中毒死亡不传播');
});

test('未觉醒同 seed 逐字节一致；觉醒后同 seed 亦逐字节一致（确定性）', () => {
  const drive = ({ relics, awakenings }) => {
    const sim = makeSim({ relics, awakenings, seed: 'awakening-det-seed' });
    const tower = addTower(sim, 'arrow');
    const enemies = [addEnemy(sim, { x: 0, y: 0 }), addEnemy(sim, { x: 1, y: 0 })];
    // 暴击遗物驱动 combatRng 消费 + 直接伤害 + 投射物开火，覆盖命中与 RNG 路径。
    for (let i = 0; i < 6; i++) {
      sim.dealDamage(enemies[i % 2], 10, 'arrow', { tower });
      sim.fire(tower, sim.statsFor(tower), enemies[i % 2]);
    }
    sim.rogue2 = { contracts: [], bonusPoints: {}, doctrines: sim.rogue2.doctrines, awakenings: sim.rogue2.awakenings };
    return withFixedNow(1700000000999, () => JSON.stringify(sim.toSnapshot()));
  };

  const relics = ['sharp', 'crit'];
  assert.equal(drive({ relics, awakenings: [] }), drive({ relics, awakenings: [] }), '未觉醒逐字节一致');
  assert.equal(
    drive({ relics, awakenings: [{ relicId: 'sharp', id: 'sharp-pierce' }] }),
    drive({ relics, awakenings: [{ relicId: 'sharp', id: 'sharp-pierce' }] }),
    '觉醒后逐字节一致'
  );
});
