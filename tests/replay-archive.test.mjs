// 回放分层归档：20 局明细硬上限、按周纯统计聚合、幂等与结算失败隔离。
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DB_PATH = path.join(os.tmpdir(), `rtd-replay-archive-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = DB_PATH;
process.env.DB_BACKUP = '0';

const DAY = 24 * 60 * 60 * 1000;

let db;
let createProfile;
let hydrateRun;
let insertRun;
let findRun;
let insertReplay;
let archiveOld;
let listWeeklyArchives;
let countReplays;
let weekKey;
let RunService;

let seq = 0;

function removeDb() {
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${DB_PATH}${suffix}`, { force: true });
  }
}

function seedAccount(accountId) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO accounts (id, kind, created_at, updated_at)
     VALUES (?, 'unclaimed', ?, ?)`
  ).run(accountId, now, now);
  return createProfile(accountId);
}

function seedReplay(accountId, finishedAt, { score, kills, victory, waveReached }) {
  seq += 1;
  const runId = `run-${accountId}-${seq}`;
  const replayId = `replay-${accountId}-${seq}`;
  insertRun({
    id: runId,
    accountId,
    mode: 'normal',
    boardKey: 'normal',
    difficulty: 'standard',
    seed: `seed-${seq}`,
    day: '2026-01-05',
    contentVersion: 'test',
    relics: '[]',
    createdAt: finishedAt - 1000,
  });
  insertReplay({
    id: replayId,
    accountId,
    runId,
    mode: 'normal',
    difficulty: 'standard',
    seed: `seed-${seq}`,
    mapChoice: -1,
    summary: '{}',
    result: JSON.stringify({ victory, score, kills, waveReached }),
    createdAt: finishedAt - 1000,
    finishedAt,
  });
  return replayId;
}

before(async () => {
  ({ db } = await import('../server/db/index.mjs'));
  ({ createProfile, hydrateRun } = await import('../server/db.mjs'));
  ({ insertRun, findRun } = await import('../server/db/runs.mjs'));
  ({ insertReplay, archiveOld, listWeeklyArchives, countReplays } = await import(
    '../server/db/replays.mjs'
  ));
  ({ weekKey } = await import('../public/js/shared/scoring.js'));
  ({ RunService } = await import('../server/services/run-service.mjs'));
});

after(() => {
  try {
    db?.close();
  } catch {
    /* ignore */
  }
  removeDb();
});

test('明细上限硬约束：超过 20 局的旧记录按周聚合后删除', () => {
  const accountId = 'archive-cap';
  seedAccount(accountId);

  // 2026-01-05 是周一，对应 ISO 2026-W02；后两批分别落在 W03、W04。
  const monday = new Date(2026, 0, 5, 12, 0, 0).getTime();
  const created = [];
  for (let i = 0; i < 25; i++) {
    const weekOffset = i < 10 ? 0 : i < 18 ? 7 : 14;
    const finishedAt = monday + weekOffset * DAY + i * 1000;
    created.push(
      seedReplay(accountId, finishedAt, {
        score: 100 + i,
        kills: 10 + i,
        victory: i % 3 === 0,
        waveReached: (i % 10) + 1,
      })
    );
  }

  const archived = archiveOld(accountId);
  assert.equal(archived.archived, 5, '只有超出上限的 5 局进入归档');
  assert.equal(countReplays(accountId), 20, '明细必须收敛到 20 局');

  const weekly = listWeeklyArchives(accountId);
  assert.equal(weekly.length, 1, '被归档的 5 局同属一周，应合成一行');
  assert.deepEqual(weekly[0], {
    week: '2026-W02',
    runs: 5,
    victories: 2,
    scoreSum: 510,
    bestScore: 104,
    killsSum: 60,
    bestWave: 5,
    updatedAt: weekly[0].updatedAt,
  });
  assert.ok(weekly[0].updatedAt > 0);

  // 统计行只含聚合值，不携带任何单局定位信息。
  for (const forbidden of ['id', 'runId', 'seed', 'relics', 'events', 'accountId']) {
    assert.equal(forbidden in weekly[0], false, `周聚合不应包含 ${forbidden}`);
  }

  const remaining = db
    .prepare('SELECT id FROM replays WHERE account_id = ? ORDER BY finished_at ASC')
    .all(accountId)
    .map((row) => row.id);
  for (const removed of created.slice(0, 5)) {
    assert.equal(remaining.includes(removed), false, '最旧的 5 局明细应被删除');
  }
  assert.equal(remaining.length, 20);

  // 幂等：没有新的超限明细时，重复归档不改变任何统计。
  const again = archiveOld(accountId);
  assert.deepEqual(again, { archived: 0, weeks: [] });
  assert.equal(countReplays(accountId), 20);
  assert.deepEqual(listWeeklyArchives(accountId), weekly);
});

test('周聚合按账号隔离，不泄露他人数据', () => {
  const owner = 'archive-owner';
  const stranger = 'archive-stranger';
  seedAccount(owner);
  seedAccount(stranger);

  const monday = new Date(2026, 1, 2, 12, 0, 0).getTime(); // 2026-02-02 → ISO W06
  for (let i = 0; i < 22; i++) {
    const finishedAt = monday + i * 1000;
    seedReplay(owner, finishedAt, { score: 10, kills: 1, victory: false, waveReached: 2 });
    seedReplay(stranger, finishedAt, { score: 99, kills: 9, victory: true, waveReached: 7 });
  }

  archiveOld(owner);

  const ownerWeekly = listWeeklyArchives(owner);
  assert.equal(ownerWeekly.length, 1);
  assert.equal(ownerWeekly[0].runs, 2, '只归档本人超限的 2 局');
  assert.equal(ownerWeekly[0].scoreSum, 20);
  assert.equal(ownerWeekly[0].victories, 0);

  assert.equal(listWeeklyArchives(stranger).length, 0, '他人未归档，不应看到聚合行');
  assert.equal(countReplays(stranger), 22, '归档他人不影响本人明细');

  archiveOld(stranger);
  const strangerWeekly = listWeeklyArchives(stranger);
  assert.equal(strangerWeekly[0].runs, 2);
  assert.equal(strangerWeekly[0].victories, 2);
  assert.equal(strangerWeekly[0].bestWave, 7);
  assert.deepEqual(listWeeklyArchives(owner), ownerWeekly, '先归档的账号不受影响');

  assert.deepEqual(listWeeklyArchives('nobody'), []);
});

test('归档失败不影响结算：本局照常落库，下次结算重试归档', () => {
  const accountId = 'archive-settle';
  const profile = seedAccount(accountId);

  // 预置 20 局旧明细，本次结算后就会触发归档。
  const monday = new Date(2026, 2, 2, 12, 0, 0).getTime();
  for (let i = 0; i < 20; i++) {
    seedReplay(accountId, monday + i * 1000, {
      score: 50 + i,
      kills: 1,
      victory: false,
      waveReached: 1,
    });
  }

  // 人为让周聚合写入失败：结算仍必须成功。
  db.exec(
    `CREATE TRIGGER fail_replay_weekly BEFORE INSERT ON replay_weekly
       BEGIN SELECT RAISE(ABORT, 'archive boom'); END;`
  );

  const runId = 'archive-settle-run';
  insertRun({
    id: runId,
    accountId,
    mode: 'normal',
    boardKey: 'normal',
    difficulty: 'standard',
    seed: 'archive-settle-seed',
    day: '2026-03-02',
    contentVersion: 'test',
    relics: '[]',
    createdAt: Date.now() - 60_000,
  });
  db.prepare('UPDATE runs SET waves_served = 3, cleared_waves = 3, map_choice = 0 WHERE id = ?').run(
    runId
  );

  const service = new RunService();
  const settled = service.settle(hydrateRun(findRun(runId)), profile, {
    waveReached: 3,
    kills: 12,
    goldLeft: 5,
    baseHp: 10,
  });

  assert.ok(settled.replayId, '归档失败不应吞掉结算响应');
  assert.equal(db.prepare('SELECT status FROM runs WHERE id = ?').get(runId).status, 'finished');
  assert.equal(countReplays(accountId), 21, '本局回放已随结算事务落库，归档回滚不删明细');
  assert.deepEqual(listWeeklyArchives(accountId), [], '归档失败后不留下半截统计');

  // 故障消除后重试归档：明细收敛且聚合正确。
  db.exec('DROP TRIGGER fail_replay_weekly');
  const retry = archiveOld(accountId);
  assert.equal(retry.archived, 1);
  assert.equal(countReplays(accountId), 20);
  const weekly = listWeeklyArchives(accountId);
  assert.equal(weekly.length, 1);
  assert.equal(weekly[0].runs, 1);
});
