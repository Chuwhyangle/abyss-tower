// 运行配置：账号体系开关与内容版本。
// AUTH_ENABLED=0 时回退到旧的 x-player-token 匿名模式，便于回滚。
export const AUTH_ENABLED = process.env.AUTH_ENABLED !== '0';
export const REGISTRATION_MODE =
  process.env.REGISTRATION_MODE === 'closed' ? 'closed' : 'open';
export const CONTENT_VERSION = process.env.CONTENT_VERSION || 'v1.13.0';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 90 * 24 * 60 * 60 * 1000;
export const COOKIE_NAME = 'at_session';
export const HOST_COOKIE_NAME = '__Host-at_session';
export const COOKIE_MAX_AGE_SECONDS = Math.floor(SESSION_TTL_MS / 1000);
