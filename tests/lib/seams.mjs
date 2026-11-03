// 接缝注册表：跨维度接口（加成聚合 / 海克斯钩子×塔生命周期 / 快照往返 / 回放往返 / mode 分支 / 经济）。
// 每条缝 = 一个跨维度接口 + 一个变体无关的断言体 assert(sc, axis, variant)。
// 缝测试遍历「声明了该缝的轴」（axes.mjs 里 axis.seams 声明的集合），对每根轴的每个变体
// 用 axis.specFor 建场景后跑本缝断言——接缝只写一次，新轴声明即自动被卷进去。
import assert from 'node:assert/strict';

import { decodeRun, encodeRun } from '../../public/js/shared/replay.js';
import { assertSnapshotRoundTrip } from './assertions.mjs';

export const SEAMS = [
  {
    id: 'mods',
    name: '加成聚合',
    assert(sc) {
      const { sim } = sc;
      assert.equal(typeof sim.mods, 'object', '加成聚合：sim.mods 应为对象');
      // recomputeMods 返回聚合结果本体，且与 sim.mods 是同一引用。
      assert.equal(sim.recomputeMods(), sim.mods, '加成聚合：recomputeMods 应返回 sim.mods 本体');
      // 通过接口增补一个 mod 来源，聚合值必须随之变化（非平凡聚合的证据）。
      const before = sim.mods.crit ?? 0;
      const result = sc.buyRelic('crit');
      assert.equal(result.applied, true, '加成聚合：购入 crit 遗物应成功');
      assert.ok(sim.mods.crit > before, '加成聚合：购入 crit 后 sim.mods.crit 应上升');
    },
  },
  {
    id: 'hooks',
    name: '海克斯钩子×塔生命周期',
    assert(sc) {
      const { sim } = sc;
      assert.equal(typeof sim.hexRuntime, 'object', '钩子缝：hexRuntime 应存在');
      // 钩子统一出口：缺失钩子安全跳过、返回值不合法回退默认，任何场景都不得抛异常。
      assert.equal(typeof sim.hexRuntime.modifyTowerStats, 'function', '钩子缝：缺 modifyTowerStats');
      const [cell] = sc.buildableCells(1);
      assert.ok(cell, '钩子缝：地图应至少有一个可建格');
      const tower = sc.build('arrow', cell.c, cell.r, 0);
      assert.ok(tower, '钩子缝：应能建塔');
      assert.ok(Number.isInteger(sim.towerMaxLevel(tower)) && sim.towerMaxLevel(tower) >= 1, '钩子缝：towerMaxLevel 应为有限整数');
      assert.ok(Number.isFinite(sim.upgradeCost(tower)), '钩子缝：upgradeCost 应为有限数');
      assert.ok(Number.isFinite(sim.sellValue(tower)), '钩子缝：sellValue 应为有限数');
      const stats = sim.hexRuntime.modifyTowerStats(tower, { atk: 1, range: 1, rate: 1 }, sim.hexCtx);
      assert.ok(stats && typeof stats === 'object', '钩子缝：modifyTowerStats 应返回对象');
    },
  },
  {
    id: 'snapshot',
    name: '快照往返',
    assert(sc) {
      assertSnapshotRoundTrip(sc.sim);
    },
  },
  {
    id: 'replay',
    name: '回放往返',
    assert(sc) {
      const { sim } = sc;
      const raw = {
        seed: sim.seed,
        mapChoice: Number.isInteger(sim.map?.index) ? sim.map.index : 0,
        difficulty: sim.difficulty,
        mode: sim.mode,
        relics: sim.relics.map((r) => ({ id: r.id, level: r.level })),
        events: [],
        ...(sim.hex?.id ? { hexId: sim.hex.id } : {}),
      };
      const code = encodeRun(raw);
      const decoded = decodeRun(code);
      assert.equal(decoded.ok, true, `回放往返：${code} 应可解码`);
      assert.equal(decoded.run.seed, raw.seed);
      assert.equal(decoded.run.difficulty, raw.difficulty);
      assert.equal(decoded.run.mode, raw.mode);
      assert.deepEqual(decoded.run.relics, raw.relics);
      assert.equal(encodeRun(decoded.run), code, '回放往返：再编码应逐字节一致');
    },
  },
  {
    id: 'mode',
    name: 'mode 分支',
    assert(sc, axis, variant) {
      const { sim } = sc;
      assert.equal(sim.mode, variant.id, `mode 分支：应为 ${variant.id}`);
      if (variant.id === 'tower') {
        assert.ok(sim.tower, 'tower 模式应持有选路状态');
        assert.ok(sim.towerGraph, 'tower 模式应持有节点图');
        assert.equal(sim.tower.route.node, '1:0', 'tower 模式缺省应从起点节点出发');
      } else {
        assert.equal(sim.tower, null, `${variant.id} 模式不应持有选路状态`);
        assert.equal(sim.towerGraph, null, `${variant.id} 模式不应持有节点图`);
      }
    },
  },
  {
    id: 'economy',
    name: '经济',
    assert(sc) {
      const { sim } = sc;
      assert.equal(typeof sim.gold, 'number', '经济缝：gold 应为数值');
      const before = sim.gold;
      const [cell] = sc.buildableCells(1);
      const tower = sc.build('arrow', cell.c, cell.r, 0);
      assert.ok(tower, '经济缝：应能建塔');
      assert.ok(sim.gold < before, '经济缝：建塔应扣金');
      const value = sc.sell(tower);
      assert.ok(value > 0, '经济缝：卖塔应回金');
    },
  },
];

export const SEAM_BY_ID = Object.freeze(Object.fromEntries(SEAMS.map((seam) => [seam.id, seam])));

export function seamById(id) {
  return SEAM_BY_ID[id] ?? null;
}
