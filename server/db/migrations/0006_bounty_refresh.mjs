// 悬赏刷新记录：每账号每个周键一行，记录已用免费刷新次数。
// 主键即限次键：同一周内并发刷新只能命中同一行，超过上限由上层拒绝。
export const version = 6;
export const name = 'account_bounty_refreshes';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS account_bounty_refreshes (
      account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      period_key    TEXT NOT NULL,
      refresh_count INTEGER NOT NULL DEFAULT 0 CHECK (refresh_count >= 0),
      refreshed_at  INTEGER,
      updated_at    INTEGER NOT NULL,
      PRIMARY KEY (account_id, period_key)
    );
  `);
}
