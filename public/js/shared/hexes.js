// 主海克斯门面：调用方统一从 shared/hexes.js 引入注册表与选择逻辑。
export {
  HEXES,
  HEX_BY_ID,
  HEX_ORDER,
  HEX_POOL_VERSION,
  offerHexes,
  offerHexesFromPool,
  validateHexChoice,
} from './hexes/index.js';
