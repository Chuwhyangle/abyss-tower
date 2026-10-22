import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWave } from '../public/js/shared/waves.js';
import { DIFFICULTIES, MAX_WAVE } from '../public/js/shared/data.js';

const SEED = 'wave-test-seed';

test('波次生成：确定性', () => {
  for (const difficulty of ['roam', 'standard', 'abyss']) {
    const a = generateWave(SEED, 7, difficulty);
    const b = generateWave(SEED, 7, difficulty);
    assert.deepEqual(a, b);
  }
});

test('波次生成：首领节奏与最终波', () => {
  for (let wave = 1; wave <= MAX_WAVE; wave++) {
    const def = generateWave(SEED, wave, 'standard');
    assert.equal(def.boss, wave % 5 === 0, `第 ${wave} 波首领标记错误`);
    assert.equal(def.finalBoss, wave === MAX_WAVE);
    assert.ok(def.totalCount >= 1);
    assert.ok(def.totalCount <= 80, `第 ${wave} 波数量超限：${def.totalCount}`);
  }
  const final = generateWave(SEED, MAX_WAVE, 'standard');
  assert.equal(final.boss, true);
  assert.equal(final.finalBoss, true);
});

test('波次生成：血量与难度单调', () => {
  let previous = 0;
  for (let wave = 1; wave <= MAX_WAVE; wave++) {
    const hp = generateWave(SEED, wave, 'standard').hpMul;
    assert.ok(hp > previous, `第 ${wave} 波血量倍率未增长`);
    previous = hp;
  }

  for (let wave = 1; wave <= MAX_WAVE; wave++) {
    const roam = generateWave(SEED, wave, 'roam');
    const standard = generateWave(SEED, wave, 'standard');
    const abyss = generateWave(SEED, wave, 'abyss');
    assert.ok(roam.hpMul < standard.hpMul);
    assert.ok(standard.hpMul < abyss.hpMul);
    assert.ok(roam.countMul < standard.countMul);
    assert.ok(standard.countMul < abyss.countMul);
  }
});

test('波次生成：难度不改变敌人组合类型', () => {
  for (let wave = 1; wave <= MAX_WAVE; wave++) {
    const types = (difficulty) =>
      generateWave(SEED, wave, difficulty).groups.map((group) => group.type);
    assert.deepEqual(types('roam'), types('standard'));
    assert.deepEqual(types('standard'), types('abyss'));
  }
});

test('波次生成：难度数量倍率生效', () => {
  const roam = generateWave(SEED, 12, 'roam');
  const abyss = generateWave(SEED, 12, 'abyss');
  assert.ok(abyss.totalCount > roam.totalCount);
  assert.equal(generateWave(SEED, 30, 'abyss').finalBoss, true);
});

test('难度配置完整性', () => {
  for (const id of ['roam', 'standard', 'abyss']) {
    const diff = DIFFICULTIES[id];
    assert.ok(diff.name);
    assert.ok(diff.hpMul > 0 && diff.countMul > 0 && diff.scoreMul > 0);
    assert.ok(typeof diff.goldBonus === 'number');
    assert.ok(typeof diff.hpBonus === 'number');
  }
});
