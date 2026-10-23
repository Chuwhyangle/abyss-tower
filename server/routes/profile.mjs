// 玩家档案接口：会话初始化、档案读取、进度查询、数据导出与账号删除。
import { db, updateProfile } from '../db.mjs';
import {
  DELETION_COOLDOWN_MS,
  findAccountById,
  publicAccount,
  softDeleteAccount,
} from '../db/accounts.mjs';
import { cosmeticSummary, setSelectedCosmetics } from '../db/achievements.mjs';
import { recordPlayerEvent } from '../db/events.mjs';
import { hashIp, recordAuthEvent } from '../auth/rate-limit.mjs';
import { clearSessionCookie } from '../auth/cookies.mjs';
import { recentDailyChallenges } from '../../public/js/shared/scoring.js';
import { cleanName, dailyAttemptsLeft, dailyState, today } from './support.mjs';

const HISTORY_DAYS = 14;

// 设置云同步：存于 player_kv，逐账号一份；与 public/js/settings.js 的默认值/选项保持一致。
export const SETTINGS_MAX_BYTES = 4096;
const SETTINGS_NAMESPACE = 'settings';
const SETTINGS_KEY = 'quality';
const SETTINGS_FALLBACK = {
  fps: 30,
  dpr: 1,
  decorations: 'light',
  floaters: 'key',
  glow: false,
  shake: false,
  showFps: false,
  music: true,
  sfxVolume: 80,
  musicVolume: 50,
  colorBlind: 'none',
  highContrast: false,
};
const SETTINGS_OPTIONS = {
  fps: [30, 60],
  dpr: [1, 2],
  decorations: ['off', 'light', 'full'],
  floaters: ['off', 'key', 'all'],
  colorBlind: ['none', 'deuteranopia', 'protanopia', 'tritanopia'],
};

function pickOption(key, value, fallback) {
  const options = SETTINGS_OPTIONS[key];
  if (options.includes(value)) return value;
  const numeric = Number(value);
  return options.includes(numeric) ? numeric : fallback;
}

function clampVolume(value, fallback) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (typeof value === 'string' && value.trim() === '') return fallback;
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(100, Math.max(0, Math.round(numeric)));
}

// 服务端归一化：只保留已知字段，非法值回退默认，防止任意 JSON 落库。
export function sanitizeSettings(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const settings = {};
  for (const [key, fallback] of Object.entries(SETTINGS_FALLBACK)) {
    const value = source[key];
    if (SETTINGS_OPTIONS[key]) settings[key] = pickOption(key, value, fallback);
    else if (key === 'sfxVolume' || key === 'musicVolume') {
      settings[key] = clampVolume(value, fallback);
    } else {
      settings[key] = typeof value === 'boolean' ? value : fallback;
    }
  }
  return settings;
}

function readStoredSettings(accountId) {
  const row = db
    .prepare(
      'SELECT value_json, updated_at FROM player_kv WHERE account_id = ? AND namespace = ? AND key = ?'
    )
    .get(accountId, SETTINGS_NAMESPACE, SETTINGS_KEY);
  if (!row) return { settings: null, updatedAt: 0, corrupt: false };
  let parsed;
  try {
    parsed = JSON.parse(row.value_json);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { settings: null, updatedAt: 0, corrupt: true };
  }
  return {
    settings: sanitizeSettings(parsed),
    updatedAt: Number(row.updated_at) || 0,
    corrupt: false,
  };
}

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
    router.add('GET', '/api/profile/settings', (ctx) => this.readSettings(ctx));
    router.add('PUT', '/api/profile/settings', (ctx) => this.saveSettings(ctx));
    router.add('GET', '/api/profile/progress', (ctx) => this.progress(ctx));
    router.add('GET', '/api/profile/cosmetics', (ctx) =>
      ctx.json(200, cosmeticSummary(ctx.token))
    );
    router.add('PUT', '/api/profile/cosmetics', (ctx) => this.selectCosmetics(ctx));
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

  readSettings(ctx) {
    return ctx.json(200, readStoredSettings(ctx.token));
  }

  // 最近修改优先：客户端带 updatedAt，落后于已存版本时返回服务端版本而不覆盖。
  async saveSettings(ctx) {
    const body = await ctx.readJson();
    const raw = body?.settings;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return ctx.fail(400, '设置格式无效', 'INVALID_SETTINGS');
    }
    if (Buffer.byteLength(JSON.stringify(raw), 'utf8') > SETTINGS_MAX_BYTES) {
      return ctx.fail(413, '设置数据过大', 'SETTINGS_TOO_LARGE');
    }
    const stored = readStoredSettings(ctx.token);
    const now = Date.now();
    const proposedAt = Number(body.updatedAt);
    const proposed =
      Number.isFinite(proposedAt) && proposedAt > 0 ? Math.min(proposedAt, now) : now;
    if (stored.settings && stored.updatedAt > proposed) {
      return ctx.json(200, { ...stored, conflict: true });
    }
    const settings = sanitizeSettings(raw);
    db.prepare(
      `INSERT INTO player_kv (account_id, namespace, key, value_json, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(account_id, namespace, key) DO UPDATE SET
         value_json = excluded.value_json, updated_at = excluded.updated_at`
    ).run(ctx.token, SETTINGS_NAMESPACE, SETTINGS_KEY, JSON.stringify(settings), proposed);
    return ctx.json(200, { settings, updatedAt: proposed, corrupt: false, conflict: false });
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

  // 外观选择：只接受已解锁的称号/头像框；未给出的字段保持不变，null 表示卸下。
  async selectCosmetics(ctx) {
    const body = await ctx.readJson();
    const patch = {};
    for (const kind of ['title', 'frame']) {
      if (!(kind in body)) continue;
      const value = body[kind];
      if (value === null || value === '') {
        patch[kind] = null;
      } else if (typeof value === 'string') {
        patch[kind] = value;
      } else {
        return ctx.fail(400, '外观参数无效', 'INVALID_COSMETIC');
      }
    }
    if (!Object.keys(patch).length) {
      return ctx.fail(400, '没有需要更新的外观', 'NO_COSMETIC_CHANGES');
    }
    const result = setSelectedCosmetics(ctx.token, patch);
    if (!result.ok) {
      const errors = {
        UNKNOWN_TITLE: [400, '未知称号', 'UNKNOWN_TITLE'],
        UNKNOWN_FRAME: [400, '未知头像框', 'UNKNOWN_FRAME'],
        TITLE_LOCKED: [403, '称号尚未解锁', 'TITLE_LOCKED'],
        FRAME_LOCKED: [403, '头像框尚未解锁', 'FRAME_LOCKED'],
      };
      const [status, message, code] = errors[result.code] || [400, '外观不可用', 'COSMETIC_ERROR'];
      return ctx.fail(status, message, code);
    }
    return ctx.json(200, cosmeticSummary(ctx.token));
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
