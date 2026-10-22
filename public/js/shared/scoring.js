// 结算公式：前后端共用；服务端为准，客户端只用于本地预览。
import { MAX_WAVE, getDifficulty } from './data.js';

export const VICTORY_BONUS = 10000;
export const VICTORY_CORES = 15;

export const CAPS = {
  killsPerWave: 600,
  killsFlat: 50,
  goldPerWave: 1200,
  goldFlat: 600,
  baseHp: 120,
};

export function isVictory(waveReached, wavesServed = waveReached) {
  return waveReached >= MAX_WAVE && wavesServed >= MAX_WAVE;
}

export function computeRawScore({ waveReached, kills, goldLeft, baseHp, victory }) {
  return (
    Math.floor(waveReached) * 1000 +
    Math.floor(kills) * 8 +
    Math.floor(goldLeft) * 2 +
    Math.floor(baseHp) * 150 +
    (victory ? VICTORY_BONUS : 0)
  );
}

export function computeOutcome({
  waveReached,
  wavesServed = waveReached,
  kills,
  goldLeft,
  baseHp,
  difficulty = 'standard',
}) {
  const diff = getDifficulty(difficulty);
  const victory = isVictory(waveReached, wavesServed);
  const rawScore = computeRawScore({ waveReached, kills, goldLeft, baseHp, victory });
  const score = Math.round(rawScore * diff.scoreMul);
  const cores = Math.round(
    (Math.floor(waveReached) * 2 + Math.floor(rawScore / 2500) + (victory ? VICTORY_CORES : 0)) *
      diff.coresMul
  );
  return { victory, rawScore, score, cores };
}

export function clampFinishPayload(body, wavesServed) {
  const toInt = (value, min, max) => {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
  };
  const waveReached = toInt(body.waveReached, 0, wavesServed);
  return {
    waveReached,
    kills: toInt(body.kills, 0, waveReached * CAPS.killsPerWave + CAPS.killsFlat),
    goldLeft: toInt(body.goldLeft, 0, waveReached * CAPS.goldPerWave + CAPS.goldFlat),
    baseHp: toInt(body.baseHp, 0, CAPS.baseHp),
  };
}
