// 存档兼容入口：校验/迁移的实现已收敛到 shared/snapshot.js，这里保留原有导出名以稳定公共 API。
import {
  BASE_SAVE_VERSION,
  MIN_SAVE_VERSION,
  SAVE_VERSION,
  migrateSnapshot,
  normalizeSnapshot,
  validateSnapshot,
} from './snapshot.js';

export const SNAPSHOT_VERSION = SAVE_VERSION;
export const MIN_SNAPSHOT_VERSION = MIN_SAVE_VERSION;
export const BASE_SNAPSHOT_VERSION = BASE_SAVE_VERSION;

export const validateSave = validateSnapshot;

export { migrateSnapshot, normalizeSnapshot };
