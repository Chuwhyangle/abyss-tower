// 赛季通行证接口：读取当前赛季积分轨道，领取已完成里程碑；已结束赛季只读并可切换历史。
import {
  archiveSeasonPassSeason,
  claimAllSeasonPassMilestones,
  claimSeasonPassMilestone,
  listSeasonPassHistory,
  seasonPassArchivedSummary,
  seasonPassSummary,
} from '../db/season_pass.mjs';
import { seasonOf } from '../db/leaderboard.mjs';
import { isSeasonClosed, isSeasonKey, previousSeasonKey } from '../../public/js/shared/season-pass.js';

const FAILURE = {
  UNKNOWN_MILESTONE: [404, '里程碑不存在', 'UNKNOWN_MILESTONE'],
  SEASON_PASS_INCOMPLETE: [400, '赛季积分尚未达到该里程碑', 'SEASON_PASS_INCOMPLETE'],
  SEASON_UNAVAILABLE: [400, '当前赛季不可用', 'SEASON_UNAVAILABLE'],
};

// 领取只能发生在当前赛季：历史赛季已终态，提前到来的赛季也拒绝。
function rejectNonCurrentSeason(ctx, season) {
  if (season == null) return false;
  if (!isSeasonKey(season)) {
    ctx.fail(400, '赛季参数不合法', 'INVALID_SEASON');
    return true;
  }
  if (isSeasonClosed(season, Date.now())) {
    ctx.fail(409, '赛季已结束，无法领取', 'SEASON_CLOSED');
    return true;
  }
  if (season !== seasonOf()) {
    ctx.fail(400, '只能领取当前赛季的里程碑', 'SEASON_UNAVAILABLE');
    return true;
  }
  return false;
}

export class SeasonPassRoutes {
  register(router) {
    router.add('GET', '/api/season-pass', (ctx) => this.list(ctx));
    router.add('POST', '/api/season-pass/claim', (ctx) => this.claim(ctx));
    router.add('POST', '/api/season-pass/claim-all', (ctx) => this.claimAll(ctx));
  }

  list(ctx) {
    const accountId = ctx.token;
    const currentSeason = seasonOf();
    const requested = ctx.url?.searchParams?.get('season') ?? null;

    if (requested !== null && requested !== currentSeason) {
      if (!isSeasonKey(requested)) {
        return ctx.fail(400, '赛季参数不合法', 'INVALID_SEASON');
      }
      if (!isSeasonClosed(requested, Date.now())) {
        return ctx.fail(400, '该赛季尚未结束', 'SEASON_UNAVAILABLE');
      }
      const archived = seasonPassArchivedSummary(accountId, requested);
      if (!archived) return ctx.fail(404, '没有该赛季的记录', 'SEASON_NOT_FOUND');
      return ctx.json(200, {
        ...archived,
        currentSeason,
        history: listSeasonPassHistory(accountId, currentSeason),
      });
    }

    // 进入新赛季后的第一次读取固化上一赛季终态；此后历史赛季只读。
    const previous = previousSeasonKey(currentSeason);
    if (previous) archiveSeasonPassSeason(accountId, previous);

    const summary = seasonPassSummary(accountId);
    const closed = summary.season ? isSeasonClosed(summary.season, Date.now()) : false;
    const history = listSeasonPassHistory(accountId, currentSeason);
    if (!closed) {
      return ctx.json(200, { ...summary, closed: false, readOnly: false, currentSeason, history });
    }
    return ctx.json(200, {
      ...summary,
      closed: true,
      readOnly: true,
      claimableCount: 0,
      milestones: summary.milestones.map((milestone) => ({ ...milestone, claimable: false })),
      currentSeason,
      history,
    });
  }

  async claim(ctx) {
    const body = (await ctx.readJson()) || {};
    if (rejectNonCurrentSeason(ctx, body.season)) return true;
    const milestoneId = body.id ?? body.milestoneId ?? null;
    const result = claimSeasonPassMilestone(ctx.token, milestoneId);
    if (!result.ok) {
      const [status, message, code] = FAILURE[result.code] || [400, '无法领取该里程碑', result.code];
      return ctx.fail(status, message, code);
    }
    return ctx.json(200, result);
  }

  async claimAll(ctx) {
    const body = (await ctx.readJson()) || {};
    if (rejectNonCurrentSeason(ctx, body.season)) return true;
    const result = claimAllSeasonPassMilestones(ctx.token);
    if (!result.ok) {
      const [status, message, code] = FAILURE[result.code] || [400, '无法领取里程碑', result.code];
      return ctx.fail(status, message, code);
    }
    return ctx.json(200, result);
  }
}
