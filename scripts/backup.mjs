// 在线备份 SQLite：VACUUM INTO 会生成一致快照，无需停服。
// 用法：npm run backup [目标路径] [--rotate N]
//   --rotate N  只保留最近 N 份备份，另按 ISO 周保留每周首份；
//               删除前用 PRAGMA integrity_check 校验，损坏的备份一律保留并告警。
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 轮转只处理本脚本生成的备份命名，避免误删同目录里的其他数据库。
export const BACKUP_FILE_RE = /^game-.*\.db$/;

const USAGE = `在线备份 SQLite（VACUUM INTO）

用法：
  node scripts/backup.mjs [目标路径] [--rotate N]

选项：
  --rotate N   保留最近 N 份备份，另按 ISO 周保留每周首份；
               删除前做 PRAGMA integrity_check，损坏的备份保留不删
  -h, --help   显示帮助
`;

export function parseRotate(raw) {
  if (raw == null) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`--rotate 必须是正整数：${raw}`);
  }
  return value;
}

// ISO-8601 周键（周一为一周起点），用 UTC 保证跨时区一致。
export function isoWeekKey(ms) {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) throw new Error(`无效时间：${ms}`);
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const year = day.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const week = Math.ceil(((day.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

// 纯函数：给定备份条目 [{ file, mtimeMs }]，返回保留集与待删除集。
// 规则：按时间保留最近 keep 份，再保留每个 ISO 周最早的一份。
export function planRotation(entries, { keep = 5 } = {}) {
  if (!Number.isInteger(keep) || keep < 1) {
    throw new Error(`保留份数必须是正整数：${keep}`);
  }
  if (!Array.isArray(entries)) throw new Error('备份条目必须是数组');

  const sorted = [...entries].sort(
    (a, b) => a.mtimeMs - b.mtimeMs || String(a.file).localeCompare(String(b.file))
  );

  const keepFiles = new Set(
    sorted.slice(Math.max(0, sorted.length - keep)).map((entry) => entry.file)
  );
  const seenWeeks = new Set();
  for (const entry of sorted) {
    const week = isoWeekKey(entry.mtimeMs);
    if (seenWeeks.has(week)) continue;
    seenWeeks.add(week);
    keepFiles.add(entry.file);
  }

  return {
    keep: sorted.filter((entry) => keepFiles.has(entry.file)).map((entry) => entry.file),
    remove: sorted.filter((entry) => !keepFiles.has(entry.file)).map((entry) => entry.file),
  };
}

export function listBackupFiles(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const entries = [];
  for (const name of names.sort()) {
    if (!BACKUP_FILE_RE.test(name)) continue;
    const file = path.join(dir, name);
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    entries.push({ file, mtimeMs: stat.mtimeMs });
  }
  return entries;
}

export function verifyBackupIntegrity(file) {
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const row = db.prepare('PRAGMA integrity_check').get();
    const verdict = row ? Object.values(row)[0] : null;
    return { ok: verdict === 'ok', verdict };
  } catch (error) {
    return { ok: false, verdict: error.message };
  } finally {
    db?.close();
  }
}

// 就地轮转：只删除通过完整性校验的旧备份；保护 target 与源库不被删除。
export function rotateBackups(dir, { keep, protect = [] } = {}) {
  const protectedFiles = new Set(protect.map((file) => path.resolve(file)));
  const entries = listBackupFiles(dir).filter(
    (entry) => !protectedFiles.has(path.resolve(entry.file))
  );
  const plan = planRotation(entries, { keep });

  const removed = [];
  const failed = [];
  for (const file of plan.remove) {
    const verdict = verifyBackupIntegrity(file);
    if (!verdict.ok) {
      failed.push({ file, verdict: verdict.verdict });
      continue;
    }
    try {
      fs.rmSync(file);
      removed.push(file);
    } catch (error) {
      failed.push({ file, verdict: error.message });
    }
  }
  return { keep: plan.keep, remove: plan.remove, removed, failed };
}

function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      rotate: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    console.log(USAGE);
    return;
  }

  const keep = parseRotate(values.rotate);
  const dbPath = process.env.DB_PATH || path.join(ROOT, 'server', 'data', 'game.db');

  if (!fs.existsSync(dbPath)) {
    console.error(`数据库不存在：${dbPath}`);
    process.exitCode = 1;
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const defaultTarget = path.join(ROOT, 'backups', `game-${stamp}.db`);
  const target = path.resolve(positionals[0] || defaultTarget);

  if (fs.existsSync(target)) {
    console.error(`目标已存在，拒绝覆盖：${target}`);
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });

  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }

  const size = fs.statSync(target).size;
  console.log(`备份完成：${target} (${(size / 1024).toFixed(1)} KB)`);

  if (keep == null) return;

  const rotation = rotateBackups(path.dirname(target), {
    keep,
    protect: [target, path.resolve(dbPath)],
  });
  if (rotation.removed.length > 0) {
    console.log(`轮转：删除 ${rotation.removed.length} 份旧备份`);
  }
  for (const failure of rotation.failed) {
    console.error(`警告：备份校验失败，保留不删：${failure.file}（${failure.verdict}）`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`错误：${error.message}`);
    process.exitCode = 1;
  }
}
