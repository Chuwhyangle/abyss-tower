// 数据层模块化拆分：导出面、内容逐字一致、模块间单向依赖（无循环）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

import * as data from '../public/js/shared/data.js';
import * as constants from '../public/js/shared/data/constants.js';
import * as difficulties from '../public/js/shared/data/difficulties.js';
import * as towers from '../public/js/shared/data/towers.js';
import * as enemies from '../public/js/shared/data/enemies.js';
import * as caps from '../public/js/shared/data/caps.js';
import * as relics from '../public/js/shared/data/relics.js';
import * as unlocks from '../public/js/shared/data/unlocks.js';
import * as skills from '../public/js/shared/data/skills.js';

const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public/js/shared/data');

// 拆分前 data.js 的完整导出名清单（对外契约）。
const EXPECTED_EXPORTS = [
  'BOSS_SKILLS', 'DIFFICULTIES', 'DIFFICULTY_ORDER', 'ENEMIES', 'GLOBAL_MOD_CAPS', 'MAP_COLS', 'MAP_ROWS',
  'MAX_WAVE', 'RARITY', 'RELICS', 'RELIC_BY_ID', 'RELIC_LEVEL_LABELS', 'RELIC_MAX_LEVEL',
  'TILE', 'TOWERS', 'TOWER_ORDER', 'UNLOCKS', 'UNLOCK_BY_ID', 'fallbackOffers', 'getDifficulty',
  'normalizeRelicState', 'normalizeRelicStates', 'relicEffectText', 'relicLevelOf',
  'relicModsAtLevel', 'rollRelicOffers', 'towerLevelStats', 'towerUpgradeCost', 'unlockedTowerIds',
  'SKILL_LEVEL_COSTS', 'SKILLS', 'SKILL_ORDER', 'isSkillUnlocked', 'skillStats', 'skillUnlockText', 'skillUpgradeCost',
];

// 拆分前（单文件 data.js）的内容快照：数据 + 关键函数输出。
// V21-005：TOWERS 增加纯数据 evolutions 分支，内容快照随之更新。
// W19-009：敌人扩容到 12 种（含机制型敌人），内容快照随之更新。
// V26-001：遗物扩容到 40 件，内容快照随之更新。
// V30-002：遗物新增 set 套装标签，内容快照随之更新（单件 mods 未改动）。
// V34-001：遗物扩容到 50 件并新增 2 套套装，内容快照随之更新。
// V36-002：塔的进化扩容到三分支（24 条路线），内容快照随之更新。
// V41-004：遗物扩容到 60 件并新增条件型套装，内容快照随之更新。
// V50-003：遗物扩容到 70 件并新增回合型效果，内容快照随之更新。
const BASELINE_HASH = '85fdc3f1bed8417f544219a0d35148bd3df458b55e0a156d0e7b20e3153385df';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function snapshotPayload(d) {
  return {
    constants: { TILE: d.TILE, MAP_COLS: d.MAP_COLS, MAP_ROWS: d.MAP_ROWS, MAX_WAVE: d.MAX_WAVE },
    difficulties: d.DIFFICULTIES,
    difficultyOrder: d.DIFFICULTY_ORDER,
    towers: d.TOWERS,
    towerOrder: d.TOWER_ORDER,
    enemies: d.ENEMIES,
    rarity: d.RARITY,
    relics: d.RELICS,
    relicById: d.RELIC_BY_ID,
    relicMaxLevel: d.RELIC_MAX_LEVEL,
    relicLevelLabels: d.RELIC_LEVEL_LABELS,
    globalModCaps: d.GLOBAL_MOD_CAPS,
    unlocks: d.UNLOCKS,
    unlockById: d.UNLOCK_BY_ID,
    behaviors: {
      getDifficulty: [d.getDifficulty('abyss'), d.getDifficulty('nope')],
      relicModsAtLevel: [
        d.relicModsAtLevel('sharp', 1),
        d.relicModsAtLevel('sharp', 3),
        d.relicModsAtLevel('powder', 2),
        d.relicModsAtLevel('warlord', 3),
      ],
      normalizeRelicStates: d.normalizeRelicStates([
        'sharp', { id: 'quickdraw', level: 2 }, { id: 'nope' }, 'sharp', { id: 'eagle', toLevel: 3 },
      ]),
      relicLevelOf: d.relicLevelOf([{ id: 'sharp', level: 2 }], 'sharp'),
      relicEffectText: [d.relicEffectText('powder', 2), d.relicEffectText('warlord', 1)],
      fallbackOffers: d.fallbackOffers(7),
      rollRelicOffers: [
        d.rollRelicOffers('seed-a', [], 3, 1),
        d.rollRelicOffers('seed-b', [{ id: 'sharp', level: 2 }], 3, 5),
      ],
      unlockedTowerIds: [d.unlockedTowerIds([]), d.unlockedTowerIds(d.UNLOCKS.map((u) => u.id))],
      towerLevelStats: [
        d.towerLevelStats('arrow', 0),
        d.towerLevelStats('cannon', 1),
        d.towerLevelStats('banner', 2),
      ],
      towerUpgradeCost: [
        d.towerUpgradeCost('arrow', 0),
        d.towerUpgradeCost('arrow', 2),
        d.towerUpgradeCost('sniper', 1),
      ],
    },
  };
}

