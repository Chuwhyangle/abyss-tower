// 最近对局回放摘要：每局一条，只存决策与结果摘要，不保存模拟帧。
export const version = 5;
export const name = 'replays';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS replays (
      id           TEXT PRIMARY KEY,
      account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      run_id       TEXT NOT NULL UNIQUE REFERENCES runs(id) ON DELETE CASCADE,
      mode         TEXT NOT NULL,
      difficulty   TEXT NOT NULL,
      seed         TEXT NOT NULL,
      map_choice   INTEGER NOT NULL DEFAULT -1,
      summary_json TEXT NOT NULL DEFAULT '{}',
      result_json  TEXT NOT NULL DEFAULT '{}',
      created_at   INTEGER NOT NULL,
      finished_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_replays_account
      ON replays(account_id, finished_at DESC, id DESC);
  `);
}
