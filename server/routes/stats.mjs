// 生涯统计接口：只返回当前登录账号的聚合结果。
import { careerStats } from '../db/stats.mjs';

export class StatsRoutes {
  register(router) {
    router.add('GET', '/api/stats', (ctx) => ctx.json(200, careerStats(ctx.token)));
  }
}