test('data.js 的导出名集合与拆分前完全一致', () => {
  assert.deepEqual(Object.keys(data).sort(), [...EXPECTED_EXPORTS].sort());
});

test('data.js 只做再导出：绑定与各主题模块同一引用', () => {
  assert.equal(data.TILE, constants.TILE);
  assert.equal(data.MAX_WAVE, constants.MAX_WAVE);
  assert.equal(data.DIFFICULTIES, difficulties.DIFFICULTIES);
  assert.equal(data.DIFFICULTY_ORDER, difficulties.DIFFICULTY_ORDER);
  assert.equal(data.getDifficulty, difficulties.getDifficulty);
  assert.equal(data.TOWERS, towers.TOWERS);
  assert.equal(data.TOWER_ORDER, towers.TOWER_ORDER);
  assert.equal(data.towerLevelStats, towers.towerLevelStats);
  assert.equal(data.towerUpgradeCost, towers.towerUpgradeCost);
  assert.equal(data.ENEMIES, enemies.ENEMIES);
  assert.equal(data.BOSS_SKILLS, enemies.BOSS_SKILLS);
  assert.equal(data.GLOBAL_MOD_CAPS, caps.GLOBAL_MOD_CAPS);
  assert.equal(data.RARITY, relics.RARITY);
  assert.equal(data.RELICS, relics.RELICS);
  assert.equal(data.RELIC_BY_ID, relics.RELIC_BY_ID);
  assert.equal(data.rollRelicOffers, relics.rollRelicOffers);
  assert.equal(data.UNLOCKS, unlocks.UNLOCKS);
  assert.equal(data.UNLOCK_BY_ID, unlocks.UNLOCK_BY_ID);
  assert.equal(data.unlockedTowerIds, unlocks.unlockedTowerIds);
  assert.equal(data.SKILLS, skills.SKILLS);
  assert.equal(data.SKILL_ORDER, skills.SKILL_ORDER);
  assert.equal(data.skillStats, skills.skillStats);
});

