// 通知领域服务：读取前的归档策略、分页归一、偏好载荷校验与批量已读语义都在这里；
// 通知表读写与偏好归一化仍由仓储层（server/db/notifications.mjs）提供。
import {
  DEFAULT_NOTIFICATION_PAGE,
  MAX_NOTIFICATION_PAGE,
  NOTIFICATION_READ_BATCH_SIZE,
  archiveOld,
  list as listNotifications,
  markAllRead,
  markReadBatch,
  readPrefs,
  writePrefs,
} from '../db/notifications.mjs';

function boundedInt(raw, fallback, max) {
  const parsed = Math.floor(Number(raw));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, parsed));
}

function failure(status, message, code) {
  return { ok: false, status, message, code };
}

export class NotificationsService {
  // 通知列表：读取前顺手压缩 90 天前的明细；归档失败绝不能阻断列表读取。
  list(accountId, params) {
    try {
      archiveOld(accountId);
    } catch {
      /* 归档失败时保留明细，下次读取会重试 */
    }
    const page = listNotifications(accountId, {
      cursor: params.get('cursor'),
      limit: boundedInt(params.get('limit'), DEFAULT_NOTIFICATION_PAGE, MAX_NOTIFICATION_PAGE),
    });
    // 非法/跨账号游标直接拒绝，不回退首页，避免看起来翻页成功却读错数据。
    if (!page) return failure(400, '非法游标', 'INVALID_CURSOR');
    return { ok: true, body: page };
  }

  // 默认只处理一批（响应带 remaining 供客户端续批）；all=true 时循环到未读清零。
  readAll(accountId, body) {
    if (body?.all === true) return { ok: true, body: markAllRead(accountId) };
    const result = markReadBatch(accountId, NOTIFICATION_READ_BATCH_SIZE);
    return { ok: true, body: { ok: true, ...result, unread: result.remaining } };
  }

  getPrefs(accountId) {
    return { ok: true, body: { prefs: readPrefs(accountId) } };
  }

  // 接受 { prefs: {...} } 或直接的对象；非法值回退默认并随响应返回 ignored 列表。
  savePrefs(accountId, body) {
    const raw = body?.prefs ?? body;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return failure(400, '通知偏好格式无效', 'INVALID_NOTIFICATION_PREFS');
    }
    const result = writePrefs(accountId, raw);
    return { ok: true, body: { prefs: result.prefs, ignored: result.invalid } };
  }
}
