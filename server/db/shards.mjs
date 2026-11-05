// 皮肤碎片钱包：皮肤升级、赛季里程碑与赛季商店共用的碎片货币存取。
// 扣减走条件 UPDATE（余额不足时一行都不改），发放走 UPSERT（与 db.mjs 的星核同口径）。
import { db } from '../db.mjs';

export const SEASON_PASS_SHARD_CURRENCY = 'skin_shards';

export function getSeasonShards(accountId) {
  const row = db
    .prepare('SELECT balance FROM player_wallets WHERE account_id = ? AND currency_id = ?')
    .get(accountId, SEASON_PASS_SHARD_CURRENCY);
  return Math.max(0, Math.floor(Number(row?.balance) || 0));
}

// 皮肤碎片消耗（皮肤升级）：余额充足才扣减；必须在调用方事务内执行。
export function spendSeasonShardsInTx(accountId, amount, now = Date.now()) {
  const cost = Math.max(0, Math.floor(Number(amount) || 0));
  if (cost === 0) return true;
  const result = db
    .prepare(
      `UPDATE player_wallets
          SET balance = balance - ?, updated_at = ?
        WHERE account_id = ? AND currency_id = ? AND balance >= ?`
    )
    .run(cost, now, accountId, SEASON_PASS_SHARD_CURRENCY, cost);
  return result.changes === 1;
}

// 必须在调用方事务内执行：发放碎片（里程碑/商店共用）。
export function grantShardsInTx(accountId, amount, now = Date.now()) {
  const gain = Math.floor(Number(amount));
  if (!Number.isFinite(gain) || gain <= 0) return getSeasonShards(accountId);
  db.prepare(
    `INSERT INTO player_wallets (account_id, currency_id, balance, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(account_id, currency_id) DO UPDATE SET
       balance = balance + excluded.balance,
       updated_at = excluded.updated_at`
  ).run(accountId, SEASON_PASS_SHARD_CURRENCY, gain, now);
  return getSeasonShards(accountId);
}
