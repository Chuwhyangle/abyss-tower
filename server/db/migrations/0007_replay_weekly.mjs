// 回放按周归档：明细超过保留上限后，旧记录聚合成每账号每周一行的纯统计。
// 主键即聚合键：同一周重复归档只会累加一次（明细删除与聚合写入同事务）。
export const version = 7;
export const name = 'replay_weekly';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS replay_weekly (
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      week       TEXT NOT NULL,
      runs       INTEGER NOT NULL DEFAULT 0 CHECK (runs >= 0),
      victories  INTEGER NOT NULL DEFAULT 0 CHECK (victories >= 0),
      score_sum  INTEGER NOT NULL DEFAULT 0 CHECK (score_sum >= 0),
      best_score INTEGER NOT NULL DEFAULT 0 CHECK (best_score >= 0),
      kills_sum  INTEGER NOT NULL DEFAULT 0 CHECK (kills_sum >= 0),
      best_wave  INTEGER NOT NULL DEFAULT 0 CHECK (best_wave >= 0),
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (account_id, week)
    );
  `);
}
