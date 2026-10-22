import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeOutcome,
  computeRawScore,
  isVictory,
  clampFinishPayload,
} from '../public/js/shared/scoring.js';
import { MAX_WAVE } from '../public/js/shared/data.js';

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
  assert.equal(abyss.cores, Math.round((10 * 2 + Math.floor(13300 / 2500)) * 1.3));

  const roam = computeOutcome({ ...base, difficulty: 'roam' });
  assert.equal(roam.score, Math.round(13300 * 0.8));
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
