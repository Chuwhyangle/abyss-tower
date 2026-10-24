// 敏感操作审计：写入 best-effort（失败只记日志，不影响主流程），查询只返回本人记录。
import { db } from './index.mjs';

// action 枚举的唯一来源；新增动作必须先在这里登记。
export const AUDIT_ACTIONS = Object.freeze({
  ACCOUNT_DELETE: 'account_delete',
  PASSWORD_CHANGE: 'password_change',
  SESSIONS_REVOKE_OTHERS: 'sessions_revoke_others',
  SEASON_SETTLE: 'season_settle',
});

const ACTION_VALUES = new Set(Object.values(AUDIT_ACTIONS));

export const AUDIT_PAGE_SIZE = 50;

// 导出按游标分页读取，避免一次性把长期积累的审计记录全部载入内存。
export const AUDIT_EXPORT_PAGE_SIZE = 200;
export const AUDIT_EXPORT_MAX_PAGE = 1000;

const REDACTED = '[redacted]';
// 凭据类字段无论写在 meta 的哪一层都不落库、不返回。
const SENSITIVE_KEY =
  /(password|passwd|token|secret|hash|cookie|authorization|session|credential|recovery)/i;
const MAX_DEPTH = 4;
const MAX_STRING = 500;
const MAX_ARRAY = 50;

export function isAuditAction(action) {
  return ACTION_VALUES.has(action);
}

// 递归脱敏：命中敏感字段名的值整体替换，深度/长度/数组长度都有上界，防止 meta 膨胀。
export function sanitizeAuditMeta(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= MAX_DEPTH) return REDACTED;
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY)
      .map((item) => sanitizeAuditMeta(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : sanitizeAuditMeta(item, depth + 1);
    }
    return out;
  }
  return null;
}

// 返回是否写入成功；任何异常都在这里吞掉，调用方的主流程不受影响。
export function recordAudit(accountId, action, meta = {}, now = Date.now()) {
  if (!accountId || !isAuditAction(action)) {
    console.error(`[audit] 忽略无效写入：action=${action}`);
    return false;
  }
  let payload = '{}';
  try {
    payload = JSON.stringify(sanitizeAuditMeta(meta ?? {}));
  } catch (error) {
    console.error(`[audit] meta 序列化失败（${action}）：${error.message}`);
  }
  try {
    db.prepare(
      'INSERT INTO audit_log (account_id, action, meta_json, created_at) VALUES (?, ?, ?, ?)'
    ).run(accountId, action, payload, now);
    return true;
  } catch (error) {
    console.error(`[audit] 写入失败（${action}）：${error.message}`);
    return false;
  }
}

function parseMeta(text) {
  try {
    return sanitizeAuditMeta(JSON.parse(text));
  } catch {
    return {};
  }
}

function mapRow(row) {
  return {
    id: row.id,
    action: row.action,
    meta: parseMeta(row.meta_json),
    createdAt: row.created_at,
  };
}

// 只按账号查询；limit 上限为 AUDIT_PAGE_SIZE，越界参数回落到默认值。
export function listAuditForAccount(accountId, limit = AUDIT_PAGE_SIZE) {
  if (!accountId) return [];
  const requested = Math.floor(Number(limit));
  const size = Number.isFinite(requested)
    ? Math.max(1, Math.min(AUDIT_PAGE_SIZE, requested))
    : AUDIT_PAGE_SIZE;
  const rows = db
    .prepare(
      `SELECT id, action, meta_json, created_at
         FROM audit_log
        WHERE account_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?`
    )
    .all(accountId, size);
  return rows.map(mapRow);
}

// 游标编码 (created_at, id)：两条记录同一毫秒时用 id 兜底，保证分页不重不漏。
export function encodeAuditCursor(entry) {
  const createdAt = Math.trunc(Number(entry?.createdAt));
  const id = Math.trunc(Number(entry?.id));
  if (!Number.isFinite(createdAt) || !Number.isFinite(id)) return null;
  return Buffer.from(`${createdAt}:${id}`, 'utf8').toString('base64url');
}

