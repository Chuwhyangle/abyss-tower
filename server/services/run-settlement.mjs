// 远征结算编排：成绩计算、结算事务、回放归档、成就/通知/排行榜写入与返回值组装。
// 规则派生来自 run-rules.mjs，榜单写入走仓储层，服务类只把本文件的结果交给路由。
import crypto from 'node:crypto';

import { normalizeStats, transaction, updateProfile } from '../db.mjs';
import { REPLAY_LIMIT, archiveOld, insertReplay } from '../db/replays.mjs';
import { settleRun } from '../db/runs.mjs';
import { personalBest, rankFor, recordLeaderboardEntry } from '../db/leaderboard.mjs';
import { seasonOf } from '../db/leaderboard-sql.mjs';
import { validateLeaderboardEntry } from '../db/leaderboard-validate.mjs';
import { recordPlayerEvent } from '../db/events.mjs';
import { unlockAchievements } from '../db/achievements.mjs';
import { grantVictorySkillUnlock } from '../db/skills.mjs';
import { grantLegacyInTx } from '../db/legacy.mjs';
import { AUTH_ENABLED, CONTENT_VERSION } from '../config.mjs';
import { clampFinishPayload, computeOutcome, hexScoreMul } from '../../public/js/shared/scoring.js';
import { mutationScoreMul } from '../../public/js/shared/mutations.js';
import { SKILLS } from '../../public/js/shared/data.js';
import { legacyYield } from '../../public/js/shared/data/meta.js';
import { chosenMapFor, dailyAttemptsLeft, hexFor, weeklyAttemptsLeft } from './run-rules.mjs';

