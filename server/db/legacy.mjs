// 跨局传承持久化：账号级传承材料，独立于 cores（player_wallets）与成就/通行证/悬赏。
// 存 player_kv('meta','legacy')，只服务于天赋树 / 永久强化的投入；解析失败回落零材料，绝不抛错。
// 与同目录 accounts.mjs 的 talent（player_kv('meta','talent')）同属局外成长，但各占独立 key，互不混用。
import { readPlayerKv, writePlayerKv } from './accounts.mjs';
import { normalizeLegacy } from '../../public/js/shared/data/meta.js';

function readLegacyJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// 读取账号传承状态：缺失 / 损坏一律收敛到零材料。
export function readLegacy(accountId) {
  const row = readPlayerKv(accountId, 'meta', 'legacy');
  return normalizeLegacy(row ? readLegacyJson(row.value_json) : null);
}

// 整值覆盖写入；返回归一化后的新状态。
export function writeLegacy(accountId, legacy, now = Date.now()) {
  const state = normalizeLegacy(legacy);
  writePlayerKv(accountId, 'meta', 'legacy', JSON.stringify(state), now);
  return state;
}

// 累加产出（结算调用）：必须在调用方事务内执行，避免读改写竞态。返回累加后的状态。
export function grantLegacyInTx(accountId, amount, now = Date.now()) {
  const gain = Math.max(0, Math.floor(Number(amount) || 0));
  if (gain === 0) return readLegacy(accountId);
  const state = readLegacy(accountId);
  state.materials.legacy_core = (state.materials.legacy_core || 0) + gain;
  return writeLegacy(accountId, state, now);
}

// 消耗（天赋 / 强化投入）：余额充足才扣减并返回 true；不足返回 false 且一行都不改。
// 同样必须在调用方事务内执行，保证余额判断与扣减原子。
export function spendLegacyInTx(accountId, amount, now = Date.now()) {
  const cost = Math.max(0, Math.floor(Number(amount) || 0));
  if (cost === 0) return true;
  const state = readLegacy(accountId);
  if ((state.materials.legacy_core || 0) < cost) return false;
  state.materials.legacy_core -= cost;
  writeLegacy(accountId, state, now);
  return true;
}
