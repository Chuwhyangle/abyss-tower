// 无尽模式的事件与遗物适配：30 波后事件继续、遗物权重按模式生效、同种子可复现。
import test from 'node:test';
import assert from 'node:assert/strict';

import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import {
  ENDLESS_EVENT_INTERVAL_WAVES,
  EVENT_WAVES,
  chainsFromHistory,
  isChainWave,
  isEventWave,
  normalizeChains,
  normalizeEventHistory,
  resolveEventForWave,
  rollEvent,
} from '../public/js/shared/events.js';
import {
  MODE_RARITY_WEIGHTS,
  RELIC_MAX_LEVEL,
  RELICS,
  RARITY,
  rarityWeightForMode,
  rollRelicOffers,
} from '../public/js/shared/data/relics.js';
import { toSnapshot } from '../public/js/shared/snapshot.js';

const SEED = 'endless-events-seed';

function makeSim(overrides = {}) {
  return new Simulation({
    map: generateMap(overrides.seed || SEED),
    seed: overrides.seed || SEED,
    difficulty: 'standard',
    mode: 'endless',
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

test('普通模式事件节奏保持不变', () => {
  assert.deepEqual(EVENT_WAVES, [5, 10, 15, 20, 25]);
  for (const wave of EVENT_WAVES) assert.equal(isEventWave(wave), true);
  for (const wave of [0, 1, 4, 6, 9, 30, 35]) assert.equal(isEventWave(wave), false);
  assert.equal(rollEvent(SEED, 30), null, '普通模式 30 波没有事件');
  assert.equal(resolveEventForWave(SEED, 30, {}), null, '普通模式 30 波没有事件节点');
});

test('无尽模式 30 波后继续按间隔排期', () => {
  assert.equal(ENDLESS_EVENT_INTERVAL_WAVES, 5);
  for (const wave of [5, 10, 25, 30, 35, 40, 100]) {
    assert.equal(isEventWave(wave, 'endless'), true, `第 ${wave} 波应触发事件`);
  }
  for (const wave of [1, 4, 6, 29, 31, 33]) {
    assert.equal(isEventWave(wave, 'endless'), false, `第 ${wave} 波不应触发事件`);
  }
  assert.ok(rollEvent(SEED, 30, 'endless'), '30 波应能抽出事件');
  assert.ok(resolveEventForWave(SEED, 35, { mode: 'endless' }), '35 波应能解析事件');
});

test('无尽模式事件序列同种子稳定', () => {
  const waves = [30, 35, 40, 45, 50];
  const first = waves.map((wave) => rollEvent(SEED, wave, 'endless').id);
  const second = waves.map((wave) => rollEvent(SEED, wave, 'endless').id);
  assert.deepEqual(first, second);
  assert.deepEqual(
    waves.map((wave) => resolveEventForWave(SEED, wave, { mode: 'endless' }).id),
    first
  );
});

test('无尽模式连锁在 30 波后仍可排期与解析', () => {
  const history = [{ wave: 30, eventId: 'altar', optionId: 'blood' }];
  assert.equal(isChainWave(32, 'endless'), true);
  assert.equal(isChainWave(32, 'normal'), false);
  assert.deepEqual(chainsFromHistory(history, 'endless'), [
    { chainId: 'altar-blood-echo', wave: 32 },
  ]);
  assert.deepEqual(chainsFromHistory(history, 'normal'), []);
  assert.deepEqual(normalizeChains([{ chainId: 'altar-blood-echo', wave: 32 }], 'endless'), [
    { chainId: 'altar-blood-echo', wave: 32 },
  ]);
  assert.deepEqual(normalizeChains([{ chainId: 'altar-blood-echo', wave: 32 }], 'normal'), []);
  assert.equal(resolveEventForWave(SEED, 32, { history, mode: 'endless' }).id, 'blood-echo');
});

test('事件历史与快照按模式保留 30 波后的记录', () => {
  const entries = [{ wave: 30, eventId: 'altar', optionId: 'blood' }];
  assert.deepEqual(normalizeEventHistory(entries, 'endless'), entries);
  assert.deepEqual(normalizeEventHistory(entries, 'normal'), []);
  assert.deepEqual(normalizeEventHistory(entries), [], '缺省模式仍是普通模式');

  const snap = toSnapshot(makeSim());
  assert.equal(snap.events, undefined, '没有事件时不写 events 字段');
  const sim = makeSim();
  sim.events = entries;
  const saved = toSnapshot(sim);
  assert.deepEqual(saved.events, entries, '无尽快照必须保住 30 波后的事件');
  assert.equal(saved.mode, 'endless');

  const normalSim = makeSim({ mode: 'normal' });
  normalSim.events = entries;
  assert.deepEqual(toSnapshot(normalSim).events, undefined, '普通模式不保存非法波次事件');
});

test('模拟器在无尽模式 30 波后继续进入事件阶段', () => {
  const sim = makeSim();
  completeWaveAt(sim, 30);
  assert.equal(sim.phase, 'event', '无尽模式 30 波后应停下来等待事件选择');
  assert.ok(sim.pendingEvent, '30 波应给出事件节点');
  // 每个事件的最后一个选项都是无门槛的“离开/拒绝”，用它完成结算。
  const leaveIndex = sim.pendingEvent.options.length - 1;
  assert.equal(sim.applyEventOption(leaveIndex).ok, true);
  assert.equal(sim.phase, 'prep');
  assert.deepEqual(sim.events.map((entry) => entry.wave), [30]);

  completeWaveAt(sim, 31);
  assert.equal(sim.phase, 'prep', '31 波不是事件波');
  completeWaveAt(sim, 35);
  assert.equal(sim.phase, 'event', '35 波应再次触发事件');
  sim.applyEventOption(sim.pendingEvent.options.length - 1);
  assert.equal(sim.phase, 'prep');
});

test('遗物稀有度权重是纯数据且按模式生效', () => {
  assert.deepEqual(MODE_RARITY_WEIGHTS.normal, {
    common: RARITY.common.weight,
    rare: RARITY.rare.weight,
    epic: RARITY.epic.weight,
  });
  assert.equal(rarityWeightForMode('epic', 'normal'), RARITY.epic.weight);
  assert.ok(
    rarityWeightForMode('epic', 'endless') > rarityWeightForMode('epic', 'normal'),
    '无尽模式应提高史诗遗物权重'
  );
  assert.ok(
    rarityWeightForMode('common', 'endless') < rarityWeightForMode('common', 'normal'),
    '无尽模式应降低普通遗物权重'
  );
  assert.equal(rarityWeightForMode('rare', 'unknown-mode'), MODE_RARITY_WEIGHTS.normal.rare);
});

test('抽取结果同种子稳定，且无尽模式史诗占比更高', () => {
  const key = `${SEED}:relic:30`;
  assert.deepEqual(
    rollRelicOffers(key, [], 3, 30, 'endless'),
    rollRelicOffers(key, [], 3, 30, 'endless')
  );

  const countEpics = (mode) => {
    let epics = 0;
    for (let i = 0; i < 400; i += 1) {
      for (const offer of rollRelicOffers(`draw-${i}`, [], 3, 30, mode)) {
        if (offer.kind === 'relic') {
          const relic = RELICS.find((item) => item.id === offer.id);
          if (relic?.rarity === 'epic') epics += 1;
        }
      }
    }
    return epics;
  };

  const normalEpics = countEpics('normal');
  const endlessEpics = countEpics('endless');
  assert.ok(endlessEpics > normalEpics, `无尽史诗 ${endlessEpics} 应多于普通 ${normalEpics}`);
});

test('满级遗物池在两种模式下都按补位收尾', () => {
  const full = RELICS.map((relic) => ({ id: relic.id, level: RELIC_MAX_LEVEL }));
  for (const mode of ['normal', 'endless']) {
    const offers = rollRelicOffers('offers-full', full, 3, 30, mode);
    assert.equal(offers.length, 3);
    assert.ok(offers.every((offer) => offer.kind !== 'relic'));
  }
});
