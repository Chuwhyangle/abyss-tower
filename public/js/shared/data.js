// 游戏静态数据：服务端与浏览器共用，保证数值与抽卡池一致。
// 内容按主题拆分在 ./data/ 下，本文件只做再导出，保持既有 import 路径不变。
export { TILE, MAP_COLS, MAP_ROWS, MAX_WAVE } from './data/constants.js';
export { DIFFICULTIES, DIFFICULTY_ORDER, getDifficulty } from './data/difficulties.js';
export { TOWERS, TOWER_ORDER, towerLevelStats, towerUpgradeCost } from './data/towers.js';
export { ENEMIES, BOSS_SKILLS } from './data/enemies.js';
export { GLOBAL_MOD_CAPS } from './data/caps.js';
export {
  RARITY,
  RELICS,
  RELIC_BY_ID,
  RELIC_MAX_LEVEL,
  RELIC_LEVEL_LABELS,
  relicModsAtLevel,
  normalizeRelicState,
  normalizeRelicStates,
  relicLevelOf,
  relicEffectText,
  fallbackOffers,
  rollRelicOffers,
} from './data/relics.js';
export { UNLOCKS, UNLOCK_BY_ID, unlockedTowerIds } from './data/unlocks.js';
export { SKILL_LEVEL_COSTS, SKILLS, SKILL_ORDER, skillStats, skillUpgradeCost, skillUnlockText, isSkillUnlocked } from './data/skills.js';
