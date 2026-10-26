// 通知接口：只做 HTTP 适配（读取查询/请求体、转响应），归档策略与偏好校验由领域服务负责。
import { NotificationsService } from '../services/notifications-service.mjs';

export class NotificationRoutes {
  constructor({ service = new NotificationsService() } = {}) {
    this.service = service;
  }

  register(router) {
    router.add('GET', '/api/notifications', (ctx) => this.list(ctx));
    router.add('POST', '/api/notifications/read', (ctx) => this.readAll(ctx));
    router.add('GET', '/api/notifications/prefs', (ctx) => this.getPrefs(ctx));
    router.add('PUT', '/api/notifications/prefs', (ctx) => this.savePrefs(ctx));
  }

  list(ctx) {
    return this.respond(ctx, this.service.list(ctx.token, ctx.url.searchParams));
  }

  async readAll(ctx) {
    const body = await ctx.readJson();
    return this.respond(ctx, this.service.readAll(ctx.token, body));
  }

  getPrefs(ctx) {
    return this.respond(ctx, this.service.getPrefs(ctx.token));
  }

  async savePrefs(ctx) {
    const body = await ctx.readJson();
    return this.respond(ctx, this.service.savePrefs(ctx.token, body));
  }

  respond(ctx, result) {
    if (!result.ok) return ctx.fail(result.status, result.message, result.code);
    return ctx.json(200, result.body);
  }
}
