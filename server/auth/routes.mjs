import {
  AUTH_ENABLED,
  REGISTRATION_MODE,
  SESSION_TTL_MS,
} from '../config.mjs';
import {
  claimAccount,
  findAccountByAlias,
  findAccountByUsername,
  hashAlias,
  publicAccount,
  registerAccount,
  setAccountPassword,
  setAccountRecovery,
  touchLogin,
} from '../db/accounts.mjs';
import {
  createSession,
  findSessionByToken,
  revokeAccountSessions,
  revokeSession,
  touchSession,
} from '../db/sessions.mjs';
import { getProfile, createProfile } from '../db.mjs';
import { recordPlayerEvent } from '../db/events.mjs';
import {
  clearSessionCookie,
  getSessionToken,
  setSessionCookie,
} from './cookies.mjs';
import {
  claimRateLimited,
  hashIp,
  loginRateLimited,
  recordAuthEvent,
  recoveryRateLimited,
  registrationRateLimited,
} from './rate-limit.mjs';
import {
  generateRecoveryCode,
  hashPassword,
  hashRecoveryCode,
  isValidPassword,
  isValidUsername,
  verifyPassword,
  verifyRecoveryCode,
} from './password.mjs';

const TOKEN_RE = /^[A-Za-z0-9_-]{8,80}$/;

function failWith(json, res, status, message, code = undefined) {
  return json(res, status, code ? { error: message, code } : { error: message });
}

function profileFor(account) {
  return (
    getProfile(account.id) ||
    createProfile(account.id, account.username || null)
  );
}

function payloadFor(account) {
  return {
    account: publicAccount(account),
    profile: profileFor(account),
  };
}

function currentSession(req) {
  const token = getSessionToken(req);
  if (!token) return null;
  const session = findSessionByToken(token);
  if (session) touchSession(session);
  return session;
}

function startSession(req, res, account, { revokeCurrent = true } = {}) {
  if (revokeCurrent) {
    const existing = currentSession(req);
    if (existing) revokeSession(existing.session_id);
  }
  const session = createSession(account.id, {
    ipHash: hashIp(req),
    userAgent: req.headers['user-agent'] || null,
  });
  setSessionCookie(req, res, session.token);
  return session;
}

function legacyTokenFrom(req) {
  const token = String(req.headers['x-player-token'] || '');
  return TOKEN_RE.test(token) ? token : '';
}

function legacyAccountFrom(req) {
  const token = legacyTokenFrom(req);
  if (!token) return null;
  return findAccountByAlias('legacy_token', hashAlias(token));
}

function tooMany(json, res, retryAfter) {
  res.setHeader('Retry-After', String(retryAfter || 900));
  return failWith(json, res, 429, '尝试次数过多，请稍后再试', 'RATE_LIMITED');
}

