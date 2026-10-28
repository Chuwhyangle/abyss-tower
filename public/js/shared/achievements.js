// 成就模块索引与赛季接口：服务端据此判定并落库，客户端只读取展示。
// 定义表在 achievements-data.js（纯数据），条件求值在 achievements-rules.js，
// 本文件只做索引（ACHIEVEMENT_BY_ID）与赛季轮换/解析等对外编排。
import { ACHIEVEMENTS, SEASONAL_ACHIEVEMENTS, SEASONAL_PER_SEASON } from './achievements-data.js';

export {
  ACHIEVEMENTS,
  ACHIEVEMENT_GROUPS,
  ACHIEVEMENT_RARITIES,
  COSMETIC_FRAMES,
  COSMETIC_TITLES,
  SEASONAL_ACHIEVEMENTS,
  SEASONAL_PER_SEASON,
} from './achievements-data.js';
export { achievementProgress, evaluateAchievements } from './achievements-rules.js';

export const ACHIEVEMENT_BY_ID = Object.fromEntries(
  ACHIEVEMENTS.map((item) => [item.id, item])
);

// ── 赛季成就 ────────────────────────────────────────────────────────
// 每个赛季（自然月）从模板池里轮换出 5 个短期目标。赛季 id 形如 2026-10，
// 解锁记录以 seasonal:<赛季>:<模板 id> 落库，赛季结束后自然成为荣誉历史。
const SEASONAL_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// YYYY-MM → 连续月份序号；非法赛季返回 null。
export function seasonIndex(season) {
  if (typeof season !== 'string' || !SEASONAL_KEY_RE.test(season)) return null;
  const [year, month] = season.split('-').map(Number);
  return year * 12 + (month - 1);
}

// 确定性地按赛季轮换：同一赛季永远得到同一组 5 个目标，相邻赛季窗口顺移。
export function seasonalAchievementsFor(season) {
  const index = seasonIndex(season);
  if (index == null) return [];
  const pool = SEASONAL_ACHIEVEMENTS;
  const offset = (index * SEASONAL_PER_SEASON) % pool.length;
  return Array.from(
    { length: SEASONAL_PER_SEASON },
    (_, i) => pool[(offset + i) % pool.length]
  );
}

export function seasonalAchievementId(season, templateId) {
  return `seasonal:${season}:${templateId}`;
}

export function parseSeasonalAchievementId(id) {
  const match = /^seasonal:(\d{4}-(?:0[1-9]|1[0-2])):([a-z0-9_]+)$/.exec(String(id ?? ''));
  if (!match) return null;
  return { season: match[1], templateId: match[2] };
}

export function seasonalAchievementById(id) {
  const parsed = parseSeasonalAchievementId(id);
  if (!parsed) return null;
  return SEASONAL_ACHIEVEMENTS.find((item) => item.id === parsed.templateId) || null;
}
