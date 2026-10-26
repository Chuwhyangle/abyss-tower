// 排行榜接口：只做 HTTP 适配（解析查询、转响应），请求归一与复核说明由领域服务负责。
import { LeaderboardService } from '../services/leaderboard-service.mjs';

export class LeaderboardRoutes {
  constructor({ service = new LeaderboardService() } = {}) {
    this.service = service;
  }

  register(router) {
    router.add('GET', '/api/leaderboard', (ctx) => this.board(ctx));
    // 个人赛季结算结果：只暴露本人名次与奖励，结算本身由 CLI 显式触发。
    router.add('GET', '/api/leaderboard/seasons/:season/result', (ctx, params) =>
      this.seasonResult(ctx, params)
    );
  }

  board(ctx) {
    const result = this.service.board(ctx.url.searchParams, { accountId: ctx.token });
    if (!result.ok) return ctx.fail(result.status, result.message, result.code);
    return ctx.json(200, result.body);
  }

  seasonResult(ctx, params) {
    const result = this.service.seasonResult(ctx.token, params?.season);
    if (!result.ok) return ctx.fail(result.status, result.message, result.code);
    return ctx.json(200, result.body);
  }
}