export async function handleAuthRoute(req, res, url, { json, fail, readJson }) {
  const pathname = url.pathname;
  if (!pathname.startsWith('/api/auth/')) return false;
  const method = req.method;

  if (pathname === '/api/auth/register' && method === 'POST') {
    if (!AUTH_ENABLED) return failWith(json, res, 404, '账号体系未启用', 'AUTH_DISABLED');
    if (REGISTRATION_MODE === 'closed') {
      return failWith(json, res, 403, '注册已关闭', 'REGISTRATION_CLOSED');
    }
    const ipHash = hashIp(req);
    if (registrationRateLimited(ipHash)) return tooMany(json, res, 3600);

    let body;
    try {
      body = await readJson(req);
    } catch (error) {
      return failWith(json, res, 400, error.message);
    }
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!isValidUsername(username)) {
      return failWith(json, res, 400, '用户名需为 3–16 位字母、数字或下划线');
    }
    if (!isValidPassword(password)) {
      return failWith(json, res, 400, '密码需为 8–128 位');
    }
    if (findAccountByUsername(username)) {
      return failWith(json, res, 409, '用户名已被占用', 'USERNAME_TAKEN');
    }

    const recoveryCode = generateRecoveryCode();
    const account = registerAccount({
      username,
      passwordHash: hashPassword(password),
      recoveryHash: hashRecoveryCode(recoveryCode),
    });
    createProfile(account.id, username);
    recordPlayerEvent(account.id, 'account_registered', { kind: 'registered' });
    startSession(req, res, account);
    recordAuthEvent({
      accountId: account.id,
      usernameNorm: account.username_norm,
      event: 'register',
      ipHash,
      userAgent: req.headers['user-agent'],
    });
    return json(res, 201, {
      ...payloadFor(account),
      recoveryCode,
    });
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    if (!AUTH_ENABLED) return failWith(json, res, 404, '账号体系未启用', 'AUTH_DISABLED');
    const ipHash = hashIp(req);
    let body;
    try {
      body = await readJson(req);
    } catch (error) {
      return failWith(json, res, 400, error.message);
    }
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const account = findAccountByUsername(username);
    const usernameNorm = String(username).trim().toLowerCase();
    const limit = loginRateLimited({ usernameNorm, ipHash });
    if (limit.limited) return tooMany(json, res, limit.retryAfterSeconds);

    if (!account || account.status !== 'active' || !verifyPassword(password, account.password_hash)) {
      recordAuthEvent({
        accountId: account?.id || null,
        usernameNorm,
        event: 'login_fail',
        ipHash,
        userAgent: req.headers['user-agent'],
      });
      return failWith(json, res, 401, '用户名或密码错误', 'INVALID_CREDENTIALS');
    }

    touchLogin(account.id);
    startSession(req, res, account);
    recordAuthEvent({
      accountId: account.id,
      usernameNorm: account.username_norm,
      event: 'login_ok',
      ipHash,
      userAgent: req.headers['user-agent'],
    });
    return json(res, 200, payloadFor(account));
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    const session = currentSession(req);
    if (session) {
      revokeSession(session.session_id);
      recordAuthEvent({
        accountId: session.id,
        usernameNorm: session.username_norm,
        event: 'logout',
        ipHash: hashIp(req),
        userAgent: req.headers['user-agent'],
      });
    }
    clearSessionCookie(req, res);
    res.writeHead(204, {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end();
    return true;
  }

  if (pathname === '/api/auth/me' && method === 'GET') {
    const session = currentSession(req);
    if (!session) {
      return failWith(json, res, 401, '请先登录', 'AUTH_REQUIRED');
    }
    return json(res, 200, {
      ...payloadFor(session),
      sessionExpiresAt: session.expires_at,
      sessionTtlMs: SESSION_TTL_MS,
    });
  }

  if (pathname === '/api/auth/legacy' && method === 'GET') {
    const account = legacyAccountFrom(req);
    if (!account) return failWith(json, res, 404, '没有找到可绑定的旧账号', 'LEGACY_NOT_FOUND');
    const profile = profileFor(account);
    return json(res, 200, {
      claimable: account.kind === 'unclaimed',
      displayName: profile?.name || null,
      summary: {
        cores: profile?.cores || 0,
        unlocks: profile?.unlocks?.length || 0,
        runs: profile?.stats?.runs || 0,
      },
    });
  }

  if (pathname === '/api/auth/claim' && method === 'POST') {
    if (!AUTH_ENABLED) return failWith(json, res, 404, '账号体系未启用', 'AUTH_DISABLED');
    const ipHash = hashIp(req);
    if (claimRateLimited(ipHash)) return tooMany(json, res, 3600);
    const account = legacyAccountFrom(req);
    if (!account) return failWith(json, res, 404, '没有找到可绑定的旧账号', 'LEGACY_NOT_FOUND');
    if (account.kind !== 'unclaimed') {
      return failWith(json, res, 409, '该旧账号已经绑定', 'ALREADY_CLAIMED');
    }

    let body;
    try {
      body = await readJson(req);
    } catch (error) {
      return failWith(json, res, 400, error.message);
    }
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!isValidUsername(username)) {
      return failWith(json, res, 400, '用户名需为 3–16 位字母、数字或下划线');
    }
    if (!isValidPassword(password)) {
      return failWith(json, res, 400, '密码需为 8–128 位');
    }
    if (findAccountByUsername(username)) {
      return failWith(json, res, 409, '用户名已被占用', 'USERNAME_TAKEN');
    }

    const recoveryCode = generateRecoveryCode();
    const claimed = claimAccount(account.id, {
      username,
      passwordHash: hashPassword(password),
      recoveryHash: hashRecoveryCode(recoveryCode),
    });
    recordPlayerEvent(claimed.id, 'legacy_claimed', {});
    startSession(req, res, claimed);
    recordAuthEvent({
      accountId: claimed.id,
      usernameNorm: claimed.username_norm,
      event: 'claim',
      ipHash,
      userAgent: req.headers['user-agent'],
    });
    return json(res, 200, {
      ...payloadFor(claimed),
      recoveryCode,
    });
  }

  if (pathname === '/api/auth/password' && method === 'POST') {
    const session = currentSession(req);
    if (!session) return failWith(json, res, 401, '请先登录', 'AUTH_REQUIRED');
    let body;
    try {
      body = await readJson(req);
    } catch (error) {
      return failWith(json, res, 400, error.message);
    }
    const current = String(body.currentPassword || '');
    const next = String(body.newPassword || '');
    if (!verifyPassword(current, session.password_hash)) {
      return failWith(json, res, 401, '当前密码错误', 'INVALID_CREDENTIALS');
    }
    if (!isValidPassword(next)) {
      return failWith(json, res, 400, '新密码需为 8–128 位');
    }
    setAccountPassword(session.id, hashPassword(next));
    revokeAccountSessions(session.id, session.session_id);
    recordAuthEvent({
      accountId: session.id,
      usernameNorm: session.username_norm,
      event: 'password_change',
      ipHash: hashIp(req),
      userAgent: req.headers['user-agent'],
    });
    return json(res, 200, { ok: true });
  }

  if (pathname === '/api/auth/recovery' && method === 'POST') {
    const ipHash = hashIp(req);
    let body;
    try {
      body = await readJson(req);
    } catch (error) {
      return failWith(json, res, 400, error.message);
    }
    const username = String(body.username || '').trim();
    const usernameNorm = username.toLowerCase();
    if (recoveryRateLimited({ usernameNorm, ipHash })) return tooMany(json, res, 3600);
    const account = findAccountByUsername(username);
    const code = String(body.recoveryCode || '');
    const next = String(body.newPassword || '');
    if (
      !account ||
      account.status !== 'active' ||
      !account.recovery_hash ||
      !verifyRecoveryCode(code, account.recovery_hash)
    ) {
      recordAuthEvent({
        accountId: account?.id || null,
        usernameNorm,
        event: 'recovery_fail',
        ipHash,
        userAgent: req.headers['user-agent'],
      });
      return failWith(json, res, 401, '用户名或恢复码错误', 'INVALID_RECOVERY');
    }
    if (!isValidPassword(next)) {
      return failWith(json, res, 400, '新密码需为 8–128 位');
    }
    const newRecoveryCode = generateRecoveryCode();
    setAccountPassword(account.id, hashPassword(next));
    setAccountRecovery(account.id, hashRecoveryCode(newRecoveryCode));
    revokeAccountSessions(account.id);
    recordAuthEvent({
      accountId: account.id,
      usernameNorm: account.username_norm,
      event: 'recovery',
      ipHash,
      userAgent: req.headers['user-agent'],
    });
    return json(res, 200, { ok: true, recoveryCode: newRecoveryCode });
  }

  return fail(res, 404, '接口不存在');
}

// 账号体系启用时，游戏接口只接受已注册且有效的会话。
export function requireGameAccount(req) {
  const session = currentSession(req);
  if (!session) return null;
  if (!AUTH_ENABLED) return session;
  if (session.kind !== 'registered') return null;
  return session;
}

