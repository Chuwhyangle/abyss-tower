// 解锁商店接口：扣除星核并写入解锁项。
import { updateProfile } from '../db.mjs';
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
    const updated = updateProfile(token, {
      cores: profile.cores - unlock.cost,
      unlocks: [...profile.unlocks, unlock.id],
    });
    recordPlayerEvent(token, 'unlock_bought', {
      unlockId: unlock.id,
      cost: unlock.cost,
    });
    return ctx.json(200, { profile: updated });
  }
}