// 结算一局的全部副作用；replaySummary 由服务类提供，保证回放摘要与主动读取共用同一口径。
export function settleRunOutcome({ run, profile, body, replaySummary }) {
  const token = run.token;
  const payload = clampFinishPayload(body, run.clearedWaves);
  const mapMeta = chosenMapFor(run)?.meta || null;
  const mutationMul = mutationScoreMul(run.ruleset?.mutations?.ids || []);
  const hex = hexFor(run);
  // 旧 run 的 ruleset 没有 hex：hexScoreMul 返回 1.0，分数与改动前一致。
  const hexMul = hexScoreMul(hex?.id);
  const outcome = computeOutcome({
    ...payload,
    wavesServed: run.clearedWaves,
    difficulty: run.difficulty,
    scoreMul: (mapMeta?.scoreMul || 1) * mutationMul * hexMul,
    mode: run.mode,
  });
  const now = Date.now();
  const durationMs = Math.max(0, now - run.createdAt);
  // 无尽榜按结算时间归入赛季，与榜单 created_at 的赛季边界保持一致。
  const season = seasonOf(now);

  // 跨局传承：按本局表现确定性产出传承材料，与星核（cores）分账、不重复结算。
  const legacy = legacyYield({
    waveReached: payload.waveReached,
    kills: payload.kills,
    victory: outcome.victory,
  });

  const isPersonalBest = outcome.score > personalBest(token, run.mode, run.day, { season });
  const replayId = crypto.randomBytes(9).toString('base64url');
  const replayResult = {
    victory: outcome.victory,
    score: outcome.score,
    rawScore: outcome.rawScore,
    coresEarned: outcome.cores,
    waveReached: payload.waveReached,
    kills: payload.kills,
    goldLeft: payload.goldLeft,
    baseHp: payload.baseHp,
    durationMs,
    contentVersion: run.contentVersion,
    hexId: hex?.id || null,
  };

  // 结算与回放摘要在同一事务里落地：任一步失败都不会留下半局记录。
  transaction(() => {
    settleRun(run.id, {
      victory: outcome.victory,
      score: outcome.score,
      waveReached: payload.waveReached,
      kills: payload.kills,
      durationMs,
      result: JSON.stringify({
        rawScore: outcome.rawScore,
        coresEarned: outcome.cores,
        goldLeft: payload.goldLeft,
        baseHp: payload.baseHp,
        contentVersion: run.contentVersion,
      }),
      finishedAt: now,
    });
    insertReplay({
      id: replayId,
      accountId: token,
      runId: run.id,
      mode: run.mode,
      difficulty: run.difficulty,
      seed: run.seed,
      mapChoice: run.mapChoice,
      summary: JSON.stringify(replaySummary(run, payload)),
      result: JSON.stringify(replayResult),
      createdAt: run.createdAt,
      finishedAt: now,
    });
  });

  // 归档发生在结算事务之外：失败只影响历史聚合，绝不影响本局结算。
  // 明细删除与聚合写入同事务，下次结算会整体重试。
  try {
    archiveOld(token, REPLAY_LIMIT);
  } catch {
    /* 归档失败不影响结算 */
  }

  // 首通授予必须在更新战绩之前：skillUnlocked 会从历史首通派生，
  // 先写 wins 会让本次授予误判为「已解锁」而返回 null。
  const unlockedSkillId = outcome.victory ? grantVictorySkillUnlock(token, run.difficulty) : null;
  const unlockedSkills = unlockedSkillId
    ? [{ id: unlockedSkillId, name: SKILLS[unlockedSkillId].name }]
    : [];

  // 入榜前过基线反作弊：异常成绩直接拒绝入榜但照常结算，可疑成绩钳制后标记。
  // 变异/海克斯倍率同步放宽反作弊上下限，否则合法的高倍率成绩会被误判。
  const guard = validateLeaderboardEntry(
    {
      score: outcome.score,
      durationMs,
      wave: payload.waveReached,
      kills: payload.kills,
    },
    { scoreMul: mutationMul * hexMul }
  );
  const guardEvent = {
    runId: run.id,
    reason: guard.reason,
    flags: guard.flags,
    mode: run.mode,
    difficulty: run.difficulty,
    wave: payload.waveReached,
    kills: guard.kills,
    durationMs,
    score: outcome.score,
  };
  let leaderboardNotice = null;

  if (guard.accepted) {
    recordLeaderboardEntry({
      accountId: token,
      displayName: profile.name,
      runId: run.id,
      mode: run.mode,
      day: run.day,
      difficulty: run.difficulty,
      score: outcome.score,
      durationMs,
      wave: payload.waveReached,
      kills: guard.kills,
      victory: outcome.victory,
      suspect: guard.suspect,
      contentVersion: run.contentVersion || CONTENT_VERSION,
      createdAt: now,
    });
    if (guard.suspect) {
      recordPlayerEvent(token, 'leaderboard_suspect', guardEvent);
      leaderboardNotice = '本局成绩已记录，正在复核。';
    }
  } else {
    recordPlayerEvent(token, 'leaderboard_rejected', guardEvent);
    leaderboardNotice = '本局成绩未能进入排行榜，已提交复核。';
  }

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

  // 传承材料累加到账号级账本（player_kv('meta','legacy')），与星核 wallet 分账、互不混用。
  const legacyAfter = transaction(() => grantLegacyInTx(token, legacy.bank));

  recordPlayerEvent(token, 'run_finished', {
    runId: run.id,
    mode: run.mode,
    difficulty: run.difficulty,
    score: outcome.score,
    victory: outcome.victory,
    waveReached: payload.waveReached,
  });

  const unlockedAchievements = unlockAchievements(token, {
    run: {
      mode: run.mode,
      difficulty: run.difficulty,
      victory: outcome.victory,
      waveReached: payload.waveReached,
      kills: payload.kills,
      score: outcome.score,
      durationMs,
      relics: run.relics,
    },
    stats: updated.stats,
  });

  const rank = rankFor(run.mode, run.day, outcome.score, {
    includeUnclaimed: !AUTH_ENABLED,
    season,
    wave: payload.waveReached,
    durationMs,
  });

  return {
    victory: outcome.victory,
    difficulty: run.difficulty,
    replayId,
    waveReached: payload.waveReached,
    rawScore: outcome.rawScore,
    score: outcome.score,
    coresEarned: outcome.cores,
    totalCores: updated.cores,
    legacyEarned: legacy.bank,
    totalLegacy: legacyAfter.bank,
    personalBest: guard.accepted && isPersonalBest,
    rank,
    durationMs,
    skill: run.ruleset?.skill || null,
    mutations: run.ruleset?.mutations || null,
    hexId: hex?.id || null,
    unlockedSkill: unlockedSkillId || null,
    unlockedSkills,
    dailyAttemptsLeft: run.mode === 'daily' ? dailyAttemptsLeft(token) : null,
    weeklyAttemptsLeft: run.mode === 'weekly' ? weeklyAttemptsLeft(token, run.day) : null,
    unlockedAchievements,
    // 仅在成绩被拒绝或标记可疑时附加面向玩家的非技术性提示；正常对局不增加字段。
    ...(leaderboardNotice ? { leaderboardNotice } : {}),
  };
}
