import crypto from 'node:crypto';
import { countAuthEvents, insertAuthEvent } from '../db/accounts.mjs';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

// 限流阈值集中定义：动作 → 窗口 / 阈值 / 计数事件。
// 每个动作只统计自己的事件名，分桶互不影响；调参只改这张表。
export const RATE_LIMITS = Object.freeze({
  login: Object.freeze({
    windowMs: 15 * MINUTE_MS,
    maxPerUsername: 5,
    maxPerIp: 20,
    event: 'login_fail',
  }),
  register: Object.freeze({
    windowMs: HOUR_MS,
    maxPerIp: 5,
    event: 'register',
  }),
  claim: Object.freeze({
    windowMs: HOUR_MS,
    maxPerIp: 10,
    event: 'claim',
  }),
  recovery: Object.freeze({
    windowMs: HOUR_MS,
    maxPerUsername: 5,
    maxPerIp: 20,
    event: 'recovery_fail',
  }),
  'skill-upgrade': Object.freeze({
    windowMs: MINUTE_MS,
    maxPerAccount: 20,
    maxPerIp: 40,
    event: 'skill_upgrade_fail',
  }),
  'run-create': Object.freeze({
    windowMs: MINUTE_MS,
    maxPerAccount: 10,
    maxPerIp: 30,
    event: 'run_create_fail',
  }),
});

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
  insertAuthEvent({ accountId, usernameNorm, event, ipHash, userAgent, detail });
}

function policyFor(action) {
  const policy = RATE_LIMITS[action];
  if (!policy) throw new Error(`未知的限流动作：${action}`);
  return policy;
}

// 通用分桶查询：同一动作的失败计数按账号/用户名/IP 分别计量，互不串桶。
export function actionRateLimited(
  action,
  { accountId = null, usernameNorm = null, ipHash = null } = {}
) {
  const policy = policyFor(action);
  const since = Date.now() - policy.windowMs;
  const exceeded = (max, selector) => {
    if (max == null || !selector) return false;
    return countAuthEvents(policy.event, since, selector) >= max;
  };
  const limited =
    exceeded(policy.maxPerAccount, accountId != null ? { accountId } : null) ||
    exceeded(policy.maxPerUsername, usernameNorm != null ? { usernameNorm } : null) ||
    exceeded(policy.maxPerIp, ipHash != null ? { ipHash } : null);
  return {
    limited,
    retryAfterSeconds: Math.ceil(policy.windowMs / 1000),
  };
}

// 记录一次动作失败；失败事件的名称由 RATE_LIMITS 统一决定，计数机制共享。
export function recordRateLimitFailure(
  action,
  { accountId = null, usernameNorm = null, ipHash = null, userAgent = null } = {}
) {
  const policy = policyFor(action);
  recordAuthEvent({
    accountId,
    usernameNorm,
    event: policy.event,
    ipHash,
    userAgent,
    detail: { action },
  });
}

export function loginRateLimited({ usernameNorm, ipHash }) {
  return actionRateLimited('login', { usernameNorm, ipHash });
}

export function registrationRateLimited(ipHash) {
  return actionRateLimited('register', { ipHash }).limited;
}

export function claimRateLimited(ipHash) {
  return actionRateLimited('claim', { ipHash }).limited;
}

export function recoveryRateLimited({ usernameNorm, ipHash }) {
  return actionRateLimited('recovery', { usernameNorm, ipHash }).limited;
}
