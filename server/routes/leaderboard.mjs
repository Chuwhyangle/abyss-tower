// 排行榜接口：分页、难度筛选与当前账号排名。
import { AUTH_ENABLED } from '../config.mjs';
import { DIFFICULTIES } from '../../public/js/shared/data.js';
import {
  MAX_BOARD_PAGE_SIZE,
  accountBoardSummary,
  countBoard,
  listBoard,
} from '../db/leaderboard.mjs';
import { today } from './support.mjs';

const DEFAULT_SIZE = 20;

function boundedInt(raw, fallback, max) {
  const parsed = Math.floor(Number(raw));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, parsed));
}

export class LeaderboardRoutes {
  register(router) {
    router.add('GET', '/api/leaderboard', (ctx) => {
      const params = ctx.url.searchParams;
      const mode = params.get('mode') === 'daily' ? 'daily' : 'normal';
      const day = params.get('day') || today();
      const page = boundedInt(params.get('page'), 1, Number.MAX_SAFE_INTEGER);
      const size = boundedInt(params.get('size'), DEFAULT_SIZE, MAX_BOARD_PAGE_SIZE);
      const requested = params.get('difficulty');
      const difficulty =
        requested && Object.hasOwn(DIFFICULTIES, requested) ? requested : null;
      const includeUnclaimed = !AUTH_ENABLED;
      const offset = (page - 1) * size;

      const entries = listBoard(mode, day, {
        includeUnclaimed,
        limit: size,
        offset,
        difficulty,
        accountId: ctx.token,
      });
      const total = countBoard(mode, day, { includeUnclaimed, difficulty });
      const me = accountBoardSummary(ctx.token, mode, day, {
        includeUnclaimed,
        difficulty,
      });

      return ctx.json(200, {
        mode,
        day,
        page,
        size,
        difficulty,
        total,
        totalPages: Math.max(1, Math.ceil(total / size)),
        entries,
        me,
      });
    });
  }
}
