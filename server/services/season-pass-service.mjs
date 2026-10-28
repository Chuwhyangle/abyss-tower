// 赛季通行证领域服务：赛季窗口判定、历史归档时机与领取错误映射都在这里；
// 积分派生、领取事务与持久化仍由仓储层（server/db/season_pass.mjs）完成。
import {
  archiveSeasonPassSeason,
  claimAllSeasonPassMilestones as claimAllPersisted,
  claimSeasonPassMilestone as claimPersisted,
  listSeasonPassHistory,
  seasonPassArchivedSummary,
  seasonPassSummary,
} from '../db/season_pass.mjs';
import { seasonOf } from '../db/leaderboard-sql.mjs';
import {
  isSeasonClosed,
  isSeasonKey,
  previousSeasonKey,
} from '../../public/js/shared/season-pass.js';

const FAILURE = {
  UNKNOWN_MILESTONE: [404, '里程碑不存在', 'UNKNOWN_MILESTONE'],
  SEASON_PASS_INCOMPLETE: [400, '赛季积分尚未达到该里程碑', 'SEASON_PASS_INCOMPLETE'],
  SEASON_UNAVAILABLE: [400, '当前赛季不可用', 'SEASON_UNAVAILABLE'],
};

function failure([status, message, code]) {
  return { ok: false, status, message, code };
}

export class SeasonPassService {
  // 读取轨道：当前赛季开放领取，历史赛季只读；进入新赛季后首次读取固化上一赛季终态。
  listSeasonPass(accountId, { season: requested = null, now = Date.now() } = {}) {
    const currentSeason = seasonOf();

    if (requested !== null && requested !== currentSeason) {
      if (!isSeasonKey(requested)) {
        return failure([400, '赛季参数不合法', 'INVALID_SEASON']);
      }
      if (!isSeasonClosed(requested, now)) {
        return failure([400, '该赛季尚未结束', 'SEASON_UNAVAILABLE']);
      }
      const archived = seasonPassArchivedSummary(accountId, requested);
      if (!archived) return failure([404, '没有该赛季的记录', 'SEASON_NOT_FOUND']);
      return {
        ok: true,
        body: {
          ...archived,
          currentSeason,
          history: listSeasonPassHistory(accountId, currentSeason),
        },
      };
    }

    const previous = previousSeasonKey(currentSeason);
    if (previous) archiveSeasonPassSeason(accountId, previous);

    const summary = seasonPassSummary(accountId);
    const closed = summary.season ? isSeasonClosed(summary.season, now) : false;
    const history = listSeasonPassHistory(accountId, currentSeason);
    if (!closed) {
      return {
        ok: true,
        body: { ...summary, closed: false, readOnly: false, currentSeason, history },
      };
    }
    return {
      ok: true,
      body: {
        ...summary,
        closed: true,
        readOnly: true,
        claimableCount: 0,
        milestones: summary.milestones.map((milestone) => ({ ...milestone, claimable: false })),
        currentSeason,
        history,
      },
    };
  }

  // 单个里程碑领取：只能发生在当前赛季，历史赛季与未来赛季都拒绝。
  claimSeasonPassMilestone(accountId, { season = null, milestoneId = null } = {}, now = Date.now()) {
    const rejected = this.rejectNonCurrentSeason(season, now);
    if (rejected) return rejected;
    const result = claimPersisted(accountId, milestoneId, now);
    if (!result.ok) return failure(FAILURE[result.code] || [400, '无法领取该里程碑', result.code]);
    return { ok: true, body: result };
  }

  // 一键领取：与单个领取共用赛季窗口规则，事务内按阈值升序补齐。
  claimAllSeasonPassMilestones(accountId, { season = null } = {}, now = Date.now()) {
    const rejected = this.rejectNonCurrentSeason(season, now);
    if (rejected) return rejected;
    const result = claimAllPersisted(accountId, now);
    if (!result.ok) {
      return failure(FAILURE[result.code] || [400, '无法领取里程碑', result.code]);
    }
    return { ok: true, body: result };
  }

  // 领取只能发生在当前赛季：历史赛季已终态，提前到来的赛季也拒绝。
  rejectNonCurrentSeason(season, now) {
    if (season == null) return null;
    if (!isSeasonKey(season)) return failure([400, '赛季参数不合法', 'INVALID_SEASON']);
    if (isSeasonClosed(season, now)) return failure([409, '赛季已结束，无法领取', 'SEASON_CLOSED']);
    if (season !== seasonOf(now)) {
      return failure([400, '只能领取当前赛季的里程碑', 'SEASON_UNAVAILABLE']);
    }
    return null;
  }
}
