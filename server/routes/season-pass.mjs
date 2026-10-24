// 赛季通行证接口：读取当前赛季积分轨道，领取已完成里程碑。
import {
  claimAllSeasonPassMilestones,
  claimSeasonPassMilestone,
  seasonPassSummary,
} from '../db/season_pass.mjs';

const FAILURE = {
  UNKNOWN_MILESTONE: [404, '里程碑不存在', 'UNKNOWN_MILESTONE'],
  SEASON_PASS_INCOMPLETE: [400, '赛季积分尚未达到该里程碑', 'SEASON_PASS_INCOMPLETE'],
  SEASON_UNAVAILABLE: [400, '当前赛季不可用', 'SEASON_UNAVAILABLE'],
};

export class SeasonPassRoutes {
  register(router) {
    router.add('GET', '/api/season-pass', (ctx) => this.list(ctx));
    router.add('POST', '/api/season-pass/claim', (ctx) => this.claim(ctx));
    router.add('POST', '/api/season-pass/claim-all', (ctx) => this.claimAll(ctx));
  }

  list(ctx) {
    return ctx.json(200, seasonPassSummary(ctx.token));
  }

  async claim(ctx) {
    const body = (await ctx.readJson()) || {};
    const milestoneId = body.id ?? body.milestoneId ?? null;
    const result = claimSeasonPassMilestone(ctx.token, milestoneId);
    if (!result.ok) {
      const [status, message, code] = FAILURE[result.code] || [400, '无法领取该里程碑', result.code];
      return ctx.fail(status, message, code);
    }
    return ctx.json(200, result);
  }

  claimAll(ctx) {
    const result = claimAllSeasonPassMilestones(ctx.token);
    if (!result.ok) {
      const [status, message, code] = FAILURE[result.code] || [400, '无法领取里程碑', result.code];
      return ctx.fail(status, message, code);
    }
    return ctx.json(200, result);
  }
}
