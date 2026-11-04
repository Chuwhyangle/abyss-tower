// 真人游玩分析脚本测试：喂临时 db 断言聚合正确性 + check 双模式 exit code。
// 聚合函数以 DB 行形状（snake_case 列名）为入参，测试夹具直接喂与 SQL 返回一致的行。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import {
  aggregateOverall,
  aggregateHexes,
  aggregateRelics,
  aggregateFailures,
  aggregateModeUsage,
  parseBalanceTargets,
  evaluateHumanVsBot,
} from '../scripts/play-analytics.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'play-analytics.mjs');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'play-analytics-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS runs (
    id              TEXT PRIMARY KEY,
    account_id      TEXT NOT NULL,
    mode            TEXT NOT NULL,
    difficulty      TEXT NOT NULL DEFAULT 'standard',
    content_version TEXT NOT NULL DEFAULT 'v1.4-map2',
    ruleset_json    TEXT NOT NULL DEFAULT '{}',
    wave_reached    INTEGER NOT NULL DEFAULT 0,
    duration_ms     INTEGER NOT NULL DEFAULT 0,
    relics          TEXT NOT NULL DEFAULT '[]',
    offers          TEXT NOT NULL DEFAULT '{}',
    result_json     TEXT NOT NULL DEFAULT '{}',
    victory         INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'finished'
  );
`;

function seedDb(file, rows) {
  const db = new DatabaseSync(file);
  try {
    db.exec(SCHEMA);
    db.exec('DELETE FROM runs');
    const insert = db.prepare(
      `INSERT INTO runs (id, account_id, mode, difficulty, content_version, ruleset_json,
         wave_reached, duration_ms, relics, offers, result_json, victory, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    rows.forEach((row, index) => {
      insert.run(
        row.id ?? `run-${index}`,
        row.accountId ?? `acct-${index}`,
        row.mode ?? 'normal',
        row.difficulty ?? 'standard',
        row.content_version ?? 'v1.4-map2',
        JSON.stringify(row.ruleset_json ?? {}),
        row.wave_reached ?? 0,
        row.duration_ms ?? 0,
        JSON.stringify(row.relics ?? []),
        JSON.stringify(row.offers ?? {}),
        JSON.stringify(row.result_json ?? {}),
        row.victory ? 1 : 0,
        row.status ?? 'finished'
      );
    });
  } finally {
    db.close();
  }
}

const BALANCE = `# 平衡模拟记录

## 目标达成（全解锁 · 零 meta，机器人口径）

| 难度 | 目标区间 | 本轮 | 状态 |
| --- | --- | --- | --- |
| 漫游 | 70–85% | 78% | 达标 |
| 远征 | 25–40% | 25% | 达标 |
| 深渊 | 5–12% | 8% | 达标 |

## 目标达成（全解锁 · 满 meta，机器人口径）

| 难度 | 目标区间 | 本轮 | 状态 |
| --- | --- | --- | --- |
| 漫游 | 70–85% | 81% | 达标 |
| 远征 | 25–40% | 40% | 达标 |
| 深渊 | 5–12% | 12% | 达标 |
`;

test('aggregateOverall：难度×mode×content_version 的局数/通关率/均值', () => {
  const rows = [
    { mode: 'normal', difficulty: 'roam', content_version: 'v1', victory: true, wave_reached: 10, duration_ms: 1000, result_json: { goldLeft: 100, baseHp: 5 } },
    { mode: 'normal', difficulty: 'roam', content_version: 'v1', victory: false, wave_reached: 6, duration_ms: 500, result_json: { goldLeft: 40, baseHp: 0 } },
    { mode: 'daily', difficulty: 'standard', content_version: 'v1', victory: true, wave_reached: 12, duration_ms: 2000, result_json: {} },
    { mode: 'daily', difficulty: 'standard', content_version: 'v2', victory: false, wave_reached: 8, duration_ms: 900, result_json: { goldLeft: 70, baseHp: 2 } },
  ];
  const out = aggregateOverall(rows);
  assert.equal(out.length, 3);

  const roam = out.find((r) => r.difficulty === 'roam' && r.mode === 'normal');
  assert.equal(roam.contentVersion, 'v1');
  assert.equal(roam.count, 2);
  assert.equal(roam.winRate, 0.5);
  assert.equal(roam.avgWave, 8);
  assert.equal(roam.avgDurationMs, 750);
  assert.equal(roam.avgGold, 70);
  assert.equal(roam.avgBaseHp, 2.5);

  const stdV1 = out.find((r) => r.difficulty === 'standard' && r.contentVersion === 'v1');
  assert.equal(stdV1.winRate, 1);
  // result_json 为空对象：余金/剩血应为 null（无样本）。
  assert.equal(stdV1.avgGold, null);
  assert.equal(stdV1.avgBaseHp, null);
});

