// 回合型遗物：数量与旧 id 保留、触发周期边界、等级缩放、波末结算与随机数顺序。
import test from 'node:test';
import assert from 'node:assert/strict';

import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { RELICS, RELIC_BY_ID, relicEffectText, relicModsAtLevel } from '../public/js/shared/data.js';
import {
  EFFECT_REGISTRY,
  applyPeriodicWaveEffects,
  periodicWaveEffects,
} from '../public/js/shared/effects.js';

const SEED = 'relics-turnbased-seed';

const NEW_IDS = [
  'harvestsickle', 'emberclock', 'frostlattice', 'gambitseal',
  'tideglass', 'metronome', 'starcycle', 'moonlitvault',
  'eternalhourglass', 'stormpulse',
];

// 旧 60 件必须原样保留。
const LEGACY_IDS = [
  'sharp', 'quickdraw', 'eagle', 'bounty', 'thrifty', 'crystal', 'velocity',
  'frostglint', 'venomfang', 'sparkplug', 'steadyaim', 'coinpurse', 'sandbag',
  'frostedge', 'venomvial', 'spareparts', 'scouthorn', 'bloodpact', 'bloodstake',
  'highroller', 'moonwell', 'embertrace', 'desperado', 'goldencoffer', 'openfield',
  'powder', 'frostheart', 'static', 'toxin', 'usury', 'pierce', 'crit',
  'bosslayer', 'alchemy', 'siege', 'cartel', 'auroraveil', 'skyfall',
  'gamblerscoin', 'adrenaline', 'martyr', 'cometcore', 'warchest', 'lastbreath',
  'bloodybanner', 'lightsentry', 'bloodmoney', 'warlord', 'warhorn', 'frostbite',
  'laststand', 'greed', 'bastion', 'eclipsehour', 'bloodtide', 'doomclock',
  'stasislens', 'starforge', 'midasthrone', 'palaceguard',
];

// 回合型遗物 → [mod 键, 周期]。
const PERIODIC = {
  harvestsickle: ['waveGold2', 2],
  emberclock: ['waveHeal3', 3],
  tideglass: ['waveGold3', 3],
  metronome: ['waveHeal4', 4],
  starcycle: ['waveHeal5', 5],
  moonlitvault: ['waveGold5', 5],
  eternalhourglass: ['waveGold5', 5],
};

function makeSim(relics = [], opts = {}) {
  return new Simulation({
    map: generateMap(SEED),
    seed: SEED,
    difficulty: 'standard',
    gold: 5000,
    baseHp: 40,
    maxBaseHp: 40,
    relics,
    towers: [],
    unlockedTowers: ['arrow', 'cannon', 'frost', 'arc', 'poison', 'sniper', 'banner'],
    onToast: () => {},
    onSave: () => {},
    ...opts,
  });
}

function fakeSim(mods, { gold = 100, baseHp = 10, maxBaseHp = 20 } = {}) {
  return {
    mods,
    gold,
    baseHp,
    maxBaseHp,
    map: { base: { x: 0, y: 0 } },
    effects: [],
    addEffect(effect) {
      this.effects.push(effect);
    },
  };
}

function clearWaveAt(sim, wave) {
  sim.phase = 'wave';
  sim.wave = wave;
  sim.waveDef = { reward: 0 };
  sim.completeWave();
}

test('遗物池扩到 70 件，新增 10 件，旧 id 全部保留', () => {
  assert.ok(RELICS.length >= 70, `当前只有 ${RELICS.length} 件遗物`);
  assert.equal(RELICS.length, 70);
  assert.equal(new Set(RELICS.map((relic) => relic.id)).size, RELICS.length, '遗物 id 必须唯一');
  for (const id of NEW_IDS) assert.ok(RELIC_BY_ID[id], `新增遗物 ${id} 丢失`);
  for (const id of LEGACY_IDS) assert.ok(RELIC_BY_ID[id], `旧遗物 ${id} 丢失`);
});

test('回合型遗物的 mod 键声明了周期与波末时机', () => {
  for (const [id, [key, period]] of Object.entries(PERIODIC)) {
    const relic = RELIC_BY_ID[id];
    assert.ok(key in relic.mods, `${id} 缺少回合型 mod 键 ${key}`);
    const entry = EFFECT_REGISTRY[key];
    assert.ok(entry, `${id} 使用了未注册的键 ${key}`);
    assert.equal(entry.periodic?.period, period, `${key} 的周期不符`);
    assert.equal(entry.periodic?.timing, 'waveEnd');
    assert.equal(typeof entry.applyPeriodic, 'function');
  }
});

