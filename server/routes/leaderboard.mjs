// 排行榜接口：分页、难度筛选与当前账号排名。
import { AUTH_ENABLED } from '../config.mjs';
import { DIFFICULTIES } from '../../public/js/shared/data.js';
import {
  mutationKey,
  mutationScoreMul,
  mutationSummary,
  validateMutationSelection,
} from '../../public/js/shared/mutations.js';
import { dayKey, isWeekKey, weekKey } from '../../public/js/shared/scoring.js';
import {
  MAX_BOARD_PAGE_SIZE,
  accountBoardSummary,
  countBoard,
  isSeasonKey,
  listBoard,
  listSeasons,
  seasonBounds,
  seasonOf,
  seasonResultFor,
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
      const requestedMode = params.get('mode');
      const mode =
        requestedMode === 'daily'
          ? 'daily'
          : requestedMode === 'weekly'
            ? 'weekly'
            : requestedMode === 'endless'
              ? 'endless'
              : requestedMode === 'mutated'
                ? 'mutated'
                : 'normal';
      // 变异榜：组合非法直接拒绝，不做静默回退，避免查到错误的榜。
      let mutationIds = null;
      if (mode === 'mutated') {
        const selection = validateMutationSelection(params.get('mutations'));
        if (!selection.ok) return ctx.fail(400, selection.error, 'INVALID_MUTATION_COMBO');
        mutationIds = selection.ids;
      }
      // 周榜的 day 维度是 ISO 周键；变异榜是规范化组合；非法或缺失时回退当前维度。
      const requestedDay = params.get('day');
      const day =
        mode === 'mutated'
          ? mutationKey(mutationIds)
          : mode === 'weekly'
            ? (isWeekKey(requestedDay) ? requestedDay : weekKey())
            : requestedDay || today();
      const page = boundedInt(params.get('page'), 1, Number.MAX_SAFE_INTEGER);
      const size = boundedInt(params.get('size'), DEFAULT_SIZE, MAX_BOARD_PAGE_SIZE);
      const requested = params.get('difficulty');
      const difficulty =
        requested && Object.hasOwn(DIFFICULTIES, requested) ? requested : null;
      const includeUnclaimed = !AUTH_ENABLED;
      const offset = (page - 1) * size;

      // 赛季默认当前自然月；非法参数回退当前赛季，不报错。
      // mode=endless 与普通榜共用赛季参数：赛季既是查询区间，也是榜单 key（endless:<season>）。
      const currentSeason = seasonOf();
      const requestedSeason = params.get('season');
      const season = isSeasonKey(requestedSeason) ? requestedSeason : currentSeason;
      const bounds = seasonBounds(season);
      const seasonList = new Set(listSeasons());
      seasonList.add(currentSeason);
      seasonList.add(season);

      const entries = listBoard(mode, day, {
        includeUnclaimed,
        limit: size,
        offset,
        difficulty,
        accountId: ctx.token,
        season,
      });
      const total = countBoard(mode, day, { includeUnclaimed, difficulty, season });
      const me = accountBoardSummary(ctx.token, mode, day, {
        includeUnclaimed,
        difficulty,
        season,
      });

      return ctx.json(200, {
        mode,
        day,
        week: mode === 'weekly' ? day : null,
        mutations: mutationIds ? mutationSummary(mutationIds) : null,
        mutationScoreMul: mutationIds ? mutationScoreMul(mutationIds) : null,
        page,
        size,
        difficulty,
        total,
        totalPages: Math.max(1, Math.ceil(total / size)),
        entries,
        me,
        season,
        seasons: [...seasonList].sort().reverse(),
        seasonStart: dayKey(new Date(bounds.start)),
        seasonEnd: dayKey(new Date(bounds.end - 1)),
      });
    });

    // 个人赛季结算结果：只暴露本人名次与奖励，结算本身由 CLI 显式触发。
    router.add('GET', '/api/leaderboard/seasons/:season/result', (ctx, params) => {
      const season = params?.season;
      if (!isSeasonKey(season)) {
        return ctx.fail(400, '非法赛季：应为 YYYY-MM', 'INVALID_SEASON');
      }
      return ctx.json(200, { season, result: seasonResultFor(ctx.token, season) });
    });
  }
}
