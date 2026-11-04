// 主海克斯注册表：定义完整性、确定性三选一、no-op 桩过滤与选择校验。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HEXES,
  HEX_BY_ID,
  HEX_ORDER,
  HEX_POOL_VERSION,
  offerHexes,
  offerHexesFromPool,
  validateHexChoice,
} from '../public/js/shared/hexes.js';
import { axisById } from './lib/axes.mjs';
import { buildScenario } from './lib/scenario.mjs';
import { assertInvariants } from './lib/assertions.mjs';

// 设计基准：顺序、名称与 scoreMul 由 PRD/任务定义固定。
const EXPECTED = [
  { id: 'glass_cannon', name: '玻璃大炮', scoreMul: 1.15 },
  { id: 'one_tower', name: '独塔为王', scoreMul: 1.2 },
  { id: 'swarm', name: '虫群战术', scoreMul: 1.05 },
  { id: 'golden_law', name: '黄金律法', scoreMul: 1.1 },
  { id: 'relic_devourer', name: '遗物吞噬者', scoreMul: 1.1 },
  { id: 'undead_legion', name: '亡者军团', scoreMul: 1.15 },
  { id: 'molten_core', name: '熔火核心', scoreMul: 1.05 },
  { id: 'gamblers_dice', name: '赌徒之骰', scoreMul: 1.1 },
  { id: 'mirror_engineering', name: '镜像工程', scoreMul: 1.1 },
  { id: 'overload_grid', name: '过载电网', scoreMul: 1.05 },
];

const TEXT_FIELDS = ['id', 'name', 'glyph', 'color', 'pitch', 'desc', 'downside'];

test('HEX_ORDER 固定十个 id，HEXES 与 HEX_BY_ID 一一对应', () => {
  assert.deepEqual(HEX_ORDER, EXPECTED.map((hex) => hex.id));
  assert.equal(HEXES.length, 10);
  assert.equal(Object.keys(HEX_BY_ID).length, 10);
  for (const [index, hex] of HEXES.entries()) {
    assert.equal(hex.id, HEX_ORDER[index]);
    assert.equal(HEX_BY_ID[hex.id], hex);
  }
  assert.ok(Object.isFrozen(HEXES));
  assert.ok(Object.isFrozen(HEX_ORDER));
  assert.ok(Object.isFrozen(HEX_BY_ID));
  assert.equal(HEX_POOL_VERSION, 'hex-v1');
});

test('十个定义字段完整，名称与 scoreMul 符合设计', () => {
  for (const expected of EXPECTED) {
    const hex = HEX_BY_ID[expected.id];
    assert.ok(hex, `缺少海克斯 ${expected.id}`);
    assert.equal(hex.name, expected.name);
    assert.equal(hex.scoreMul, expected.scoreMul);
    for (const field of TEXT_FIELDS) {
      assert.equal(typeof hex[field], 'string', `${expected.id}.${field} 必须是字符串`);
      assert.ok(hex[field].trim().length > 0, `${expected.id}.${field} 不能为空`);
    }
    assert.ok(Array.isArray(hex.tags) && hex.tags.length > 0, `${expected.id}.tags 必须是非空数组`);
    assert.ok(hex.tags.every((tag) => typeof tag === 'string' && tag.length > 0));
    assert.equal(typeof hex.implemented, 'boolean', `${expected.id}.implemented 必须是布尔值`);
    assert.equal(typeof hex.hooks, 'object', `${expected.id}.hooks 必须是对象`);
    assert.ok(!Array.isArray(hex.hooks));
  }
});

test('id 唯一且全部由注册表 import 收集', () => {
  assert.equal(new Set(HEX_ORDER).size, HEX_ORDER.length);
  for (const id of HEX_ORDER) {
    assert.ok(HEX_BY_ID[id], `${id} 未进入 HEX_BY_ID`);
  }
});

test('每个已声明钩子都是函数，且缺省钩子不改变入参', () => {
  for (const hex of HEXES) {
    for (const [name, hook] of Object.entries(hex.hooks)) {
      assert.equal(typeof hook, 'function', `${hex.id}.hooks.${name} 必须是函数`);
    }
    // 已实现的海克斯会真实改写入参，数值由各自实现任务的测试覆盖；这里只审计 no-op 桩。
    if (hex.implemented) continue;
    if (hex.hooks.modifyTowerStats) {
      const stats = { damage: 10 };
      assert.equal(hex.hooks.modifyTowerStats({}, stats, {}), stats);
    }
    for (const name of ['towerMaxLevel', 'upgradeCost', 'allowedEvolutions']) {
      if (hex.hooks[name]) assert.equal(hex.hooks[name]({}, 7), 7, `${hex.id}.hooks.${name} 默认应原样返回`);
    }
    for (const name of ['sellRatio', 'relicOfferCount', 'relicRerollBonus']) {
      if (hex.hooks[name]) assert.equal(hex.hooks[name](7), 7, `${hex.id}.hooks.${name} 默认应原样返回`);
    }
    if (hex.hooks.relicRerollCost) assert.equal(hex.hooks.relicRerollCost(7, 2), 7);
    if (hex.hooks.canBuild) assert.equal(hex.hooks.canBuild('arrow', 0, 0, {}), true);
  }
});

