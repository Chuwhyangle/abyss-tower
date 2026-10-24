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
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    meta: parseMeta(row.meta_json),
    createdAt: row.created_at,
  }));
}
