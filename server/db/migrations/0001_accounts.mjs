// 账号体系 + 可扩展玩家数据 schema，并导入 v1.x 的匿名令牌数据。
// 迁移在单个事务内执行；旧表改名为 legacy_* 保留，不删除。
import crypto from 'node:crypto';
import { DIFFICULTY_ORDER } from '../../../public/js/shared/data.js';

export const version = 1;
export const name = 'accounts_player_data';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS accounts (
    id            TEXT PRIMARY KEY,
    kind          TEXT NOT NULL DEFAULT 'unclaimed'
                  CHECK (kind IN ('unclaimed','registered')),
    username      TEXT,
    username_norm TEXT,
    password_hash TEXT,
    recovery_hash TEXT,
    status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','disabled','deleted')),
    meta          TEXT NOT NULL DEFAULT '{}',
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    last_login_at INTEGER
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_username
    ON accounts(username_norm) WHERE username_norm IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status, created_at);

  CREATE TABLE IF NOT EXISTS account_identities (
    id          TEXT PRIMARY KEY,
    account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    provider    TEXT NOT NULL,
    subject     TEXT NOT NULL,
    secret_hash TEXT,
    meta        TEXT NOT NULL DEFAULT '{}',
    created_at  INTEGER NOT NULL,
    UNIQUE (provider, subject)
  );
  CREATE INDEX IF NOT EXISTS idx_identities_account ON account_identities(account_id);

  CREATE TABLE IF NOT EXISTS account_sessions (
    id           TEXT PRIMARY KEY,
    account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    token_hash   TEXT NOT NULL UNIQUE,
    created_at   INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    revoked_at   INTEGER,
    ip_hash      TEXT,
    user_agent   TEXT,
    meta         TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_account
    ON account_sessions(account_id, revoked_at, expires_at);
  CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON account_sessions(expires_at);

  CREATE TABLE IF NOT EXISTS account_aliases (
    provider   TEXT NOT NULL,
    alias_hash TEXT NOT NULL,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (provider, alias_hash)
  );

  CREATE TABLE IF NOT EXISTS auth_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id    TEXT,
    username_norm TEXT,
    event         TEXT NOT NULL,
    ip_hash       TEXT,
    user_agent    TEXT,
    detail        TEXT NOT NULL DEFAULT '{}',
    created_at    INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_auth_events_ip ON auth_events(ip_hash, created_at);
  CREATE INDEX IF NOT EXISTS idx_auth_events_user ON auth_events(username_norm, created_at);

  CREATE TABLE IF NOT EXISTS player_profiles (
    account_id   TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    title_id     TEXT,
    avatar_id    TEXT,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    meta         TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS player_wallets (
    account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    currency_id TEXT NOT NULL,
    balance     INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (account_id, currency_id)
  );

  CREATE TABLE IF NOT EXISTS player_unlocks (
    account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    unlock_id   TEXT NOT NULL,
    unlocked_at INTEGER NOT NULL,
    meta        TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (account_id, unlock_id)
  );

  CREATE TABLE IF NOT EXISTS player_stats (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    stat_key   TEXT NOT NULL,
    scope_key  TEXT NOT NULL DEFAULT '',
    value_num  NUMERIC NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, stat_key, scope_key)
  );

  CREATE TABLE IF NOT EXISTS player_progress (
    account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    progress_type TEXT NOT NULL,
    progress_key  TEXT NOT NULL,
    value_num     INTEGER NOT NULL DEFAULT 0,
    state_json    TEXT NOT NULL DEFAULT '{}',
    updated_at    INTEGER NOT NULL,
    PRIMARY KEY (account_id, progress_type, progress_key)
  );

  CREATE TABLE IF NOT EXISTS player_kv (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    namespace  TEXT NOT NULL,
    key        TEXT NOT NULL,
    value_json TEXT NOT NULL DEFAULT 'null',
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, namespace, key)
  );

  CREATE TABLE IF NOT EXISTS player_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    payload    TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_player_events_account
    ON player_events(account_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_player_events_type
    ON player_events(event_type, created_at);

  CREATE TABLE IF NOT EXISTS runs (
    id              TEXT PRIMARY KEY,
    account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    mode            TEXT NOT NULL,
    board_key       TEXT,
    difficulty      TEXT NOT NULL DEFAULT 'standard',
    seed            TEXT NOT NULL,
    day             TEXT NOT NULL,
    content_version TEXT NOT NULL DEFAULT 'v1.4-map2',
    ruleset_json    TEXT NOT NULL DEFAULT '{}',
    waves_served    INTEGER NOT NULL DEFAULT 0,
    cleared_waves   INTEGER NOT NULL DEFAULT 0,
    map_choice      INTEGER NOT NULL DEFAULT -1,
    relics          TEXT NOT NULL DEFAULT '[]',
    offers          TEXT NOT NULL DEFAULT '{}',
    rerolls_used    INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','finished','abandoned')),
    victory         INTEGER NOT NULL DEFAULT 0,
    score           INTEGER NOT NULL DEFAULT 0,
    wave_reached    INTEGER NOT NULL DEFAULT 0,
    kills           INTEGER NOT NULL DEFAULT 0,
    duration_ms     INTEGER NOT NULL DEFAULT 0,
    result_json     TEXT NOT NULL DEFAULT '{}',
    created_at      INTEGER NOT NULL,
    finished_at     INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_runs_account
    ON runs(account_id, status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_runs_board
    ON runs(board_key, score DESC, duration_ms ASC);

  CREATE TABLE IF NOT EXISTS leaderboard_entries (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    board_key       TEXT NOT NULL,
    account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    display_name    TEXT NOT NULL,
    run_id          TEXT REFERENCES runs(id) ON DELETE SET NULL,
    difficulty      TEXT NOT NULL,
    score           INTEGER NOT NULL,
    duration_ms     INTEGER NOT NULL,
    content_version TEXT NOT NULL,
    metrics_json    TEXT NOT NULL DEFAULT '{}',
    created_at      INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_lb_board
    ON leaderboard_entries(board_key, score DESC, duration_ms ASC);
  CREATE INDEX IF NOT EXISTS idx_lb_account
    ON leaderboard_entries(account_id, board_key);
`;

function hasTable(db, table) {
  return !!db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
}

function tableColumns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
}

function value(row, key, fallback) {
  const raw = row?.[key];
  return raw == null ? fallback : raw;
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseJson(text, fallback) {
  try {
    const parsed = JSON.parse(text);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

function defaultDisplayName(token) {
  return `指挥官-${String(token || '').slice(-4).toUpperCase()}`;
}

export function up(db) {
  // 1. 先把旧表读进内存，之后改名，避免新旧 runs 表名冲突。
  const legacyProfiles = [];
  if (hasTable(db, 'profiles')) {
    legacyProfiles.push(...db.prepare('SELECT * FROM profiles').all());
  }
  const legacyRuns = [];
  let legacyRunColumns = new Set();
  if (hasTable(db, 'runs')) {
    legacyRunColumns = tableColumns(db, 'runs');
    legacyRuns.push(...db.prepare('SELECT * FROM runs').all());
  }
  const legacyLeaderboard = [];
  let legacyBoardColumns = new Set();
  if (hasTable(db, 'leaderboard')) {
    legacyBoardColumns = tableColumns(db, 'leaderboard');
    legacyLeaderboard.push(...db.prepare('SELECT * FROM leaderboard').all());
  }

  if (hasTable(db, 'profiles')) db.exec('ALTER TABLE profiles RENAME TO legacy_profiles');
  if (hasTable(db, 'runs')) db.exec('ALTER TABLE runs RENAME TO legacy_runs');
  if (hasTable(db, 'leaderboard')) db.exec('ALTER TABLE leaderboard RENAME TO legacy_leaderboard');

  // 2. 新 schema
  db.exec(SCHEMA);

  const now = Date.now();
  const insertAccount = db.prepare(`
    INSERT INTO accounts
      (id, kind, username, username_norm, password_hash, recovery_hash, status, meta,
       created_at, updated_at, last_login_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, NULL)
  `);
  const insertAlias = db.prepare(
    'INSERT OR IGNORE INTO account_aliases (provider, alias_hash, account_id, created_at) VALUES (?, ?, ?, ?)'
  );
  const insertProfile = db.prepare(`
    INSERT OR IGNORE INTO player_profiles
      (account_id, display_name, title_id, avatar_id, created_at, updated_at, meta)
    VALUES (?, ?, NULL, NULL, ?, ?, '{}')
  `);
  const insertWallet = db.prepare(`
    INSERT INTO player_wallets (account_id, currency_id, balance, updated_at)
    VALUES (?, 'cores', ?, ?)
    ON CONFLICT(account_id, currency_id) DO UPDATE SET
      balance = excluded.balance,
      updated_at = excluded.updated_at
  `);
  const insertUnlock = db.prepare(`
    INSERT OR IGNORE INTO player_unlocks (account_id, unlock_id, unlocked_at, meta)
    VALUES (?, ?, ?, '{}')
  `);
  const insertStat = db.prepare(`
    INSERT INTO player_stats (account_id, stat_key, scope_key, value_num, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(account_id, stat_key, scope_key) DO UPDATE SET
      value_num = excluded.value_num,
      updated_at = excluded.updated_at
  `);
  const insertRun = db.prepare(`
    INSERT INTO runs
      (id, account_id, mode, board_key, difficulty, seed, day, content_version,
       ruleset_json, waves_served, cleared_waves, map_choice, relics, offers,
       rerolls_used, status, victory, score, wave_reached, kills, duration_ms,
       result_json, created_at, finished_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)
  `);
  const insertLeaderboard = db.prepare(`
    INSERT INTO leaderboard_entries
      (board_key, account_id, display_name, run_id, difficulty, score, duration_ms,
       content_version, metrics_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'v1.3', ?, ?)
  `);

  const accountByToken = new Map();

  function ensureAccount(token, displayName) {
    const key = String(token || 'legacy');
    if (accountByToken.has(key)) return accountByToken.get(key);
    const accountId = crypto.randomUUID();
    const createdAt = now;
    insertAccount.run(
      accountId,
      'unclaimed',
      null,
      null,
      null,
      null,
      JSON.stringify({ legacy: true }),
      createdAt,
      createdAt
    );
    insertAlias.run('legacy_token', sha256(key), accountId, createdAt);
    insertProfile.run(accountId, displayName || defaultDisplayName(key), createdAt, createdAt);
    insertWallet.run(accountId, 0, createdAt);
    accountByToken.set(key, accountId);
    return accountId;
  }

  // 3. profiles → accounts / player_profiles / wallets / unlocks / stats
  for (const profile of legacyProfiles) {
    const token = String(value(profile, 'token', ''));
    const accountId = ensureAccount(token, String(value(profile, 'name', defaultDisplayName(token))));
    const createdAt = number(value(profile, 'created_at', now), now);
    const updatedAt = number(value(profile, 'updated_at', createdAt), createdAt);
    insertProfile.run(
      accountId,
      String(value(profile, 'name', defaultDisplayName(token))),
      createdAt,
      updatedAt
    );
    insertWallet.run(accountId, Math.max(0, number(value(profile, 'cores', 0))), updatedAt);

    const unlocks = parseJson(value(profile, 'unlocks', '[]'), []);
    if (Array.isArray(unlocks)) {
      for (const unlock of unlocks) {
        if (typeof unlock === 'string') insertUnlock.run(accountId, unlock, updatedAt);
      }
    }

    const stats = parseJson(value(profile, 'stats', '{}'), {});
    insertStat.run(accountId, 'runs', '', number(stats.runs), updatedAt);
    insertStat.run(accountId, 'kills', '', number(stats.kills), updatedAt);
    insertStat.run(accountId, 'wins', '', number(stats.wins), updatedAt);
    const byDifficulty = stats.byDifficulty || {};
    for (const difficulty of DIFFICULTY_ORDER) {
      const entry = byDifficulty[difficulty] || {};
      const scope = `difficulty:${difficulty}`;
      insertStat.run(accountId, 'best_wave', scope, number(entry.bestWave), updatedAt);
      insertStat.run(accountId, 'best_score', scope, number(entry.bestScore), updatedAt);
      insertStat.run(accountId, 'wins', scope, number(entry.wins), updatedAt);
      insertStat.run(accountId, 'runs', scope, number(entry.runs), updatedAt);
    }
  }

  // 4. runs
  const runKeys = new Map();
  for (const run of legacyRuns) {
    const token = String(value(run, 'token', ''));
    const accountId = ensureAccount(token);
    const runId = String(value(run, 'id', crypto.randomUUID()));
    const mode = value(run, 'mode', 'normal') === 'daily' ? 'daily' : 'normal';
    const day = String(value(run, 'day', new Date(number(value(run, 'created_at', now), now)).toISOString().slice(0, 10)));
    const difficulty = String(value(run, 'difficulty', 'standard'));
    const status = String(value(run, 'status', 'active'));
    const wavesServed = Math.max(0, number(value(run, 'waves_served', 0)));
    const hasCleared = legacyRunColumns.has('cleared_waves');
    const hasMapChoice = legacyRunColumns.has('map_choice');
    const finalStatus =
      !hasMapChoice && status === 'active' ? 'abandoned' : status;
    const clearedWaves = hasCleared
      ? Math.max(0, number(value(run, 'cleared_waves', 0)))
      : status === 'finished'
        ? Math.max(0, number(value(run, 'wave_reached', 0)))
        : wavesServed > 0
          ? wavesServed - 1
          : 0;
    const mapChoice = hasMapChoice
      ? number(value(run, 'map_choice', -1), -1)
      : status === 'finished'
        ? 0
        : -1;
    const boardKey = mode === 'daily' ? `daily:${day}` : 'normal';
    const relics = typeof value(run, 'relics', '[]') === 'string'
      ? value(run, 'relics', '[]')
      : JSON.stringify(value(run, 'relics', []));
    const offers = typeof value(run, 'offers', '{}') === 'string'
      ? value(run, 'offers', '{}')
      : JSON.stringify(value(run, 'offers', {}));

    insertRun.run(
      runId,
      accountId,
      mode,
      boardKey,
      difficulty,
      String(value(run, 'seed', 'legacy')),
      day,
      'v1.3',
      wavesServed,
      clearedWaves,
      mapChoice,
      relics,
      offers,
      Math.max(0, number(value(run, 'rerolls_used', 0))),
      finalStatus,
      number(value(run, 'victory', 0)) ? 1 : 0,
      number(value(run, 'score', 0)),
      number(value(run, 'wave_reached', 0)),
      number(value(run, 'kills', 0)),
      number(value(run, 'duration_ms', 0)),
      number(value(run, 'created_at', now), now),
      value(run, 'finished_at', null) == null ? null : number(value(run, 'finished_at'), now)
    );

    runKeys.set(
      `${token}|${mode}|${day}|${number(value(run, 'wave_reached', 0))}|${number(value(run, 'score', 0))}`,
      runId
    );
  }

  // 5. leaderboard → leaderboard_entries
  for (const entry of legacyLeaderboard) {
    const token = String(value(entry, 'token', ''));
    const accountId = ensureAccount(token, String(value(entry, 'name', defaultDisplayName(token))));
    const mode = value(entry, 'mode', 'normal') === 'daily' ? 'daily' : 'normal';
    const day = String(value(entry, 'day', new Date(number(value(entry, 'created_at', now), now)).toISOString().slice(0, 10)));
    const boardKey = mode === 'daily' ? `daily:${day}` : 'normal';
    const wave = number(value(entry, 'wave', 0));
    const score = number(value(entry, 'score', 0));
    const runId = runKeys.get(`${token}|${mode}|${day}|${wave}|${score}`) || null;
    const metrics = JSON.stringify({
      wave,
      kills: number(value(entry, 'kills', 0)),
      victory: number(value(entry, 'victory', 0)) ? 1 : 0,
    });
    const createdAt = number(value(entry, 'created_at', now), now);
    insertLeaderboard.run(
      boardKey,
      accountId,
      String(value(entry, 'name', defaultDisplayName(token))),
      runId,
      String(value(entry, 'difficulty', 'standard')),
      score,
      number(value(entry, 'duration_ms', 0)),
      metrics,
      createdAt
    );
  }
}
