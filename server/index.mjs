import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  db,
  getProfile,
  createProfile,
  updateProfile,
  getRun,
  hydrateRun,
  normalizeStats,
} from './db.mjs';
import { generateMap } from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';
import {
  rollRelicOffers,
  normalizeRelicStates,
  RELIC_BY_ID,
  RELIC_MAX_LEVEL,
  UNLOCK_BY_ID,
  DIFFICULTIES,
  unlockedTowerIds,
  MAX_WAVE,
} from '../public/js/shared/data.js';
import { clampFinishPayload, computeOutcome } from '../public/js/shared/scoring.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../public');
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';

const DAILY_ATTEMPTS = 3;
const START_GOLD = 260;
const START_HP = 20;
const META_GOLD = 40;
const META_HP = 3;

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'referrer-policy': 'no-referrer',
  'content-security-policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'",
};

// ---------- helpers ----------

function json(res, status, data) {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

function fail(res, status, message) {
  json(res, status, { error: message });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function isValidToken(token) {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(token);
}

function cleanName(raw) {
  return String(raw)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 16);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 256 * 1024) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        const parsed = JSON.parse(data);
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch {
        reject(new Error('JSON 解析失败'));
      }
    });
    req.on('error', reject);
  });
}

function finishedDailyToday(token) {
  return db
    .prepare(
      `SELECT COUNT(*) AS c FROM runs WHERE token = ? AND mode = 'daily' AND day = ? AND status = 'finished'`
    )
    .get(token, today()).c;
}

function runForToken(id, token) {
  const run = hydrateRun(getRun(id));
  if (!run || run.token !== token) return null;
  return run;
}

function maxRerollsFor(profile) {
  return 1 + (profile.unlocks.includes('extra_reroll') ? 2 : 0);
}

function difficultyPayload(difficulty) {
  const diff = DIFFICULTIES[difficulty] || DIFFICULTIES.standard;
  return { ...diff };
}

function dailyAttemptsLeft(token) {
  return Math.max(0, DAILY_ATTEMPTS - finishedDailyToday(token));
}

