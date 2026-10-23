// 赛季结算结果：每个账号每个赛季只保留一条，主键即幂等键。
export const version = 3;
export const name = 'season_results';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS season_results (
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      season     TEXT NOT NULL,
      rank       INTEGER NOT NULL,
      cores      INTEGER NOT NULL DEFAULT 0 CHECK (cores >= 0),
      settled_at INTEGER NOT NULL,
      PRIMARY KEY (account_id, season)
    );
    CREATE INDEX IF NOT EXISTS idx_season_results_rank
      ON season_results(season, rank);
  `);
}