test('aggregateHexes：选取率=选中/出现，胜率只算选中局', () => {
  const rows = [
    { content_version: 'v1', ruleset_json: { hex: { id: 'one_tower', offers: ['one_tower', 'swarm', 'golden_law'] } }, victory: true },
    { content_version: 'v1', ruleset_json: { hex: { id: 'swarm', offers: ['one_tower', 'swarm', 'golden_law'] } }, victory: false },
    { content_version: 'v1', ruleset_json: { hex: { id: 'one_tower', offers: ['one_tower', 'swarm', 'glass_cannon'] } }, victory: false },
    { content_version: 'v1', ruleset_json: {}, victory: true },
  ];
  const out = aggregateHexes(rows);
  const oneTower = out.find((r) => r.hex === 'one_tower');
  assert.equal(oneTower.name, '独塔为王');
  assert.equal(oneTower.offered, 3);
  assert.equal(oneTower.picked, 2);
  assert.equal(oneTower.pickRate, 2 / 3);
  assert.equal(oneTower.winRate, 0.5);
});

test('aggregateRelics：选取率=持有/出现，胜率差=持有胜率−未持有胜率', () => {
  const rows = [
    // run A：锐利箭簇出现在三选一里并被持有；胜利。
    { content_version: 'v1', victory: true, relics: [{ id: 'sharp', level: 1 }], offers: { '1': { offers: [{ kind: 'relic', id: 'sharp' }, { kind: 'relic', id: 'eagle' }] } } },
    // run B：锐利箭簇出现但未持有；失败。
    { content_version: 'v1', victory: false, relics: [], offers: { '1': { offers: [{ kind: 'relic', id: 'sharp' }] } } },
    // run C：持有锐利箭簇（未出现在 offers 里）；胜利。
    { content_version: 'v1', victory: true, relics: ['sharp'], offers: {} },
  ];
  const out = aggregateRelics(rows);
  const sharp = out.find((r) => r.relic === 'sharp');
  assert.equal(sharp.name, '锐利箭簇');
  assert.equal(sharp.offered, 2);
  assert.equal(sharp.owned, 2);
  assert.equal(sharp.pickRate, 1);
  assert.equal(sharp.winRateWith, 1);
  // 未持有 = run B（失败）→ 胜率 0。
  assert.equal(sharp.winRateWithout, 0);
  assert.equal(sharp.winRateDelta, 1);
});

test('aggregateFailures：只统计失败局并按波次聚合', () => {
  const rows = [
    { content_version: 'v1', victory: false, wave_reached: 3 },
    { content_version: 'v1', victory: false, wave_reached: 3 },
    { content_version: 'v1', victory: true, wave_reached: 12 },
    { content_version: 'v2', victory: false, wave_reached: 7 },
  ];
  const out = aggregateFailures(rows);
  assert.equal(out.find((r) => r.contentVersion === 'v1' && r.wave === 3).failCount, 2);
  assert.equal(out.find((r) => r.contentVersion === 'v2' && r.wave === 7).failCount, 1);
  assert.equal(out.some((r) => r.wave === 12), false);
});

test('aggregateModeUsage：全部状态按 mode 计数', () => {
  const rows = [
    { mode: 'normal', content_version: 'v1' },
    { mode: 'normal', content_version: 'v1' },
    { mode: 'tower', content_version: 'v1' },
    { mode: 'tower', content_version: 'v2' },
  ];
  const out = aggregateModeUsage(rows);
  assert.equal(out.find((r) => r.mode === 'normal' && r.contentVersion === 'v1').runCount, 2);
  assert.equal(out.find((r) => r.mode === 'tower' && r.contentVersion === 'v1').runCount, 1);
});

test('parseBalanceTargets：解析零 meta 表并停在满 meta 表前', () => {
  const targets = parseBalanceTargets(BALANCE);
  assert.deepEqual([...targets.keys()].sort(), ['abyss', 'roam', 'standard']);
  assert.deepEqual(targets.get('roam'), { lo: 70, hi: 85 });
  assert.deepEqual(targets.get('standard'), { lo: 25, hi: 40 });
  assert.deepEqual(targets.get('abyss'), { lo: 5, hi: 12 });
});

