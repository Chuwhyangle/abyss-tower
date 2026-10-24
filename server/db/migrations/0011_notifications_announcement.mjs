// 通知中心新增系统公告类型。SQLite 无法直接修改 CHECK 约束，只能重建表并搬运既有记录；
// 旧数据（成就/悬赏/赛季）逐列复制，id 与唯一键原样保留。
export const version = 11;
export const name = 'notifications_announcement';

export function up(db) {
  db.exec(`
    CREATE TABLE account_notifications_v11 (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      kind       TEXT NOT NULL CHECK (kind IN ('achievement', 'bounty', 'season', 'announcement')),
      dedupe_key TEXT NOT NULL,
      payload    TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      read_at    INTEGER,
      UNIQUE (account_id, kind, dedupe_key)
    );
    INSERT INTO account_notifications_v11
      (id, account_id, kind, dedupe_key, payload, created_at, read_at)
      SELECT id, account_id, kind, dedupe_key, payload, created_at, read_at
        FROM account_notifications;
    DROP TABLE account_notifications;
    ALTER TABLE account_notifications_v11 RENAME TO account_notifications;
    CREATE INDEX IF NOT EXISTS idx_account_notifications_account
      ON account_notifications(account_id, created_at DESC, id DESC);
  `);
}
