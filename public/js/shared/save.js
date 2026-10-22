// 存档兼容：v2 只有遗物 ID，v3 使用 {id, level}；旧档一律按 Ⅰ 级恢复。
import { MAX_WAVE, normalizeRelicStates } from './data.js';

export const SNAPSHOT_VERSION = 3;

export function normalizeSnapshot(snap) {
  if (!snap || (snap.version !== 2 && snap.version !== 3)) return null;
  const rawWave = Number(snap.clearedWave ?? snap.wave);
  const clearedWave = Math.max(0, Math.min(MAX_WAVE, Number.isFinite(rawWave) ? Math.floor(rawWave) : 0));
  return {
    ...snap,
    version: SNAPSHOT_VERSION,
    relics: normalizeRelicStates(snap.relics || []),
    clearedWave,
    wave: clearedWave,
    pendingDraft: !!snap.pendingDraft,
  };
}