export function parseAuditCursor(value) {
  if (typeof value !== 'string' || value === '') return null;
  let text;
  try {
    text = Buffer.from(value, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const separator = text.indexOf(':');
  if (separator <= 0) return null;
  const createdAt = Number(text.slice(0, separator));
  const id = Number(text.slice(separator + 1));
  if (!Number.isInteger(createdAt) || createdAt < 0) return null;
  if (!Number.isInteger(id) || id < 0) return null;
  return { createdAt, id };
}

// 导出分页：按 created_at DESC, id DESC 稳定排序，返回本页与下一页游标。
export function exportRows(accountId, { limit = AUDIT_EXPORT_PAGE_SIZE, cursor = null } = {}) {
  if (!accountId) return { rows: [], nextCursor: null };
  const requested = Math.floor(Number(limit));
  const size = Number.isFinite(requested)
    ? Math.max(1, Math.min(AUDIT_EXPORT_MAX_PAGE, requested))
    : AUDIT_EXPORT_PAGE_SIZE;
  const after = typeof cursor === 'string' ? parseAuditCursor(cursor) : cursor;
  const sql = after
    ? `SELECT id, action, meta_json, created_at
         FROM audit_log
        WHERE account_id = ?
          AND (created_at < ? OR (created_at = ? AND id < ?))
        ORDER BY created_at DESC, id DESC
        LIMIT ?`
    : `SELECT id, action, meta_json, created_at
         FROM audit_log
        WHERE account_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?`;
  const rows = after
    ? db.prepare(sql).all(accountId, after.createdAt, after.createdAt, after.id, size)
    : db.prepare(sql).all(accountId, size);
  const entries = rows.map(mapRow);
  const nextCursor =
    rows.length === size ? encodeAuditCursor(entries[entries.length - 1]) : null;
  return { rows: entries, nextCursor };
}

// 逐页迭代全部本人记录；调用方可以边读边写，内存里只保留一页。
export function* auditExportPages(accountId, { pageSize = AUDIT_EXPORT_PAGE_SIZE } = {}) {
  let cursor = null;
  while (true) {
    const { rows, nextCursor } = exportRows(accountId, { limit: pageSize, cursor });
    yield rows;
    if (!nextCursor) return;
    cursor = nextCursor;
  }
}

// 导出时额外屏蔽 IP 类字段（写入侧未记录这些字段，导出侧仍做兜底）。
const EXPORT_BLOCKED_KEY = /^(ip|ip_?addr(ess)?|client_?ip|remote_?addr|ip_?hash)$/i;

function scrubExportMeta(value, depth = 0) {
  if (value == null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => scrubExportMeta(item, depth + 1));
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] =
      SENSITIVE_KEY.test(key) || EXPORT_BLOCKED_KEY.test(key)
        ? REDACTED
        : scrubExportMeta(item, depth + 1);
  }
  return out;
}

function isoOrEmpty(ms) {
  const date = new Date(Number(ms));
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

export function toAuditExportEntry(entry) {
  return {
    id: entry.id,
    action: entry.action,
    createdAt: entry.createdAt,
    createdAtIso: isoOrEmpty(entry.createdAt),
    meta: scrubExportMeta(entry.meta),
  };
}

export const AUDIT_CSV_COLUMNS = Object.freeze([
  'id',
  'action',
  'createdAt',
  'createdAtIso',
  'meta',
]);

// RFC 4180：逗号/引号/换行出现时整体加引号并转义引号；同时中和表格公式注入。
function csvCell(value) {
  let text = value == null ? '' : String(value);
  if (/^[=+@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function auditCsvHeader() {
  return `${AUDIT_CSV_COLUMNS.join(',')}\r\n`;
}

export function auditCsvRow(entry) {
  const exported = toAuditExportEntry(entry);
  const values = [
    exported.id,
    exported.action,
    exported.createdAt,
    exported.createdAtIso,
    JSON.stringify(exported.meta),
  ];
  return `${values.map(csvCell).join(',')}\r\n`;
}