test('文案写清触发周期', () => {
  assert.equal(relicEffectText('harvestsickle', 1), '每 2 波结束时获得 6 金币');
  assert.equal(relicEffectText('emberclock', 1), '每 3 波结束时恢复 1 点基地生命');
  assert.equal(relicEffectText('metronome', 1), '每 4 波结束时恢复 2 点基地生命');
  assert.equal(relicEffectText('moonlitvault', 1), '每 5 波结束时获得 18 金币');
  for (const [id, [key, period]] of Object.entries(PERIODIC)) {
    const text = relicEffectText(id, 1);
    assert.ok(text.includes(`每 ${period} 波`), `${id} 文案未写明周期：${text}`);
  }
});

test('触发边界：只在周期整数倍波末触发，第 0 波不触发', () => {
  const mods = { waveGold2: 6, waveHeal3: 1, waveGold5: 40 };
  assert.deepEqual(periodicWaveEffects(mods, 0), []);
  assert.deepEqual(periodicWaveEffects(mods, 1), []);
  assert.deepEqual(periodicWaveEffects(mods, 2), [{ key: 'waveGold2', value: 6, period: 2 }]);
  assert.deepEqual(periodicWaveEffects(mods, 3), [{ key: 'waveHeal3', value: 1, period: 3 }]);
  assert.deepEqual(periodicWaveEffects(mods, 4), [{ key: 'waveGold2', value: 6, period: 2 }]);
  assert.deepEqual(periodicWaveEffects(mods, 5), [{ key: 'waveGold5', value: 40, period: 5 }]);
  assert.deepEqual(periodicWaveEffects(mods, 6), [
    { key: 'waveGold2', value: 6, period: 2 },
    { key: 'waveHeal3', value: 1, period: 3 },
  ]);
});

test('数值随等级缩放并受注册表单件上限约束', () => {
  assert.equal(relicModsAtLevel('harvestsickle', 1).waveGold2, 6);
  assert.equal(relicModsAtLevel('harvestsickle', 3).waveGold2, 13);
  assert.equal(relicModsAtLevel('tideglass', 3).waveGold3, 31);
  assert.equal(relicModsAtLevel('metronome', 3).waveHeal4, 4);
  assert.equal(relicModsAtLevel('eternalhourglass', 3).waveGold5, 77);
  for (const [id, [key]] of Object.entries(PERIODIC)) {
    const entry = EFFECT_REGISTRY[key];
    assert.ok(relicModsAtLevel(id, 3)[key] <= entry.cap, `${id} 超出单件上限`);
  }
});

test('applyPeriodicWaveEffects 结算金币并封顶治疗', () => {
  const goldSim = fakeSim({ waveGold2: 6 });
  assert.deepEqual(applyPeriodicWaveEffects(goldSim, 2), [
    { key: 'waveGold2', value: 6, period: 2 },
  ]);
  assert.equal(goldSim.gold, 106);

  const healSim = fakeSim({ waveHeal3: 5 }, { baseHp: 19, maxBaseHp: 20 });
  applyPeriodicWaveEffects(healSim, 3);
  assert.equal(healSim.baseHp, 20, '治疗不得超过基地生命上限');
  assert.equal(healSim.effects.length, 1);

  const idle = fakeSim({ waveGold2: 6 });
  assert.deepEqual(applyPeriodicWaveEffects(idle, 3), [], '非周期波次不触发');
  assert.equal(idle.gold, 100);
});

test('sim 波末结算：按周期加金币/回血，未到周期不触发', () => {
  const sim = makeSim(
    [{ id: 'harvestsickle', level: 1 }, { id: 'emberclock', level: 1 }],
    { baseHp: 10, maxBaseHp: 20 }
  );

  const goldBefore = sim.gold;
  clearWaveAt(sim, 1);
  assert.equal(sim.gold, goldBefore, '第 1 波不触发');
  assert.equal(sim.baseHp, 10);

  clearWaveAt(sim, 2);
  assert.equal(sim.gold, goldBefore + 6, '第 2 波结算收割镰刀');

  clearWaveAt(sim, 3);
  assert.equal(sim.baseHp, 11, '第 3 波结算余烬节拍');
  assert.equal(sim.gold, goldBefore + 6, '第 3 波不再触发收割镰刀');
});

test('回合型结算不消耗战斗随机数，固定种子保持确定性', () => {
  const withRelic = makeSim([{ id: 'harvestsickle', level: 1 }]);
  const withoutRelic = makeSim([]);
  withRelic.phase = 'wave';
  withRelic.wave = 2;
  withRelic.waveDef = { reward: 0 };
  const nextWithout = withoutRelic.combatRng.float();
  withRelic.completeWave();
  assert.equal(withRelic.combatRng.float(), nextWithout, '波末结算不应推进战斗 RNG');
  assert.equal(withRelic.gold, 5006);

  const a = makeSim([{ id: 'tideglass', level: 3 }]);
  const b = makeSim([{ id: 'tideglass', level: 3 }]);
  clearWaveAt(a, 3);
  clearWaveAt(b, 3);
  assert.equal(a.gold, b.gold, '同种子同遗物结果一致');
  assert.equal(a.gold, 5000 + 31);
});
