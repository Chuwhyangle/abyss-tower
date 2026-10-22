import {
  COOKIE_MAX_AGE_SECONDS,
  COOKIE_NAME,
  HOST_COOKIE_NAME,
} from '../config.mjs';

export function isSecureRequest(req) {
  if (process.env.COOKIE_SECURE === '1') return true;
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return forwarded === 'https';
}

export function sessionCookieName(req) {
  return isSecureRequest(req) ? HOST_COOKIE_NAME : COOKIE_NAME;
}

export function parseCookies(req) {
  const header = req.headers.cookie;
  const result = new Map();
  if (!header) return result;
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    result.set(name, decodeURIComponent(part.slice(index + 1).trim()));
  }
  return result;
}

export function getSessionToken(req) {
  const cookies = parseCookies(req);
  return cookies.get(HOST_COOKIE_NAME) || cookies.get(COOKIE_NAME) || null;
}

function attributes(req, maxAge) {
  const pieces = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (isSecureRequest(req)) pieces.push('Secure', 'Priority=High');
  return pieces.join('; ');
}

export function setSessionCookie(req, res, token) {
  const name = sessionCookieName(req);
  res.setHeader(
    'Set-Cookie',
    `${name}=${encodeURIComponent(token)}; ${attributes(req, COOKIE_MAX_AGE_SECONDS)}`
  );
}

export function clearSessionCookie(req, res) {
  for (const name of [HOST_COOKIE_NAME, COOKIE_NAME]) {
    const value = `${name}=; ${attributes(req, 0)}`;
    const existing = res.getHeader('Set-Cookie');
    if (!existing) res.setHeader('Set-Cookie', value);
    else if (Array.isArray(existing)) res.setHeader('Set-Cookie', [...existing, value]);
    else res.setHeader('Set-Cookie', [String(existing), value]);
  }
}
