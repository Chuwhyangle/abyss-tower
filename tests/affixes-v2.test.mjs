// 地图词缀 v2：词缀扩到 12，新增「狂暴」「贫瘠」，且每个词缀都能被平衡模拟覆盖。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAP_MODIFIERS,
  MODIFIER_BY_ID,
  candidatePlan,
  generateMapCandidates,
} from '../public/js/shared/mapgen.js';

const MODIFIER_IDS = MAP_MODIFIERS.map((modifier) => modifier.id);
const CJK_RE = /[一-鿿]/;
// 平衡模拟（tests/balance-sim.mjs）默认种子口径：balance-0..balance-39。
const BALANCE_SEEDS = 40;

const IMPLEMENTED_MODIFIER_PARAMS = new Set([
  'id',
  'name',
  'color',
  'desc',
  'hpMul',
  'speedMul',
  'goldMul',
  'rangeMul',
  'scoreMul',
  'extraPortal',
]);

test('地图词缀扩到 12，且原有 10 个全部保留', () => {
  assert.equal(MAP_MODIFIERS.length, 12, `词缀数量 ${MAP_MODIFIERS.length} !== 12`);
  for (const id of [
    'rich',
    'swift',
    'mist',
    'rift',
    'armored',
    'bounty',
    'vista',
    'surge',
    'dusk',
    'starlit',
    'frenzy',
    'barren',
  ]) {
    assert.ok(MODIFIER_BY_ID[id], `缺少词缀 ${id}`);
  }
  assert.equal(new Set(MODIFIER_IDS).size, MAP_MODIFIERS.length, '词缀 id 重复');
});

test('新词缀有中文名与说明，且只使用已实现参数', () => {
  const frenzy = MODIFIER_BY_ID.frenzy;
  const barren = MODIFIER_BY_ID.barren;
  assert.ok(frenzy && barren, '缺少「狂暴」或「贫瘠」');
  assert.equal(frenzy.name, '狂暴');
  assert.equal(barren.name, '贫瘠');
  assert.ok(frenzy.speedMul > 1, '狂暴应提高敌人移速');
  assert.ok(barren.goldMul < 1, '贫瘠应降低击杀金币');

  for (const modifier of MAP_MODIFIERS) {
    assert.ok(CJK_RE.test(modifier.name), `${modifier.id} 缺少中文名`);
    assert.ok(CJK_RE.test(modifier.desc), `${modifier.id} 缺少中文说明`);
    assert.ok(/^#[0-9a-f]{6}$/i.test(modifier.color), `${modifier.id} 配色非法`);
    for (const key of Object.keys(modifier)) {
      assert.ok(
        IMPLEMENTED_MODIFIER_PARAMS.has(key),
        `${modifier.id} 使用了未实现的参数：${key}`
      );
    }
    for (const key of ['hpMul', 'speedMul', 'goldMul', 'rangeMul', 'scoreMul']) {
      assert.ok(
        Number.isFinite(modifier[key]) && modifier[key] > 0,
        `${modifier.id}.${key} 非法`
      );
    }
    assert.ok(Number.isInteger(modifier.extraPortal), `${modifier.id}.extraPortal 非法`);
  }
});

test('固定候选只携带地图 trait，12 个随机词缀仍完整可用', () => {
  // 新对局改为三张固定地图：候选词缀 = 地图固定 trait（canyon 无 trait）。
  const candidates = generateMapCandidates('affixes-v2-pool-fixed', 3);
  assert.deepEqual(
    candidates.map((candidate) => candidate.modifier?.id ?? null),
    [null, 'trade', 'echo']
  );
  // 旧随机词缀表保留给 legacy 回退与历史面板，12 个 id 都能解析。
  for (const id of MODIFIER_IDS) assert.ok(MODIFIER_BY_ID[id], `缺少词缀 ${id}`);
});

test('candidatePlan 的默认种子集仍覆盖全部词缀（legacy/平衡工具用）', () => {
  // 每日/每周挑战已改为固定地图 trait；candidatePlan 只剩 legacy 回退与
  // 平衡模拟的工具路径，仍需保证默认种子集能覆盖 12 个词缀。
  const covered = new Set();
  for (let i = 0; i < BALANCE_SEEDS; i++) {
    const { modifierPool } = candidatePlan(`balance-${i}`, 3);
    for (const modifier of modifierPool.slice(0, 3)) covered.add(modifier.id);
  }
  const missing = MODIFIER_IDS.filter((id) => !covered.has(id));
  assert.deepEqual(missing, [], `平衡模拟未覆盖的词缀：${missing.join(', ')}`);
});

test('同种子生成结果一致', () => {
  assert.deepEqual(
    generateMapCandidates('affixes-v2-fixed-seed', 3),
    generateMapCandidates('affixes-v2-fixed-seed', 3)
  );
  assert.deepEqual(
    candidatePlan('affixes-v2-fixed-seed', 3),
    candidatePlan('affixes-v2-fixed-seed', 3)
  );

  // 固定地图的 trait 各自唯一：无 trait 的 canyon + 商路 + 回响。
  const ids = generateMapCandidates('affixes-v2-fixed-seed', 3).map(
    (candidate) => candidate.modifier?.id ?? null
  );
  assert.deepEqual(ids, [null, 'trade', 'echo']);
  assert.equal(new Set(ids.filter(Boolean)).size, ids.filter(Boolean).length);
});
