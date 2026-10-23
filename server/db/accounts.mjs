import crypto from 'node:crypto';
import { db } from './index.mjs';
import { revokeAccountSessions } from './sessions.mjs';

// 删除后的冷却期：期间会话失效、登录被拒，但账号尚未真正清除，可凭密码取消。
export const DELETION_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

export function hashAlias(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function publicAccount(row) {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    username: row.username || null,
    status: row.status,
    createdAt: row.created_at,
  };
}

export function findAccountById(id) {
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) || null;
}

export function findAccountByUsername(username) {
  const normalized = normalizeUsername(username);
  if (!normalized) return null;
  return (
    db.prepare('SELECT * FROM accounts WHERE username_norm = ?').get(normalized) || null
  );
}

export function createAccount({
  kind = 'unclaimed',
  username = null,
  passwordHash = null,
  recoveryHash = null,
  meta = {},
} = {}) {
  const now = Date.now();
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO accounts
       (id, kind, username, username_norm, password_hash, recovery_hash, status, meta,
        created_at, updated_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, NULL)`
  ).run(
    id,
    kind,
    username,
    username ? normalizeUsername(username) : null,
    passwordHash,
    recoveryHash,
    JSON.stringify(meta || {}),
    now,
    now
  );
  return findAccountById(id);
}

export function registerAccount({ username, passwordHash, recoveryHash }) {
  return createAccount({
    kind: 'registered',
    username,
    passwordHash,
    recoveryHash,
    meta: { registeredAt: Date.now() },
  });
}

export function claimAccount(accountId, { username, passwordHash, recoveryHash }) {
  const now = Date.now();
  db.prepare(
    `UPDATE accounts
        SET kind = 'registered',
            username = ?,
            username_norm = ?,
            password_hash = ?,
            recovery_hash = ?,
            updated_at = ?
      WHERE id = ?`
  ).run(username, normalizeUsername(username), passwordHash, recoveryHash, now, accountId);
  deleteAliases(accountId);
  return findAccountById(accountId);
}

export function setAccountPassword(accountId, passwordHash) {
  db.prepare(
    'UPDATE accounts SET password_hash = ?, updated_at = ? WHERE id = ?'
  ).run(passwordHash, Date.now(), accountId);
}

export function setAccountRecovery(accountId, recoveryHash) {
  db.prepare(
    'UPDATE accounts SET recovery_hash = ?, updated_at = ? WHERE id = ?'
  ).run(recoveryHash, Date.now(), accountId);
}

export function touchLogin(accountId) {
  const now = Date.now();
  db.prepare(
    'UPDATE accounts SET last_login_at = ?, updated_at = ? WHERE id = ?'
  ).run(now, now, accountId);
}

export function addAlias(provider, aliasHash, accountId) {
  db.prepare(
    'INSERT OR IGNORE INTO account_aliases (provider, alias_hash, account_id, created_at) VALUES (?, ?, ?, ?)'
  ).run(provider, aliasHash, accountId, Date.now());
}

export function findAccountByAlias(provider, aliasHash) {
  return (
    db
      .prepare(
        `SELECT a.* FROM account_aliases al
           JOIN accounts a ON a.id = al.account_id
          WHERE al.provider = ? AND al.alias_hash = ?`
      )
      .get(provider, aliasHash) || null
  );
}

export function deleteAliases(accountId) {
  db.prepare('DELETE FROM account_aliases WHERE account_id = ?').run(accountId);
}

function readMeta(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function getAccountDeletion(accountId) {
  const row = findAccountById(accountId);
  if (!row || row.status !== 'deleted') return null;
  const deletion = readMeta(row.meta).deletion;
  const dueAt = Number(deletion?.dueAt);
  if (!deletion || !Number.isFinite(dueAt)) return null;
  return { requestedAt: Number(deletion.requestedAt), dueAt };
}

// 软删除：状态置为 deleted，记录冷却截止时间，并让该账号所有会话立即失效。
export function softDeleteAccount(accountId, at = Date.now()) {
  const row = findAccountById(accountId);
  if (!row) return null;
  const meta = readMeta(row.meta);
  const deletion = { requestedAt: at, dueAt: at + DELETION_COOLDOWN_MS };
  meta.deletion = deletion;
  db.prepare('UPDATE accounts SET status = ?, meta = ?, updated_at = ? WHERE id = ?').run(
    'deleted',
    JSON.stringify(meta),
    at,
    accountId
  );
  revokeAccountSessions(accountId);
  return { account: findAccountById(accountId), deletion };
}

// 冷却期内取消删除：恢复 active 并清除删除计划；已到期则不可恢复。
export function cancelAccountDeletion(accountId, at = Date.now()) {
  const row = findAccountById(accountId);
  if (!row || row.status !== 'deleted') return null;
  const meta = readMeta(row.meta);
  const dueAt = Number(meta.deletion?.dueAt);
  if (!Number.isFinite(dueAt) || dueAt <= at) return null;
  delete meta.deletion;
  db.prepare('UPDATE accounts SET status = ?, meta = ?, updated_at = ? WHERE id = ?').run(
    'active',
    JSON.stringify(meta),
    at,
    accountId
  );
  return findAccountById(accountId);
}

// 清理到期删除：真正 DELETE 账号，级联移除档案/对局/会话等全部玩家数据。
// 返回被清除的账号 id，调用方可据此补审计事件。
export function purgeDueDeletions(now = Date.now()) {
  const rows = db.prepare("SELECT id, meta FROM accounts WHERE status = 'deleted'").all();
  const purged = [];
  db.exec('BEGIN IMMEDIATE');
  try {
    const remove = db.prepare('DELETE FROM accounts WHERE id = ?');
    for (const row of rows) {
      const dueAt = Number(readMeta(row.meta).deletion?.dueAt);
      if (!Number.isFinite(dueAt) || dueAt > now) continue;
      remove.run(row.id);
      purged.push(row.id);
    }
    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore rollback failure */
    }
    throw error;
  }
  return purged;
}

export function ensureLegacyAccount(token) {
  const aliasHash = hashAlias(token);
  const existing = findAccountByAlias('legacy_token', aliasHash);
  if (existing) return existing;
  const account = createAccount({
    kind: 'unclaimed',
    meta: { legacy: true, importedAt: Date.now() },
  });
  addAlias('legacy_token', aliasHash, account.id);
  return account;
}
