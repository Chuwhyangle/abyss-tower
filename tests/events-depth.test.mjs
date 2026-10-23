// 局内事件深度：8 类事件、权重与稀有事件、效果合法性、序列可复现。
import test from 'node:test';
import assert from 'node:assert/strict';

import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { RNG } from '../public/js/shared/rng.js';
import {
  EVENTS,
  EVENT_ORDER,
  EVENT_WAVES,
  canAffordEventOption,
  isEventWave,
  normalizeEventHistory,
  resolveEventOption,
  rollEvent,
} from '../public/js/shared/events.js';

const SEED = 'events-depth-seed';
const RESOURCE_KEYS = ['gold', 'hp', 'maxHp'];
const FINITE_DELTA_KEYS = ['gold', 'hp', 'maxHp'];

function makeSim(overrides = {}) {
  return new Simulation({
    map: generateMap(overrides.seed || SEED),
    seed: overrides.seed || SEED,
    difficulty: 'standard',
    gold: 500,
    baseHp: 20,
    maxBaseHp: 20,
    towers: [],
    onToast: () => {},
    ...overrides,
  });
}

function completeWaveAt(sim, wave) {
  sim.phase = 'wave';
  sim.wave = wave;
  sim.waveDef = { index: wave, reward: 0, groups: [] };
  sim.completeWave();
}

function assertFiniteDeltas(deltas, label) {
  assert.ok(deltas && typeof deltas === 'object', `${label} 必须给出效果对象`);
  for (const [key, value] of Object.entries(deltas)) {
    assert.ok(FINITE_DELTA_KEYS.includes(key), `${label} 含未知资源 ${key}`);
    assert.ok(Number.isFinite(value), `${label} 的 ${key} 必须是有限数字`);
  }
}

test('事件池至少 8 类，定义完整且常规/稀有分层', () => {
  assert.ok(EVENT_ORDER.length >= 8, `事件数 ${EVENT_ORDER.length} < 8`);
  assert.equal(new Set(EVENT_ORDER).size, EVENT_ORDER.length, '事件 id 不能重复');
  assert.deepEqual([...EVENT_ORDER].sort(), Object.keys(EVENTS).sort(), 'EVENT_ORDER 与 EVENTS 必须一致');

  const rareEvents = [];
  const commonEvents = [];
  for (const id of EVENT_ORDER) {
    const event = EVENTS[id];
    assert.equal(event.id, id);
    assert.ok(event.name && event.desc, `${id} 缺少名称或描述`);
    assert.ok(Number.isFinite(event.weight) && event.weight > 0, `${id} 权重必须为正`);
    assert.equal(typeof event.rare, 'boolean', `${id} 必须标记 rare`);
    assert.ok(event.options.length >= 2 && event.options.length <= 3, `${id} 应有 2–3 个选项`);
    assert.equal(
      new Set(event.options.map((option) => option.id)).size,
      event.options.length,
      `${id} 选项 id 不能重复`
    );
    (event.rare ? rareEvents : commonEvents).push(event);
  }

  assert.ok(rareEvents.length >= 1, '至少要有一种稀有事件');
  const minCommonWeight = Math.min(...commonEvents.map((event) => event.weight));
  for (const event of rareEvents) {
    assert.ok(event.weight < minCommonWeight, `${event.id} 稀有事件权重必须低于常规事件`);
  }
});

test('每个选项的代价与收益合法，效果不依赖外部状态', () => {
  for (const id of EVENT_ORDER) {
    const event = EVENTS[id];
    let zeroEffectOptions = 0;

    for (const option of event.options) {
      const label = `${id}/${option.id}`;
      assert.ok(option.name && option.desc, `${label} 缺少名称或描述`);

      const requires = option.requires || {};
      for (const [key, value] of Object.entries(requires)) {
        assert.ok(RESOURCE_KEYS.includes(key), `${label} 的 requires 含未知资源 ${key}`);
        assert.ok(Number.isFinite(value) && value >= 0, `${label} 的 requires.${key} 必须是非负数字`);
      }

      if (option.gamble) {
        assert.ok(option.deltas === undefined, `${label} 不能同时声明 gamble 与 deltas`);
        const { chance, win, lose } = option.gamble;
        assert.ok(chance > 0 && chance < 1, `${label} 的胜率必须在 (0,1) 内`);
        assertFiniteDeltas(win, `${label}.win`);
        assertFiniteDeltas(lose, `${label}.lose`);
        assert.ok(Object.keys(win).length > 0 && Object.keys(lose).length > 0, `${label} 赌局必须有输赢结果`);
      } else {
        assertFiniteDeltas(option.deltas, `${label}.deltas`);
        if (Object.keys(option.deltas).length === 0) zeroEffectOptions += 1;
      }

      const ctx = { seed: SEED, wave: 5, gold: 1000, baseHp: 50, maxHp: 50 };
      const first = resolveEventOption(event, option.id, ctx);
      assert.equal(first.ok, true, `${label} 资源充足时应可结算`);
      assert.equal(first.eventId, id);
      assert.equal(first.optionId, option.id);
      assertFiniteDeltas(first.deltas, `${label} 结算增量`);

      const second = resolveEventOption(event, option.id, ctx);
      assert.deepEqual(second, first, `${label} 同输入必须得到同一结果`);
    }

    assert.equal(zeroEffectOptions, 1, `${id} 应恰好有一个无代价的离开选项`);
  }
});

