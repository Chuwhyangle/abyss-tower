// 遗物模块门面：调用方统一从 shared/data/relics.js 引入注册表与抽取逻辑。
// 定义、等级与抽取实现位于 ./relics/ 下；本文件只做再导出，保持既有 import 路径不变。
export {
  RARITY,
  MODE_RARITY_WEIGHTS,
  rarityWeightForMode,
  RELICS,
  RELIC_BY_ID,
  RELIC_MAX_LEVEL,
  RELIC_LEVEL_LABELS,
  relicModsAtLevel,
  relicBehaviorsAtLevel,
  normalizeRelicState,
  normalizeRelicStates,
  relicLevelOf,
  relicEffectText,
  fallbackOffers,
  rollRelicOffers,
  rollStarterOffers,
} from './relics/index.js';
