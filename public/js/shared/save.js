// 存档兼容：v2 只有遗物 ID，v3 使用 {id, level}，v4 增加 skill:{id, level, cooldown}。
// 旧档一律按 Ⅰ 级遗物恢复；旧档没有技能时 skill=null（ruleset 为空的旧局正常继续）。
import { MAX_WAVE, SKILLS, skillStats, normalizeRelicStates } from './data.js';

export const SNAPSHOT_VERSION = 4;
// 无技能的旧局仍写 v3：字段与旧版完全一致，避免旧客户端/旧测试误读。
export const BASE_SNAPSHOT_VERSION = 3;
const SUPPORTED_VERSIONS = [2, 3, 4];

function normalizeSkill(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const def = SKILLS[raw.id];
  if (!def) return null;
  const level = Math.max(
    1,
    Math.min(def.levels.length, Math.floor(Number(raw.level) || 1))
  );
  const stats = skillStats(def.id, level);
  const rawCooldown = Number(raw.cooldown);
  const cooldown = Number.isFinite(rawCooldown)
    ? Math.max(0, Math.min(stats.cd, rawCooldown))
    : 0;
  const out = { id: def.id, level, cooldown };
  // 兼容设计稿 5.4 的 skill.readyAt（epoch）写法。
  const readyAt = Number(raw.readyAt);
  if (Number.isFinite(readyAt) && readyAt > 0) out.readyAt = readyAt;
  const speed = Number(raw.speed);
  if (Number.isFinite(speed) && speed > 0) out.speed = speed;
  return out;
}

export function normalizeSnapshot(snap) {
  if (!snap || !SUPPORTED_VERSIONS.includes(snap.version)) return null;
  const rawWave = Number(snap.clearedWave ?? snap.wave);
  const clearedWave = Math.max(0, Math.min(MAX_WAVE, Number.isFinite(rawWave) ? Math.floor(rawWave) : 0));
  return {
    ...snap,
    version: SNAPSHOT_VERSION,
    relics: normalizeRelicStates(snap.relics || []),
    skill: normalizeSkill(snap.skill),
    clearedWave,
    wave: clearedWave,
    pendingDraft: !!snap.pendingDraft,
  };
}
