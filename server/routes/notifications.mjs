// 通知接口：读取本人最近通知与未读数，一键全部已读。
import { markAllRead, notificationSummary } from '../db/notifications.mjs';

export class NotificationRoutes {
  register(router) {
    router.add('GET', '/api/notifications', (ctx) => this.list(ctx));
    router.add('POST', '/api/notifications/read', (ctx) => this.readAll(ctx));
  }

  list(ctx) {
    return ctx.json(200, notificationSummary(ctx.token));
  }

  readAll(ctx) {
    return ctx.json(200, markAllRead(ctx.token));
  }
}
