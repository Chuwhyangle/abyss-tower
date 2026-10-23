// 成就接口：返回全部成就定义与当前账号的解锁状态。
import { achievementSummary } from '../db/achievements.mjs';

export class AchievementRoutes {
  register(router) {
    router.add('GET', '/api/achievements', (ctx) => this.list(ctx));
  }

  list(ctx) {
    return ctx.json(200, achievementSummary(ctx.token));
  }
}
