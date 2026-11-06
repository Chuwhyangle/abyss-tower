// 玩家档案/对局的兼容读写层：对上层保持旧接口形状，底层使用新的可扩展表。
import { db, transaction } from './db/index.mjs';
import { DIFFICULTY_ORDER, normalizeRelicStates } from '../public/js/shared/data.js';
import { rollGacha, GACHA_PRICE } from '../public/js/shared/data/gacha.js';

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

// 增量购买：重查已拥有 → 条件扣费 → 幂等授予，同一事务内完成，避免并发双花与 lost-update。
// 供路由层调用，SQL 不内联进路由（架构约束：路由只做 HTTP 适配）。
export function purchaseUnlock(accountId, unlockId, cost) {
  return transaction(() => {
    const owned = db
      .prepare('SELECT 1 AS ok FROM player_unlocks WHERE account_id = ? AND unlock_id = ?')
      .get(accountId, unlockId);
    if (owned) return { ok: false, status: 'ALREADY_UNLOCKED' };
    if (!spendCoresInTx(accountId, cost)) return { ok: false, status: 'INSUFFICIENT_CORES' };
    grantUnlock(accountId, unlockId);
    return { ok: true, status: 'OK' };
  });
}

// ---------- 抽卡（账号级养成，独立于单局确定性流） ----------

const GACHA_NAMESPACE = 'gacha';
const GACHA_PITY_KEY = 'pity6';
const GACHA_SHARDS_KEY = 'shards';

export function readGachaPity6(accountId) {
  const row = db
    .prepare('SELECT value_json FROM player_kv WHERE account_id = ? AND namespace = ? AND key = ?')
    .get(accountId, GACHA_NAMESPACE, GACHA_PITY_KEY);
  const pity = Math.floor(Number(safeParse(row?.value_json, 0)));
  return Number.isFinite(pity) && pity >= 0 ? pity : 0;
}

export function readGachaShards(accountId) {
  const row = db
    .prepare('SELECT value_json FROM player_kv WHERE account_id = ? AND namespace = ? AND key = ?')
    .get(accountId, GACHA_NAMESPACE, GACHA_SHARDS_KEY);
  const raw = safeParse(row?.value_json, {});
  const shards = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [towerId, count] of Object.entries(raw)) {
      const n = Math.floor(Number(count));
      if (Number.isFinite(n) && n > 0) shards[towerId] = n;
    }
  }
  return shards;
}

function writeGachaPity6InTx(accountId, pity, now) {
  db.prepare(
    `INSERT INTO player_kv (account_id, namespace, key, value_json, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(account_id, namespace, key) DO UPDATE SET
       value_json = excluded.value_json, updated_at = excluded.updated_at`
  ).run(accountId, GACHA_NAMESPACE, GACHA_PITY_KEY, JSON.stringify(pity), now);
}

function writeGachaShardsInTx(accountId, shards, now) {
  db.prepare(
    `INSERT INTO player_kv (account_id, namespace, key, value_json, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(account_id, namespace, key) DO UPDATE SET
       value_json = excluded.value_json, updated_at = excluded.updated_at`
  ).run(accountId, GACHA_NAMESPACE, GACHA_SHARDS_KEY, JSON.stringify(shards), now);
}

function writeGachaHistoryInTx(accountId, entry, now) {
  db.prepare(
    `INSERT INTO gacha_history (account_id, drawn_at, tower_id, rarity, is_new, shards, request_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    accountId,
    now,
    entry.towerId,
    entry.rarity,
    entry.isNew ? 1 : 0,
    entry.shards,
    entry.requestId ?? null
  );
}

export function readGachaHistory(accountId, limit = 20) {
  return db
    .prepare(
      `SELECT tower_id, rarity, is_new, shards, drawn_at FROM gacha_history
        WHERE account_id = ? ORDER BY id DESC LIMIT ?`
    )
    .all(accountId, Math.max(1, Math.min(100, Math.floor(Number(limit) || 20))));
}

export function readGachaHistoryByRequest(accountId, requestId) {
  return db
    .prepare(
      `SELECT tower_id, rarity, is_new, shards, drawn_at FROM gacha_history
        WHERE account_id = ? AND request_id = ? ORDER BY id ASC`
    )
    .all(accountId, String(requestId));
}

function readOwnedTowerIds(accountId) {
  return db
    .prepare('SELECT unlock_id FROM player_unlocks WHERE account_id = ?')
    .all(accountId)
    .map((row) => row.unlock_id)
    .filter((id) => typeof id === 'string' && id.startsWith('tower_'))
    .map((id) => id.slice('tower_'.length));
}

// 单事务抽卡：条件扣费 → 注入随机源抽取 → 落库（历史/保底/拥有/碎片），要么全成要么全滚。
// 随机源必须由调用方注入（账号级 node:crypto 播种的 RNG），绝不复用 sim.js 确定性流。
export function drawGachaInTx(accountId, { count = 1, requestId = null, rng } = {}) {
  if (!rng || typeof rng.float !== 'function') {
    throw new Error('drawGachaInTx 需要注入 { float() } 随机源');
  }
  const draws = Math.floor(Number(count) || 1);
  const price = draws === 10 ? GACHA_PRICE.ten : GACHA_PRICE.single * draws;
  return transaction(() => {
    const now = Date.now();
    if (!spendCoresInTx(accountId, price, now)) {
      return { ok: false, status: 'INSUFFICIENT_CORES' };
    }
    const owned = readOwnedTowerIds(accountId);
    const pity = readGachaPity6(accountId);
    const roll = rollGacha(rng, draws, owned, pity);
    for (const entry of roll.results) {
      writeGachaHistoryInTx(accountId, { ...entry, requestId }, now);
    }
    writeGachaPity6InTx(accountId, roll.pity6, now);
    const shards = readGachaShards(accountId);
    for (const entry of roll.results) {
      if (entry.isNew) {
        grantUnlock(accountId, `tower_${entry.towerId}`);
      } else {
        shards[entry.towerId] = (shards[entry.towerId] || 0) + entry.shards;
      }
    }
    writeGachaShardsInTx(accountId, shards, now);
    return {
      ok: true,
      status: 'OK',
      results: roll.results,
      pity6: roll.pity6,
      balance: getCores(accountId),
    };
  });
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
