// 远征接口：开局、续玩、地图/波次/遗物/结算/放弃。
import crypto from 'node:crypto';

import {
  db,
  updateProfile,
  getActiveRun,
  getCores,
  grantCores,
  normalizeStats,
} from '../db.mjs';
import { AUTH_ENABLED, CONTENT_VERSION } from '../config.mjs';
import { personalBest, rankFor, recordLeaderboardEntry } from '../db/leaderboard.mjs';
import { recordPlayerEvent } from '../db/events.mjs';
import {
  grantVictorySkillUnlock,
  readSelectedSkill,
  readSkillLevel,
  skillUnlocked,
} from '../db/skills.mjs';
import { generateMapCandidates } from '../../public/js/shared/mapgen.js';
import { generateWave } from '../../public/js/shared/waves.js';
import {
  rollRelicOffers,
  normalizeRelicStates,
  RELIC_BY_ID,
  RELIC_MAX_LEVEL,
  DIFFICULTIES,
  SKILLS,
  TOWER_ORDER,
  unlockedTowerIds,
  MAX_WAVE,
} from '../../public/js/shared/data.js';
import { clampFinishPayload, computeOutcome } from '../../public/js/shared/scoring.js';
import {
  DAILY_ATTEMPTS,
  DAILY_MAX_REROLLS,
  DAILY_RULESET,
  DAILY_SKILL_LEVEL,
  DAILY_START_GOLD,
  DAILY_START_HP,
  boardKeyFor,
  dailyAttemptsLeft,
  difficultyPayload,
  finishedDailyToday,
  maxRerollsFor,
  maxRerollsForRun,
  runForToken,
  skillForRun,
  today,
  towersUnlockedForRun,
} from './support.mjs';

const START_GOLD = 260;
const START_HP = 20;
const META_GOLD = 40;
const META_HP = 3;

const RUN_ACTIONS = /^\/api\/runs\/(?<id>[A-Za-z0-9_-]+)(?:\/(?<action>wave|clear|map|relics|relic|finish|abandon))?$/;

export class RunRoutes {
  register(router) {
    router.add('POST', '/api/runs', (ctx) => this.create(ctx));
    router.add('GET', '/api/runs/active', (ctx) => this.active(ctx));
    router.add(null, RUN_ACTIONS, (ctx, params) => this.resource(ctx, params));
  }

  async create(ctx) {
    const { req } = ctx;
    const token = ctx.token;
    const profile = ctx.profile;
    const body = await ctx.readJson();
    const mode = body.mode === 'daily' ? 'daily' : 'normal';
    const daily = mode === 'daily';
    const difficulty = DIFFICULTIES[body.difficulty] ? body.difficulty : 'standard';
    const diff = DIFFICULTIES[difficulty];
    const day = today();

    if (daily && finishedDailyToday(token) >= DAILY_ATTEMPTS) {
      return ctx.fail(429, '今日挑战次数已用完');
    }

    // 技能选择：每日允许任意技能且固定 5 级；普通局必须已解锁，等级只从 DB 读。
    let skillId = null;
    if (body.skillId != null && body.skillId !== '') {
      skillId = String(body.skillId);
      if (!SKILLS[skillId]) return ctx.fail(400, '未知技能', 'INVALID_SKILL');
      if (!daily && !skillUnlocked(token, skillId)) {
        return ctx.fail(403, '技能尚未解锁', 'SKILL_LOCKED');
      }
    }
    if (!skillId) {
      const selected = readSelectedSkill(token);
      skillId = selected && (daily || skillUnlocked(token, selected)) ? selected : 'aurora';
    }
    const skillLevel = daily ? DAILY_SKILL_LEVEL : readSkillLevel(token, skillId);

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
    // 每日使用固定开局资源，忽略难度加成与账号 meta 加成，保证榜单公平。
    const startingGold = daily
      ? DAILY_START_GOLD
      : Math.max(100, START_GOLD + (unlocks.includes('start_gold') ? META_GOLD : 0) + diff.goldBonus);
    const baseHp = daily
      ? DAILY_START_HP
      : Math.max(8, START_HP + (unlocks.includes('start_hp') ? META_HP : 0) + diff.hpBonus);
    const maxRerolls = daily ? DAILY_MAX_REROLLS : maxRerollsFor(profile);
    const startRelics =
      !daily && unlocks.includes('start_relic')
        ? rollRelicOffers(`${seed}:start:${token}`, [], 1, 1)
            .filter((offer) => offer.kind === 'relic')
            .map((offer) => ({ id: offer.id, level: offer.toLevel }))
        : [];

    const ruleset = {
      v: 1,
      skill: { id: skillId, level: skillLevel },
      meta: { startGold: startingGold, baseHp, maxRerolls },
    };
    if (daily) ruleset.daily = { date: day, ruleset: DAILY_RULESET };

    db.prepare(
      `UPDATE runs SET status = 'abandoned', finished_at = ? WHERE account_id = ? AND status = 'active'`
    ).run(Date.now(), token);

    const id = crypto.randomBytes(9).toString('base64url');
    const candidates = generateMapCandidates(seed, 3);
    const boardKey = boardKeyFor(mode, day);
    db.prepare(
      `INSERT INTO runs
         (id, account_id, mode, board_key, difficulty, seed, day, content_version,
          ruleset_json, waves_served, cleared_waves, map_choice, relics, offers,
          rerolls_used, status, result_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, -1, ?, '{}', 0, 'active', '{}', ?)`
    ).run(
      id,
      token,
      mode,
      boardKey,
      difficulty,
      seed,
      day,
      CONTENT_VERSION,
      JSON.stringify(ruleset),
      JSON.stringify(startRelics),
      Date.now()
    );

    return ctx.json(200, {
      runId: id,
      seed,
      mode,
      difficulty,
      difficultyConfig: difficultyPayload(difficulty),
      day,
      candidates,
      startingGold,
      baseHp,
      relics: startRelics,
      towersUnlocked: daily ? [...TOWER_ORDER] : unlockedTowerIds(unlocks),
      maxRerolls,
      skill: ruleset.skill,
      ruleset,
      clearedWaves: 0,
      wavesServed: 0,
      dailyAttemptsLeft: daily ? dailyAttemptsLeft(token) : null,
    });
  }

