// 本地运维 CLI：备份 / 账户查询 / 禁用账号 / 从备份恢复 / 赛季结算。
// 零依赖，直接复用 node:sqlite 与 VACUUM INTO 备份方式（同 scripts/backup.mjs）。
// 用法：node scripts/ops.mjs <command> [options]，详见 --help。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { parseRotate, rotateBackups } from './backup.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DB = process.env.DB_PATH || path.join(ROOT, 'server', 'data', 'game.db');
const DEFAULT_LIMIT = 50;

const USAGE = `本地运维 CLI

用法：
  node scripts/ops.mjs <command> [options]

命令：
  backup [--out <path>] [--rotate N]       备份数据库（VACUUM INTO，拒绝覆盖已有文件）
                                            --rotate N 保留最近 N 份与每周首份，删除前校验
  accounts [--search <name>] [--limit N]   列出账号摘要（不含密码/恢复码哈希）
  disable <username> [--yes]               禁用账号；未加 --yes 时只做 dry-run
  restore <backup> --to <db> [--yes]       从备份恢复到目标库；拒绝覆盖正在使用的库
  settle-season <YYYY-MM> [--yes]          结算赛季并发放星核；未加 --yes 时只做 dry-run

通用选项：
  --db <path>    操作的数据库（默认 $DB_PATH 或 server/data/game.db）
  --json         以 JSON 输出
  -h, --help     显示帮助
`;

class OpsError extends Error {}

function parseCli(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      db: { type: 'string' },
      out: { type: 'string' },
      rotate: { type: 'string' },
      search: { type: 'string' },
      limit: { type: 'string' },
      to: { type: 'string' },
      yes: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  return { command: positionals[0] || null, args: positionals.slice(1), opts: values };
}

function dbPathFor(opts) {
  return path.resolve(opts.db || DEFAULT_DB);
}

function requireDbFile(file) {
  if (!fs.existsSync(file)) throw new OpsError(`数据库不存在：${file}`);
  return file;
}

function openDb(file, { readOnly = false } = {}) {
  return new DatabaseSync(file, { readOnly });
}

function parseLimit(raw) {
  if (raw == null) return DEFAULT_LIMIT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new OpsError(`--limit 必须是正整数：${raw}`);
  }
  return Math.min(value, 10000);
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatTime(value) {
  if (!value) return '-';
  return new Date(Number(value)).toISOString().replace('T', ' ').slice(0, 19);
}

function backupStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function vacuumInto(db, target) {
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
}

// ---------- backup ----------

function commandBackup(opts) {
  let keep = null;
  try {
    keep = parseRotate(opts.rotate);
  } catch (error) {
    throw new OpsError(error.message);
  }

  const source = requireDbFile(dbPathFor(opts));
  const target = path.resolve(
    opts.out || path.join(ROOT, 'backups', `game-${backupStamp()}.db`)
  );
  if (target === source) throw new OpsError('备份目标不能是数据库本身');
  if (fs.existsSync(target)) throw new OpsError(`目标已存在，拒绝覆盖：${target}`);

  fs.mkdirSync(path.dirname(target), { recursive: true });
  const db = openDb(source);
  try {
    vacuumInto(db, target);
  } finally {
    db.close();
  }

  const result = { source, target, bytes: fs.statSync(target).size };
  if (keep != null) {
    result.rotation = rotateBackups(path.dirname(target), {
      keep,
      protect: [target, source],
    });
  }
  return result;
}

// ---------- accounts ----------

