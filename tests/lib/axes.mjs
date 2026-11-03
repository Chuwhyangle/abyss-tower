// 轴注册表：正交维度（塔 / 海克斯 / 遗物 / 技能 / 地图 / 难度 / 波次 / 模式）。
// 每条轴 = 变体枚举 + 最小 buildScenario spec + 逐变体断言体 + 声明的接缝。
// 纪律（docs/TODO.md TODO-13）：加一个新维度只登记 1 轴（+1 测试）+ 声明 k 缝，不 ×N。
// 参数化遍历必须走 buildScenario（scenario.mjs），不得 ad-hoc 造 Simulation。
import assert from 'node:assert/strict';

import {
  DIFFICULTY_ORDER,
  RELICS,
  SKILL_ORDER,
  TOWER_ORDER,
} from '../../public/js/shared/data.js';
import { HEX_ORDER } from '../../public/js/shared/hexes.js';
import { FIXED_MAP_BY_ID } from '../../public/js/shared/maps/index.js';
import { cloneMapData } from '../../public/js/shared/maps/rasterize.js';

// 变体统一形状 { id, label }；specFor(variant) 产出 buildScenario 的最小 spec；
// run(sc, variant) 是本轴逐变体断言体（只做本轴该做的，不碰接缝）。
export const AXES = [
  {
    id: 'tower',
    name: '塔',
    seams: ['mods', 'hooks', 'snapshot', 'replay', 'economy'],
    variants: TOWER_ORDER.map((id) => ({ id, label: id })),
    specFor(variant) {
      return {
        seed: `axis-tower-${variant.id}`,
        gold: 10000,
        relics: ['crit'],
        unlockedTowers: TOWER_ORDER,
      };
    },
    run(sc, variant) {
      const [cell] = sc.buildableCells(1);
      assert.ok(cell, `塔轴 ${variant.id}：地图应至少有一个可建格`);
      const tower = sc.build(variant.id, cell.c, cell.r, 1);
      assert.ok(tower, `塔轴：应能建造并升到 1 级 ${variant.id}`);
      assert.equal(tower.type, variant.id);
      assert.equal(tower.level, 1);
      sc.runWave(1, { maxFrames: 60 * 30 });
      assert.equal(sc.sim.towers.length, 1, `塔轴 ${variant.id}：场上应恰有一塔`);
    },
  },
  {
    id: 'hex',
    name: '海克斯',
    seams: ['hooks', 'snapshot', 'replay'],
    variants: HEX_ORDER.map((id) => ({ id, label: id })),
    specFor(variant) {
      return { seed: `axis-hex-${variant.id}`, gold: 5000, hex: variant.id };
    },
    run(sc, variant) {
      assert.equal(sc.sim.hex?.id, variant.id, `海克斯轴：主海克斯应为 ${variant.id}`);
      assert.equal(sc.sim.hexRuntime.active, true, `海克斯轴：${variant.id} 应处于激活态`);
      const [cell] = sc.buildableCells(1);
      const tower = sc.place('arrow', cell.c, cell.r);
      assert.ok(tower, `海克斯轴 ${variant.id}：应能建一座箭塔`);
      sc.runWave(1, { maxFrames: 60 * 30 });
    },
  },
  {
    id: 'relic',
    name: '遗物',
    seams: ['mods', 'snapshot', 'economy'],
    variants: RELICS.map((relic) => ({ id: relic.id, label: relic.name })),
    specFor(variant) {
      return { seed: `axis-relic-${variant.id}`, gold: 5000, relics: [variant.id] };
    },
    run(sc, variant) {
      assert.ok(
        sc.sim.relics.some((r) => r.id === variant.id),
        `遗物轴：${variant.id} 应已装备`
      );
      const [cell] = sc.buildableCells(1);
      sc.build('arrow', cell.c, cell.r, 1);
      sc.runWave(1, { maxFrames: 60 * 15 });
    },
  },
  {
    id: 'skill',
    name: '技能',
    seams: ['snapshot'],
    variants: SKILL_ORDER.map((id) => ({ id, label: id })),
    specFor(variant) {
      return { seed: `axis-skill-${variant.id}`, gold: 5000, skill: { id: variant.id, level: 1 } };
    },
    run(sc, variant) {
      assert.equal(sc.sim.skill?.id, variant.id, `技能轴：主动技能应为 ${variant.id}`);
      sc.startWave(1);
      sc.spawnEnemy('grunt');
      assert.equal(sc.castSkill(), true, `技能轴：${variant.id} 应能释放`);
      sc.step(1 / 60, 2);
    },
  },
  {
    id: 'map',
    name: '地图',
    seams: ['snapshot', 'replay'],
    variants: ['canyon', 'twin', 'ring'].map((id) => ({ id, label: id })),
    specFor(variant) {
      // 固定地图是深冻结对象，克隆一份再交场景，避免模拟层对共享地图的意外写入。
      return { seed: `axis-map-${variant.id}`, gold: 5000, map: cloneMapData(FIXED_MAP_BY_ID[variant.id]) };
    },
    run(sc, variant) {
      assert.equal(sc.sim.map.id, variant.id, `地图轴：应为 ${variant.id}`);
      const [cell] = sc.buildableCells(1);
      sc.build('arrow', cell.c, cell.r, 0);
      sc.runWave(1, { maxFrames: 60 * 30 });
    },
  },
  {
    id: 'difficulty',
    name: '难度',
    seams: ['snapshot', 'replay'],
    variants: DIFFICULTY_ORDER.map((id) => ({ id, label: id })),
    specFor(variant) {
      return { seed: `axis-difficulty-${variant.id}`, gold: 5000, difficulty: variant.id };
    },
    run(sc, variant) {
      assert.equal(sc.sim.difficulty, variant.id, `难度轴：应为 ${variant.id}`);
      const [cell] = sc.buildableCells(1);
      sc.build('arrow', cell.c, cell.r, 1);
      sc.runWave(1, { maxFrames: 60 * 30 });
    },
  },
  {
    id: 'wave',
    name: '波次',
    seams: ['snapshot', 'economy'],
    variants: [1, 3, 5].map((id) => ({ id, label: `已清 ${id} 波` })),
    specFor(variant) {
      return { seed: `axis-wave-${variant.id}`, gold: 5000, clearedWave: variant.id };
    },
    run(sc, variant) {
      assert.equal(sc.sim.clearedWave, variant.id, `波次轴：已清波次应为 ${variant.id}`);
      const def = sc.startWave(variant.id + 1);
      assert.equal(def.index, variant.id + 1, `波次轴：下一波应为 ${variant.id + 1}`);
      sc.step(1 / 60, 3);
    },
  },
  {
    id: 'mode',
    name: '模式',
    seams: ['snapshot', 'mode'],
    variants: ['normal', 'daily', 'endless', 'tower'].map((id) => ({ id, label: id })),
    specFor(variant) {
      return { seed: `axis-mode-${variant.id}`, gold: 5000, mode: variant.id };
    },
    run(sc, variant) {
      assert.equal(sc.sim.mode, variant.id, `模式轴：应为 ${variant.id}`);
      if (variant.id === 'tower') {
        assert.ok(sc.sim.tower, 'tower 模式应持有选路状态');
        assert.ok(sc.sim.towerGraph, 'tower 模式应持有节点图');
      } else {
        assert.equal(sc.sim.tower, null, `${variant.id} 模式不应持有选路状态`);
        assert.equal(sc.sim.towerGraph, null, `${variant.id} 模式不应持有节点图`);
      }
    },
  },
];

export const AXIS_BY_ID = Object.freeze(Object.fromEntries(AXES.map((axis) => [axis.id, axis])));

export function axisById(id) {
  return AXIS_BY_ID[id] ?? null;
}

// 声明了某缝的轴（按注册顺序稳定返回）。
export function axesForSeam(seamId) {
  return AXES.filter((axis) => axis.seams.includes(seamId));
}
