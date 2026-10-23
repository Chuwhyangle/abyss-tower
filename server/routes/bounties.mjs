// 悬赏接口：读取当前周期的目标与进度，领取完成的目标，每周刷新一次。
import { bountySummary, claimBounty, refreshBounties } from '../db/bounties.mjs';

export class BountyRoutes {
  register(router) {
    router.add('GET', '/api/bounties', (ctx) => this.list(ctx));
    router.add('POST', '/api/bounties/refresh', (ctx) => this.refresh(ctx));
    router.add('POST', '/api/bounties/:id/claim', (ctx, params) => this.claim(ctx, params));
  }

  list(ctx) {
    return ctx.json(200, bountySummary(ctx.token));
  }

  refresh(ctx) {
    const result = refreshBounties(ctx.token);
    if (!result.ok) {
      if (result.code === 'REFRESH_LIMIT') {
        return ctx.fail(409, '本周刷新次数已用完', 'REFRESH_LIMIT');
      }
      return ctx.fail(400, '无法刷新悬赏', result.code || 'BOUNTY_REFRESH_FAILED');
    }
    return ctx.json(200, result);
  }

  claim(ctx, { id }) {
    const result = claimBounty(ctx.token, id);
    if (!result.ok) {
      if (result.code === 'UNKNOWN_BOUNTY') {
        return ctx.fail(404, '悬赏不存在', 'UNKNOWN_BOUNTY');
      }
      if (result.code === 'BOUNTY_INCOMPLETE') {
        return ctx.fail(400, '悬赏目标尚未完成', 'BOUNTY_INCOMPLETE');
      }
      return ctx.fail(400, '无法领取该悬赏', result.code || 'BOUNTY_CLAIM_FAILED');
    }
    return ctx.json(200, result);
  }
}
