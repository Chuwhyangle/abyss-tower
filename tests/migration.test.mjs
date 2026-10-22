// 旧库迁移：补 cleared_waves/difficulty/victory/duration 列，回填已清波次，归一化旧遗物。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

test('旧库自动补列、回填已清波次并归一化遗物', async () => {
  const dbPath = path.join(os.tmpdir(), `rtd-migration-${process.pid}-${Date.now()}.db`);
  const old = new DatabaseSync(dbPath);
  old.exec(`
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      mode TEXT NOT NULL,
      seed TEXT NOT NULL,
      day TEXT NOT NULL,
      waves_served INTEGER NOT NULL DEFAULT 0,
      relics TEXT NOT NULL DEFAULT '[]',
      offers TEXT NOT NULL DEFAULT '{}',
      rerolls_used INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      score INTEGER NOT NULL DEFAULT 0,
      wave_reached INTEGER NOT NULL DEFAULT 0,
      kills INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      finished_at INTEGER
    );
  `);
  old.prepare(
    `INSERT INTO runs (id, token, mode, seed, day, waves_served, relics, offers, status, wave_reached, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'finished-run', 'tok', 'normal', 'seed-a', '2026-10-20', 12,
    JSON.stringify([{ id: 'sharp', mods: { dmg: { arrow: 0.25 } } }]),
    '{}', 'finished', 12, Date.now()
  );
  old.prepare(
    `INSERT INTO runs (id, token, mode, seed, day, waves_served, relics, offers, status, wave_reached, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'active-run', 'tok', 'normal', 'seed-b', '2026-10-20', 5,
    '[]', JSON.stringify({ 4: { ids: ['sharp', 'eagle', 'crit'] } }),
    'active', 0, Date.now()
  );
  old.close();

  try {
    process.env.DB_PATH = dbPath;
    const dbModule = await import('../server/db.mjs');
    const columns = dbModule.db.prepare('PRAGMA table_info(runs)').all().map((c) => c.name);
    for (const name of ['cleared_waves', 'map_choice', 'difficulty', 'victory', 'duration_ms']) {
      assert.ok(columns.includes(name), `缺少列 ${name}`);
    }

    const finished = dbModule.hydrateRun(dbModule.getRun('finished-run'));
    assert.equal(finished.clearedWaves, 12);
    assert.equal(finished.mapChoice, 0);
    assert.deepEqual(finished.relics, [{ id: 'sharp', level: 1 }]);

    const active = dbModule.hydrateRun(dbModule.getRun('active-run'));
    assert.equal(active.clearedWaves, 4, '旧进行中远征保守回退一波');
    assert.equal(active.status, 'abandoned', '旧进行中远征因缺少地图选择被弃用');
  } finally {
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.rmSync(`${dbPath}${suffix}`, { force: true }); } catch { /* ignore */ }
    }
  }
});
