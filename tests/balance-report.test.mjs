// 平衡报告结构、字段完整性与可复现性测试。
// 用最小口径（1 种子 × 1 候选）跑两次，确认同种子输出逐字节一致。
import test from 'node:test';
import assert from 'node:assert/strict';

import { runBatch, buildReport } from './balance-sim.mjs';
import {
  DIFFICULTY_ORDER,
  ENEMIES,
  RELICS,
  TOWERS,
} from '../public/js/shared/data.js';
import { BALANCE_TARGETS } from '../public/js/shared/config.js';

const OPTIONS = { seeds: 1, candidates: 1 };
const rows = runBatch(OPTIONS);
const report = buildReport(rows, OPTIONS);

test('报告元信息记录口径且不含时间戳', () => {
  assert.equal(report.meta.seeds, 1);
  assert.equal(report.meta.candidates, 1);
  assert.equal(report.meta.totalRuns, rows.length);
  assert.equal(report.meta.totalRuns, DIFFICULTY_ORDER.length * 2 * OPTIONS.seeds * OPTIONS.candidates);
  assert.deepEqual(report.meta.difficultyOrder, DIFFICULTY_ORDER);
  assert.deepEqual(report.meta.targets, BALANCE_TARGETS);
  assert.equal(Object.hasOwn(report.meta, 'generatedAt'), false);
  for (const id of DIFFICULTY_ORDER) {
    const diff = report.meta.difficulties[id];
    assert.equal(typeof diff.name, 'string');
    for (const key of ['hpMul', 'countMul', 'speedMul', 'goldBonus', 'hpBonus']) {
      assert.equal(typeof diff[key], 'number', `${id}.${key}`);
    }
  }
});

test('总体汇总覆盖 难度 × 解锁状态 且通关率合法', () => {
  assert.equal(report.summary.length, DIFFICULTY_ORDER.length * 2);
  for (const id of DIFFICULTY_ORDER) {
    for (const meta of ['base', 'full']) {
      const row = report.summary.find((item) => item.difficulty === id && item.meta === meta);
      assert.ok(row, `缺少 ${id}:${meta}`);
      assert.equal(row.runs, OPTIONS.seeds * OPTIONS.candidates);
      assert.ok(row.winRate >= 0 && row.winRate <= 1);
      assert.equal(typeof row.avgWave, 'number');
      assert.equal(typeof row.avgScore, 'number');
    }
  }
});

test('目标状态完整并引用 BALANCE_TARGETS', () => {
  assert.equal(report.targets.length, DIFFICULTY_ORDER.length);
  for (const row of report.targets) {
    const [low, high] = BALANCE_TARGETS[row.difficulty];
    assert.equal(row.low, low);
    assert.equal(row.high, high);
    assert.ok(['达标', '高于目标', '低于目标', '无数据'].includes(row.status));
    if (row.winRate != null) {
      assert.ok(row.winRate >= 0 && row.winRate <= 1);
    }
  }
});

test('逐塔分解覆盖全部塔与全部难度/解锁组合', () => {
  assert.equal(report.content.towers.length, Object.keys(TOWERS).length * DIFFICULTY_ORDER.length * 2);
  for (const id of DIFFICULTY_ORDER) {
    for (const meta of ['base', 'full']) {
      for (const tower of Object.keys(TOWERS)) {
        const row = report.content.towers.find(
          (item) => item.difficulty === id && item.meta === meta && item.id === tower
        );
        assert.ok(row, `缺少 ${id}:${meta}:${tower}`);
        assert.equal(row.name, TOWERS[tower].name);
        assert.ok(row.pickRate >= 0 && row.pickRate <= 1);
        assert.equal(row.runs, OPTIONS.seeds * OPTIONS.candidates);
        assert.ok(row.runsWith <= row.runs);
        assert.equal(row.winsWith <= row.runsWith, true);
        assert.ok(row.avgCount >= 0);
      }
    }
  }
});

test('逐遗物分解覆盖全部遗物（仅全解锁）', () => {
  assert.equal(report.content.relics.length, RELICS.length * DIFFICULTY_ORDER.length);
  for (const id of DIFFICULTY_ORDER) {
    for (const relic of RELICS) {
      const row = report.content.relics.find(
        (item) => item.difficulty === id && item.id === relic.id
      );
      assert.ok(row, `缺少 ${id}:${relic.id}`);
      assert.equal(row.name, relic.name);
      assert.equal(row.rarity, relic.rarity);
      assert.ok(row.pickRate >= 0 && row.pickRate <= 1);
      assert.ok(row.runsWith <= row.runs);
      assert.ok(row.avgLevel == null || (row.avgLevel >= 1 && row.avgLevel <= 3));
    }
  }
});

test('逐敌人分解覆盖全部敌人类型', () => {
  assert.equal(report.content.enemies.length, Object.keys(ENEMIES).length * DIFFICULTY_ORDER.length);
  for (const id of DIFFICULTY_ORDER) {
    for (const enemy of Object.values(ENEMIES)) {
      const row = report.content.enemies.find(
        (item) => item.difficulty === id && item.id === enemy.id
      );
      assert.ok(row, `缺少 ${id}:${enemy.id}`);
      assert.equal(row.name, enemy.name);
      assert.ok(row.encounterRate >= 0 && row.encounterRate <= 1);
      assert.ok(row.avgCount >= 0);
      assert.ok(row.avgFirstWave == null || row.avgFirstWave >= 1);
      assert.ok(row.encounterRateInWins == null || row.encounterRateInWins >= 0);
    }
  }
});

test('明细行包含逐内容追踪字段', () => {
  assert.equal(report.runs.length, rows.length);
  for (const row of report.runs) {
    assert.ok(Array.isArray(row.towerTypes));
    assert.equal(typeof row.towerCounts, 'object');
    assert.ok(Array.isArray(row.relicStates));
    assert.equal(typeof row.enemyCounts, 'object');
    assert.equal(typeof row.enemyFirstWave, 'object');
    assert.equal(row.towerTypes.length, new Set(row.towerTypes).size);
  }
});

test('同种子两次运行报告完全一致', () => {
  const second = buildReport(runBatch(OPTIONS), OPTIONS);
  assert.deepEqual(second, report);
  assert.equal(JSON.stringify(second), JSON.stringify(report));
});
