// 存档兼容与损坏回退：无效版本、字段缺失/类型错误、跨版本迁移、非法难度/地图、幂等性。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SNAPSHOT_VERSION,
  normalizeSnapshot,
  validateSave,
} from '../public/js/shared/save.js';
import { MAP_COLS, MAP_ROWS, MAX_WAVE, RELIC_MAX_LEVEL } from '../public/js/shared/data.js';

test('validateSave：非对象输入安全拒绝，不抛异常', () => {
  const badInputs = [null, undefined, 0, 42, '', '{"version":3}', true, [], [1, 2, 3]];
  for (const input of badInputs) {
    const result = validateSave(input);
    assert.equal(result.ok, false, `应拒绝 ${String(input)}`);
    assert.equal(result.reason, 'not-an-object');
    assert.equal(normalizeSnapshot(input), null);
  }
});

test('validateSave：缺少/非法/未来/过旧版本一律拒绝', () => {
  assert.deepEqual(validateSave({}), { ok: false, reason: 'missing-version' });
  assert.deepEqual(validateSave({ version: '3' }), { ok: false, reason: 'invalid-version' });
  assert.deepEqual(validateSave({ version: 3.5 }), { ok: false, reason: 'invalid-version' });
  assert.deepEqual(validateSave({ version: 5 }), { ok: false, reason: 'future-version' });
  assert.deepEqual(validateSave({ version: 99 }), { ok: false, reason: 'future-version' });
  assert.deepEqual(validateSave({ version: 1 }), { ok: false, reason: 'unsupported-version' });
  assert.equal(normalizeSnapshot({ version: 5 }), null);
});

test('缺字段的存档按安全默认值恢复', () => {
  for (const raw of [{ version: 2 }, { version: 3 }]) {
    const result = validateSave(raw);
    assert.equal(result.ok, true);
    const snap = result.snapshot;
    assert.equal(snap.version, SNAPSHOT_VERSION);
    assert.equal(snap.clearedWave, 0);
    assert.equal(snap.wave, 0);
    assert.deepEqual(snap.relics, []);
    assert.equal(snap.pendingDraft, false);
    // 未提供的可玩字段保持缺失，交由运行时默认值处理（不凭空补 0 金币）。
    assert.equal('gold' in snap, false);
    assert.equal('baseHp' in snap, false);
  }
});

test('错误类型与越界数值被收敛，不抛异常', () => {
  const raw = {
    version: 3,
    clearedWave: 999,
    gold: -50,
    baseHp: 'many',
    maxBaseHp: 12,
    kills: Number.NaN,
    relics: { nope: true },
    towers: [
      { type: 'arrow', c: -3, r: 999, level: 'x', invested: -1 },
      { type: 'unknown-tower', c: 1, r: 1 },
      42,
      null,
    ],
    difficulty: 'nightmare',
    mode: 'weird',
    mapId: 'moon',
    modifierId: 'bogus',
    mapChoice: -2,
    preWave: 'yes',
  };

  const result = validateSave(raw);
  assert.equal(result.ok, true);
  const snap = result.snapshot;

  assert.equal(snap.clearedWave, MAX_WAVE);
  assert.equal(snap.wave, MAX_WAVE);
  assert.equal(snap.gold, 0);
  assert.equal(snap.baseHp, 0);
  assert.equal(snap.maxBaseHp, 12);
  assert.equal(snap.kills, 0);
  assert.deepEqual(snap.relics, []);
  assert.deepEqual(snap.towers, [
    { type: 'arrow', c: 0, r: MAP_ROWS - 1, level: 0, invested: 0 },
  ]);
  assert.equal(snap.difficulty, 'standard');
  assert.equal(snap.mode, 'normal');
  assert.equal(snap.mapId, 'canyon');
  assert.equal(snap.modifierId, null);
  assert.equal(snap.mapChoice, 0);
  assert.equal(snap.preWave, false);

  for (const warning of [
    'relics-not-array',
    'invalid-difficulty',
    'invalid-mode',
    'invalid-map-id',
    'invalid-modifier-id',
    'wave-clamped',
  ]) {
    assert.ok(result.warnings.includes(warning), `缺少告警 ${warning}`);
  }
});