// ---------- API ----------

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  const method = req.method;

  if (pathname === '/api/health') {
    return json(res, 200, { ok: true, uptime: Math.round(process.uptime()) });
  }

  const token = String(req.headers['x-player-token'] || '');
  if (!isValidToken(token)) return fail(res, 401, '缺少有效的玩家令牌');

  let profile = getProfile(token) || createProfile(token);

  if (pathname === '/api/session' && method === 'POST') {
    const body = await readJson(req);
    if (typeof body.name === 'string') {
      const name = cleanName(body.name);
      if (!name) return fail(res, 400, '昵称不能为空');
      profile = updateProfile(token, { name });
    }
    return json(res, 200, { profile, dailyAttemptsLeft: dailyAttemptsLeft(token) });
  }

  if (pathname === '/api/profile' && method === 'GET') {
    return json(res, 200, { profile });
  }

  if (pathname === '/api/leaderboard' && method === 'GET') {
    const mode = url.searchParams.get('mode') === 'daily' ? 'daily' : 'normal';
    const day = url.searchParams.get('day') || today();
    const sql =
      mode === 'daily'
        ? `SELECT name, difficulty, wave, score, kills, victory, duration_ms, created_at FROM (
             SELECT name, difficulty, wave, score, kills, victory, duration_ms, created_at,
                    ROW_NUMBER() OVER (PARTITION BY token ORDER BY score DESC, duration_ms ASC) AS rn
             FROM leaderboard WHERE mode = 'daily' AND day = ?
           ) WHERE rn = 1 ORDER BY score DESC, duration_ms ASC LIMIT 20`
        : `SELECT name, difficulty, wave, score, kills, victory, duration_ms, created_at FROM (
             SELECT name, difficulty, wave, score, kills, victory, duration_ms, created_at,
                    ROW_NUMBER() OVER (PARTITION BY token ORDER BY score DESC, duration_ms ASC) AS rn
             FROM leaderboard WHERE mode = 'normal'
           ) WHERE rn = 1 ORDER BY score DESC, duration_ms ASC LIMIT 20`;
    const rows = mode === 'daily' ? db.prepare(sql).all(day) : db.prepare(sql).all();
    return json(res, 200, {
      mode,
      day,
      entries: rows.map((row) => ({
        name: row.name,
        difficulty: row.difficulty || 'standard',
        wave: row.wave,
        score: row.score,
        kills: row.kills,
        victory: !!row.victory,
        durationMs: row.duration_ms || 0,
        createdAt: row.created_at,
      })),
    });
  }

  if (pathname === '/api/runs' && method === 'POST') {
    const body = await readJson(req);
    const mode = body.mode === 'daily' ? 'daily' : 'normal';
    const difficulty = DIFFICULTIES[body.difficulty] ? body.difficulty : 'standard';
    const diff = DIFFICULTIES[difficulty];
    const day = today();

    if (mode === 'daily' && finishedDailyToday(token) >= DAILY_ATTEMPTS) {
      return fail(res, 429, '今日挑战次数已用完');
    }

    // 仅隔离测试服务允许固定种子，便于性能/平衡复现；生产环境默认关闭。
    const testSeed =
      process.env.ALLOW_TEST_SEED === '1'
        ? String(req.headers['x-test-seed'] || '').slice(0, 64)
        : '';
    const seed = testSeed
      ? `test-${testSeed}`
      : mode === 'daily'
        ? `daily-${day}`
        : crypto.randomBytes(8).toString('hex');
    const unlocks = profile.unlocks;
    const startingGold = Math.max(
      100,
      START_GOLD + (unlocks.includes('start_gold') ? META_GOLD : 0) + diff.goldBonus
    );
    const baseHp = Math.max(
      8,
      START_HP + (unlocks.includes('start_hp') ? META_HP : 0) + diff.hpBonus
    );
    const maxRerolls = maxRerollsFor(profile);
    const startRelics = unlocks.includes('start_relic')
      ? rollRelicOffers(`${seed}:start:${token}`, [], 1, 1)
          .filter((offer) => offer.kind === 'relic')
          .map((offer) => ({ id: offer.id, level: offer.toLevel }))
      : [];

    db.prepare(
      `UPDATE runs SET status = 'abandoned', finished_at = ? WHERE token = ? AND status = 'active'`
    ).run(Date.now(), token);

    const id = crypto.randomBytes(9).toString('base64url');
    db.prepare(
      `INSERT INTO runs
         (id, token, mode, difficulty, seed, day, waves_served, cleared_waves, relics, offers, rerolls_used, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, '{}', 0, 'active', ?)`
    ).run(id, token, mode, difficulty, seed, day, JSON.stringify(startRelics), Date.now());

    return json(res, 200, {
      runId: id,
      seed,
      mode,
      difficulty,
      difficultyConfig: difficultyPayload(difficulty),
      day,
      map: generateMap(seed),
      startingGold,
      baseHp,
      relics: startRelics,
      towersUnlocked: unlockedTowerIds(unlocks),
      maxRerolls,
      clearedWaves: 0,
      wavesServed: 0,
      dailyAttemptsLeft: mode === 'daily' ? dailyAttemptsLeft(token) : null,
    });
  }

  const runMatch = pathname.match(/^\/api\/runs\/([A-Za-z0-9_-]+)(?:\/(wave|clear|relics|relic|finish|abandon))?$/);
  if (runMatch) {
    const runId = runMatch[1];
    const action = runMatch[2] || 'info';
    const run = runForToken(runId, token);
    if (!run) return fail(res, 404, '远征不存在');

    if (action === 'info' && method === 'GET') {
      return json(res, 200, {
        run: {
          id: run.id,
          mode: run.mode,
          difficulty: run.difficulty,
          difficultyConfig: difficultyPayload(run.difficulty),
          seed: run.seed,
          day: run.day,
          wavesServed: run.wavesServed,
          clearedWaves: run.clearedWaves,
          inProgress: run.clearedWaves < run.wavesServed,
          currentWave: run.clearedWaves < run.wavesServed ? run.wavesServed : run.clearedWaves,
          relics: normalizeRelicStates(run.relics),
          status: run.status,
          victory: !!run.victory,
          maxRerolls: maxRerollsFor(profile),
          rerollsUsed: run.rerollsUsed,
          towersUnlocked: unlockedTowerIds(profile.unlocks),
          createdAt: run.createdAt,
        },
      });
    }

    if (run.status !== 'active') return fail(res, 409, '该远征已结束');

    if (action === 'wave' && method === 'POST') {
      // 有未结算波次时重放当前波，不推进波次、不重复发奖。
      if (run.clearedWaves < run.wavesServed) {
        const current = run.wavesServed;
        return json(res, 200, {
          wave: generateWave(run.seed, current, run.difficulty),
          replay: true,
          clearedWaves: run.clearedWaves,
          wavesServed: run.wavesServed,
        });
      }
      if (run.clearedWaves >= MAX_WAVE) return fail(res, 409, '已抵达最终波次');
      const next = run.wavesServed + 1;
      db.prepare('UPDATE runs SET waves_served = ? WHERE id = ?').run(next, runId);
      return json(res, 200, {
        wave: generateWave(run.seed, next, run.difficulty),
        replay: false,
        clearedWaves: run.clearedWaves,
        wavesServed: next,
      });
    }

    if (action === 'clear' && method === 'POST') {
      const body = await readJson(req);
      const wave = Math.floor(Number(body.wave));
      if (!Number.isFinite(wave) || wave < 1 || wave > MAX_WAVE) {
        return fail(res, 400, '波次号不合法');
      }
      if (wave > run.wavesServed) return fail(res, 409, '该波次尚未放行');
      if (wave <= run.clearedWaves) {
        return json(res, 200, {
          ok: true,
          clearedWaves: run.clearedWaves,
          wavesServed: run.wavesServed,
          nextWave: run.wavesServed + 1,
          duplicate: true,
        });
      }
      if (wave !== run.wavesServed) {
        return fail(res, 409, '只能结算当前进行中的波次');
      }
      db.prepare('UPDATE runs SET cleared_waves = ? WHERE id = ?').run(wave, runId);
      return json(res, 200, {
        ok: true,
        clearedWaves: wave,
        wavesServed: run.wavesServed,
        nextWave: wave + 1,
      });
    }

    if (action === 'relics' && method === 'POST') {
      const body = await readJson(req);
      if (run.clearedWaves !== run.wavesServed) {
        return fail(res, 409, '当前波次尚未结算完成');
      }
      const key = String(run.clearedWaves);
      const maxRerolls = maxRerollsFor(profile);
      let rerollsUsed = run.rerollsUsed;
      const offers = run.offers || {};

      if (body.reroll) {
        if (offers[key]?.picked) return fail(res, 409, '本次遗物已选择，不能刷新');
        if (rerollsUsed >= maxRerolls) return fail(res, 409, '刷新次数已用完');
        rerollsUsed += 1;
        delete offers[key];
      }

      const relicStates = normalizeRelicStates(run.relics);
      let slot = offers[key];
      // 兼容旧进行中远征的 { ids: [...] } 格式。
      if (slot && Array.isArray(slot.ids)) {
        slot = {
          offers: slot.ids
            .map((id) => {
              if (!RELIC_BY_ID[id]) return null;
              const fromLevel = relicStates.find((state) => state.id === id)?.level || 0;
              return {
                kind: 'relic',
                id,
                fromLevel,
                toLevel: Math.min(RELIC_MAX_LEVEL, fromLevel + 1),
              };
            })
            .filter(Boolean),
          picked: false,
        };
        offers[key] = slot;
      }
      if (!slot) {
        slot = {
          offers: rollRelicOffers(
            `${run.seed}:relic:${run.clearedWaves}:${rerollsUsed}`,
            relicStates,
            3,
            run.clearedWaves
          ),
          picked: false,
        };
        offers[key] = slot;
      }

      db.prepare('UPDATE runs SET offers = ?, rerolls_used = ? WHERE id = ?').run(
        JSON.stringify(offers),
        rerollsUsed,
        runId
      );

      return json(res, 200, {
        wave: run.clearedWaves,
        offers: slot.offers,
        picked: !!slot.picked,
        relics: relicStates,
        rerollsUsed,
        maxRerolls,
      });
    }

    if (action === 'relic' && method === 'POST') {
      const body = await readJson(req);
      if (run.clearedWaves !== run.wavesServed) {
        return fail(res, 409, '当前波次尚未结算完成');
      }
      const offers = run.offers || {};
      const key = String(run.clearedWaves);
      const slot = offers[key];
      if (!slot || !Array.isArray(slot.offers)) return fail(res, 400, '本次遗物选项不存在');
      if (slot.picked) return fail(res, 409, '本次遗物已经选择');

      let offer = null;
      const index = Number(body.index);
      if (Number.isInteger(index) && index >= 0 && index < slot.offers.length) {
        offer = slot.offers[index];
      } else if (body.relicId) {
        offer = slot.offers.find(
          (item) => item.kind === 'relic' && item.id === String(body.relicId)
        );
      }
      if (!offer) return fail(res, 400, '选择不在本次选项中');

      let states = normalizeRelicStates(run.relics);
      if (offer.kind === 'relic') {
        const existing = states.find((state) => state.id === offer.id);
        const targetLevel = Math.min(
          RELIC_MAX_LEVEL,
          Math.max(offer.toLevel || 1, (existing?.level || 0) + 1)
        );
        if (existing) existing.level = targetLevel;
        else states.push({ id: offer.id, level: targetLevel });
        db.prepare('UPDATE runs SET relics = ? WHERE id = ?').run(JSON.stringify(states), runId);
      }

      slot.picked = true;
      db.prepare('UPDATE runs SET offers = ? WHERE id = ?').run(JSON.stringify(offers), runId);
      return json(res, 200, { applied: offer, picked: true, relics: states });
    }

    if (action === 'finish' && method === 'POST') {
      const body = await readJson(req);
      const payload = clampFinishPayload(body, run.clearedWaves);
      const outcome = computeOutcome({
        ...payload,
        wavesServed: run.clearedWaves,
        difficulty: run.difficulty,
      });
      const now = Date.now();
      const durationMs = Math.max(0, now - run.createdAt);

      const prevBestSql =
        run.mode === 'daily'
          ? `SELECT MAX(score) AS s FROM leaderboard WHERE token = ? AND mode = ? AND day = ?`
          : `SELECT MAX(score) AS s FROM leaderboard WHERE token = ? AND mode = ?`;
      const prevBest =
        run.mode === 'daily'
          ? db.prepare(prevBestSql).get(token, run.mode, run.day)
          : db.prepare(prevBestSql).get(token, run.mode);
      const personalBest = outcome.score > (prevBest?.s || 0);

      db.prepare(
        `UPDATE runs SET status = 'finished', victory = ?, score = ?, wave_reached = ?,
           kills = ?, duration_ms = ?, finished_at = ? WHERE id = ?`
      ).run(
        outcome.victory ? 1 : 0,
        outcome.score,
        payload.waveReached,
        payload.kills,
        durationMs,
        now,
        runId
      );

      db.prepare(
        `INSERT INTO leaderboard
           (token, name, mode, difficulty, day, seed, wave, score, kills, victory, duration_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        token,
        profile.name,
        run.mode,
        run.difficulty,
        run.day,
        run.seed,
        payload.waveReached,
        outcome.score,
        payload.kills,
        outcome.victory ? 1 : 0,
        durationMs,
        now
      );

      const stats = normalizeStats(profile.stats);
      stats.runs += 1;
      stats.kills += payload.kills;
      if (outcome.victory) stats.wins += 1;
      const byDiff = stats.byDifficulty[run.difficulty];
      byDiff.runs += 1;
      byDiff.bestWave = Math.max(byDiff.bestWave, payload.waveReached);
      byDiff.bestScore = Math.max(byDiff.bestScore, outcome.score);
      if (outcome.victory) byDiff.wins += 1;

      const updated = updateProfile(token, {
        cores: profile.cores + outcome.cores,
        stats,
      });

      const rankSql =
        run.mode === 'daily'
          ? `SELECT COUNT(*) AS c FROM (
               SELECT token, MAX(score) AS s FROM leaderboard WHERE mode = 'daily' AND day = ? GROUP BY token
             ) WHERE s > ?`
          : `SELECT COUNT(*) AS c FROM (
               SELECT token, MAX(score) AS s FROM leaderboard WHERE mode = 'normal' GROUP BY token
             ) WHERE s > ?`;
      const rank =
        (run.mode === 'daily'
          ? db.prepare(rankSql).get(run.day, outcome.score)
          : db.prepare(rankSql).get(outcome.score)).c + 1;

      return json(res, 200, {
        victory: outcome.victory,
        difficulty: run.difficulty,
        waveReached: payload.waveReached,
        rawScore: outcome.rawScore,
        score: outcome.score,
        coresEarned: outcome.cores,
        totalCores: updated.cores,
        personalBest,
        rank,
        durationMs,
        dailyAttemptsLeft: run.mode === 'daily' ? dailyAttemptsLeft(token) : null,
      });
    }

    if (action === 'abandon' && method === 'POST') {
      db.prepare(`UPDATE runs SET status = 'abandoned', finished_at = ? WHERE id = ?`).run(
        Date.now(),
        runId
      );
      return json(res, 200, { ok: true });
    }
  }

  if (pathname === '/api/unlock' && method === 'POST') {
    const body = await readJson(req);
    const unlock = UNLOCK_BY_ID[String(body.unlockId || '')];
    if (!unlock) return fail(res, 404, '未知解锁项');
    if (profile.unlocks.includes(unlock.id)) return fail(res, 409, '已经解锁');
    if (profile.cores < unlock.cost) return fail(res, 400, '星核不足');
    const updated = updateProfile(token, {
      cores: profile.cores - unlock.cost,
      unlocks: [...profile.unlocks, unlock.id],
    });
    return json(res, 200, { profile: updated });
  }

  return fail(res, 404, '接口不存在');
}

// ---------- 静态资源 ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveFile(res, file) {
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'content-type': MIME[ext] || 'application/octet-stream',
    'cache-control': 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
}

function serveStatic(req, res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return fail(res, 400, '非法路径');
  }
  if (decoded === '/') decoded = '/index.html';

  const file = path.normalize(path.join(PUBLIC_DIR, decoded));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return fail(res, 403, '禁止访问');

  fs.stat(file, (error, stat) => {
    if (!error && stat.isFile()) return serveFile(res, file);
    // 带扩展名的资源缺失时返回 404，避免把 JS/CSS 当成 HTML 返回。
    if (path.extname(decoded)) return fail(res, 404, '资源不存在');
    return serveFile(res, path.join(PUBLIC_DIR, 'index.html'));
  });
}

// ---------- server ----------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return fail(res, 405, '不支持的请求方法');
    }
    serveStatic(req, res, url.pathname);
  } catch (error) {
    console.error('[request]', req.method, url.pathname, error);
    if (!res.headersSent) fail(res, 500, error.message || '服务器内部错误');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[渊塔守卫] http://${HOST}:${PORT}`);
});

function shutdown(signal) {
  console.log(`\n[渊塔守卫] 收到 ${signal}，正在关闭...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
