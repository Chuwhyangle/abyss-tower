// 成就深度：定义规模 / 分组 / 稀有度 / 进度计算 / 隐藏成就遮罩 / 旧 id 兼容。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ACHIEVEMENTS,
  ACHIEVEMENT_BY_ID,
  ACHIEVEMENT_GROUPS,
  ACHIEVEMENT_RARITIES,
  achievementProgress,
  evaluateAchievements,
} from '../public/js/shared/achievements.js';

const DB_PATH = path.join(os.tmpdir(), `rtd-ach-depth-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = DB_PATH;
process.env.DB_BACKUP = '0';

let deps = null;

function ctxWith({
  runs = 0,
  wins = 0,
  kills = 0,
  bestWave = 0,
  bestScore = 0,
  dailyRuns = 0,
  dailyWins = 0,
  relics = null,
} = {}) {
  return {
    run: relics ? { relics } : null,
    stats: {
      runs,
      wins,
      kills,
      byDifficulty: { standard: { runs, wins, bestWave, bestScore } },
    },
    dailyRuns,
    dailyWins,
    unlocked: new Set(),
  };
}

before(async () => {
  const { db } = await import('../server/db/index.mjs');
  const accounts = await import('../server/db/accounts.mjs');
  const achievements = await import('../server/db/achievements.mjs');
  const account = accounts.createAccount({
    kind: 'registered',
    username: `depth${Date.now().toString(36)}`,
    passwordHash: 'depth-test-password',
  });
  const insert = db.prepare(
    `INSERT INTO runs
       (id, account_id, mode, difficulty, seed, day, status, victory, score,
        wave_reached, kills, duration_ms, created_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, 'finished', ?, ?, ?, ?, ?, ?, ?)`
  );
  const now = Date.now();
  insert.run('depth-r1', account.id, 'normal', 'standard', 's1', '2026-10-20', 1, 4000, 12, 150, 60000, now, now);
  insert.run('depth-r2', account.id, 'normal', 'standard', 's2', '2026-10-21', 0, 1000, 6, 150, 90000, now, now);
  insert.run('depth-r3', account.id, 'daily', 'standard', 's3', '2026-10-22', 0, 500, 3, 50, 30000, now, now);
  deps = { db, account, ...achievements };
});

after(() => {
  try {
    deps?.db?.close();
  } catch {
    /* 已关闭 */
  }
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${DB_PATH}${suffix}`, { force: true });
  }
});

test('成就定义：数量 ≥30、id 唯一、分组与稀有度合法', () => {
  assert.ok(ACHIEVEMENTS.length >= 30, `实际 ${ACHIEVEMENTS.length} 条`);
  const ids = new Set();
  for (const achievement of ACHIEVEMENTS) {
    assert.ok(!ids.has(achievement.id), `重复 id：${achievement.id}`);
    ids.add(achievement.id);
    assert.ok(
      ACHIEVEMENT_GROUPS.some((group) => group.id === achievement.group),
      `非法分组：${achievement.group}`
    );
    assert.ok(ACHIEVEMENT_RARITIES[achievement.rarity], `非法稀有度：${achievement.rarity}`);
    assert.equal(typeof achievement.hidden, 'boolean');
    assert.equal(typeof achievement.check, 'function');
    if (achievement.target !== undefined) {
      assert.ok(Number.isInteger(achievement.target) && achievement.target > 0);
      assert.equal(typeof achievement.progress, 'function');
    }
  }
  for (const group of ACHIEVEMENT_GROUPS) {
    assert.ok(
      ACHIEVEMENTS.some((achievement) => achievement.group === group.id),
      `分组没有成就：${group.id}`
    );
  }
});

test('进度计算：0 / 部分 / 完成，并封顶到目标值', () => {
  const kills1000 = ACHIEVEMENT_BY_ID.kills_1000;
  assert.deepEqual(achievementProgress(kills1000, ctxWith()), { current: 0, target: 1000 });
  assert.deepEqual(achievementProgress(kills1000, ctxWith({ kills: 250 })), {
    current: 250,
    target: 1000,
  });
  assert.deepEqual(achievementProgress(kills1000, ctxWith({ kills: 1000 })), {
    current: 1000,
    target: 1000,
  });
  // 超过目标时封顶，避免进度条溢出。
  assert.deepEqual(achievementProgress(ACHIEVEMENT_BY_ID.kills_100, ctxWith({ kills: 999 })), {
    current: 100,
    target: 100,
  });
  // 分难度统计口径。
  assert.deepEqual(achievementProgress(ACHIEVEMENT_BY_ID.wave_20, ctxWith({ bestWave: 12 })), {
    current: 12,
    target: 20,
  });
  assert.deepEqual(achievementProgress(ACHIEVEMENT_BY_ID.score_5000, ctxWith({ bestScore: 4000 })), {
    current: 4000,
    target: 5000,
  });
  // 每日挑战与单局遗物进度。
  assert.deepEqual(achievementProgress(ACHIEVEMENT_BY_ID.daily_10, ctxWith({ dailyRuns: 4 })), {
    current: 4,
    target: 10,
  });
  assert.deepEqual(
    achievementProgress(
      ACHIEVEMENT_BY_ID.relic_collector,
      ctxWith({ relics: [{ level: 1 }, { level: 1 }, { level: 1 }] })
    ),
    { current: 3, target: 5 }
  );
  // 非进度型成就没有进度结构。
  assert.equal(achievementProgress(ACHIEVEMENT_BY_ID.speedrun, ctxWith()), null);
  assert.equal(achievementProgress(ACHIEVEMENT_BY_ID.hidden_perfect_run, ctxWith()), null);
});

