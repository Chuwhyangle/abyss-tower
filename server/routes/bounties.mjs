// 悬赏接口：读取当前周期的目标与进度，领取完成的目标。
import { bountySummary, claimBounty } from '../db/bounties.mjs';

export class BountyRoutes {
  register(router) {
    router.add('GET', '/api/bounties', (ctx) => this.list(ctx));
    router.add('POST', '/api/bounties/:id/claim', (ctx, params) => this.claim(ctx, params));
  }

  list(ctx) {
    return ctx.json(200, bountySummary(ctx.token));
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
