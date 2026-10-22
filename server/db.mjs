import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIFFICULTY_ORDER, normalizeRelicStates } from '../public/js/shared/data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(dataDir, 'game.db');
export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;

  CREATE TABLE IF NOT EXISTS profiles (
    token TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    cores INTEGER NOT NULL DEFAULT 0,
    unlocks TEXT NOT NULL DEFAULT '[]',
    stats TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    mode TEXT NOT NULL,
    difficulty TEXT NOT NULL DEFAULT 'standard',
    seed TEXT NOT NULL,
    day TEXT NOT NULL,
    waves_served INTEGER NOT NULL DEFAULT 0,
    cleared_waves INTEGER NOT NULL DEFAULT 0,
    map_choice INTEGER NOT NULL DEFAULT -1,
    relics TEXT NOT NULL DEFAULT '[]',
    offers TEXT NOT NULL DEFAULT '{}',
    rerolls_used INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    victory INTEGER NOT NULL DEFAULT 0,
    score INTEGER NOT NULL DEFAULT 0,
    wave_reached INTEGER NOT NULL DEFAULT 0,
    kills INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    finished_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_runs_token ON runs(token, status);

  CREATE TABLE IF NOT EXISTS leaderboard (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL,
    name TEXT NOT NULL,
    mode TEXT NOT NULL,
    difficulty TEXT NOT NULL DEFAULT 'standard',
    day TEXT NOT NULL,
    seed TEXT NOT NULL,
    wave INTEGER NOT NULL,
    score INTEGER NOT NULL,
    kills INTEGER NOT NULL,
    victory INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_lb_mode ON leaderboard(mode, score DESC);
  CREATE INDEX IF NOT EXISTS idx_lb_day ON leaderboard(mode, day, score DESC);
`);

// 兼容原型阶段创建的旧库：补列而不是重建。
function ensureColumn(table, name, ddl) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((column) => column.name === name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
    return true;
  }
  return false;
}

ensureColumn('runs', 'difficulty', "TEXT NOT NULL DEFAULT 'standard'");
ensureColumn('runs', 'victory', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('runs', 'duration_ms', 'INTEGER NOT NULL DEFAULT 0');
const clearedWavesAdded = ensureColumn('runs', 'cleared_waves', 'INTEGER NOT NULL DEFAULT 0');
if (clearedWavesAdded) {
  // 旧数据无法区分"进行中"和"已清"：已结束局按结算波次回填，进行中局保守回退一波。
  db.exec(`
    UPDATE runs
       SET cleared_waves = CASE
         WHEN status = 'finished' THEN wave_reached
         WHEN waves_served > 0 THEN waves_served - 1
         ELSE 0
       END
  `);
}

const mapChoiceAdded = ensureColumn('runs', 'map_choice', 'INTEGER NOT NULL DEFAULT -1');
if (mapChoiceAdded) {
  // 旧局没有地图候选数据；已结束局按 0 回填，进行中局弃用以免旧塔位落在新路径上。
  db.exec(`
    UPDATE runs SET map_choice = 0 WHERE map_choice < 0 AND status = 'finished';
    UPDATE runs SET status = 'abandoned', finished_at = created_at WHERE status = 'active' AND map_choice < 0;
  `);
}
ensureColumn('leaderboard', 'difficulty', "TEXT NOT NULL DEFAULT 'standard'");
ensureColumn('leaderboard', 'victory', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('leaderboard', 'duration_ms', 'INTEGER NOT NULL DEFAULT 0');

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

export function hydrateProfile(row) {
  if (!row) return null;
  return {
    token: row.token,
    name: row.name,
    cores: row.cores,
    unlocks: safeParse(row.unlocks, []),
    stats: normalizeStats(safeParse(row.stats, {})),
    createdAt: row.created_at,
  };
}

export function getProfile(token) {
  return hydrateProfile(db.prepare('SELECT * FROM profiles WHERE token = ?').get(token));
}

export function createProfile(token, name = null) {
  const now = Date.now();
  const finalName = name || `指挥官-${token.slice(-4).toUpperCase()}`;
  db.prepare(
    'INSERT INTO profiles (token, name, cores, unlocks, stats, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?, ?)'
  ).run(token, finalName, '[]', JSON.stringify(defaultStats()), now, now);
  return getProfile(token);
}

export function updateProfile(token, { name, cores, unlocks, stats }) {
  const current = getProfile(token);
  if (!current) return null;
  db.prepare(
    'UPDATE profiles SET name = ?, cores = ?, unlocks = ?, stats = ?, updated_at = ? WHERE token = ?'
  ).run(
    name ?? current.name,
    cores ?? current.cores,
    JSON.stringify(unlocks ?? current.unlocks),
    JSON.stringify(stats ? normalizeStats(stats) : current.stats),
    Date.now(),
    token
  );
  return getProfile(token);
}

export function getRun(id) {
  return db.prepare('SELECT * FROM runs WHERE id = ?').get(id) || null;
}

export function hydrateRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    token: row.token,
    mode: row.mode,
    difficulty: row.difficulty || 'standard',
    seed: row.seed,
    day: row.day,
    wavesServed: row.waves_served,
    clearedWaves: row.cleared_waves ?? 0,
    mapChoice: row.map_choice ?? -1,
    relics: normalizeRelicStates(safeParse(row.relics, [])),
    offers: safeParse(row.offers, {}),
    rerollsUsed: row.rerolls_used,
    status: row.status,
    victory: row.victory || 0,
    score: row.score,
    waveReached: row.wave_reached,
    kills: row.kills,
    durationMs: row.duration_ms || 0,
    createdAt: row.created_at,
  };
}
