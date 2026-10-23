// 快照单一来源：固定样例字节一致、序列化结果可校验、v2/v3 迁移、非法字段回退。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { MAP_ROWS, MAX_WAVE } from '../public/js/shared/data.js';
import {
  MIN_SAVE_VERSION,
  SAVE_VERSION,
  migrateSnapshot,
  normalizeSnapshot,
  toSnapshot,
  validateSnapshot,
} from '../public/js/shared/snapshot.js';
import {
  BASE_SNAPSHOT_VERSION,
  MIN_SNAPSHOT_VERSION,
  SNAPSHOT_VERSION,
  validateSave,
} from '../public/js/shared/save.js';

function withFixedNow(now, fn) {
  const realNow = Date.now;
  Date.now = () => now;
  try {
    return fn();
  } finally {
    Date.now = realNow;
  }
}

const FIXED_STATE = {
  runId: 'run-fixed',
  seed: 'seed-fixed',
  mode: 'daily',
  difficulty: 'abyss',
  clearedWave: 7,
  pendingDraft: true,
  gold: 123.9,
  baseHp: -5,
  maxBaseHp: 20,
  kills: 42,
  relics: [
    { id: 'sharp', level: 2 },
    { id: 'eagle', level: 0 },
  ],
  towers: [{ type: 'arrow', c: 2, r: 3, level: 1, invested: 80 }],
  startedAt: 1700000000000,
};

test('固定样例序列化字节与重构前一致', () => {
  const snap = withFixedNow(1700000000123, () => toSnapshot(FIXED_STATE));
  assert.equal(
    JSON.stringify(snap),
    '{"version":3,"runId":"run-fixed","seed":"seed-fixed","mode":"daily",'
      + '"difficulty":"abyss","wave":7,"clearedWave":7,"pendingDraft":true,'
      + '"gold":123,"baseHp":0,"maxBaseHp":20,"kills":42,'
      + '"relics":[{"id":"sharp","level":2},{"id":"eagle","level":1}],'
      + '"towers":[{"type":"arrow","c":2,"r":3,"level":1,"invested":80}],'
      + '"skill":null,'
      + '"startedAt":1700000000000,"savedAt":1700000000123}',
  );
});

test('toSnapshot 输出必须通过 validateSnapshot 且迁移后不变', () => {
  const snap = toSnapshot(FIXED_STATE);
  const result = validateSnapshot(snap);
  assert.equal(result.ok, true);
  assert.equal(result.warnings, undefined);
  const norm = normalizeSnapshot(snap);
  const { version, skill, ...normRest } = norm;
  const { version: rawVersion, skill: rawSkill, ...rawRest } = snap;
  assert.deepEqual(normRest, rawRest);
  assert.equal(version, SAVE_VERSION);
  assert.equal(skill, null);
});

test('Simulation.toSnapshot 使用同一实现', () => {
  const fixedNow = 1700000000999;
  const opts = {
    map: generateMap('snapshot-test-seed'),
    seed: 'snapshot-test-seed',
    runId: 'run-sim',
    mode: 'normal',
    difficulty: 'standard',
    gold: 260,
    baseHp: 20,
    maxBaseHp: 20,
    relics: [{ id: 'sharp', level: 1 }],
    towers: [],
    startedAt: 1700000000000,
    onToast: () => {},
  };
  const sim = new Simulation(opts);
  const snap = withFixedNow(fixedNow, () => sim.toSnapshot());
  const shared = withFixedNow(fixedNow, () => toSnapshot(sim));

  assert.deepEqual(snap, shared);
  assert.equal(snap.version, BASE_SNAPSHOT_VERSION);
  assert.equal(validateSnapshot(snap).ok, true);
});

test('v2 存档迁移：遗物仅 ID 恢复为 Ⅰ 级，wave 提升为 clearedWave', () => {
  const snap = normalizeSnapshot({
    version: 2,
    wave: 4,
    relics: ['sharp', { id: 'eagle', level: 2 }],
  });

  assert.equal(snap.version, SAVE_VERSION);
  assert.equal(snap.clearedWave, 4);
  assert.equal(snap.wave, 4);
  assert.deepEqual(snap.relics, [
    { id: 'sharp', level: 1 },
    { id: 'eagle', level: 2 },
  ]);
});

test('缺失字段按安全默认值回退，可玩字段不凭空补值', () => {
  const snap = migrateSnapshot({ version: 2 });
  assert.equal(snap.version, SAVE_VERSION);
  assert.equal(snap.clearedWave, 0);
  assert.equal(snap.wave, 0);
  assert.equal(snap.pendingDraft, false);
  assert.deepEqual(snap.relics, []);
  assert.equal('gold' in snap, false);
  assert.equal('towers' in snap, false);
});

test('非法字段收敛：难度/地图/词缀/数值越界', () => {
  const result = validateSnapshot({
    version: 3,
    difficulty: 'nightmare',
    mode: 'weird',
    mapId: 'moon',
    modifierId: 'bogus',
    gold: -20,
    clearedWave: 999,
    towers: [{ type: 'arrow', c: -1, r: 999, level: 'x', invested: -5 }],
  });

  assert.equal(result.ok, true);
  const snap = result.snapshot;
  assert.equal(snap.difficulty, 'standard');
  assert.equal(snap.mode, 'normal');
  assert.equal(snap.mapId, 'canyon');
  assert.equal(snap.modifierId, null);
  assert.equal(snap.gold, 0);
  assert.equal(snap.clearedWave, MAX_WAVE);
  assert.deepEqual(snap.towers, [{ type: 'arrow', c: 0, r: MAP_ROWS - 1, level: 0, invested: 0 }]);
  assert.ok(result.warnings.includes('invalid-difficulty'));
  assert.ok(result.warnings.includes('invalid-map-id'));
});

test('版本入口保持单一：save.js 与 snapshot.js 共享同一常量与函数', () => {
  assert.equal(SNAPSHOT_VERSION, SAVE_VERSION);
  assert.equal(MIN_SNAPSHOT_VERSION, MIN_SAVE_VERSION);
  assert.equal(validateSave, validateSnapshot);
  assert.equal(SAVE_VERSION, 4);
  assert.equal(MIN_SAVE_VERSION, 2);
});