test('进度型成就按 target 解锁，重复评估不再新增', () => {
  const context = ctxWith({ runs: 1, kills: 100 });
  const added = evaluateAchievements(context);
  assert.ok(added.includes('first_run'));
  assert.ok(added.includes('kills_100'));
  assert.ok(!added.includes('kills_1000'));

  const again = evaluateAchievements({ ...context, unlocked: new Set(added) });
  assert.deepEqual(again, []);
});

test('隐藏成就在摘要里只返回占位，描述不泄漏', () => {
  const summary = deps.achievementSummary(deps.account.id);
  assert.ok(summary.total >= 30);
  assert.equal(summary.groups.length, ACHIEVEMENT_GROUPS.length);
  assert.equal(
    summary.groups.reduce((sum, group) => sum + group.total, 0),
    summary.total
  );

  const hidden = summary.achievements.filter((item) => item.hidden);
  assert.ok(hidden.length >= 1);
  const lockedHidden = hidden.filter((item) => !item.unlocked);
  assert.ok(lockedHidden.length >= 1);
  const payload = JSON.stringify(summary);
  for (const item of lockedHidden) {
    assert.equal(item.title, '???');
    assert.equal(item.desc, '');
    assert.equal(item.condition, '???');
    assert.equal(item.progress, null);
    assert.ok(!payload.includes(ACHIEVEMENT_BY_ID[item.id].desc), '隐藏成就描述泄漏');
  }
});

test('摘要进度来自服务端实测统计', () => {
  const summary = deps.achievementSummary(deps.account.id);
  const byId = new Map(summary.achievements.map((item) => [item.id, item]));
  // 3 局、350 击杀、最高 12 波、最高 4000 分、1 次每日挑战。
  assert.equal(byId.get('kills_1000').progress.current, 350);
  assert.equal(byId.get('kills_1000').progress.target, 1000);
  assert.equal(byId.get('wave_20').progress.current, 12);
  assert.equal(byId.get('score_5000').progress.current, 4000);
  assert.equal(byId.get('daily_10').progress.current, 1);
  assert.equal(byId.get('runs_10').progress.current, 3);
});

test('旧 id 解锁保持兼容，已解锁成就进度显示完成', () => {
  const added = deps.unlockAchievements(deps.account.id, {
    run: {
      mode: 'normal',
      difficulty: 'standard',
      victory: true,
      waveReached: 12,
      kills: 150,
      score: 4000,
      durationMs: 60000,
      relics: [],
    },
    stats: {
      runs: 3,
      wins: 1,
      kills: 350,
      byDifficulty: {
        roam: { runs: 0, wins: 0, bestWave: 0, bestScore: 0 },
        standard: { runs: 3, wins: 1, bestWave: 12, bestScore: 4000 },
        abyss: { runs: 0, wins: 0, bestWave: 0, bestScore: 0 },
      },
    },
  });
  assert.ok(added.includes('first_run'), `实际解锁：${added.join(',')}`);
  assert.ok(added.includes('first_win'));
  assert.ok(added.includes('wave_10'));
  assert.ok(added.includes('kills_100'));
  assert.ok(added.includes('hidden_no_relic_win'));

  const summary = deps.achievementSummary(deps.account.id);
  const byId = new Map(summary.achievements.map((item) => [item.id, item]));
  assert.equal(byId.get('first_run').unlocked, true);
  assert.equal(typeof byId.get('first_run').unlockedAt, 'number');
  assert.deepEqual(byId.get('first_run').progress, { current: 1, target: 1 });
  // 已解锁的隐藏成就揭晓真实描述。
  assert.equal(byId.get('hidden_no_relic_win').unlocked, true);
  assert.notEqual(byId.get('hidden_no_relic_win').desc, '');
  // 尚未解锁的隐藏成就仍然遮罩。
  assert.equal(byId.get('hidden_perfect_run').desc, '');
});
