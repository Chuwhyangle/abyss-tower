// 游戏接口共用的领域辅助：日期、昵称清洗、每日状态。
import { dailyChallenge, dayKey } from '../../public/js/shared/scoring.js';
import { dailyStreakFor } from '../services/run-service.mjs';

export { dailyAttemptsLeft } from '../services/run-service.mjs';

// 每日边界按服务器本地时区，与玩家的「今天」一致。
export function today() {
  return dayKey();
}

// 大厅与开局共用的当日挑战信息：种子、词缀、连续参与天数。
export function dailyState(token, day = today()) {
  return { ...dailyChallenge(day), streak: dailyStreakFor(token, day) };
}

export function cleanName(raw) {
  return String(raw)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 16);
}
