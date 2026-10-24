// 通知接口：读取本人最近通知与未读数，一键全部已读，以及通知偏好读写。
import { markAllRead, notificationSummary, readPrefs, writePrefs } from '../db/notifications.mjs';

export class NotificationRoutes {
  register(router) {
    router.add('GET', '/api/notifications', (ctx) => this.list(ctx));
    router.add('POST', '/api/notifications/read', (ctx) => this.readAll(ctx));
    router.add('GET', '/api/notifications/prefs', (ctx) => this.getPrefs(ctx));
    router.add('PUT', '/api/notifications/prefs', (ctx) => this.savePrefs(ctx));
  }

  list(ctx) {
    return ctx.json(200, notificationSummary(ctx.token));
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
