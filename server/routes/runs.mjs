// 远征接口：只做身份读取、参数解析、调用领域服务与响应序列化。
import { actionRateLimited, hashIp, recordRateLimitFailure } from '../auth/rate-limit.mjs';
import {
  RunError,
  RunService,
  dailyAttemptsLeft,
  weeklyAttemptsLeft,
} from '../services/run-service.mjs';

const RUN_ACTIONS = /^\/api\/runs\/(?<id>[A-Za-z0-9_-]+)(?:\/(?<action>wave|clear|map|relics|relic|events|event|finish|abandon))?$/;

export class RunRoutes {
  constructor(service = new RunService()) {
    this.service = service;
  }

  register(router) {
    router.add('POST', '/api/runs', (ctx) => this.create(ctx));
    router.add('GET', '/api/runs/active', (ctx) => this.active(ctx));
    router.add(null, RUN_ACTIONS, (ctx, params) => this.resource(ctx, params));
  }

  async create(ctx) {
    const limit = actionRateLimited('run-create', {
      accountId: ctx.token,
      ipHash: hashIp(ctx.req),
    });
    if (limit.limited) {
      ctx.res.setHeader('Retry-After', String(limit.retryAfterSeconds));
      return ctx.fail(429, '操作过于频繁，请稍后再试', 'RATE_LIMITED');
    }

    const body = await ctx.readJson();
    // 仅隔离测试服务允许固定种子，便于性能/平衡复现；生产环境默认关闭。
    const testSeed =
      process.env.ALLOW_TEST_SEED === '1'
        ? String(ctx.req.headers['x-test-seed'] || '').slice(0, 64)
        : '';
    return this.respond(
      ctx,
      () =>
        ctx.json(
          200,
          this.service.create({ token: ctx.token, profile: ctx.profile, body, testSeed })
        ),
      'run-create'
    );
  }

  active(ctx) {
    return ctx.json(200, this.service.active(ctx.token, ctx.profile));
  }

  async resource(ctx, { id: runId, action: actionParam }) {
    const action = actionParam || 'info';
    const run = this.service.ownRun(runId, ctx.token);
    if (!run) return ctx.fail(404, '远征不存在');

    // 放弃是幂等的：已结束的远征再次放弃仍返回 200，且不会把已结算状态改回 abandoned。
    if (action === 'abandon' && ctx.method === 'POST') return this.abandon(ctx, run);
    if (action === 'info' && ctx.method === 'GET') {
      return ctx.json(200, {
        run: this.service.serialize(run, ctx.profile, { withVictory: true }),
      });
    }
    if (run.status !== 'active') return ctx.fail(409, '该远征已结束', 'RUN_FINISHED');
    if (ctx.method !== 'POST') return false;

    if (action === 'map') return this.map(ctx, run);
    if (action === 'wave') return this.wave(ctx, run);
    if (action === 'clear') return this.clear(ctx, run);
    if (action === 'relics') return this.relics(ctx, run);
    if (action === 'relic') return this.relic(ctx, run);
    if (action === 'events') return this.events(ctx, run);
    if (action === 'event') return this.event(ctx, run);
    if (action === 'finish') return this.finish(ctx, run);
    return false;
  }

  async map(ctx, run) {
    const body = await ctx.readJson();
    const index = Math.floor(Number(body.index));
    return this.respond(ctx, () => ctx.json(200, this.service.chooseMap(run, index)));
  }

  wave(ctx, run) {
    return this.respond(ctx, () => ctx.json(200, this.service.serveWave(run)));
  }

  async clear(ctx, run) {
    const body = await ctx.readJson();
    const wave = Math.floor(Number(body.wave));
    return this.respond(ctx, () => ctx.json(200, this.service.clearWave(run, wave)));
  }

  async relics(ctx, run) {
    const body = await ctx.readJson();
    return this.respond(ctx, () =>
      ctx.json(200, this.service.relicOffers(run, ctx.profile, { reroll: !!body.reroll }))
    );
  }

  async relic(ctx, run) {
    const body = await ctx.readJson();
    return this.respond(ctx, () =>
      ctx.json(
        200,
        this.service.pickRelic(run, { index: body.index, relicId: body.relicId })
      )
    );
  }

  events(ctx, run) {
    return this.respond(ctx, () => ctx.json(200, this.service.eventNode(run)));
  }

  async event(ctx, run) {
    const body = await ctx.readJson();
    return this.respond(ctx, () =>
      ctx.json(200, this.service.pickEvent(run, { index: body.index, optionId: body.optionId }))
    );
  }

  async finish(ctx, run) {
    const body = await ctx.readJson();
    return this.respond(ctx, () =>
      ctx.json(200, this.service.settle(run, ctx.profile, body))
    );
  }

  // 放弃接口：返回本局模式对应的剩余次数，供界面在二次确认后与标题页保持一致。
  // 只有进行中的远征才改写状态；重复放弃（abandoned）或已结算（finished）保持原状态。
  abandon(ctx, run) {
    return this.respond(ctx, () => {
      const active = run.status === 'active';
      if (active) this.service.abandon(run);
      return ctx.json(200, {
        ok: true,
        status: active ? 'abandoned' : run.status,
        alreadyAbandoned: !active,
        dailyAttemptsLeft: run.mode === 'daily' ? dailyAttemptsLeft(ctx.token) : null,
        weeklyAttemptsLeft:
          run.mode === 'weekly' ? weeklyAttemptsLeft(ctx.token, run.day) : null,
      });
    });
  }

  respond(ctx, action, failureAction = null) {
    try {
      return action();
    } catch (error) {
      if (error instanceof RunError) {
        if (failureAction) {
          recordRateLimitFailure(failureAction, {
            accountId: ctx.token,
            ipHash: hashIp(ctx.req),
            userAgent: ctx.req.headers['user-agent'] || null,
          });
        }
        return ctx.fail(error.status, error.message, error.code);
      }
      throw error;
    }
  }
}
