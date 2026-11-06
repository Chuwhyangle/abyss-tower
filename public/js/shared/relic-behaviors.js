// 遗物行为词条（feat-relic-behaviors）的结算路由：把 Ⅱ/Ⅲ 级机制型效果从 sim 核心剥离到本模块。
// 词条数据在 shared/data/relics/*.js（纯数据）；本模块只按 kind+towerType 查询并消费，
// 通过 hook 总线注册为 provider（onProjectileHit / onKillSettle），不再改 combat-system.js。
//
// 确定性红线：每个结算函数完整复刻重构前的行为，仅移动位置——不创建随机数、不触碰 combatRng，
// 也不改变与周围结算（击退 / 霜缚 / 派系 / 觉醒）的相对顺序。
export class RelicBehaviorProvider {
  constructor(sim) {
    this.sim = sim;
    this.name = 'relic-behaviors';
  }

  // 命中结算点：先毒雾传播、后霜塔冻结（与重构前的消费顺序一致）。
  onProjectileHit(enemy, proj) {
    this.poisonHitSpread(enemy, proj);
    this.frostHitFreeze(enemy, proj);
  }

  // 击杀结算点：非致命传播先于 noExplosion 门禁，zap/burst 走常规伤害入口。
  onKillSettle(enemy, killingDamage, opts = {}) {
    this.poisonKillSpread(enemy);
    if (opts.noExplosion) return;
    this.arcKillZap(enemy, killingDamage);
    this.cannonKillBurst(enemy, killingDamage);
  }

  // 毒雾命中传播：命中时向半径内最近 targets 名敌人传播 dpsMul 毒伤（单槽取高，不叠层）。
  // 与重构前一致：词条只在「毒伤投射物」上触发（dot 为 0 时不传播）。
  poisonHitSpread(enemy, proj) {
    if (proj.dot <= 0 || proj.towerType !== 'poison') return;
    const sim = this.sim;
    const dps = proj.dot * (1 + (sim.mods.dot || 0));
    for (const behavior of sim.relicSystem.behaviorsFor('poison', 'poisonHitSpread')) {
      const spreadDps = dps * behavior.dpsMul;
      const spreadUntil = sim.time + (proj.dotDur || 3);
      const candidates = [];
      for (const other of sim.enemies) {
        if (other.dead || other === enemy) continue;
        if (Math.hypot(other.x - enemy.x, other.y - enemy.y) <= behavior.radius) candidates.push(other);
      }
      for (let i = 0; i < Math.min(behavior.targets, candidates.length); i++) {
        const other = candidates[i];
        if (spreadDps >= other.poisonDps || sim.time > other.poisonUntil) {
          other.poisonDps = Math.max(spreadDps, sim.time > other.poisonUntil ? 0 : other.poisonDps);
          other.poisonUntil = Math.max(other.poisonUntil, spreadUntil);
        }
      }
    }
  }

  // 霜塔冻结：每第 hits 次命中冻结 duration 秒（首领减半），计数器挂敌身上（词条 id 隔离）。
  frostHitFreeze(enemy, proj) {
    if (proj.towerType !== 'frost') return;
    const sim = this.sim;
    for (const behavior of sim.relicSystem.behaviorsFor('frost', 'frostHitFreeze')) {
      const counter = 'bh:' + behavior.id;
      enemy[counter] = (enemy[counter] || 0) + 1;
      if (enemy[counter] >= behavior.hits) {
        const dur = enemy.boss ? behavior.duration / 2 : behavior.duration;
        enemy.freezeUntil = Math.max(enemy.freezeUntil || 0, sim.time + dur);
        enemy[counter] = 0;
      }
    }
  }

  // 中毒死亡传播：向半径内最近敌人传播当前毒层（复用 poisonHop 限制跳数，非致命）。
  poisonKillSpread(enemy) {
    const sim = this.sim;
    for (const behavior of sim.relicSystem.behaviorsFor('poison', 'poisonKillSpread')) {
      if (enemy.poisonDps <= 0 || sim.time >= (enemy.poisonUntil || 0)) continue;
      if ((enemy.poisonHop || 0) >= behavior.hops) continue;
      let nearest = null;
      let bestDist = Infinity;
      for (const other of sim.enemies) {
        if (other.dead || other === enemy) continue;
        const d = Math.hypot(other.x - enemy.x, other.y - enemy.y);
        if (d <= behavior.radius && d < bestDist) {
          bestDist = d;
          nearest = other;
        }
      }
      if (nearest) {
        nearest.poisonDps = Math.max(nearest.poisonDps || 0, enemy.poisonDps);
        nearest.poisonUntil = Math.max(nearest.poisonUntil || 0, enemy.poisonUntil);
        nearest.poisonHop = (enemy.poisonHop || 0) + 1;
        sim.addEffect({
          kind: 'poisonSpread',
          x: nearest.x,
          y: nearest.y,
          r0: 0.05,
          r1: 0.6,
          ttl: 0.3,
          color: '#9be15d',
        });
      }
    }
  }

  // 电弧击杀：对半径内敌人造成 killingDamage × damageMul（走常规伤害入口，noExplosion 防递归）。
  arcKillZap(enemy, killingDamage) {
    const sim = this.sim;
    for (const behavior of sim.relicSystem.behaviorsFor('arc', 'arcKillZap')) {
      if (killingDamage <= 0) continue;
      for (const other of sim.enemies) {
        if (other.dead || other === enemy) continue;
        if (Math.hypot(other.x - enemy.x, other.y - enemy.y) <= behavior.radius) {
          sim.damage(other, killingDamage * behavior.damageMul, {
            noExplosion: true,
            weapon: 'arcKillZap',
            source: 'relic',
          });
        }
      }
    }
  }

  // 炮台击杀爆裂：对半径内敌人造成 killingDamage × ratio（走常规伤害入口，noExplosion 防递归）。
  cannonKillBurst(enemy, killingDamage) {
    const sim = this.sim;
    for (const behavior of sim.relicSystem.behaviorsFor('cannon', 'cannonKillBurst')) {
      if (killingDamage <= 0) continue;
      for (const other of sim.enemies) {
        if (other.dead || other === enemy) continue;
        if (Math.hypot(other.x - enemy.x, other.y - enemy.y) <= behavior.radius) {
          sim.damage(other, killingDamage * behavior.ratio, {
            noExplosion: true,
            weapon: 'cannonKillBurst',
            source: 'relic',
          });
        }
      }
    }
  }
}