  active(ctx) {
    const token = ctx.token;
    const profile = ctx.profile;
    const active = getActiveRun(token);
    if (!active) return ctx.json(200, { run: null });
    const candidates = generateMapCandidates(active.seed, 3);
    const chosen = active.mapChoice >= 0 ? candidates[active.mapChoice] || null : null;
    return ctx.json(200, {
      run: {
        id: active.id,
        mode: active.mode,
        difficulty: active.difficulty,
        difficultyConfig: difficultyPayload(active.difficulty),
        seed: active.seed,
        day: active.day,
        wavesServed: active.wavesServed,
        clearedWaves: active.clearedWaves,
        inProgress: active.clearedWaves < active.wavesServed,
        currentWave: active.clearedWaves < active.wavesServed ? active.wavesServed : active.clearedWaves,
        mapChoice: active.mapChoice,
        map: chosen,
        mapMeta: chosen?.meta || null,
        relics: normalizeRelicStates(active.relics),
        status: active.status,
        maxRerolls: maxRerollsForRun(active, profile),
        rerollsUsed: active.rerollsUsed,
        towersUnlocked: towersUnlockedForRun(active, profile),
        skill: skillForRun(active),
        ruleset: active.ruleset,
        createdAt: active.createdAt,
      },
    });
  }

  async resource(ctx, { id: runId, action: actionParam }) {
    const token = ctx.token;
    const profile = ctx.profile;
    const action = actionParam || 'info';
    const run = runForToken(runId, token);
    if (!run) return ctx.fail(404, '远征不存在');

    if (action === 'info' && ctx.method === 'GET') {
      const candidates = generateMapCandidates(run.seed, 3);
      const chosen = run.mapChoice >= 0 ? candidates[run.mapChoice] || null : null;
      return ctx.json(200, {
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
          mapChoice: run.mapChoice,
          map: chosen,
          mapMeta: chosen?.meta || null,
          relics: normalizeRelicStates(run.relics),
          status: run.status,
          victory: !!run.victory,
          maxRerolls: maxRerollsForRun(run, profile),
          rerollsUsed: run.rerollsUsed,
          towersUnlocked: towersUnlockedForRun(run, profile),
          skill: skillForRun(run),
          ruleset: run.ruleset,
          createdAt: run.createdAt,
        },
      });
    }

    if (run.status !== 'active') return ctx.fail(409, '该远征已结束', 'RUN_FINISHED');