function escapeLike(value) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function commandAccounts(opts) {
  const file = requireDbFile(dbPathFor(opts));
  const limit = parseLimit(opts.limit);
  const search = opts.search ? `%${escapeLike(opts.search.trim().toLowerCase())}%` : null;

  const db = openDb(file, { readOnly: true });
  try {
    const rows = db
      .prepare(
        `SELECT a.id, a.username, a.kind, a.status, a.created_at, a.last_login_at,
                COALESCE(w.balance, 0) AS cores,
                COALESCE(s.value_num, 0) AS wins
           FROM accounts a
           LEFT JOIN player_wallets w
                  ON w.account_id = a.id AND w.currency_id = 'cores'
           LEFT JOIN player_stats s
                  ON s.account_id = a.id AND s.stat_key = 'wins' AND s.scope_key = ''
          WHERE (? IS NULL OR a.username_norm LIKE ? ESCAPE '\\')
          ORDER BY a.created_at DESC, a.id
          LIMIT ?`
      )
      .all(search, search, limit);
    return rows.map((row) => ({
      id: row.id,
      username: row.username ?? null,
      kind: row.kind,
      status: row.status,
      cores: Number(row.cores) || 0,
      wins: Number(row.wins) || 0,
      createdAt: Number(row.created_at),
      lastLoginAt: row.last_login_at == null ? null : Number(row.last_login_at),
    }));
  } finally {
    db.close();
  }
}

// ---------- disable ----------

function commandDisable(username, opts) {
  if (!username) throw new OpsError('用法：node scripts/ops.mjs disable <username> [--yes]');
  const file = requireDbFile(dbPathFor(opts));
  const normalized = username.trim().toLowerCase();

  const db = openDb(file);
  try {
    const account = db
      .prepare('SELECT id, username, status FROM accounts WHERE username_norm = ?')
      .get(normalized);
    if (!account) throw new OpsError(`未找到账号：${username}`);
    if (account.status === 'deleted') {
      throw new OpsError(`账号已删除，无法禁用：${account.username || account.id}`);
    }
    if (account.status === 'disabled') {
      return { dryRun: false, changed: false, account, message: '账号已是禁用状态' };
    }
    if (!opts.yes) {
      return {
        dryRun: true,
        changed: false,
        account,
        message: `[dry-run] 将禁用账号 ${account.username}（${account.id}）；加 --yes 执行`,
      };
    }
    db.prepare(
      "UPDATE accounts SET status = 'disabled', updated_at = ? WHERE id = ? AND status = 'active'"
    ).run(Date.now(), account.id);
    return {
      dryRun: false,
      changed: true,
      account: { ...account, status: 'disabled' },
      message: `已禁用账号 ${account.username}（${account.id}）`,
    };
  } finally {
    db.close();
  }
}

// ---------- restore ----------

function assertBackupReadable(backup) {
  let db;
  try {
    db = openDb(backup, { readOnly: true });
    const result = db.prepare('PRAGMA integrity_check').get();
    const verdict = result ? Object.values(result)[0] : null;
    if (verdict !== 'ok') throw new OpsError(`备份文件校验失败：${backup}（${verdict}）`);
  } catch (error) {
    if (error instanceof OpsError) throw error;
    throw new OpsError(`不是可用的 SQLite 备份：${backup}（${error.message}）`);
  } finally {
    db?.close();
  }
}