test('同 seed 同 mode 的 offer 稳定，并固定洗牌快照', () => {
  const first = offerHexesFromPool(HEX_ORDER, 'hex-seed-1');
  const second = offerHexesFromPool(HEX_ORDER, 'hex-seed-1');
  assert.deepEqual(first, second);
  assert.deepEqual(first, ['golden_law', 'relic_devourer', 'mirror_engineering']);
  assert.deepEqual(offerHexesFromPool(HEX_ORDER, 'hex-seed-1', 3, 'daily'), ['golden_law', 'overload_grid', 'undead_legion']);
  assert.deepEqual(offerHexesFromPool(HEX_ORDER, 'hex-seed-1', 3, 'weekly'), ['one_tower', 'undead_legion', 'gamblers_dice']);
});

test('不同 seed 与不同 mode 能出现不同组合', () => {
  const combos = new Set();
  for (let seed = 0; seed < 24; seed += 1) {
    const offer = offerHexesFromPool(HEX_ORDER, `seed-${seed}`);
    assert.equal(offer.length, 3);
    assert.equal(new Set(offer).size, 3);
    combos.add(offer.join(','));
  }
  assert.ok(combos.size > 1, '不同 seed 应能产生不同组合');

  const byMode = new Set();
  for (let seed = 0; seed < 24; seed += 1) {
    byMode.add(offerHexesFromPool(HEX_ORDER, `seed-${seed}`, 3, 'daily').join(','));
    byMode.add(offerHexesFromPool(HEX_ORDER, `seed-${seed}`, 3, 'weekly').join(','));
  }
  assert.ok(byMode.size > 1, 'mode 应参与派生');
});

test('no-op 桩不会被 offer（implemented=false 过滤）', () => {
  const implemented = HEXES.filter((hex) => hex.implemented).map((hex) => hex.id);
  for (const seed of ['a', 'b', 'daily-2026-10-25', 42, null, undefined]) {
    const offer = offerHexes(seed);
    assert.equal(offer.length, Math.min(3, implemented.length));
    assert.ok(offer.every((id) => implemented.includes(id)), 'offer 只能来自 implemented 定义');
  }
});

test('候选池不足、含未知 id 或 count 非法时安全返回', () => {
  assert.deepEqual(offerHexesFromPool(['nope', 7, null], 'seed'), []);
  assert.deepEqual(offerHexesFromPool(['glass_cannon', 'nope'], 'seed'), ['glass_cannon']);
  assert.deepEqual(offerHexesFromPool(HEX_ORDER, 'seed', 0), []);
  assert.deepEqual(offerHexesFromPool(HEX_ORDER, 'seed', -3), []);
  assert.deepEqual(offerHexesFromPool(HEX_ORDER, 'seed', 'x'), []);
  assert.deepEqual(offerHexesFromPool(null, 'seed'), []);
  assert.equal(offerHexesFromPool(HEX_ORDER, 'seed', 99).length, HEX_ORDER.length);
});

test('validateHexChoice 拒绝不在 offers 里的 id', () => {
  const offers = ['glass_cannon', 'swarm', 'molten_core'];
  assert.equal(validateHexChoice('glass_cannon', offers), true);
  assert.equal(validateHexChoice('one_tower', offers), false);
  assert.equal(validateHexChoice('not_a_hex', offers), false);
  assert.equal(validateHexChoice('', offers), false);
  assert.equal(validateHexChoice(null, offers), false);
  assert.equal(validateHexChoice(7, offers), false);
  assert.equal(validateHexChoice('glass_cannon', null), false);
  assert.equal(validateHexChoice('glass_cannon', 'glass_cannon'), false);
});

test('validateHexChoice 接受真实 offer 中的元素', () => {
  const offer = offerHexesFromPool(HEX_ORDER, 'choose-seed');
  for (const id of offer) assert.equal(validateHexChoice(id, offer), true);
});

// ---------- 迁移示范：海克斯走轴注册表参数化 ----------
// 过去每个海克斯一个 ad-hoc 文件（hex-*.test.mjs），各自手拼 `new Simulation` 验证钩子行为；
// 现在只登记一根 `hex` 轴（tests/lib/axes.mjs），一条测试参数化遍历全部海克斯，
// 复用 assertions.mjs 的不变量——加一个海克斯 = 变体表 +1，测试数 +1 轴，不 ×N。

test('示范·海克斯轴：一根轴参数化遍历全部海克斯，不变量自动卷入', () => {
  const axis = axisById('hex');
  assert.ok(axis, 'hex 轴应已注册');
  // 参数化遍历：HEX_ORDER 十个海克斯 = 十个变体，一条测试走完（ad-hoc 时代是十个文件）。
  assert.equal(axis.variants.length, HEX_ORDER.length, 'hex 轴变体数应等于 HEX_ORDER');
  for (const variant of axis.variants) {
    const sc = buildScenario(axis.specFor(variant));
    axis.run(sc, variant);
  }
  // 不变量对任意海克斯变体自动落证：确定性 + RNG 顺序 + 快照 round-trip + 无崩溃。
  const [first] = axis.variants;
  assertInvariants(axis.specFor(first), (sc) => axis.run(sc, first), { label: `海克斯轴·${first.id}` });
});
