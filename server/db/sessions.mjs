import crypto from 'node:crypto';
import { db } from './index.mjs';
import { SESSION_ABSOLUTE_MS, SESSION_TTL_MS } from '../config.mjs';

export function hashSessionToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function createSession(accountId, { ipHash = null, userAgent = null } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO account_sessions
       (id, account_id, token_hash, created_at, last_used_at, expires_at, revoked_at,
        ip_hash, user_agent, meta)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, '{}')`
  ).run(id, accountId, hashSessionToken(token), now, now, expiresAt, ipHash, userAgent);
  return { id, token, expiresAt };
}

export function findSessionByToken(token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT
         s.id AS session_id, s.account_id, s.created_at AS session_created_at,
         s.last_used_at, s.expires_at, s.revoked_at,
         a.id, a.kind, a.username, a.username_norm, a.password_hash, a.status,
         a.created_at, a.updated_at, a.last_login_at, a.recovery_hash
       FROM account_sessions s
       JOIN accounts a ON a.id = s.account_id
      WHERE s.token_hash = ?`
    )
    .get(hashSessionToken(token));
  if (!row) return null;
  if (row.revoked_at || row.status !== 'active') return null;
  if (row.expires_at <= Date.now()) return null;
  return row;
}

export function touchSession(session) {
  const now = Date.now();
  const absoluteDeadline = session.session_created_at + SESSION_ABSOLUTE_MS;
  const nextExpires = Math.min(now + SESSION_TTL_MS, absoluteDeadline);
  if (now - session.last_used_at > 60 * 1000) {
    db.prepare(
      'UPDATE account_sessions SET last_used_at = ?, expires_at = ? WHERE id = ?'
    ).run(now, nextExpires, session.session_id);
  }
  return nextExpires;
}

export function revokeSession(sessionId) {
  if (!sessionId) return;
  db.prepare(
    'UPDATE account_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL'
  ).run(Date.now(), sessionId);
}

export function revokeAccountSessions(accountId, exceptSessionId = null) {
  db.prepare(
    `UPDATE account_sessions
        SET revoked_at = ?
      WHERE account_id = ? AND revoked_at IS NULL AND id IS NOT ?`
  ).run(Date.now(), accountId, exceptSessionId);
}
