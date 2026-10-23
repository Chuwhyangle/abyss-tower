// 玩家档案接口：会话初始化、档案读取、进度查询、数据导出与账号删除。
import { db, updateProfile } from '../db.mjs';
import {
  DELETION_COOLDOWN_MS,
  findAccountById,
  publicAccount,
  softDeleteAccount,
} from '../db/accounts.mjs';
import { recordPlayerEvent } from '../db/events.mjs';
import { hashIp, recordAuthEvent } from '../auth/rate-limit.mjs';
import { clearSessionCookie } from '../auth/cookies.mjs';
import { recentDailyChallenges } from '../../public/js/shared/scoring.js';
import { cleanName, dailyAttemptsLeft, dailyState, today } from './support.mjs';

const HISTORY_DAYS = 14;

function readProgress(accountId, type = null) {
  const rows = type
    ? db
        .prepare(
          'SELECT progress_type, progress_key, value_num, state_json, updated_at FROM player_progress WHERE account_id = ? AND progress_type = ?'
        )
        .all(accountId, type)
    : db
        .prepare(
          'SELECT progress_type, progress_key, value_num, state_json, updated_at FROM player_progress WHERE account_id = ?'
        )
        .all(accountId);
  return rows.map((row) => {
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
}

export class ProfileRoutes {
  register(router) {
    router.add('POST', '/api/session', (ctx) => this.session(ctx));
    router.add('GET', '/api/profile', (ctx) => ctx.json(200, { profile: ctx.profile }));
    router.add('GET', '/api/profile/progress', (ctx) => this.progress(ctx));
    router.add('GET', '/api/profile/export', (ctx) => this.exportData(ctx));
    router.add('GET', '/api/daily/history', (ctx) => this.dailyHistory(ctx));
    router.add('DELETE', '/api/profile', (ctx) => this.remove(ctx));
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
    const profile = ctx.profile;
    const progress = readProgress(ctx.token, ctx.url.searchParams.get('type'));
    return ctx.json(200, {
      stats: profile.stats,
      unlocks: profile.unlocks,
      wallet: { cores: profile.cores },
      progress,
    });
  }

  // 每日挑战历史：派生最近 N 天的种子与词缀，只合并当前账号自己的每日最佳。
  dailyHistory(ctx) {
    const raw = Number(ctx.url.searchParams.get('days'));
    const days = Number.isFinite(raw)
      ? Math.max(1, Math.min(HISTORY_DAYS, Math.floor(raw)))
      : HISTORY_DAYS;
    const entries = recentDailyChallenges(today(), days);
    const oldest = entries[entries.length - 1]?.day;
    const bestByDay = new Map();
    if (oldest) {
      const rows = db
        .prepare(
          `SELECT day, MAX(score) AS best_score, MAX(wave_reached) AS best_wave,
                  COUNT(*) AS attempts, MAX(finished_at) AS last_played_at
             FROM runs
            WHERE account_id = ? AND mode = 'daily' AND status = 'finished' AND day >= ?
            GROUP BY day`
        )
        .all(ctx.token, oldest);
      for (const row of rows) bestByDay.set(row.day, row);
    }
    return ctx.json(200, {
      today: entries[0]?.day ?? null,
      days,
      history: entries.map((entry) => {
        const row = bestByDay.get(entry.day);
        return {
          ...entry,
          played: !!row,
          bestScore: row ? row.best_score : null,
          bestWave: row ? row.best_wave : null,
          attempts: row ? row.attempts : 0,
          lastPlayedAt: row ? row.last_played_at : null,
        };
      }),
    });
  }

  // 数据导出：只读取当前账号自己的档案、进度与对局摘要，绝不返回凭据哈希。
  exportData(ctx) {
    const account = findAccountById(ctx.token);
    if (!account) return ctx.fail(404, '账号不存在');
    const profile = ctx.profile;
    const runs = db
      .prepare(
        `SELECT id, mode, board_key, difficulty, day, status, victory, score,
                wave_reached, kills, duration_ms, created_at, finished_at
           FROM runs WHERE account_id = ? ORDER BY created_at DESC`
      )
      .all(ctx.token);
    return ctx.json(200, {
      exportedAt: new Date().toISOString(),
      account: publicAccount(account),
      profile: {
        name: profile.name,
        cores: profile.cores,
        unlocks: profile.unlocks,
        stats: profile.stats,
        createdAt: profile.createdAt,
      },
      progress: readProgress(ctx.token),
      runs: runs.map((row) => ({
        id: row.id,
        mode: row.mode,
        boardKey: row.board_key,
        difficulty: row.difficulty,
        day: row.day,
        status: row.status,
        victory: !!row.victory,
        score: row.score,
        waveReached: row.wave_reached,
        kills: row.kills,
        durationMs: row.duration_ms,
        createdAt: row.created_at,
        finishedAt: row.finished_at,
      })),
    });
  }

  // 账号删除采用软删除 + 7 天冷却期：需显式确认，立即吊销会话，冷却期内可取消。
  async remove(ctx) {
    const body = await ctx.readJson();
    if (body.confirm !== 'DELETE') {
      return ctx.fail(400, '删除账号需要 confirm 字段为 "DELETE"', 'CONFIRMATION_REQUIRED');
    }
    const result = softDeleteAccount(ctx.token);
    if (!result) return ctx.fail(404, '账号不存在');
    recordPlayerEvent(ctx.token, 'account_deletion_requested', {
      dueAt: result.deletion.dueAt,
    });
    recordAuthEvent({
      accountId: ctx.token,
      usernameNorm: ctx.identity?.account?.username_norm || null,
      event: 'deletion_request',
      ipHash: hashIp(ctx.req),
      userAgent: ctx.req.headers['user-agent'],
      detail: { dueAt: result.deletion.dueAt },
    });
    clearSessionCookie(ctx.req, ctx.res);
    return ctx.json(200, {
      ok: true,
      deletion: {
        requestedAt: result.deletion.requestedAt,
        dueAt: result.deletion.dueAt,
        cooldownMs: DELETION_COOLDOWN_MS,
      },
    });
  }
}