test('各主题模块的导出面保持单一职责', () => {
  assert.deepEqual(Object.keys(constants).sort(), ['MAP_COLS', 'MAP_ROWS', 'MAX_WAVE', 'TILE']);
  assert.deepEqual(Object.keys(difficulties).sort(), ['DIFFICULTIES', 'DIFFICULTY_ORDER', 'getDifficulty']);
  assert.deepEqual(Object.keys(towers).sort(), ['TOWERS', 'TOWER_ORDER', 'towerLevelStats', 'towerUpgradeCost']);
  assert.deepEqual(Object.keys(enemies).sort(), ['BOSS_SKILLS', 'BOSS_VARIANTS', 'BOSS_VARIANT_ROTATION', 'ENEMIES']);
  assert.deepEqual(Object.keys(caps), ['GLOBAL_MOD_CAPS']);
  assert.deepEqual(Object.keys(skills).sort(), [
    'SKILLS', 'SKILL_LEVEL_COSTS', 'SKILL_ORDER', 'isSkillUnlocked',
    'skillStats', 'skillUnlockText', 'skillUpgradeCost',
  ]);
  assert.deepEqual(Object.keys(unlocks).sort(), ['UNLOCKS', 'UNLOCK_BY_ID', 'unlockedTowerIds']);
  assert.deepEqual(Object.keys(relics).sort(), [
    'RARITY', 'RELICS', 'RELIC_BY_ID', 'RELIC_LEVEL_LABELS', 'RELIC_MAX_LEVEL',
    'fallbackOffers', 'normalizeRelicState', 'normalizeRelicStates', 'relicEffectText',
    'relicLevelOf', 'relicModsAtLevel', 'rollRelicOffers',
  ]);
});

test('数量与拆分前一致', () => {
  assert.equal(Object.keys(data.TOWERS).length, 8);
  assert.equal(data.TOWER_ORDER.length, 8);
  assert.equal(Object.keys(data.ENEMIES).length, 12);
  assert.equal(data.RELICS.length, 70);
  assert.equal(Object.keys(data.RARITY).length, 3);
  assert.equal(data.UNLOCKS.length, 9);
});

test('BOSS_SKILLS 与拆分前逐字一致', () => {
  assert.deepEqual(data.BOSS_SKILLS, {
    roar: { id: 'roar', name: '深渊咆哮', color: '#ff8a6b', radiusKey: 'bossRoarRadius', unlockWave: 5 },
    summon: { id: 'summon', name: '裂隙召唤', color: '#e2609e', unlockWave: 10 },
    slam: { id: 'slam', name: '地脉震击', color: '#ffb066', radiusKey: 'bossSlamRadius', unlockWave: 15 },
  });
});

test('数值与函数输出与拆分前逐字一致（内容快照）', () => {
  const json = JSON.stringify(canonicalize(snapshotPayload(data)));
  const hash = createHash('sha256').update(json).digest('hex');
  assert.equal(hash, BASELINE_HASH);
});

test('data/ 模块之间单向依赖，无循环', () => {
  const files = readdirSync(DATA_DIR).filter((name) => name.endsWith('.js'));
  const graph = new Map();
  for (const name of files) {
    const source = readFileSync(join(DATA_DIR, name), 'utf8');
    const deps = [];
    for (const match of source.matchAll(/^\s*import\s[\s\S]*?from\s+'(\.[^']+)'/gm)) {
      const target = resolve(DATA_DIR, match[1]);
      if (dirname(target) === DATA_DIR) deps.push(relative(DATA_DIR, target));
    }
    graph.set(name, deps);
  }

  const visiting = new Set();
  const visited = new Set();
  const cycles = [];
  const visit = (node, path) => {
    if (visiting.has(node)) {
      cycles.push([...path, node].join(' -> '));
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    for (const dep of graph.get(node) || []) visit(dep, [...path, node]);
    visiting.delete(node);
    visited.add(node);
  };
  for (const name of graph.keys()) visit(name, []);

  assert.deepEqual(cycles, []);
  // 依赖方向固定：relics/unlocks -> towers，其余只依赖上游基础模块。
  assert.deepEqual(graph.get('towers.js'), []);
  assert.deepEqual(graph.get('relics.js').sort(), ['towers.js']);
  assert.deepEqual(graph.get('unlocks.js').sort(), ['towers.js']);
});
