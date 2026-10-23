// 排行榜接口。
import { AUTH_ENABLED } from '../config.mjs';
import { listBoard } from '../db/leaderboard.mjs';
import { today } from './support.mjs';

export class LeaderboardRoutes {
  register(router) {
    router.add('GET', '/api/leaderboard', (ctx) => {
      const mode = ctx.url.searchParams.get('mode') === 'daily' ? 'daily' : 'normal';
      const day = ctx.url.searchParams.get('day') || today();
      return ctx.json(200, {
        mode,
        day,
        entries: listBoard(mode, day, {
          includeUnclaimed: !AUTH_ENABLED,
          limit: 20,
        }),
      });
    });
  }
}
