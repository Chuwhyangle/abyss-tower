// 在线备份 SQLite：VACUUM INTO 会生成一致快照，无需停服。
// 用法：npm run backup [目标路径]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env.DB_PATH || path.join(ROOT, 'server', 'data', 'game.db');

if (!fs.existsSync(dbPath)) {
  console.error(`数据库不存在：${dbPath}`);
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const defaultTarget = path.join(ROOT, 'backups', `game-${stamp}.db`);
const target = path.resolve(process.argv[2] || defaultTarget);

if (fs.existsSync(target)) {
  console.error(`目标已存在，拒绝覆盖：${target}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(target), { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
db.close();

const size = fs.statSync(target).size;
console.log(`备份完成：${target} (${(size / 1024).toFixed(1)} KB)`);