test('v2 遗物只存 ID 时按 Ⅰ 级恢复，等级越界收敛', () => {
  const snap = normalizeSnapshot({
    version: 2,
    wave: 4,
    relics: ['sharp', { id: 'eagle', level: 9 }, { relicId: 'static', toLevel: 2 }, 'missing', null],
    gold: 100,
    towers: [],
  });

  assert.equal(snap.version, SNAPSHOT_VERSION);
  assert.equal(snap.clearedWave, 4);
  assert.equal(snap.wave, 4);
  assert.deepEqual(snap.relics, [
    { id: 'sharp', level: 1 },
    { id: 'eagle', level: RELIC_MAX_LEVEL },
    { id: 'static', level: 2 },
  ]);
  assert.equal(normalizeSnapshot({ version: 2, relics: [{ id: 'sharp', level: 9 }] }).relics[0].level, RELIC_MAX_LEVEL);
});

test('非法难度/地图/词缀回退默认，合法值原样保留', () => {
  const bad = normalizeSnapshot({
    version: 3,
    difficulty: 'nightmare',
    mapId: 'moon',
    modifierId: 'bogus',
    mapChoice: -1,
  });
  assert.equal(bad.difficulty, 'standard');
  assert.equal(bad.mapId, 'canyon');
  assert.equal(bad.modifierId, null);
  assert.equal(bad.mapChoice, 0);

  const good = normalizeSnapshot({
    version: 3,
    difficulty: 'abyss',
    mapId: 'twin',
    modifierId: 'rift',
    mapChoice: 2,
  });
  assert.equal(good.difficulty, 'abyss');
  assert.equal(good.mapId, 'twin');
  assert.equal(good.modifierId, 'rift');
  assert.equal(good.mapChoice, 2);
});

test('normalizeSnapshot 幂等：连续两次结果一致', () => {
  const samples = [
    {
      version: 3,
      runId: 'run-1',
      seed: 'seed-1',
      mode: 'daily',
      difficulty: 'abyss',
      clearedWave: 7,
      pendingDraft: true,
      gold: 123.9,
      baseHp: 14,
      maxBaseHp: 20,
      kills: 42,
      relics: [{ id: 'sharp', level: 2 }],
      towers: [{ type: 'arrow', c: 2, r: 3, level: 1, invested: 80 }],
    },
    { version: 2, wave: 4, relics: ['sharp', 'eagle'], gold: 100, towers: [] },
    { version: 2 },
    {
      version: 3,
      seed: 123,
      runId: 5,
      preWave: 'yes',
      mapId: 'moon',
      clearedWave: -2,
      relics: { bad: true },
      towers: 'nope',
      difficulty: '???',
    },
  ];

  for (const sample of samples) {
    const once = normalizeSnapshot(sample);
    assert.notEqual(once, null);
    const twice = normalizeSnapshot(once);
    assert.deepEqual(twice, once);
  }
});

test('正常 v3 存档往返不改变可玩字段', () => {
  const raw = {
    version: 3,
    runId: 'run-1',
    seed: 'seed-1',
    mode: 'daily',
    difficulty: 'abyss',
    wave: 7,
    clearedWave: 7,
    pendingDraft: true,
    gold: 123,
    baseHp: 14,
    maxBaseHp: 20,
    kills: 42,
    relics: [{ id: 'sharp', level: 2 }],
    towers: [{ type: 'arrow', c: 2, r: 3, level: 1, invested: 80 }],
    startedAt: 111,
    savedAt: 222,
  };

  const snap = normalizeSnapshot(raw);
  const { skill, version, ...rest } = snap;
  const { version: rawVersion, ...rawRest } = raw;
  assert.deepEqual(rest, rawRest);
  assert.equal(skill, null);
  assert.equal(version, SNAPSHOT_VERSION);
  assert.ok(snap.towers[0].c < MAP_COLS);
});

test('任意畸形字段组合都不抛未捕获异常', () => {
  const weird = [
    { version: 3, relics: [Symbol('x')], towers: [Symbol('y')] },
    { version: 3, clearedWave: Symbol('w'), gold: Symbol('g') },
    { version: 3, relics: [undefined, null, 0, '', [], {}, { id: {} }] },
    { version: 3, towers: [undefined, [], {}, { type: 'arrow', c: {}, r: [], level: null }] },
    { version: 2, seed: {}, runId: [], difficulty: [], mode: {} },
  ];
  for (const input of weird) {
    assert.doesNotThrow(() => validateSave(input));
    assert.doesNotThrow(() => normalizeSnapshot(input));
  }
});
