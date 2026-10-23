// 生涯统计：只读聚合已结算的 runs，不改结算逻辑、不改表结构。
import { db } from './index.mjs';
import { DIFFICULTIES, DIFFICULTY_ORDER } from '../../public/js/shared/data.js';

const RECENT_LIMIT = 10;

function winRate(wins, runs) {
  return runs > 0 ? Math.round((wins / runs) * 1000) / 1000 : 0;
}

function roundWave(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

function emptyDifficulty(id) {
  return {
    id,
    name: DIFFICULTIES[id]?.name || id,
    runs: 0,
    wins: 0,
    winRate: 0,
    bestWave: 0,
    avgWave: 0,
    bestScore: 0,
  };
}

function recentRuns(accountId) {
  return db
    .prepare(
      `SELECT id, mode, difficulty, wave_reached, victory, score, kills, duration_ms,
              finished_at, created_at
         FROM runs
        WHERE account_id = ? AND status = 'finished'
        ORDER BY COALESCE(finished_at, created_at) DESC, created_at DESC
        LIMIT ?`
    )
    .all(accountId, RECENT_LIMIT)
    .map((row) => ({
      id: row.id,
      mode: row.mode,
      difficulty: row.difficulty,
      difficultyName: DIFFICULTIES[row.difficulty]?.name || row.difficulty,
      waveReached: Number(row.wave_reached) || 0,
      victory: !!row.victory,
      score: Number(row.score) || 0,
      kills: Number(row.kills) || 0,
      durationMs: Number(row.duration_ms) || 0,
      finishedAt: row.finished_at ?? row.created_at,
    }));
}

export function careerStats(accountId) {
  const rows = db
    .prepare(
      `SELECT difficulty,
              COUNT(*) AS runs,
              SUM(victory) AS wins,
              MAX(wave_reached) AS best_wave,
              AVG(wave_reached) AS avg_wave,
              MAX(score) AS best_score,
              SUM(kills) AS kills
         FROM runs
        WHERE account_id = ? AND status = 'finished'
        GROUP BY difficulty`
    )
    .all(accountId);

  const byDifficulty = new Map(DIFFICULTY_ORDER.map((id) => [id, emptyDifficulty(id)]));
  let runs = 0;
  let wins = 0;
  let bestWave = 0;
  let bestScore = 0;
  let kills = 0;
  let waveTotal = 0;

  for (const row of rows) {
    const target = byDifficulty.get(row.difficulty) || emptyDifficulty(row.difficulty);
    const count = Number(row.runs) || 0;
    const rowWins = Number(row.wins) || 0;
    const rowBestWave = Number(row.best_wave) || 0;
    const rowKills = Number(row.kills) || 0;
    Object.assign(target, {
      runs: count,
      wins: rowWins,
      winRate: winRate(rowWins, count),
      bestWave: rowBestWave,
      avgWave: roundWave(row.avg_wave),
      bestScore: Number(row.best_score) || 0,
    });
    byDifficulty.set(target.id, target);

    runs += count;
    wins += rowWins;
    kills += rowKills;
    bestWave = Math.max(bestWave, rowBestWave);
    bestScore = Math.max(bestScore, Number(row.best_score) || 0);
    waveTotal += (Number(row.avg_wave) || 0) * count;
  }

  return {
    totals: {
      runs,
      wins,
      losses: runs - wins,
      winRate: winRate(wins, runs),
      bestWave,
      avgWave: runs > 0 ? roundWave(waveTotal / runs) : 0,
      bestScore,
      kills,
    },
    byDifficulty: [...byDifficulty.values()],
    recent: recentRuns(accountId),
  };
}
