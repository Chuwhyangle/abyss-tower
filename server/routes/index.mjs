// 路由装配：公开路由 → 登录门禁 → 业务路由 → 统一 404。
import { createProfile, getProfile } from '../db.mjs';
import { resolveGameAccount } from '../auth/identity.mjs';
import { GameContext } from '../http/context.mjs';
import { ApiRouter } from './router.mjs';
import { AuthRoutes } from './auth.mjs';
import { ConfigRoutes, DiagnosticsRoutes, HealthRoutes } from './system.mjs';
import { ProfileRoutes } from './profile.mjs';
import { LeaderboardRoutes } from './leaderboard.mjs';
import { RunRoutes } from './runs.mjs';
import { SkillRoutes } from './skills.mjs';
import { UnlockRoutes } from './unlock.mjs';
import { AchievementRoutes } from './achievements.mjs';
import { BountyRoutes } from './bounties.mjs';
import { NotificationRoutes } from './notifications.mjs';
import { StatsRoutes } from './stats.mjs';
import { ReplayRoutes } from './replay.mjs';
import { ReplayHistoryRoutes } from './replays.mjs';

// 门禁：解析会话/旧令牌，确保玩家档案存在；失败时直接回 401。
export function createGameGate() {
  return (ctx) => {
    const identity = resolveGameAccount(ctx.req);
    if (!identity) {
      ctx.json(401, { error: '请先登录', code: 'AUTH_REQUIRED' });
      return null;
    }
    const token = identity.account.id;
    const profile = getProfile(token) || createProfile(token, identity.account.username || null);
    return new GameContext(ctx, { identity, profile });
  };
}

export function createApiRouter() {
  return new ApiRouter(createGameGate())
    .addPublic(new HealthRoutes())
    .addPublic(new ConfigRoutes())
    .addPublic(new DiagnosticsRoutes())
    .addPublic(new AuthRoutes())
    .addProtected(new ProfileRoutes())
    .addProtected(new LeaderboardRoutes())
    .addProtected(new RunRoutes())
    .addProtected(new SkillRoutes())
    .addProtected(new UnlockRoutes())
    .addProtected(new AchievementRoutes())
    .addProtected(new BountyRoutes())
    .addProtected(new NotificationRoutes())
    .addProtected(new StatsRoutes())
    .addProtected(new ReplayRoutes())
    .addProtected(new ReplayHistoryRoutes());
}
