// 玩家档案接口：会话初始化、档案读取、进度查询。
import { db, updateProfile } from '../db.mjs';
import { cleanName, dailyAttemptsLeft, dailyState } from './support.mjs';

export class ProfileRoutes {
  register(router) {
    router.add('POST', '/api/session', (ctx) => this.session(ctx));
    router.add('GET', '/api/profile', (ctx) => ctx.json(200, { profile: ctx.profile }));
    router.add('GET', '/api/profile/progress', (ctx) => this.progress(ctx));
  }

  async session(ctx) {
    const body = await ctx.readJson();
    let profile = ctx.profile;
    if (typeof body.name === 'string') {
      const name = cleanName(body.name);
      if (!name) return ctx.fail(400, '昵称不能为空');
      profile = ctx.setProfile(updateProfile(ctx.token, { name }));
    }
    return ctx.json(200, {
      profile,
      dailyAttemptsLeft: dailyAttemptsLeft(ctx.token),
      daily: dailyState(ctx.token),
    });
  }

  progress(ctx) {
    const token = ctx.token;
    const profile = ctx.profile;
    const type = ctx.url.searchParams.get('type');
    const rows = type
      ? db
          .prepare(
            'SELECT progress_type, progress_key, value_num, state_json, updated_at FROM player_progress WHERE account_id = ? AND progress_type = ?'
          )
          .all(token, type)
      : db
          .prepare(
            'SELECT progress_type, progress_key, value_num, state_json, updated_at FROM player_progress WHERE account_id = ?'
          )
          .all(token);
    const progress = rows.map((row) => {
      let state = {};
      try {
        state = JSON.parse(row.state_json) || {};
      } catch {
        state = {};
      }
      return {
        type: row.progress_type,
        key: row.progress_key,
        value: row.value_num,
        state,
        updatedAt: row.updated_at,
      };
    });
    return ctx.json(200, {
      stats: profile.stats,
      unlocks: profile.unlocks,
      wallet: { cores: profile.cores },
      progress,
    });
  }
}
