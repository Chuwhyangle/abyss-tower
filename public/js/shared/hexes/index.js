// 主海克斯注册表：十个定义、确定性三选一与选择校验；服务端与浏览器共用。
// 注册表一次性 import 全部 10 个模块；后续实现任务只改各自模块，不再改这里。
// 钩子契约（HEX-002 运行时对缺失的钩子安全跳过）：
//   onRunInit / modifyTowerStats / towerMaxLevel / upgradeCost / allowedEvolutions
//   canBuild / onTowerBuilt / onTowerUpgraded / onTowerRemoved / sellRatio
//   onWaveStart / onWaveEnd / onEnemyKilled / onLeak / onHit
//   onRelicGained / relicOfferCount / relicRerollCost / relicRerollBonus
import { RNG } from '../rng.js';

import gamblersDice from './gamblers-dice.js';
import glassCannon from './glass-cannon.js';
import goldenLaw from './golden-law.js';
import mirrorEngineering from './mirror-engineering.js';
import moltenCore from './molten-core.js';
import oneTower from './one-tower.js';
import overloadGrid from './overload-grid.js';
import relicDevourer from './relic-devourer.js';
import swarm from './swarm.js';
import undeadLegion from './undead-legion.js';

// 固定顺序：开局展示与同 seed 洗牌都依赖它保持稳定。
const DEFINITIONS = [
  glassCannon,
  oneTower,
  swarm,
  goldenLaw,
  relicDevourer,
  undeadLegion,
  moltenCore,
  gamblersDice,
  mirrorEngineering,
  overloadGrid,
];

export const HEXES = Object.freeze(DEFINITIONS);
export const HEX_ORDER = Object.freeze(HEXES.map((hex) => hex.id));
export const HEX_BY_ID = Object.freeze(Object.fromEntries(HEXES.map((hex) => [hex.id, hex])));

// 遗物/海克斯池版本：写入 run 的 ruleset，供回放与旧数据判别。
export const HEX_POOL_VERSION = 'hex-v1';

const DEFAULT_OFFER_COUNT = 3;
const OFFER_SALT = 'hex-offer-v1';

function implementedIds() {
  return HEX_ORDER.filter((id) => HEX_BY_ID[id].implemented);
}

function normalizeCount(count) {
  const value = Number(count);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

// 从给定候选池按 seed+mode 确定性洗牌取前 count 个。
// 池不足 count 时返回全部；未知 id 会被过滤（候选池只能来自注册表）。
export function offerHexesFromPool(pool, seed, count = DEFAULT_OFFER_COUNT, mode = 'normal') {
  if (!Array.isArray(pool)) return [];
  const ids = [...new Set(pool.filter((id) => typeof id === 'string' && HEX_BY_ID[id]))];
  const limit = normalizeCount(count);
  if (limit === 0 || ids.length === 0) return [];
  const rng = new RNG(`${OFFER_SALT}:${mode ?? 'normal'}:${seed ?? ''}`);
  return rng.shuffle(ids).slice(0, limit);
}

// 开局三选一：只在 implemented 的定义里洗牌，no-op 桩永远不会被 offer。
// mode 用于每日/本周派生（同 seed 同 mode 结果一致）。
export function offerHexes(seed, count = DEFAULT_OFFER_COUNT, mode = 'normal') {
  return offerHexesFromPool(implementedIds(), seed, count, mode);
}

// 选择校验：id 必须是注册表里的已知海克斯，且出现在本次 offers 中。
export function validateHexChoice(id, offers) {
  if (typeof id !== 'string' || id === '') return false;
  if (!Array.isArray(offers)) return false;
  if (!HEX_BY_ID[id]) return false;
  return offers.includes(id);
}
