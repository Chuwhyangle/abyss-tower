// 最近对局回放接口：只读摘要。未登录由登录门禁回 401；非本人回放与不存在一样回 404。
import {
  REPLAY_LIMIT,
  WEEKLY_ARCHIVE_LIMIT,
  findReplay,
  listReplays,
  listWeeklyArchives,
} from '../db/replays.mjs';

// 列表只需要足够定位一局的信息，时间线细节留给详情接口。
function listEntry(replay) {
  return {
    id: replay.id,
    runId: replay.runId,
    mode: replay.mode,
    difficulty: replay.difficulty,
    seed: replay.seed,
    map: replay.map,
    victory: !!replay.result.victory,
    score: replay.result.score ?? 0,
    waveReached: replay.result.waveReached ?? replay.waves.reached ?? 0,
    kills: replay.result.kills ?? 0,
    durationMs: replay.result.durationMs ?? 0,
    relicCount: replay.relics.length,
    eventCount: replay.events.length,
    finishedAt: replay.finishedAt,
  };
}

export class ReplayHistoryRoutes {
  register(router) {
    router.add('GET', '/api/replays', (ctx) => this.list(ctx));
    router.add('GET', '/api/replays/:id', (ctx, { id }) => this.detail(ctx, id));
  }

  list(ctx) {
    const entries = listReplays(ctx.token, REPLAY_LIMIT).map(listEntry);
    const weekly = listWeeklyArchives(ctx.token, WEEKLY_ARCHIVE_LIMIT);
    // replays 保留旧字段名，既有结算页与客户端无需同步改动。
    return ctx.json(200, { entries, weekly, replays: entries, limit: REPLAY_LIMIT });
  }

  detail(ctx, id) {
    const replay = findReplay(ctx.token, id);
    if (!replay) return ctx.fail(404, '回放不存在');
    return ctx.json(200, { replay });
  }
}
