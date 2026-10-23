// 公开接口：健康检查、运行配置与只读诊断（无需登录）。
import crypto from 'node:crypto';

import { AUTH_ENABLED, CONTENT_VERSION, REGISTRATION_MODE } from '../config.mjs';
import { DIAGNOSTICS_LIMIT, errorLog } from '../http/error-log.mjs';

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function remoteAddress(req) {
  return String(req?.socket?.remoteAddress || req?.connection?.remoteAddress || '');
}

export function isLoopbackRequest(req) {
  return LOOPBACK_ADDRESSES.has(remoteAddress(req));
}

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

// 管理员凭据：配置 DIAGNOSTICS_ADMIN_TOKEN 后，非回环请求需带匹配的
// x-diagnostics-token 头。与认证体系解耦，避免改动登录/会话逻辑。
export function hasAdminToken(req, expected = process.env.DIAGNOSTICS_ADMIN_TOKEN) {
  if (!expected) return false;
  const provided = req?.headers?.['x-diagnostics-token'];
  if (typeof provided !== 'string' || !provided) return false;
  const left = digest(provided);
  const right = digest(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function canViewDiagnostics(req, expectedToken) {
  try {
    return isLoopbackRequest(req) || hasAdminToken(req, expectedToken);
  } catch {
    return false;
  }
}

export class HealthRoutes {
  register(router) {
    // 原有行为：任意方法都返回健康状态。
    router.add(null, '/api/health', (ctx) =>
      ctx.json(200, { ok: true, uptime: Math.round(process.uptime()) })
    );
  }
}

export class ConfigRoutes {
  register(router) {
    router.add('GET', '/api/config', (ctx) =>
      ctx.json(200, {
        authEnabled: AUTH_ENABLED,
        registrationMode: REGISTRATION_MODE,
        contentVersion: CONTENT_VERSION,
      })
    );
  }
}

export class DiagnosticsRoutes {
  register(router) {
    router.add('GET', '/api/system/diagnostics', (ctx) => {
      if (!canViewDiagnostics(ctx.req)) {
        return ctx.fail(403, '无权访问诊断信息', 'FORBIDDEN');
      }
      return ctx.json(200, {
        ok: true,
        generatedAt: Date.now(),
        capacity: errorLog.capacity,
        count: errorLog.size,
        errors: errorLog.recent(DIAGNOSTICS_LIMIT),
      });
    });
  }
}
