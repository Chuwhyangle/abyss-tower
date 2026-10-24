// 通知接口：读取本人通知（游标分页 + 归档摘要）、一键全部已读，以及通知偏好读写。
import {
  DEFAULT_NOTIFICATION_PAGE,
  MAX_NOTIFICATION_PAGE,
  archiveOld,
  list as listNotifications,
  markAllRead,
  readPrefs,
  writePrefs,
} from '../db/notifications.mjs';

function boundedInt(raw, fallback, max) {
  const parsed = Math.floor(Number(raw));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, parsed));
}

export class NotificationRoutes {
  register(router) {
    router.add('GET', '/api/notifications', (ctx) => this.list(ctx));
    router.add('POST', '/api/notifications/read', (ctx) => this.readAll(ctx));
    router.add('GET', '/api/notifications/prefs', (ctx) => this.getPrefs(ctx));
    router.add('PUT', '/api/notifications/prefs', (ctx) => this.savePrefs(ctx));
  }

  list(ctx) {
    // 读取前顺手压缩 90 天前的明细：幂等，且失败绝不能阻断通知列表。
    try {
      archiveOld(ctx.token);
    } catch {
      /* 归档失败时保留明细，下次读取会重试 */
    }
    const params = ctx.url.searchParams;
    const page = listNotifications(ctx.token, {
      cursor: params.get('cursor'),
      limit: boundedInt(params.get('limit'), DEFAULT_NOTIFICATION_PAGE, MAX_NOTIFICATION_PAGE),
    });
    // 非法/跨账号游标直接拒绝，不回退首页，避免看起来翻页成功却读错数据。
    if (!page) return ctx.fail(400, '非法游标', 'INVALID_CURSOR');
    return ctx.json(200, page);
  }

  readAll(ctx) {
    return ctx.json(200, markAllRead(ctx.token));
  }

  getPrefs(ctx) {
    return ctx.json(200, { prefs: readPrefs(ctx.token) });
  }

  // 接受 { prefs: {...} } 或直接的对象；非法值回退默认并随响应返回 ignored 列表。
  async savePrefs(ctx) {
    const body = await ctx.readJson();
    const raw = body?.prefs ?? body;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return ctx.fail(400, '通知偏好格式无效', 'INVALID_NOTIFICATION_PREFS');
    }
    const result = writePrefs(ctx.token, raw);
    return ctx.json(200, { prefs: result.prefs, ignored: result.invalid });
  }
}
