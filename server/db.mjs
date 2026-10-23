// 玩家档案/对局的兼容读写层：对上层保持旧接口形状，底层使用新的可扩展表。
import { db, transaction } from './db/index.mjs';
import { DIFFICULTY_ORDER, normalizeRelicStates } from '../public/js/shared/data.js';

export { db, transaction };
export { DB_PATH } from './db/index.mjs';

export function defaultStats() {
  const byDifficulty = {};
  for (const id of DIFFICULTY_ORDER) {
    byDifficulty[id] = { bestWave: 0, bestScore: 0, wins: 0, runs: 0 };
  }
  return { runs: 0, kills: 0, wins: 0, byDifficulty };
}

export const DEFAULT_STATS = defaultStats();

export function safeParse(text, fallback) {
  try {
    const value = JSON.parse(text);
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

export function normalizeStats(raw) {
  const stats = { ...defaultStats(), ...(raw || {}) };
  stats.byDifficulty = { ...defaultStats().byDifficulty, ...((raw || {}).byDifficulty || {}) };
  for (const id of DIFFICULTY_ORDER) {
    stats.byDifficulty[id] = {
      bestWave: 0,
      bestScore: 0,
      wins: 0,
      runs: 0,
      ...(stats.byDifficulty[id] || {}),
    };
  }
  return stats;
}

function readStats(accountId) {
  const stats = defaultStats();
  const rows = db
    .prepare('SELECT stat_key, scope_key, value_num FROM player_stats WHERE account_id = ?')
    .all(accountId);
  const globalKeys = new Set(['runs', 'kills', 'wins']);
  const difficultyKeys = {
    best_wave: 'bestWave',
    best_score: 'bestScore',
    wins: 'wins',
    runs: 'runs',
  };
  for (const row of rows) {
    const amount = Number(row.value_num) || 0;
    if (!row.scope_key) {
      if (globalKeys.has(row.stat_key)) stats[row.stat_key] = amount;
      continue;
    }
    if (!row.scope_key.startsWith('difficulty:')) continue;
    const difficulty = row.scope_key.slice('difficulty:'.length);
    const target = stats.byDifficulty[difficulty];
    const key = difficultyKeys[row.stat_key];
    if (target && key) target[key] = amount;
  }
  return stats;
}

function writeStats(accountId, rawStats) {
  const stats = normalizeStats(rawStats);
  const now = Date.now();
  const insert = db.prepare(`
    INSERT INTO player_stats (account_id, stat_key, scope_key, value_num, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM player_stats WHERE account_id = ?').run(accountId);
    insert.run(accountId, 'runs', '', stats.runs, now);
    insert.run(accountId, 'kills', '', stats.kills, now);
    insert.run(accountId, 'wins', '', stats.wins, now);
    for (const difficulty of DIFFICULTY_ORDER) {
      const entry = stats.byDifficulty[difficulty];
      const scope = `difficulty:${difficulty}`;
      insert.run(accountId, 'best_wave', scope, entry.bestWave, now);
      insert.run(accountId, 'best_score', scope, entry.bestScore, now);
      insert.run(accountId, 'wins', scope, entry.wins, now);
      insert.run(accountId, 'runs', scope, entry.runs, now);
    }
    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw error;
  }
}

export function hydrateProfile(row) {
  if (!row) return null;
  return getProfile(row.account_id || row.token);
}

export function getProfile(accountId) {
  if (!accountId) return null;
  const row = db
    .prepare(
      `SELECT p.account_id, p.display_name, p.created_at, a.kind, a.username
         FROM player_profiles p
         JOIN accounts a ON a.id = p.account_id
        WHERE p.account_id = ?`
    )
    .get(accountId);
  if (!row) return null;
  const wallet = db
    .prepare(
      "SELECT balance FROM player_wallets WHERE account_id = ? AND currency_id = 'cores'"
    )
    .get(accountId);
  const unlocks = db
    .prepare(
      'SELECT unlock_id FROM player_unlocks WHERE account_id = ? ORDER BY unlocked_at ASC'
    )
    .all(accountId)
    .map((entry) => entry.unlock_id);
  return {
    token: accountId,
    accountId,
    name: row.display_name,
    cores: wallet?.balance || 0,
    unlocks,
    stats: readStats(accountId),
    accountKind: row.kind,
    username: row.username || null,
    createdAt: row.created_at,
  };
}

export function createProfile(accountId, name = null) {
  const now = Date.now();
  const displayName = name || `指挥官-${String(accountId).slice(-4).toUpperCase()}`;
  db.prepare(
    `INSERT OR IGNORE INTO player_profiles
       (account_id, display_name, title_id, avatar_id, created_at, updated_at, meta)
     VALUES (?, ?, NULL, NULL, ?, ?, '{}')`
  ).run(accountId, displayName, now, now);
  db.prepare(
    `INSERT OR IGNORE INTO player_wallets (account_id, currency_id, balance, updated_at)
     VALUES (?, 'cores', 0, ?)`
  ).run(accountId, now);
  return getProfile(accountId);
}

export function updateProfile(accountId, { name, cores, unlocks, stats } = {}) {
  const current = getProfile(accountId);
  if (!current) return null;
  const now = Date.now();
  if (name != null) {
    db.prepare(
      'UPDATE player_profiles SET display_name = ?, updated_at = ? WHERE account_id = ?'
    ).run(name, now, accountId);
  }
  if (cores != null) {
    db.prepare(
      `INSERT INTO player_wallets (account_id, currency_id, balance, updated_at)
       VALUES (?, 'cores', ?, ?)
       ON CONFLICT(account_id, currency_id) DO UPDATE SET
         balance = excluded.balance,
         updated_at = excluded.updated_at`
    ).run(accountId, Math.max(0, Math.floor(Number(cores) || 0)), now);
  }
  if (Array.isArray(unlocks)) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM player_unlocks WHERE account_id = ?').run(accountId);
      const insert = db.prepare(
        `INSERT OR IGNORE INTO player_unlocks (account_id, unlock_id, unlocked_at, meta)
         VALUES (?, ?, ?, '{}')`
      );
      for (const unlock of new Set(unlocks.filter((item) => typeof item === 'string'))) {
        insert.run(accountId, unlock, now);
      }
      db.exec('COMMIT');
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw error;
    }
  }
  if (stats != null) writeStats(accountId, stats);
  db.prepare('UPDATE player_profiles SET updated_at = ? WHERE account_id = ?').run(now, accountId);
  return getProfile(accountId);
}

// ---------- 星核与解锁（原子写） ----------

export function getCores(accountId) {
  const row = db
    .prepare("SELECT balance FROM player_wallets WHERE account_id = ? AND currency_id = 'cores'")
    .get(accountId);
  return Math.max(0, Math.floor(Number(row?.balance) || 0));
}

// 必须已处于 transaction() 内：条件 UPDATE 保证余额不足时一行都不会改。
export function spendCoresInTx(accountId, amount, now = Date.now()) {
  const cost = Math.floor(Number(amount));
  if (!Number.isFinite(cost) || cost < 0) return false;
  if (cost === 0) return true;
  const result = db
    .prepare(
      `UPDATE player_wallets
          SET balance = balance - ?, updated_at = ?
        WHERE account_id = ? AND currency_id = 'cores' AND balance >= ?`
    )
    .run(cost, now, accountId, cost);
  return result.changes === 1;
}

export function spendCores(accountId, amount) {
  const cost = Math.floor(Number(amount));
  if (!Number.isFinite(cost) || cost < 0) return false;
  if (cost === 0) return true;
  return transaction(() => spendCoresInTx(accountId, cost));
}

export function grantCores(accountId, amount) {
  const gain = Math.floor(Number(amount));
  if (!Number.isFinite(gain) || gain <= 0) return getCores(accountId);
  const now = Date.now();
  db.prepare(
    `INSERT INTO player_wallets (account_id, currency_id, balance, updated_at)
     VALUES (?, 'cores', ?, ?)
     ON CONFLICT(account_id, currency_id) DO UPDATE SET
       balance = balance + excluded.balance,
       updated_at = excluded.updated_at`
  ).run(accountId, gain, now);
  return getCores(accountId);
}

// 幂等授予：重复调用返回 false，调用方据此决定是否提示“新解锁”。
export function grantUnlock(accountId, unlockId) {
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO player_unlocks (account_id, unlock_id, unlocked_at, meta)
       VALUES (?, ?, ?, '{}')`
    )
    .run(accountId, String(unlockId), Date.now());
  return result.changes === 1;
}

export function getRun(id) {
  return db.prepare('SELECT * FROM runs WHERE id = ?').get(id) || null;
}

export function getActiveRun(accountId) {
  const row = db
    .prepare(
      "SELECT * FROM runs WHERE account_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1"
    )
    .get(accountId);
  return hydrateRun(row);
}

export function hydrateRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    token: row.account_id,
    accountId: row.account_id,
    mode: row.mode,
    boardKey: row.board_key || null,
    difficulty: row.difficulty || 'standard',
    seed: row.seed,
    day: row.day,
    contentVersion: row.content_version || null,
    wavesServed: row.waves_served,
    clearedWaves: row.cleared_waves ?? 0,
    mapChoice: row.map_choice ?? -1,
    relics: normalizeRelicStates(safeParse(row.relics, [])),
    offers: safeParse(row.offers, {}),
    // 开局冻结的规则集（技能等级/每日固定资源）；旧局为 {}。
    ruleset: safeParse(row.ruleset_json, {}),
    rerollsUsed: row.rerolls_used,
    status: row.status,
    victory: row.victory || 0,
    score: row.score,
    waveReached: row.wave_reached,
    kills: row.kills,
    durationMs: row.duration_ms || 0,
    result: safeParse(row.result_json, {}),
    createdAt: row.created_at,
  };
}
