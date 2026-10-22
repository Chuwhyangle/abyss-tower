import crypto from 'node:crypto';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;
const MAXMEM = 64 * 1024 * 1024;

function scrypt(password, salt, { n = SCRYPT_N, r = SCRYPT_R, p = SCRYPT_P } = {}) {
  return crypto.scryptSync(String(password), salt, KEY_LEN, {
    N: n,
    r,
    p,
    maxmem: MAXMEM,
  });
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = scrypt(password, salt);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[4], 'base64');
    expected = Buffer.from(parts[5], 'base64');
  } catch {
    return false;
  }
  if (!salt.length || !expected.length) return false;
  let actual;
  try {
    actual = scrypt(password, salt, { n, r, p });
  } catch {
    return false;
  }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// 恢复码：8 组 4 位，高熵；只返回一次，库里存 scrypt 哈希。
export function generateRecoveryCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(32);
  const chars = Array.from(bytes, (value) => alphabet[value % alphabet.length]);
  return chars.join('').match(/.{4}/g).join('-');
}

export function hashRecoveryCode(code) {
  return hashPassword(normalizeRecoveryCode(code));
}

export function verifyRecoveryCode(code, stored) {
  return verifyPassword(normalizeRecoveryCode(code), stored);
}

export function normalizeRecoveryCode(code) {
  return String(code || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function isValidUsername(username) {
  return typeof username === 'string' && /^[A-Za-z0-9_]{3,16}$/.test(username);
}

export function isValidPassword(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 128;
}
