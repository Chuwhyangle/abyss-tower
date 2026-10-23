import crypto from 'node:crypto';
import { db } from '../db/index.mjs';

const WINDOW_MS = 15 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const LOGIN_FAILURES_PER_USER = 5;
const LOGIN_FAILURES_PER_IP = 20;
const REGISTRATIONS_PER_IP = 5;
const CLAIMS_PER_IP = 10;

// 代码是公开的，不能内置默认盐：未配置时每次进程启动随机生成。
// 代价仅是重启后限流窗口重新计数，不影响账号数据。
const IP_SALT = process.env.AUTH_IP_SALT || crypto.randomBytes(32).toString('hex');

export function clientIp(req) {
  // Cloudflare 会覆盖该头，优先使用；否则退回 X-Forwarded-For / socket。
  const cloudflare = String(req.headers['cf-connecting-ip'] || '').trim();
  if (cloudflare) return cloudflare;
  const forwarded = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  return forwarded || req.socket?.remoteAddress || 'unknown';
}

export function hashIp(req) {
  return crypto.createHmac('sha256', IP_SALT).update(clientIp(req)).digest('hex');
}

export function recordAuthEvent({
  accountId = null,
  usernameNorm = null,
  event,
  ipHash = null,
  userAgent = null,
  detail = {},
}) {
  db.prepare(
    `INSERT INTO auth_events
       (account_id, username_norm, event, ip_hash, user_agent, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    accountId,
    usernameNorm,
    event,
    ipHash,
    userAgent ? String(userAgent).slice(0, 300) : null,
    JSON.stringify(detail || {}),
    Date.now()
  );
}

function countEvents(event, since, { usernameNorm = null, ipHash = null } = {}) {
  const conditions = ['event = ?', 'created_at >= ?'];
  const params = [event, since];
  if (usernameNorm != null) {
    conditions.push('username_norm = ?');
    params.push(usernameNorm);
  }
  if (ipHash != null) {
    conditions.push('ip_hash = ?');
    params.push(ipHash);
  }
  return db
    .prepare(`SELECT COUNT(*) AS c FROM auth_events WHERE ${conditions.join(' AND ')}`)
    .get(...params).c;
}

export function loginRateLimited({ usernameNorm, ipHash }) {
  const since = Date.now() - WINDOW_MS;
  const byUser = countEvents('login_fail', since, { usernameNorm });
  const byIp = countEvents('login_fail', since, { ipHash });
  return {
    limited: byUser >= LOGIN_FAILURES_PER_USER || byIp >= LOGIN_FAILURES_PER_IP,
    retryAfterSeconds: Math.ceil(WINDOW_MS / 1000),
  };
}

export function registrationRateLimited(ipHash) {
  return (
    countEvents('register', Date.now() - HOUR_MS, { ipHash }) >= REGISTRATIONS_PER_IP
  );
}

export function claimRateLimited(ipHash) {
  return countEvents('claim', Date.now() - HOUR_MS, { ipHash }) >= CLAIMS_PER_IP;
}

export function recoveryRateLimited({ usernameNorm, ipHash }) {
  const since = Date.now() - HOUR_MS;
  return (
    countEvents('recovery_fail', since, { usernameNorm }) >= 5 ||
    countEvents('recovery_fail', since, { ipHash }) >= 20
  );
}
