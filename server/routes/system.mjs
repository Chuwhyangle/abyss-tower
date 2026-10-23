// 公开接口：健康检查与运行配置（无需登录）。
import { AUTH_ENABLED, CONTENT_VERSION, REGISTRATION_MODE } from '../config.mjs';

export class HealthRoutes {
  register(router) {
    // 原有行为：任意方法都返回健康状态。
    router.add(null, '/api/health', (ctx) =>
      ctx.json(200, { ok: true, uptime: Math.round(process.uptime()) })
    );
  }
}

export class ConfigRoutes {
  register(router) {
    router.add('GET', '/api/config', (ctx) =>
      ctx.json(200, {
        authEnabled: AUTH_ENABLED,
        registrationMode: REGISTRATION_MODE,
        contentVersion: CONTENT_VERSION,
      })
    );
  }
}
