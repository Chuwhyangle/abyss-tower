// 通知中心持久化：只保留每账号最近 20 条，写入失败不阻断结算等主流程。
import { db } from './index.mjs';

export const NOTIFICATION_LIMIT = 20;

// 通知偏好：成就 / 悬赏 / 赛季三类，默认全部接收。
export const NOTIFICATION_KINDS = ['achievement', 'bounty', 'season'];
export const DEFAULT_NOTIFICATION_PREFS = Object.freeze({
  achievement: true,
  bounty: true,
  season: true,
});
const PREFS_NAMESPACE = 'notifications';
const PREFS_KEY = 'prefs';

function parsePayload(text) {
  try {
    return JSON.parse(text || '{}') ?? {};
  } catch {
    return {};
  }
}

// 超过上限时删除最旧的记录；同毫秒写入用 id 作为稳定次序。
function prune(accountId) {
  db.prepare(
    `DELETE FROM account_notifications
      WHERE account_id = ?
        AND id NOT IN (
          SELECT id FROM account_notifications
           WHERE account_id = ?
           ORDER BY created_at DESC, id DESC
           LIMIT ?
        )`
  ).run(accountId, accountId, NOTIFICATION_LIMIT);
}

// 只接受已知类型 + 布尔值；非法项回退该类型默认值并记录警告，未知字段忽略。
export function normalizePrefs(raw, warn = console.warn) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const prefs = {};
  const invalid = [];
  for (const [key, value] of Object.entries(source)) {
    if (!NOTIFICATION_KINDS.includes(key)) {
      invalid.push(key);
      if (typeof warn === 'function') {
        warn(`[notifications] 忽略未知偏好 ${key}`);
      }
      continue;
    }
    if (typeof value !== 'boolean') {
      invalid.push(key);
      prefs[key] = DEFAULT_NOTIFICATION_PREFS[key];
      if (typeof warn === 'function') {
        warn(
          `[notifications] 偏好 ${key}=${JSON.stringify(value)} 非法，回退默认 ${DEFAULT_NOTIFICATION_PREFS[key]}`
        );
      }
      continue;
    }
    prefs[key] = value;
  }
  return { prefs, invalid };
}

// 读取偏好：无记录、数据损坏或查询失败都回退默认全开，保证主流程不受影响。
export function readPrefs(accountId) {
  if (!accountId) return { ...DEFAULT_NOTIFICATION_PREFS };
  try {
    const row = db
      .prepare(
        'SELECT value_json FROM player_kv WHERE account_id = ? AND namespace = ? AND key = ?'
      )
      .get(accountId, PREFS_NAMESPACE, PREFS_KEY);
    if (!row) return { ...DEFAULT_NOTIFICATION_PREFS };
    let parsed;
    try {
      parsed = JSON.parse(row.value_json);
    } catch {
      parsed = null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      console.warn('[notifications] 偏好数据损坏，已回退默认值');
      return { ...DEFAULT_NOTIFICATION_PREFS };
    }
    return { ...DEFAULT_NOTIFICATION_PREFS, ...normalizePrefs(parsed).prefs };
  } catch {
    return { ...DEFAULT_NOTIFICATION_PREFS };
  }
}

// 合并写入：只更新给出的类型，非法值回退默认；返回最终偏好与被忽略的字段。
export function writePrefs(accountId, patch, now = Date.now()) {
  const { prefs: incoming, invalid } = normalizePrefs(patch);
  const prefs = { ...readPrefs(accountId), ...incoming };
  try {
    db.prepare(
      `INSERT INTO player_kv (account_id, namespace, key, value_json, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(account_id, namespace, key) DO UPDATE SET
         value_json = excluded.value_json, updated_at = excluded.updated_at`
    ).run(accountId, PREFS_NAMESPACE, PREFS_KEY, JSON.stringify(prefs), now);
  } catch {
    // 偏好写入失败不应阻断通知本身；内存中的默认值仍然生效。
  }
  return { prefs, invalid };
}

function isKindEnabled(accountId, kind) {
  if (!NOTIFICATION_KINDS.includes(kind)) return true;
  return readPrefs(accountId)[kind] !== false;
}

// 通知是附加反馈：缺表、约束冲突、锁等待等任何失败都只吞掉，返回 null。
// 同一 (kind, dedupeKey) 重复写入保持幂等，不会新增未读。
export function notify(accountId, { kind, dedupeKey, payload = {} }, now = Date.now()) {
  if (!accountId || !kind || !dedupeKey) return null;
  // 关闭的类型只停止产生新的未读，历史记录保持可读。
  if (!isKindEnabled(accountId, kind)) return null;
  try {
    const result = db
      .prepare(
        `INSERT INTO account_notifications
           (account_id, kind, dedupe_key, payload, created_at, read_at)
         VALUES (?, ?, ?, ?, ?, NULL)
         ON CONFLICT(account_id, kind, dedupe_key) DO NOTHING`
      )
      .run(accountId, kind, dedupeKey, JSON.stringify(payload ?? {}), now);
    if (result.changes !== 1) return null;
    prune(accountId);
    return { kind, dedupeKey };
  } catch {
    return null;
  }
}

// 返回最近 20 条与未读数；只按 account_id 查询，天然隔离他人记录。
export function notificationSummary(accountId) {
  const rows = db
    .prepare(
      `SELECT id, kind, payload, created_at, read_at
         FROM account_notifications
        WHERE account_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?`
    )
    .all(accountId, NOTIFICATION_LIMIT);
  const unreadRow = db
    .prepare(
      `SELECT COUNT(*) AS c FROM account_notifications
        WHERE account_id = ? AND read_at IS NULL`
    )
    .get(accountId);
  return {
    unread: Number(unreadRow?.c) || 0,
    items: rows.map((row) => ({
      id: Number(row.id),
      kind: row.kind,
      payload: parsePayload(row.payload),
      createdAt: Number(row.created_at),
      readAt: row.read_at == null ? null : Number(row.read_at),
    })),
  };
}

// 全部标记已读：只影响本人未读记录，返回实际更新条数。
export function markAllRead(accountId, now = Date.now()) {
  const result = db
    .prepare(
      `UPDATE account_notifications SET read_at = ?
        WHERE account_id = ? AND read_at IS NULL`
    )
    .run(now, accountId);
  return { ok: true, updated: Number(result.changes) || 0, unread: 0 };
}
