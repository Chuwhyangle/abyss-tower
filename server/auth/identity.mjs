import { AUTH_ENABLED } from '../config.mjs';
import { ensureLegacyAccount } from '../db/accounts.mjs';
import { requireGameAccount } from './routes.mjs';

const TOKEN_RE = /^[A-Za-z0-9_-]{8,80}$/;

// 账号模式：只认已注册会话；回退模式：继续接受旧 x-player-token。
export function resolveGameAccount(req) {
  const session = requireGameAccount(req);
  if (session) return { account: session, mode: 'session' };
  if (AUTH_ENABLED) return null;

  const token = String(req.headers['x-player-token'] || '');
  if (!TOKEN_RE.test(token)) return null;
  return { account: ensureLegacyAccount(token), mode: 'legacy' };
}
