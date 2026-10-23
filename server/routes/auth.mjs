// 认证路由适配器：把既有 handleAuthRoute 挂到 /api/auth/ 前缀。
import { handleAuthRoute } from '../auth/routes.mjs';
import { json, fail, readJson } from '../http/respond.mjs';

export class AuthRoutes {
  register(router) {
    router.add(null, /^\/api\/auth\//, async (ctx) => {
      const handled = await handleAuthRoute(ctx.req, ctx.res, ctx.url, { json, fail, readJson });
      return handled !== false;
    });
  }
}
