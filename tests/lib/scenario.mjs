// 无头模拟场景构造器：声明式 buildScenario(spec) → 就绪 Simulation + 驱动 helper。
// 纯数据 + 功能特效，零 DOM / 零美术 / 零第三方依赖；复用 sim.js 的确定性，
// 不新增 RNG 调用、不改 sim.js 的 combatRng 顺序（RNG tap 只读记录、值原样透传）。
import crypto from 'node:crypto';

import { Simulation } from '../../public/js/sim.js';
import { generateMap } from '../../public/js/shared/mapgen.js';
import { generateWave } from '../../public/js/shared/waves.js';

// 固定开局时间：避免 startedAt 退化成墙钟（0 会被 `|| Date.now()` 覆盖）。
const FIXED_STARTED_AT = 1700000000000;
const DEFAULT_STEP = 1 / 60;

// ---------- 确定性哈希（events/rng/state 三份共用的规范形 + 摘要） ----------

// 键序无关的规范化 JSON：同结构必然同字节，用作哈希输入。
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
  }
  return value === undefined ? null : value;
}

export function canonicalJson(value) {
  return JSON.stringify(sortKeys(value));
}

export function digest(value) {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

// 快照里唯一不可复现的字段是 savedAt（墙钟）；对比前剥掉。
export function stripSavedAt(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  const { savedAt, ...rest } = snapshot;
  return rest;
}

/**
 * 声明式构造一个就绪的无头场景。
 *
 * @param {object} spec 可组合的声明：
 *   map         地图对象（缺省 generateMap(seed)）
 *   seed        种子（缺省 'scenario-default-seed'）
 *   difficulty  roam | standard | abyss（缺省 'standard'）
 *   mode        normal | daily | endless | tower（缺省 'normal'）
 *   waves       计划波数提示（缺省 null，仅记录在场景上）
 *   gold / baseHp / maxBaseHp / kills / runId / startedAt  经济与基地初值
 *   relics      遗物 id 或 {id, level} 数组
 *   towers      预置塔数组（走 sim.js 的读档回填路径）
 *   hex / hexState  主海克斯 id 与每局状态
 *   skill       主动技能 {id, level[, cooldown]}
 *   unlockedTowers  已解锁塔类型（缺省 ['arrow','cannon','frost']）
 *   onSave / onGameOver / onWaveClear / onToast  可选回调
 *   sim         其余直接透传给 Simulation 的字段（兜底覆盖）
 * @returns {object} 场景：{ sim, toasts, rngLog, waves, ...驱动 helper }
 */
export function buildScenario(spec = {}) {
  const seed = spec.seed ?? 'scenario-default-seed';
  const difficulty = spec.difficulty ?? 'standard';
  const mode = spec.mode ?? 'normal';
  const map = spec.map ?? generateMap(seed);
  const toasts = [];
  const sim = new Simulation({
    map,
    seed,
    difficulty,
    mode,
    runId: spec.runId ?? null,
    gold: spec.gold ?? 260,
    baseHp: spec.baseHp ?? 20,
    maxBaseHp: spec.maxBaseHp ?? 20,
    kills: spec.kills ?? 0,
    clearedWave: spec.clearedWave ?? spec.wave ?? 0,
    relics: spec.relics ?? [],
    towers: spec.towers ?? [],
    unlockedTowers: spec.unlockedTowers ?? ['arrow', 'cannon', 'frost'],
    hex: spec.hex ?? null,
    hexState: spec.hexState ?? null,
    skill: spec.skill,
    startedAt: spec.startedAt ?? FIXED_STARTED_AT,
    onToast: (message) => toasts.push(message),
    onSave: spec.onSave,
    onGameOver: spec.onGameOver,
    onWaveClear: spec.onWaveClear,
    ...(spec.sim || {}),
  });

  const scenario = {
    sim,
    toasts,
    rngLog: [],
    waves: spec.waves ?? null,
    _tappedRngs: new Set(),

    // 在 RNG 实例自身上包装 _next（实例自有属性），只读记录、值原样返回；
    // 不改 RNG.prototype，不与其他并行测试冲突。
    _tapRng(rng) {
      if (!rng || scenario._tappedRngs.has(rng)) return;
      const original = rng._next;
      if (typeof original !== 'function') return;
      const log = scenario.rngLog;
      rng._next = function tappedNext() {
        const value = original();
        log.push(value);
        return value;
      };
      scenario._tappedRngs.add(rng);
    },

    // 地图可建格（按行优先），供无坐标用例自动选点。
    buildableCells(count = 1) {
      const cells = [];
      for (let r = 0; r < sim.map.rows && cells.length < count; r++) {
        for (let c = 0; c < sim.map.cols && cells.length < count; c++) {
          if (sim.canBuild(c, r)) cells.push({ c, r });
        }
      }
      return cells;
    },

    // ---------- 塔生命周期 ----------

    place(type, c, r) {
      if (!Number.isInteger(c) || !Number.isInteger(r)) {
        const [cell] = scenario.buildableCells(1);
        if (!cell) return null;
        c = cell.c;
        r = cell.r;
      }
      return sim.placeTower(type, c, r) ? sim.towerAt(c, r) : null;
    },

    // 建塔 + 升到指定等级（0 起索引），返回塔。
    build(type, c, r, level = 0) {
      const tower = scenario.place(type, c, r);
      if (!tower) return null;
      while (tower.level < level) {
        if (!sim.upgradeTower(tower)) return null;
      }
      return tower;
    },

    upgrade(tower) {
      return sim.upgradeTower(tower);
    },

    evolve(tower, evolutionIds) {
      return sim.evolveTower(tower, evolutionIds);
    },

    sell(tower) {
      return sim.sellTower(tower);
    },

    // ---------- 波次 ----------

    // 开第 n 波（缺省下一波）；返回波次定义。
    startWave(n) {
      const index = Number.isInteger(n) ? n : sim.clearedWave + 1;
      const meta = sim.map?.meta || {};
      const def = generateWave(
        sim.seed,
        index,
        sim.difficulty,
        { portalCount: meta.portalCount || 1, modifier: meta.modifier || null, hpMul: meta.hpMul || 1 },
        { endless: sim.mode === 'endless' }
      );
      sim.beginWave(def);
      scenario._tapRng(sim.combatRng);
      return def;
    },

    // 步进 frames 帧（缺省 1 帧 @ 60fps）。
    step(dt = DEFAULT_STEP, frames = 1) {
      for (let i = 0; i < frames; i++) sim.update(dt);
      return scenario;
    },

    spawnEnemy(type, laneIndex = 0, hpMulOverride = null, progress = 0) {
      sim.spawnEnemy(type, laneIndex, hpMulOverride, progress);
      return sim.enemies[sim.enemies.length - 1] ?? null;
    },

    // 开波并步进到本波结束（或 maxFrames 上限）。
    runWave(n, { maxFrames = 60 * 90 } = {}) {
      const def = scenario.startWave(n);
      let frames = 0;
      while (sim.phase === 'wave' && frames < maxFrames) {
        scenario.step(DEFAULT_STEP);
        frames += 1;
      }
      return { def, frames };
    },

    // ---------- 技能 / 遗物 ----------

    castSkill() {
      return sim.castSkill();
    },

    buyRelic(relicOrOffer) {
      return sim.addRelic(relicOrOffer);
    },

    // ---------- 读状态 ----------

    // 一次性读出 snapshot + stats + RNG hash，供复用断言落证。
    read() {
      return {
        snapshot: sim.toSnapshot(),
        stats: sim.getHud(),
        rngHash: digest(scenario.rngLog),
      };
    },
  };

  scenario._tapRng(sim.combatRng);
  return scenario;
}