test('同种子的两次事件序列完全一致', () => {
  for (const seed of [SEED, 'another-seed', '边界-seed']) {
    const once = EVENT_WAVES.map((wave) => rollEvent(seed, wave).id);
    const twice = EVENT_WAVES.map((wave) => rollEvent(seed, wave).id);
    assert.deepEqual(twice, once, `种子 ${seed} 的事件序列必须可复现`);
    for (const id of once) assert.ok(EVENT_ORDER.includes(id));
  }

  // 不同种子至少有一处不同，避免序列被写死。
  const a = EVENT_WAVES.map((wave) => rollEvent(SEED, wave).id).join(',');
  let differs = false;
  for (let i = 0; i < 50 && !differs; i += 1) {
    const b = EVENT_WAVES.map((wave) => rollEvent(`probe-${i}`, wave).id).join(',');
    differs = a !== b;
  }
  assert.equal(differs, true, '不同种子不应总是得到同一序列');
});

test('非事件波次不生成事件', () => {
  for (const wave of [0, 1, 4, 6, 9, 26]) {
    assert.equal(isEventWave(wave), false);
    assert.equal(rollEvent(SEED, wave), null);
  }
});

test('事件推导不消耗战斗 RNG', () => {
  const sim = makeSim();
  const reference = makeSim();
  const expected = reference.combatRng.float();

  completeWaveAt(sim, 5);
  assert.ok(sim.pendingEvent);
  const leaveIndex = sim.pendingEvent.options.findIndex((option) => option.id === 'leave');
  sim.applyEventOption(leaveIndex);

  assert.equal(sim.combatRng.float(), expected, '事件选择与结算都不得推进 combatRng');
});

test('稀有事件权重低于常规事件，抽样分布符合权重边界', () => {
  const rareIds = new Set(EVENT_ORDER.filter((id) => EVENTS[id].rare));
  const counts = Object.fromEntries(EVENT_ORDER.map((id) => [id, 0]));

  const seeds = 3000;
  for (let i = 0; i < seeds; i += 1) {
    for (const wave of EVENT_WAVES) {
      counts[rollEvent(`weight-probe-${i}`, wave).id] += 1;
    }
  }

  const total = seeds * EVENT_WAVES.length;
  const rareCount = [...rareIds].reduce((sum, id) => sum + counts[id], 0);
  const rareShare = rareCount / total;

  for (const id of EVENT_ORDER) {
    assert.ok(counts[id] > 0, `${id} 在 ${total} 次抽样中一次都没出现`);
  }
  assert.ok(rareShare > 0.02, `稀有事件占比 ${rareShare} 过低，权重可能失效`);
  assert.ok(rareShare < 0.25, `稀有事件占比 ${rareShare} 过高，失去稀有性`);

  // weighted 机制本身：高权重条目应显著更常被选中。
  const rng = new RNG('weighted-mechanism');
  const items = [
    { id: 'common', weight: 10 },
    { id: 'rare', weight: 1 },
  ];
  let common = 0;
  let rare = 0;
  for (let i = 0; i < 5000; i += 1) {
    if (rng.weighted(items).id === 'common') common += 1;
    else rare += 1;
  }
  assert.ok(common > rare * 3, `weighted 未体现权重差异：common=${common}, rare=${rare}`);
});

test('资源不足时选项不可执行，离开选项始终可用', () => {
  for (const id of EVENT_ORDER) {
    const event = EVENTS[id];
    for (const option of event.options) {
      const leave = option.deltas && Object.keys(option.deltas).length === 0 && !option.requires;
      const affordable = canAffordEventOption(option, { gold: 0, baseHp: 1, maxHp: 1 });
      if (leave) {
        assert.equal(affordable, true, `${id}/${option.id} 离开选项应始终可用`);
      } else {
        assert.equal(affordable, false, `${id}/${option.id} 零资源时不应可执行`);
        assert.equal(
          resolveEventOption(event, option.id, { seed: SEED, wave: 5, gold: 0, baseHp: 1, maxHp: 1 }).ok,
          false
        );
      }
    }
  }
});

test('新事件历史可归一化，未知事件与旧存档按无事件处理', () => {
  const history = normalizeEventHistory([
    { wave: 5, eventId: 'abyss-contract', optionId: 'blood-pact' },
    { wave: 5, eventId: 'fate-wheel', optionId: 'spin-big' },
    { wave: 10, eventId: 'relic-forge', optionId: 'scrap' },
    { wave: 15, eventId: 'cursed-mirror', optionId: 'stare' },
    { wave: 20, eventId: 'tower-smith', optionId: 'not-an-option' },
    { wave: 30, eventId: 'tower-smith', optionId: 'fortify' },
    null,
  ]);

  assert.deepEqual(history, [
    { wave: 5, eventId: 'abyss-contract', optionId: 'blood-pact' },
    { wave: 10, eventId: 'relic-forge', optionId: 'scrap' },
  ]);
  assert.deepEqual(normalizeEventHistory(undefined), [], '旧存档无事件字段按无事件处理');
});

test('模拟器事件序列同种子一致，且新事件可正常结算', () => {
  const first = makeSim();
  const second = makeSim();
  for (const wave of EVENT_WAVES) {
    completeWaveAt(first, wave);
    completeWaveAt(second, wave);
    assert.ok(first.pendingEvent, `第 ${wave} 波应触发事件`);
    assert.equal(first.pendingEvent.id, second.pendingEvent.id);
    const leaveIndex = first.pendingEvent.options.findIndex((option) => option.id === 'leave');
    first.applyEventOption(leaveIndex);
    second.applyEventOption(leaveIndex);
  }
  assert.deepEqual(first.events, second.events);
  assert.equal(first.events.length, EVENT_WAVES.length);
});
