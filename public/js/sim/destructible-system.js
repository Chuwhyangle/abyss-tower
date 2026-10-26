// 可破坏物：布点状态、诅咒光环、拆除结算与虫巢召唤。
import { ENEMIES } from '../shared/data.js';
import { DESTRUCTIBLE_BY_ID } from '../shared/destructibles.js';

// 虫巢噬虫沿车道依次错开的间距（格），避免 6 只叠在同一个点上。
const NEST_SPAWN_SPACING = 0.2;
// 石碑叠加上限与每层增伤都来自可破坏物数据，避免模拟层另写一份魔数。
const OBELISK_MAX_STACKS = DESTRUCTIBLE_BY_ID.obelisk?.effect?.maxStacks ?? 3;

export class DestructibleSystem {
  constructor(sim) {
    this.sim = sim;
  }

  get towerDamageMul() {
    const perStack = DESTRUCTIBLE_BY_ID.obelisk?.effect?.towerDamageMul ?? 0;
    return 1 + this.sim.obeliskStacks * perStack;
  }

  // 快照视图：只暴露拆除结果，不把布点坐标/效果写进存档（布点随地图恢复）。
  get destructibleState() {
    return {
      destroyed: this.sim.destructibles.filter((item) => item.destroyed).map((item) => item.id),
      obeliskStacks: this.sim.obeliskStacks,
    };
  }

  // 该格上尚未拆除的可破坏物；没有则返回 null（拆除后该格自然恢复可建造）。
  destructibleAt(c, r) {
    return this.sim.destructibles.find((item) => !item.destroyed && item.c === c && item.r === r) || null;
  }

  // 存活图腾的诅咒光环：多个图腾相乘（每张固定图只有一个）。
  // 移速在 updateEnemies 里实时生效（拆除即失效）；生命只在生成时结算，已生成敌人不回滚。
  destructibleAura() {
    let speedMul = 1;
    let hpMul = 1;
    for (const item of this.sim.destructibles) {
      if (item.destroyed || !item.effect?.aura) continue;
      speedMul *= item.effect.aura.enemySpeedMul ?? 1;
      hpMul *= item.effect.aura.enemyHpMul ?? 1;
    }
    return { speedMul, hpMul };
  }

  // 拆除可破坏物：校验存在/未拆除/金币足够 → 扣费 → 标记 → 效果 → 存档。
  // 同一 id 只有第一次成功（重复调用返回 already-destroyed 且不扣费）。
  destroyDestructible(id) {
    const item = this.sim.destructibles.find((entry) => entry.id === id) || null;
    if (!item) {
      this.sim.opts.onToast?.('这里没有可拆除的物件');
      return { ok: false, reason: 'not-found' };
    }
    if (item.destroyed) {
      this.sim.opts.onToast?.('这个物件已经拆除了');
      return { ok: false, reason: 'already-destroyed' };
    }
    if (this.sim.gold < item.cost) {
      this.sim.opts.onToast?.('金币不足，无法拆除');
      return { ok: false, reason: 'gold-insufficient' };
    }
    this.sim.gold -= item.cost;
    item.destroyed = true;
    this.sim.applyDestructibleEffect(item);
    // 与其它局内状态一致：整备阶段立即落盘，波中由波前快照负责回滚重放。
    this.sim.save();
    return { ok: true, reason: 'destroyed' };
  }

  // 效果全部来自注册表的声明式数据（gold/baseHp/towerDamageMul/spawn/aura）。
  applyDestructibleEffect(item) {
    const effect = item.effect || {};
    if (effect.gold) this.sim.gold += effect.gold;
    if (effect.baseHp) this.sim.baseHp = Math.min(this.sim.maxBaseHp, this.sim.baseHp + effect.baseHp);
    if (effect.towerDamageMul) {
      this.sim.obeliskStacks = Math.min(OBELISK_MAX_STACKS, this.sim.obeliskStacks + 1);
      this.sim.recomputeTowerStats();
    }
    if (effect.spawn) this.sim.spawnDestructibleSwarm(item);
    // totem 没有即时结算：标记 destroyed 后存活光环不再计入（已生成敌人不回滚）。
  }

  // 虫巢：在巢穴位置（投影到最近车道）生成当前波次强度的噬虫。
  // 走 spawnEnemy 接口，不推进波次计数（wave/clearedWave/spawnQueue 都不动）。
  spawnDestructibleSwarm(item) {
    const spawn = item.effect?.spawn;
    if (!spawn || !ENEMIES[spawn.enemy]) return 0;
    const { lane, progress } = this.sim.laneProgressNear(item.c, item.r);
    const length = this.sim.lanes[lane]?.len ?? 0;
    const hpMul = this.sim.currentWaveHpMul();
    const count = Math.max(0, Math.floor(spawn.count || 0));
    for (let i = 0; i < count; i += 1) {
      const at = Math.max(0, Math.min(length - 0.01, progress + i * NEST_SPAWN_SPACING));
      this.sim.spawnEnemy(spawn.enemy, lane, hpMul, at);
    }
    return count;
  }

  // 召唤/拆除效果的「当前波次强度」：波内用本波 hpMul，整备期用下一波。
  // 波次生成是纯函数（种子派生、不消耗 combatRng），提前预测不会改变后续结算。
}

export function createDestructibleEntries(placements, destroyedIds = []) {
  if (!Array.isArray(placements)) return [];
  const destroyed = new Set(Array.isArray(destroyedIds) ? destroyedIds : []);
  return placements.map((placement) => {
    const type = DESTRUCTIBLE_BY_ID[placement?.type] || null;
    return {
      id: placement?.id,
      type: placement?.type,
      c: placement?.c,
      r: placement?.r,
      cost: type?.cost ?? 0,
      effect: cloneEffectData(type?.effect ?? null),
      destroyed: destroyed.has(placement?.id),
    };
  });
}

// 效果是纯数据（MAP-003 保证可 JSON 往返）：深拷贝后运行时修改不会污染全局注册表。

function cloneEffectData(effect) {
  return effect == null ? null : JSON.parse(JSON.stringify(effect));
}

// 石碑层数：非法/负数按 0，超过叠加上限按上限。

export function normalizeObeliskStacks(value) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(OBELISK_MAX_STACKS, parsed);
}
