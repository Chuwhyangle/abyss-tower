// 悬赏周期记录：每账号每周期每个目标一行，claimed_at 为空表示未领取。
// 主键即幂等键：重复领取只能命中同一行，不会重复发放星核。
export const version = 4;
export const name = 'account_bounties';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS account_bounties (
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      period     TEXT NOT NULL CHECK (period IN ('daily', 'weekly', 'season')),
      period_key TEXT NOT NULL,
      bounty_id  TEXT NOT NULL,
      target     INTEGER NOT NULL DEFAULT 0 CHECK (target >= 0),
      progress   INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0),
      claimed_at INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (account_id, period, period_key, bounty_id)
    );
    CREATE INDEX IF NOT EXISTS idx_account_bounties_period
      ON account_bounties(account_id, period, period_key);
  `);
}
