// 主海克斯：玻璃大炮。全塔押注输出，漏怪直接威胁塔本身。
// 只用 HEX-002 暴露的接口：
//   onRunInit       写入 towerMaxHp（随 hexState 快照恢复）
//   onTowerBuilt    新建塔赋予 5 点生命
//   modifyTowerStats 全塔伤害 ×1.70、攻速 ×1.10（乘在最终属性上，不受遗物封顶影响）
//   onLeak          对漏怪车道内距基地最近的塔造成 1 点伤害
const TOWER_MAX_HP = 5;
const DAMAGE_MUL = 1.7;
const RATE_MUL = 1.1;
const LEAK_DAMAGE = 1;
const LEAK_FLOATER_COLOR = '#ff8a6b';
// 塔掉血复用现有冲击音（核心库里没有独立的「塔受伤」音效键，本任务不改音频层）。
const LEAK_SOUND = 'bossSlam';

// 塔生命上限：开局由 onRunInit 写入 hexState，读档时随快照恢复；缺失/非法值回退默认 5。
function towerMaxHp(ctx) {
  const value = Math.floor(Number(ctx?.state?.towerMaxHp));
  return Number.isFinite(value) && value > 0 ? value : TOWER_MAX_HP;
}

// 塔生命只在这里赋值：新建/读档时补满上限，之后任何属性重算只做上限收敛——
// 已掉的血不会因重算回满，也不允许任何来源把上限抬高。
function enforceTowerHp(tower, ctx) {
  if (!tower) return;
  const maxHp = towerMaxHp(ctx);
  const rawMax = Number(tower.maxHp);
  // hp 为 null（旧塔没有生命字段）按「满血」处理，不能被 Number(null)=0 误判成空血。
  const rawHp = tower.hp == null ? NaN : Number(tower.hp);
  // 没有上限（无敌）或上限损坏：补成 5，但已有生命只做钳制，不回满。
  if (tower.maxHp == null || !Number.isFinite(rawMax)) {
    tower.maxHp = maxHp;
    tower.hp = Number.isFinite(rawHp) ? Math.max(0, Math.min(maxHp, Math.floor(rawHp))) : maxHp;
    return;
  }
  const capped = Math.min(Math.max(1, Math.floor(rawMax)), maxHp);
  tower.maxHp = capped;
  tower.hp = Number.isFinite(rawHp) ? Math.max(0, Math.min(capped, Math.floor(rawHp))) : capped;
}

// 塔到基地的直线距离；地图缺少基地坐标时退回车道进度（进度越大越靠近基地）。
function distanceToBase(sim, tower) {
  const base = sim.map?.base;
  const bx = Number(base?.x);
  const by = Number(base?.y);
  if (Number.isFinite(bx) && Number.isFinite(by)) return Math.hypot(tower.x - bx, tower.y - by);
  const spot = sim.laneProgressNear(tower.c, tower.r);
  return -spot.progress;
}

// 漏怪车道内距基地最近的塔；同距离取 id 最小。没有该车道的塔时返回 null。
function nearestTowerOnLane(sim, lane) {
  let best = null;
  for (const tower of sim.towers) {
    if (!tower) continue;
    const spot = sim.laneProgressNear(tower.c, tower.r);
    if (spot.lane !== lane) continue;
    const distance = distanceToBase(sim, tower);
    if (
      best === null ||
      distance < best.distance ||
      (distance === best.distance && tower.id < best.tower.id)
    ) {
      best = { tower, distance };
    }
  }
  return best === null ? null : best.tower;
}

const hooks = Object.freeze({
  // 开局：写入本局的塔生命上限（读档不重放，值从快照 hexState 恢复）。
  onRunInit(ctx) {
    if (!ctx?.state) return;
    ctx.state.towerMaxHp = TOWER_MAX_HP;
  },
  // 建塔：新塔带满 5 点生命。
  onTowerBuilt(tower, ctx) {
    enforceTowerHp(tower, ctx);
  },
  // 属性重算末尾：全塔伤害 ×1.70、攻速 ×1.10；顺带收敛塔生命（读档旧塔也能补上限）。
  // 入参不是完整塔属性（缺 dmg/rate）时原样返回，保持「缺省钩子不改入参」的注册表契约。
  modifyTowerStats(tower, stats, ctx) {
    enforceTowerHp(tower, ctx);
    const dmg = Number(stats?.dmg);
    const rate = Number(stats?.rate);
    if (!Number.isFinite(dmg) || !Number.isFinite(rate)) return stats;
    return {
      ...stats,
      dmg: dmg * DAMAGE_MUL,
      rate: rate * RATE_MUL,
    };
  },
  // 漏怪：伤害漏怪车道上最靠近基地的塔；没有塔时没有额外效果。
  onLeak(enemy, ctx) {
    const sim = ctx?.sim;
    if (!sim || !Array.isArray(sim.towers) || sim.towers.length === 0) return;
    if (typeof sim.damageTower !== 'function') return;
    const lane = Number.isInteger(enemy?.lane) ? enemy.lane : 0;
    const tower = nearestTowerOnLane(sim, lane);
    if (!tower) return;
    const destroyed = sim.damageTower(tower, LEAK_DAMAGE);
    // 被摧毁时模拟层已经写了「塔被摧毁」飘字，这里只补存活时的掉血飘字。
    if (!destroyed) {
      sim.addFloater?.(tower.x, tower.y - 0.45, `-${LEAK_DAMAGE}`, LEAK_FLOATER_COLOR, true, {
        key: true,
      });
    }
    sim.playSound?.(LEAK_SOUND);
  },
});

export default Object.freeze({
  id: 'glass_cannon',
  name: '玻璃大炮',
  glyph: '💥',
  color: '#ff5a5f',
  tags: Object.freeze(['输出', '高风险']),
  pitch: '全塔伤害 +70%',
  desc: '塔伤害 +70%，但每座塔只有 5 点生命且无法提升；漏怪会伤塔。',
  downside: '每座塔只有 5 点生命且无法提升，漏怪会伤塔',
  scoreMul: 1.15,
  hooks,
  implemented: true,
});