test('evaluateHumanVsBot：样本不足不判定、超阈值才 fail', () => {
  const targets = parseBalanceTargets(BALANCE);
  // n=2 < floor=3 → 样本不足 → ok。
  const insufficient = evaluateHumanVsBot({
    rows: [
      { difficulty: 'standard', victory: false },
      { difficulty: 'standard', victory: false },
    ],
    targets,
    floor: 3,
  });
  assert.equal(insufficient.ok, true);
  // 三档难度全部样本不足（roam/abyss n=0，standard n=2），无 fail。
  assert.equal(insufficient.insufficient.length, 3);
  assert.equal(insufficient.failures.length, 0);
  assert.equal(insufficient.insufficient.find((i) => i.difficulty === 'standard').n, 2);

  // n=4 ≥ floor=3，真人 0% vs 目标 25–40% → 偏差 25pp > 10pp → fail。
  const failing = evaluateHumanVsBot({
    rows: [
      { difficulty: 'standard', victory: false },
      { difficulty: 'standard', victory: false },
      { difficulty: 'standard', victory: false },
      { difficulty: 'standard', victory: false },
    ],
    targets,
    floor: 3,
  });
  assert.equal(failing.ok, false);
  assert.equal(failing.failures.length, 1);
  assert.equal(failing.failures[0].difficulty, 'standard');
  assert.equal(failing.failures[0].deviationPp, 25);
});

test('check human-vs-bot CLI：样本不足 exit 0、超阈值 exit 1', (t) => {
  const dir = tempDir(t);
  const dbFile = path.join(dir, 'game.db');
  const balanceFile = path.join(dir, 'BALANCE.md');
  fs.writeFileSync(balanceFile, BALANCE, 'utf8');

  function runCheck(extra) {
    return spawnSync(process.execPath, [SCRIPT, 'check', 'human-vs-bot', '--db', dbFile, '--balance', balanceFile, ...extra], {
      cwd: ROOT,
      encoding: 'utf8',
    });
  }

  // 样本不足：floor 高于实际 n → exit 0。
  seedDb(dbFile, [{ difficulty: 'standard', victory: false }]);
  const insufficient = runCheck(['--floor', '5']);
  assert.equal(insufficient.status, 0, insufficient.stderr || insufficient.stdout);
  assert.match(insufficient.stdout, /样本不足/);

  // 超阈值：4 局远征全败，真人 0% vs 目标 25–40%，偏差 25pp > 10pp → exit 1 并写原因。
  seedDb(dbFile, [
    { difficulty: 'standard', victory: false },
    { difficulty: 'standard', victory: false },
    { difficulty: 'standard', victory: false },
    { difficulty: 'standard', victory: false },
  ]);
  const failing = runCheck(['--floor', '3']);
  assert.equal(failing.status, 1, failing.stdout);
  assert.match(failing.stdout, /远征/);
});

test('report CLI：5 段报告、content_version 分桶、不泄露 account_id', (t) => {
  const dir = tempDir(t);
  const dbFile = path.join(dir, 'game.db');
  seedDb(dbFile, [
    { id: 'r1', accountId: 'secret-account-1', mode: 'normal', difficulty: 'roam', content_version: 'v1', victory: true, wave_reached: 10, duration_ms: 1000, result_json: { goldLeft: 50, baseHp: 3 }, ruleset_json: { hex: { id: 'one_tower', offers: ['one_tower'] } } },
    { id: 'r2', accountId: 'secret-account-2', mode: 'daily', difficulty: 'standard', content_version: 'v1', victory: false, wave_reached: 4, duration_ms: 300, result_json: { goldLeft: 0, baseHp: 0 } },
  ]);

  const result = spawnSync(process.execPath, [SCRIPT, 'report', '--db', dbFile], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /## 总体（难度 × mode）/);
  assert.match(result.stdout, /## 主海克斯选取率 \/ 胜率/);
  assert.match(result.stdout, /## 遗物选取率 \/ 胜率差/);
  assert.match(result.stdout, /## 失败波次分布/);
  assert.match(result.stdout, /## mode 使用量/);
  assert.doesNotMatch(result.stdout, /secret-account/);
  assert.doesNotMatch(result.stdout, /account/);

  // content_version 分桶：v1 出现在报告里。
  assert.match(result.stdout, /v1/);
});

test('report 只读：直接连库不改动 runs 表', (t) => {
  const dir = tempDir(t);
  const dbFile = path.join(dir, 'game.db');
  seedDb(dbFile, [{ id: 'r1', accountId: 'a', mode: 'normal', difficulty: 'roam', victory: false }]);
  const db = new DatabaseSync(dbFile, { readOnly: true });
  const before = db.prepare('SELECT COUNT(*) AS c FROM runs').get().c;
  db.close();

  const result = spawnSync(process.execPath, [SCRIPT, 'report', '--db', dbFile], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const after = new DatabaseSync(dbFile, { readOnly: true }).prepare('SELECT COUNT(*) AS c FROM runs').get().c;
  assert.equal(after, before);
});
