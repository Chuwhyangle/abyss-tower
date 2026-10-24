// 公开接口：健康检查、运行配置与只读诊断（无需登录）。
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AUTH_ENABLED, CONTENT_VERSION, REGISTRATION_MODE } from '../config.mjs';
import { db } from '../db/index.mjs';
import { DIAGNOSTICS_LIMIT, errorLog } from '../http/error-log.mjs';

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '../db/migrations');
const ERROR_WINDOW_MS = 24 * 60 * 60 * 1000;

const require = createRequire(import.meta.url);
const APP_VERSION = (() => {
  try {
    const version = require('../../package.json').version;
    return typeof version === 'string' && version ? version : null;
  } catch {
    return null;
  }
})();

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

// 状态摘要的每一项都独立降级：某个数据源不可用时只输出 null，整体仍然可读。
function attempt(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function countMigrationFiles() {
  return attempt(
    () =>
      fs.readdirSync(MIGRATIONS_DIR).filter((file) => /^\d+_.*\.mjs$/.test(file)).length
  );
}

function readDatabaseSize(database) {
  return (
    attempt(() => {
      const pageCount = Number(database.prepare('PRAGMA page_count').get()?.page_count);
      const pageSize = Number(database.prepare('PRAGMA page_size').get()?.page_size);
      if (!Number.isFinite(pageCount) || !Number.isFinite(pageSize)) return null;
      return pageCount * pageSize;
    }) ?? null
  );
}

function readMigrationStats(database, total) {
  const stats = {
    applied: null,
    latestVersion: null,
    latestAppliedAt: null,
    total: Number.isInteger(total) ? total : null,
    pending: null,
  };
  attempt(() => {
    const row = database
      .prepare(
        'SELECT COUNT(*) AS applied, MAX(version) AS latest, MAX(applied_at) AS applied_at FROM schema_migrations'
      )
      .get();
    if (!row) return;
    const applied = Number(row.applied);
    const latest = Number(row.latest);
    const appliedAt = Number(row.applied_at);
    if (Number.isFinite(applied)) stats.applied = applied;
    if (Number.isInteger(latest)) stats.latestVersion = latest;
    if (Number.isFinite(appliedAt)) stats.latestAppliedAt = appliedAt;
  });
  if (stats.applied != null && stats.total != null) {
    stats.pending = Math.max(0, stats.total - stats.applied);
  }
  return stats;
}

function countActiveRuns(database) {
  return (
    attempt(() => {
      const row = database
        .prepare("SELECT COUNT(*) AS active FROM runs WHERE status = 'active'")
        .get();
      const active = Number(row?.active);
      return Number.isFinite(active) ? active : null;
    }) ?? null
  );
}

function countRecentErrors(log, now) {
  return (
    attempt(() => {
      const entries = log.recent(log.capacity);
      if (!Array.isArray(entries)) return null;
      const cutoff = now - ERROR_WINDOW_MS;
      return entries.filter((entry) => Number.isFinite(entry?.time) && entry.time >= cutoff)
        .length;
    }) ?? null
  );
}

// 运行状态摘要：只读、上限受控（COUNT 与定长环形缓冲），不输出账号、令牌或文件路径。
export function collectSystemStatus({
  database = db,
  log = errorLog,
  now = Date.now(),
  migrationsTotal = countMigrationFiles(),
} = {}) {
  const generatedAt = Number.isFinite(now) ? Math.trunc(now) : Date.now();
  return {
    ok: true,
    generatedAt,
    version: APP_VERSION,
    contentVersion: CONTENT_VERSION,
    database: {
      sizeBytes: readDatabaseSize(database),
      migrations: readMigrationStats(database, migrationsTotal),
    },
    activeRuns: countActiveRuns(database),
    errors: { last24h: countRecentErrors(log, generatedAt) },
  };
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
    router.add('GET', '/api/system/status', (ctx) => {
      if (!canViewDiagnostics(ctx.req)) {
        return ctx.fail(403, '无权访问诊断信息', 'FORBIDDEN');
      }
      return ctx.json(200, collectSystemStatus());
    });
  }
}
