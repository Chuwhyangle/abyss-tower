// 成就解锁记录：每个账号同一成就只保留一条。
export const version = 2;
export const name = 'account_achievements';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS account_achievements (
      account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      achievement_id TEXT NOT NULL,
      unlocked_at    INTEGER NOT NULL,
      PRIMARY KEY (account_id, achievement_id)
    );
    CREATE INDEX IF NOT EXISTS idx_account_achievements_account
      ON account_achievements(account_id, unlocked_at);
  `);
}