    if (action === 'map') {
      return ctx.method === 'POST' ? this.map(ctx, runId, run) : false;
    }
    if (action === 'wave') {
      return ctx.method === 'POST' ? this.wave(ctx, runId, run) : false;
    }
    if (action === 'clear') {
      return ctx.method === 'POST' ? this.clear(ctx, runId, run) : false;
    }
    if (action === 'relics') {
      return ctx.method === 'POST' ? this.relics(ctx, runId, run) : false;
    }
    if (action === 'relic') {
      return ctx.method === 'POST' ? this.relic(ctx, runId, run) : false;
    }
    if (action === 'finish') {
      return ctx.method === 'POST' ? this.finish(ctx, runId, run) : false;
    }
    if (action === 'abandon') {
      return ctx.method === 'POST' ? this.abandon(ctx, runId) : false;
    }
    return false;
  }

  async map(ctx, runId, run) {
    const body = await ctx.readJson();
    const index = Math.floor(Number(body.index));
    if (!Number.isInteger(index) || index < 0 || index > 2) {
      return ctx.fail(400, '地图编号不合法');
    }
    const candidates = generateMapCandidates(run.seed, 3);
    const chosen = candidates[index];
    if (!chosen) return ctx.fail(400, '地图不存在');
    if (run.wavesServed > 0) return ctx.fail(409, '远征已经开始，不能更换地图');
    if (run.mapChoice >= 0) {
      if (run.mapChoice === index) {
        return ctx.json(200, { map: chosen, mapMeta: chosen.meta, mapChoice: index });
      }
      return ctx.fail(409, '本局地图已经选择');
    }
    db.prepare('UPDATE runs SET map_choice = ? WHERE id = ?').run(index, runId);
    return ctx.json(200, { map: chosen, mapMeta: chosen.meta, mapChoice: index });
  }

  wave(ctx, runId, run) {
    if (run.mapChoice < 0) return ctx.fail(409, '请先选择地图');
    const candidates = generateMapCandidates(run.seed, 3);
    const mapMeta = candidates[run.mapChoice]?.meta || {};
    const waveOptions = {
      portalCount: mapMeta.portalCount || 1,
      modifier: mapMeta.modifier || null,
    };
    // 有未结算波次时重放当前波，不推进波次、不重复发奖。
    if (run.clearedWaves < run.wavesServed) {
      const current = run.wavesServed;
      return ctx.json(200, {
        wave: generateWave(run.seed, current, run.difficulty, waveOptions),
        replay: true,
        clearedWaves: run.clearedWaves,
        wavesServed: run.wavesServed,
      });
    }
    if (run.clearedWaves >= MAX_WAVE) return ctx.fail(409, '已抵达最终波次');
    const next = run.wavesServed + 1;
    db.prepare('UPDATE runs SET waves_served = ? WHERE id = ?').run(next, runId);
    return ctx.json(200, {
      wave: generateWave(run.seed, next, run.difficulty, waveOptions),
      replay: false,
      clearedWaves: run.clearedWaves,
      wavesServed: next,
    });
  }

  async clear(ctx, runId, run) {
    const body = await ctx.readJson();
    const wave = Math.floor(Number(body.wave));
    if (!Number.isFinite(wave) || wave < 1 || wave > MAX_WAVE) {
      return ctx.fail(400, '波次号不合法');
    }
    if (wave > run.wavesServed) return ctx.fail(409, '该波次尚未放行');
    if (wave <= run.clearedWaves) {
      return ctx.json(200, {
        ok: true,
        clearedWaves: run.clearedWaves,
        wavesServed: run.wavesServed,
        nextWave: run.wavesServed + 1,
        duplicate: true,
      });
    }
    if (wave !== run.wavesServed) {
      return ctx.fail(409, '只能结算当前进行中的波次');
    }
    db.prepare('UPDATE runs SET cleared_waves = ? WHERE id = ?').run(wave, runId);
    return ctx.json(200, {
      ok: true,
      clearedWaves: wave,
      wavesServed: run.wavesServed,
      nextWave: wave + 1,
    });
  }

  async relics(ctx, runId, run) {
    const profile = ctx.profile;
    const body = await ctx.readJson();
    if (run.clearedWaves !== run.wavesServed) {
      return ctx.fail(409, '当前波次尚未结算完成');
    }
    const key = String(run.clearedWaves);
    const maxRerolls = maxRerollsForRun(run, profile);
    let rerollsUsed = run.rerollsUsed;
    const offers = run.offers || {};

    if (body.reroll) {
      if (offers[key]?.picked) return ctx.fail(409, '本次遗物已选择，不能刷新');
      if (rerollsUsed >= maxRerolls) return ctx.fail(409, '刷新次数已用完');
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

    return ctx.json(200, {
      wave: run.clearedWaves,
      offers: slot.offers,
      picked: !!slot.picked,
      relics: relicStates,
      rerollsUsed,
      maxRerolls,
    });
  }

  async relic(ctx, runId, run) {
    const body = await ctx.readJson();
    if (run.clearedWaves !== run.wavesServed) {
      return ctx.fail(409, '当前波次尚未结算完成');
    }
    const offers = run.offers || {};
    const key = String(run.clearedWaves);
    const slot = offers[key];
    if (!slot || !Array.isArray(slot.offers)) return ctx.fail(400, '本次遗物选项不存在');
    if (slot.picked) return ctx.fail(409, '本次遗物已经选择');

    let offer = null;
    const index = Number(body.index);
    if (Number.isInteger(index) && index >= 0 && index < slot.offers.length) {
      offer = slot.offers[index];
    } else if (body.relicId) {
      offer = slot.offers.find(
        (item) => item.kind === 'relic' && item.id === String(body.relicId)
      );
    }
    if (!offer) return ctx.fail(400, '选择不在本次选项中');

    const states = normalizeRelicStates(run.relics);
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
    return ctx.json(200, { applied: offer, picked: true, relics: states });
  }

  async finish(ctx, runId, run) {
    const token = ctx.token;
    const profile = ctx.profile;
    const body = await ctx.readJson();
    const payload = clampFinishPayload(body, run.clearedWaves);
    const mapMeta =
      run.mapChoice >= 0
        ? generateMapCandidates(run.seed, 3)[run.mapChoice]?.meta || null
        : null;
    const outcome = computeOutcome({
      ...payload,
      wavesServed: run.clearedWaves,
      difficulty: run.difficulty,
      scoreMul: mapMeta?.scoreMul || 1,
    });
    const now = Date.now();
    const durationMs = Math.max(0, now - run.createdAt);

    const isPersonalBest = outcome.score > personalBest(token, run.mode, run.day);

    // 幂等结算：只有把 active 改成 finished 的那一次请求（changes=1）才发放奖励。
    const settled = db
      .prepare(
        `UPDATE runs SET status = 'finished', victory = ?, score = ?, wave_reached = ?,
           kills = ?, duration_ms = ?, result_json = ?, finished_at = ?
         WHERE id = ? AND status = 'active'`
      )
      .run(
        outcome.victory ? 1 : 0,
        outcome.score,
        payload.waveReached,
        payload.kills,
        durationMs,
        JSON.stringify({
          rawScore: outcome.rawScore,
          coresEarned: outcome.cores,
          goldLeft: payload.goldLeft,
          baseHp: payload.baseHp,
          contentVersion: run.contentVersion,
          skill: run.ruleset?.skill || null,
        }),
        now,
        runId
      );
    if (settled.changes === 0) return ctx.fail(409, '该远征已结束', 'RUN_FINISHED');

    // 首通授予（漫游→星陨、远征→终章）；失败不授予，重复结算已被上面的条件拦下。
    const unlockedSkillId = outcome.victory ? grantVictorySkillUnlock(token, run.difficulty) : null;
    const unlockedSkills = unlockedSkillId
      ? [{ id: unlockedSkillId, name: SKILLS[unlockedSkillId].name }]
      : [];

    recordLeaderboardEntry({
      accountId: token,
      displayName: profile.name,
      runId,
      mode: run.mode,
      day: run.day,
      difficulty: run.difficulty,
      score: outcome.score,
      durationMs,
      wave: payload.waveReached,
      kills: payload.kills,
      victory: outcome.victory,
      contentVersion: run.contentVersion || CONTENT_VERSION,
      createdAt: now,
    });

    const stats = normalizeStats(profile.stats);
    stats.runs += 1;
    stats.kills += payload.kills;
    if (outcome.victory) stats.wins += 1;
    const byDiff = stats.byDifficulty[run.difficulty];
    byDiff.runs += 1;
    byDiff.bestWave = Math.max(byDiff.bestWave, payload.waveReached);
    byDiff.bestScore = Math.max(byDiff.bestScore, outcome.score);
    if (outcome.victory) byDiff.wins += 1;

    // 星核用原子增量写入，避免并发结算互相覆盖余额。
    grantCores(token, outcome.cores);
    updateProfile(token, { stats });
    const totalCores = getCores(token);

    recordPlayerEvent(token, 'run_finished', {
      runId,
      mode: run.mode,
      difficulty: run.difficulty,
      score: outcome.score,
      victory: outcome.victory,
      waveReached: payload.waveReached,
      coresEarned: outcome.cores,
      unlockedSkill: unlockedSkillId || null,
    });

    const rank = rankFor(run.mode, run.day, outcome.score, {
      includeUnclaimed: !AUTH_ENABLED,
    });

    return ctx.json(200, {
      victory: outcome.victory,
      difficulty: run.difficulty,
      waveReached: payload.waveReached,
      rawScore: outcome.rawScore,
      score: outcome.score,
      coresEarned: outcome.cores,
      totalCores,
      unlockedSkills,
      personalBest: isPersonalBest,
      rank,
      durationMs,
      dailyAttemptsLeft: run.mode === 'daily' ? dailyAttemptsLeft(token) : null,
    });
  }

  abandon(ctx, runId) {
    db.prepare(`UPDATE runs SET status = 'abandoned', finished_at = ? WHERE id = ?`).run(
      Date.now(),
      runId
    );
    return ctx.json(200, { ok: true });
  }
}
