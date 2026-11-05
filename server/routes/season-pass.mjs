// 赛季通行证接口：只做 HTTP 适配（读取查询/请求体、转响应），赛季窗口与领取规则由领域服务负责。
import { SeasonPassService } from '../services/season-pass-service.mjs';

export class SeasonPassRoutes {
  constructor({ service = new SeasonPassService() } = {}) {
    this.service = service;
  }

  register(router) {
    router.add('GET', '/api/season-pass', (ctx) => this.list(ctx));
    router.add('POST', '/api/season-pass/claim', (ctx) => this.claim(ctx));
    router.add('POST', '/api/season-pass/claim-all', (ctx) => this.claimAll(ctx));
    router.add('POST', '/api/season-pass/shop', (ctx) => this.shop(ctx));
  }

  list(ctx) {
    return this.respond(
      ctx,
      this.service.listSeasonPass(ctx.token, {
        season: ctx.url?.searchParams?.get('season') ?? null,
      })
    );
  }

  async claim(ctx) {
    const body = (await ctx.readJson()) || {};
    return this.respond(
      ctx,
      this.service.claimSeasonPassMilestone(ctx.token, {
        season: body.season,
        milestoneId: body.id ?? body.milestoneId ?? null,
      })
    );
  }

  async claimAll(ctx) {
    const body = (await ctx.readJson()) || {};
    return this.respond(
      ctx,
      this.service.claimAllSeasonPassMilestones(ctx.token, { season: body.season })
    );
  }

  async shop(ctx) {
    const body = (await ctx.readJson()) || {};
    return this.respond(
      ctx,
      this.service.buySeasonShopOffer(ctx.token, {
        offerId: body.offerId ?? body.id ?? null,
        season: body.season,
      })
    );
  }

  respond(ctx, result) {
    if (!result.ok) return ctx.fail(result.status, result.message, result.code);
    return ctx.json(200, result.body);
  }
}
