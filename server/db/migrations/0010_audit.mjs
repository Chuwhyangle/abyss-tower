// 敏感操作审计日志：账号维度、只追加。action 枚举在 server/db/audit.mjs 集中定义。
export const version = 10;
export const name = 'audit_log';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      action     TEXT NOT NULL,
      meta_json  TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_log_account
      ON audit_log(account_id, created_at DESC, id DESC);
  `);
}
