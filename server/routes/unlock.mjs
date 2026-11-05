// 解锁商店接口：事务内条件扣费 + 幂等授予。
// 不再走 updateProfile({ unlocks }) 的 DELETE-all 全量重写——那会清掉抽卡授予的塔（lost-update 地雷）。
import { purchaseUnlock, getProfile } from '../db.mjs';
import { recordPlayerEvent } from '../db/events.mjs';
import { UNLOCK_BY_ID } from '../../public/js/shared/data.js';

export class UnlockRoutes {
  register(router) {
    router.add('POST', '/api/unlock', (ctx) => this.unlock(ctx));
  }

  async unlock(ctx) {
    const token = ctx.token;
    const profile = ctx.profile;
    const body = await ctx.readJson();
    const unlock = UNLOCK_BY_ID[String(body.unlockId || '')];
    if (!unlock) return ctx.fail(404, '未知解锁项');
    if (profile.unlocks.includes(unlock.id)) return ctx.fail(409, '已经解锁');
    if (profile.cores < unlock.cost) return ctx.fail(400, '星核不足');
    const result = purchaseUnlock(token, unlock.id, unlock.cost);
    if (result.status === 'ALREADY_UNLOCKED') return ctx.fail(409, '已经解锁');
    if (result.status === 'INSUFFICIENT_CORES') return ctx.fail(400, '星核不足');
    recordPlayerEvent(token, 'unlock_bought', {
      unlockId: unlock.id,
      cost: unlock.cost,
    });
    return ctx.json(200, { profile: getProfile(token) });
  }
}