function assertTargetNotInUse(target) {
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${target}${suffix}`;
    if (fs.existsSync(sidecar)) {
      throw new OpsError(`目标数据库正在使用中（检测到 ${path.basename(sidecar)}），拒绝覆盖：${target}`);
    }
  }
  let db;
  try {
    db = openDb(target);
    db.exec('PRAGMA busy_timeout = 0');
    db.exec('BEGIN EXCLUSIVE');
    db.exec('ROLLBACK');
  } catch (error) {
    throw new OpsError(`目标数据库正在使用中，拒绝覆盖：${target}（${error.message}）`);
  } finally {
    db?.close();
  }
}

function commandRestore(backup, opts) {
  if (!backup) {
    throw new OpsError('用法：node scripts/ops.mjs restore <backup> --to <db> [--yes]');
  }
  if (!opts.to) throw new OpsError('缺少 --to <db>：请指定恢复目标路径');

  const source = path.resolve(backup);
  const target = path.resolve(opts.to);
  if (!fs.existsSync(source)) throw new OpsError(`备份不存在：${source}`);
  if (source === target) throw new OpsError('备份路径与目标路径相同');
  assertBackupReadable(source);

  if (!opts.yes) {
    return {
      dryRun: true,
      changed: false,
      source,
      target,
      message: `[dry-run] 将用 ${source} 覆盖 ${target}；加 --yes 执行`,
    };
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target)) assertTargetNotInUse(target);

  // 先写临时文件再原子替换，避免中途失败留下半截数据库。
  const temp = `${target}.restore-${process.pid}.tmp`;
  try {
    fs.copyFileSync(source, temp);
    fs.renameSync(temp, target);
  } finally {
    fs.rmSync(temp, { force: true });
  }
  for (const suffix of ['-wal', '-shm']) {
    fs.rmSync(`${target}${suffix}`, { force: true });
  }
  return {
    dryRun: false,
    changed: true,
    source,
    target,
    bytes: fs.statSync(target).size,
    message: `已恢复：${source} → ${target}`,
  };
}

// ---------- settle-season ----------

async function commandSettleSeason(season, opts) {
  if (!season) {
    throw new OpsError('用法：node scripts/ops.mjs settle-season <YYYY-MM> [--yes]');
  }
  const file = requireDbFile(dbPathFor(opts));
  // 复用服务端结算逻辑：必须在 import 前把连接指向目标库（导入会执行迁移）。
  process.env.DB_PATH = file;
  const { isSeasonKey, settleSeason } = await import('../server/db/leaderboard.mjs');
  if (!isSeasonKey(season)) throw new OpsError(`非法赛季：${season}（应为 YYYY-MM）`);
  return settleSeason(season, { dryRun: !opts.yes });
}

// ---------- output ----------

function printHuman(command, result, opts) {
  if (command === 'accounts') {
    if (!result.length) {
      console.log(opts.search ? `没有匹配「${opts.search}」的账号` : '没有账号');
      return;
    }
    for (const row of result) {
      console.log(
        [
          row.id,
          row.username ?? '(未命名)',
          row.status,
          `星核 ${row.cores}`,
          `胜场 ${row.wins}`,
          formatTime(row.createdAt),
        ].join('  ')
      );
    }
    return;
  }

  if (command === 'backup') {
    console.log(`备份完成：${result.target}（${formatBytes(result.bytes)}）`);
    if (result.rotation) {
      if (result.rotation.removed.length > 0) {
        console.log(`轮转：删除 ${result.rotation.removed.length} 份旧备份`);
      }
      for (const failure of result.rotation.failed) {
        console.error(`警告：备份校验失败，保留不删：${failure.file}（${failure.verdict}）`);
      }
    }
    return;
  }

  if (command === 'disable') {
    console.log(result.message);
    return;
  }

  if (command === 'restore') {
    console.log(result.message);
    if (result.bytes != null) console.log(`目标大小：${formatBytes(result.bytes)}`);
    return;
  }

  if (command === 'settle-season') {
    const prefix = result.dryRun ? '[dry-run] ' : '';
    const state = result.alreadySettled ? '已结算' : '结算';
    console.log(
      `${prefix}赛季 ${result.season} ${state}：${result.settledCount} 人，共 ${result.totalCores} 星核`
    );
    for (const item of result.rewards) {
      console.log(`  #${item.rank}  ${item.accountId}  +${item.cores} 星核`);
    }
    if (result.dryRun) console.log('[dry-run] 加 --yes 执行');
  }
}

// ---------- main ----------

async function main(argv) {
  const { command, args, opts } = parseCli(argv);
  if (opts.help || !command) {
    if (command && !opts.help) throw new OpsError(`未知命令：${command}`);
    console.log(USAGE);
    return 0;
  }

  let result;
  switch (command) {
    case 'backup':
      result = commandBackup(opts);
      break;
    case 'accounts':
      result = commandAccounts(opts);
      break;
    case 'disable':
      result = commandDisable(args[0], opts);
      break;
    case 'restore':
      result = commandRestore(args[0], opts);
      break;
    case 'settle-season':
      result = await commandSettleSeason(args[0], opts);
      break;
    default:
      throw new OpsError(`未知命令：${command}（用 --help 查看用法）`);
  }

  if (opts.json) {
    console.log(
      JSON.stringify(
        command === 'accounts' ? result : { command, ...result },
        null,
        2
      )
    );
  } else {
    printHuman(command, result, opts);
  }
  return 0;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    const wantsJson = process.argv.includes('--json');
    if (wantsJson) {
      console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    } else {
      console.error(`错误：${error.message}`);
    }
    process.exitCode = 1;
  });
