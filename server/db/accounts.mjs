import crypto from 'node:crypto';
import { db } from './index.mjs';

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
