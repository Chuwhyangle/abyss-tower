// 通知中心：成就 / 悬赏 / 赛季结算产生的未读事件。
// (account_id, kind, dedupe_key) 唯一：同一事件重复结算只会落一条通知。
export const version = 8;
export const name = 'account_notifications';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS account_notifications (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      kind       TEXT NOT NULL CHECK (kind IN ('achievement', 'bounty', 'season')),
      dedupe_key TEXT NOT NULL,
      payload    TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      read_at    INTEGER,
      UNIQUE (account_id, kind, dedupe_key)
    );
    CREATE INDEX IF NOT EXISTS idx_account_notifications_account
      ON account_notifications(account_id, created_at DESC, id DESC);
  `);
}
