// 赛季通行证：积分快照 + 已领取里程碑。
// 领取主键 (account_id, season, milestone_id) 即幂等键，重复领取只能命中同一行。
export const version = 9;
export const name = 'account_season_pass';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS account_season_pass (
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      season     TEXT NOT NULL,
      points     INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (account_id, season)
    );
    CREATE TABLE IF NOT EXISTS account_season_pass_claims (
      account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      season       TEXT NOT NULL,
      milestone_id TEXT NOT NULL,
      points       INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
      claimed_at   INTEGER NOT NULL,
      PRIMARY KEY (account_id, season, milestone_id)
    );
    CREATE INDEX IF NOT EXISTS idx_account_season_pass_claims_season
      ON account_season_pass_claims(account_id, season, claimed_at);
  `);
}
