// 投射物：开火、飞行推进与落点命中。
import { TOWERS } from '../shared/data.js';

export class ProjectileSystem {
  constructor(sim) {
    this.sim = sim;
  }

  fire(tower, stats, target) {
    const def = TOWERS[tower.type];
    tower.recoil = 1;
    this.sim.playSound(`shoot_${tower.type}`);

    if (tower.type === 'arc') {
      const chain = Math.max(1, Math.round(stats.chain));
      const hit = new Set();
      const points = [{ x: tower.x, y: tower.y }];
      let current = target;
      for (let i = 0; i < chain && current; i++) {
        hit.add(current.id);
        points.push({ x: current.x, y: current.y });
        this.sim.dealDamage(current, stats.dmg, 'arc', { ignoreArmor: true, tower });
        let next = null;
        let bestDist = Infinity;
        for (const enemy of this.sim.enemies) {
          if (enemy.dead || hit.has(enemy.id)) continue;
          const d = Math.hypot(enemy.x - current.x, enemy.y - current.y);
          if (d <= def.chainRange + enemy.r && d < bestDist) {
            bestDist = d;
            next = enemy;
          }
        }
        current = next;
      }
      this.sim.addEffect({ kind: 'bolt', points, ttl: 0.18, color: '#c9a8ff' });
      return;
    }

    this.sim.projectiles.push({
      id: this.sim.nextId++,
      kind: def.proj.kind,
      x: tower.x,
      y: tower.y,
      target,
      tx: target.x,
      ty: target.y,
      angle: tower.angle,
      speed: def.proj.speed * (1 + (this.sim.mods.projSpeed || 0)),
      dmg: stats.dmg,
      towerType: tower.type,
      // 命中钩子需要出手的塔（塔被卖掉后弹道仍按出手时的那座塔归属）。
      tower,
      splash: stats.splash || 0,
      slow: stats.slow || 0,
      slowDur: stats.slowDur || 0,
      dot: stats.dot || 0,
      dotDur: stats.dotDur || 0,
      knockback: stats.knockback || 0,
      ignoreArmor: !!def.ignoreArmor,
      ttl: 4,
      done: false,
    });
    this.sim.addEffect({
      kind: 'muzzle',
      x: tower.x + Math.cos(tower.angle) * 0.32,
      y: tower.y + Math.sin(tower.angle) * 0.32,
      angle: tower.angle,
      ttl: 0.1,
      color: def.color,
    });
  }

  // ---------- 投射物 ----------
  updateProjectiles(dt) {
    for (const proj of this.sim.projectiles) {
      proj.ttl -= dt;
      if (proj.ttl <= 0) {
        proj.done = true;
        continue;
      }
      if (proj.target && proj.target.dead) proj.target = null;
      const tx = proj.target ? proj.target.x : proj.tx;
      const ty = proj.target ? proj.target.y : proj.ty;
      const dx = tx - proj.x;
      const dy = ty - proj.y;
      const dist = Math.hypot(dx, dy);
      const step = proj.speed * dt;

      if (dist <= Math.max(step, 0.12)) {
        proj.x = tx;
        proj.y = ty;
        this.sim.impact(proj);
        proj.done = true;
        continue;
      }
      proj.x += (dx / dist) * step;
      proj.y += (dy / dist) * step;
      proj.angle = Math.atan2(dy, dx);
    }
    this.sim.projectiles = this.sim.projectiles.filter((p) => !p.done);
  }

  impact(proj) {
    if (proj.splash > 0) {
      let hits = 0;
      for (const enemy of this.sim.enemies) {
        if (enemy.dead) continue;
        if (Math.hypot(enemy.x - proj.x, enemy.y - proj.y) <= proj.splash + enemy.r * 0.4) {
          this.sim.hitEnemy(enemy, proj);
          hits++;
        }
      }
      this.sim.addEffect({
        kind: 'ring',
        x: proj.x,
        y: proj.y,
        r0: 0.15,
        r1: proj.splash,
        ttl: 0.25,
        color: '#ffb066',
      });
      this.sim.shake = Math.min(10, this.sim.shake + (hits > 3 ? 2.4 : 1));
      return;
    }

    let target = proj.target;
    if (!target || target.dead) {
      let best = null;
      let bestDist = 0.45;
      for (const enemy of this.sim.enemies) {
        if (enemy.dead) continue;
        const d = Math.hypot(enemy.x - proj.x, enemy.y - proj.y);
        if (d < bestDist) {
          bestDist = d;
          best = enemy;
        }
      }
      target = best;
    }
    if (target) {
      this.sim.hitEnemy(target, proj);
      this.sim.addEffect({ kind: 'spark', x: proj.x, y: proj.y, ttl: 0.15, color: '#ffe4b0' });
    }
  }
}
