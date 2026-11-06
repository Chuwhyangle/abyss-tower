// 抽卡历史：一次抽取一行，request_id 供客户端重试幂等去重。
// 幂等：CREATE IF NOT EXISTS，重复 apply 不报错。
export const version = 12;
export const name = 'gacha_history';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS gacha_history (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      drawn_at   INTEGER NOT NULL,
      tower_id   TEXT NOT NULL,
      rarity     TEXT NOT NULL,
      is_new     INTEGER NOT NULL DEFAULT 0,
      shards     INTEGER NOT NULL DEFAULT 0,
      request_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_gacha_history_account
      ON gacha_history(account_id, id DESC);
  `);
}
