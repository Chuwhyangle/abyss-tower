import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_CORES_WAVES,
  VICTORY_CORES,
  computeOutcome,
  computeRawScore,
  isVictory,
  clampFinishPayload,
} from '../public/js/shared/scoring.js';
import { DIFFICULTIES, MAX_WAVE } from '../public/js/shared/data.js';

test('计分：基础分与难度倍率', () => {
  const base = {
    waveReached: 10,
    wavesServed: 10,
    kills: 100,
    goldLeft: 500,
    baseHp: 10,
  };
  const raw = computeRawScore({ ...base, victory: false });
  assert.equal(raw, 13300);

  const standard = computeOutcome({ ...base, difficulty: 'standard' });
  assert.equal(standard.score, 13300);
  assert.equal(standard.cores, 25);
  assert.equal(standard.victory, false);

  const abyss = computeOutcome({ ...base, difficulty: 'abyss' });
  assert.equal(abyss.score, Math.round(13300 * 1.5));
  assert.equal(abyss.cores, Math.round((10 * 2 + Math.floor(13300 / 2500)) * 1.5));

  const roam = computeOutcome({ ...base, difficulty: 'roam' });
  assert.equal(roam.score, Math.round(13300 * 0.8));
  assert.equal(roam.cores, Math.round((10 * 2 + Math.floor(13300 / 2500)) * 0.65));
});

test('星核：难度倍率 0.65 / 1.0 / 1.5 与通关奖励 25', () => {
  assert.equal(DIFFICULTIES.roam.coresMul, 0.65);
  assert.equal(DIFFICULTIES.standard.coresMul, 1.0);
  assert.equal(DIFFICULTIES.abyss.coresMul, 1.5);
  assert.equal(VICTORY_CORES, 25);

  const bool = { waveReached: MAX_WAVE, wavesServed: MAX_WAVE, kills: 300, goldLeft: 1000, baseHp: 5 };
  for (const [difficulty, expected] of [
    ['roam', Math.round((MAX_WAVE * 2 + 18 + VICTORY_CORES) * 0.65)],
    ['standard', Math.round((MAX_WAVE * 2 + 18 + VICTORY_CORES) * 1.0)],
    ['abyss', Math.round((MAX_WAVE * 2 + 18 + VICTORY_CORES) * 1.5)],
  ]) {
    const outcome = computeOutcome({ ...bool, difficulty });
    assert.equal(outcome.cores, expected, difficulty);
  }
  // 满通大致产出：漫游 ≈71、远征 ≈111、深渊 ≈166（设计稿 2.6）。
  const roam = computeOutcome({ ...bool, difficulty: 'roam' }).cores;
  const standard = computeOutcome({ ...bool, difficulty: 'standard' }).cores;
  const abyss = computeOutcome({ ...bool, difficulty: 'abyss' }).cores;
  assert.ok(roam >= 65 && roam <= 80, `roam=${roam}`);
  assert.ok(standard >= 100 && standard <= 120, `standard=${standard}`);
  assert.ok(abyss >= 155 && abyss <= 175, `abyss=${abyss}`);
});

test('星核：清波不足 5 波归零', () => {
  assert.equal(MIN_CORES_WAVES, 5);
  const base = { kills: 500, goldLeft: 500, baseHp: 10 };
  for (const difficulty of ['roam', 'standard', 'abyss']) {
    for (let wave = 0; wave < MIN_CORES_WAVES; wave++) {
      const outcome = computeOutcome({
        ...base,
        waveReached: wave,
        wavesServed: wave,
        difficulty,
      });
      assert.equal(outcome.cores, 0, `${difficulty} wave ${wave}`);
    }
    const fifth = computeOutcome({
      ...base,
      waveReached: MIN_CORES_WAVES,
      wavesServed: MIN_CORES_WAVES,
      difficulty,
    });
    assert.ok(fifth.cores > 0, `${difficulty} wave 5`);
  }
  // 结算封顶后的 waveReached 才是发核依据。
  const clamped = clampFinishPayload({ waveReached: 30, kills: 0, goldLeft: 0, baseHp: 0 }, 3);
  const outcome = computeOutcome({ ...clamped, wavesServed: 3, difficulty: 'abyss' });
  assert.equal(outcome.cores, 0);
});

test('计分：通关奖励与判定', () => {
  const final = {
    waveReached: MAX_WAVE,
    wavesServed: MAX_WAVE,
    kills: 300,
    goldLeft: 1000,
    baseHp: 5,
    difficulty: 'standard',
  };
  assert.equal(isVictory(MAX_WAVE, MAX_WAVE), true);
  assert.equal(isVictory(MAX_WAVE - 1, MAX_WAVE), false);
  assert.equal(isVictory(MAX_WAVE, MAX_WAVE - 1), false);

  const outcome = computeOutcome(final);
  assert.equal(outcome.victory, true);
  assert.equal(
    outcome.rawScore,
    MAX_WAVE * 1000 + 300 * 8 + 1000 * 2 + 5 * 150 + 10000
  );
  assert.ok(outcome.cores > 30);
});

test('结算：封顶钳制', () => {
  const payload = clampFinishPayload(
    {
      waveReached: 99,
      kills: 999999,
      goldLeft: 999999,
      baseHp: 999,
    },
    12
  );
  assert.equal(payload.waveReached, 12);
  assert.ok(payload.kills <= 12 * 600 + 50);
  assert.ok(payload.goldLeft <= 12 * 1200 + 600);
  assert.equal(payload.baseHp, 120);

  const negative = clampFinishPayload({ waveReached: -5, kills: -1, goldLeft: -1, baseHp: -1 }, 3);
  assert.equal(negative.waveReached, 0);
  assert.equal(negative.kills, 0);
  assert.equal(negative.goldLeft, 0);
  assert.equal(negative.baseHp, 0);
});
