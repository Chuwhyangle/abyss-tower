// 通知中心持久化：只保留每账号最近 20 条，写入失败不阻断结算等主流程。
import { db } from './index.mjs';

export const NOTIFICATION_LIMIT = 20;

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

// 通知是附加反馈：缺表、约束冲突、锁等待等任何失败都只吞掉，返回 null。
// 同一 (kind, dedupeKey) 重复写入保持幂等，不会新增未读。
export function notify(accountId, { kind, dedupeKey, payload = {} }, now = Date.now()) {
  if (!accountId || !kind || !dedupeKey) return null;
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
