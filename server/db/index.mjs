// SQLite 连接与版本化迁移执行器。
// 迁移文件按编号执行，校验和防止已应用迁移被偷偷改写；失败则回滚并拒绝启动。
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const DEFAULT_DATA_DIR = path.resolve(__dirname, '../data');

export const DB_PATH = process.env.DB_PATH || path.join(DEFAULT_DATA_DIR, 'game.db');

if (DB_PATH !== ':memory:') {
  fs.mkdirSync(path.dirname(path.resolve(DB_PATH)), { recursive: true });
}

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    checksum   TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  );
`);

function checksum(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function backupBeforeMigration() {
  if (process.env.DB_BACKUP === '0' || DB_PATH === ':memory:') return;
  const resolved = path.resolve(DB_PATH);
  if (!fs.existsSync(resolved)) return;
  const tables = db
    .prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table'")
    .get().c;
  // 只包含 schema_migrations 的空库无需备份。
  if (tables <= 1) return;
  const dir = path.join(path.dirname(resolved), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(
    dir,
    `pre-migration-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto
      .randomBytes(3)
      .toString('hex')}.db`
  );
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  console.log(`[db] 迁移前备份：${target}`);
}

async function loadMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.mjs'))
    .sort();
  const migrations = [];
  for (const file of files) {
    const fullPath = path.join(MIGRATIONS_DIR, file);
    const source = fs.readFileSync(fullPath, 'utf8');
    const mod = await import(pathToFileURL(fullPath).href);
    if (typeof mod.up !== 'function' || !Number.isInteger(mod.version)) {
      throw new Error(`迁移文件格式错误：${file}`);
    }
    migrations.push({
      version: mod.version,
      name: mod.name || file,
      checksum: checksum(source),
      up: mod.up,
      file,
    });
  }
  migrations.sort((a, b) => a.version - b.version);
  return migrations;
}

const migrations = await loadMigrations();
const appliedRows = db.prepare('SELECT * FROM schema_migrations ORDER BY version').all();
const applied = new Map(appliedRows.map((row) => [row.version, row]));

for (const row of appliedRows) {
  const migration = migrations.find((item) => item.version === row.version);
  if (migration && migration.checksum !== row.checksum) {
    throw new Error(
      `迁移 ${row.version}（${row.name}）已被修改，拒绝启动。请新增迁移而不是改旧文件。`
    );
  }
}

const pending = migrations.filter((item) => !applied.has(item.version));
if (pending.length) {
  backupBeforeMigration();
  for (const migration of pending) {
    db.exec('BEGIN IMMEDIATE');
    try {
      await migration.up(db);
      db.prepare(
        'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)'
      ).run(migration.version, migration.name, migration.checksum, Date.now());
      db.exec('COMMIT');
      console.log(`[db] 已应用迁移 ${migration.version}：${migration.name}`);
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* ignore rollback failure */
      }
      throw new Error(`迁移 ${migration.file} 失败：${error.message}`, { cause: error });
    }
  }
}

// 轻量清理：审计日志保留 180 天，过期/已吊销会话保留 7 天便于排查。
const cleanupNow = Date.now();
db.prepare('DELETE FROM auth_events WHERE created_at < ?').run(
  cleanupNow - 180 * 24 * 60 * 60 * 1000
);
db.prepare(
  `DELETE FROM account_sessions
    WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)`
).run(cleanupNow - 7 * 24 * 60 * 60 * 1000, cleanupNow - 7 * 24 * 60 * 60 * 1000);
