// 投射物：开火、飞行推进与落点命中。
import { TOWERS } from '../shared/data.js';

// 穿透教义（bolt）：命中后向 0.8 格内最近的另一名敌人再穿 1 层（第 2 个目标 60% 伤害）。
const PIERCE_RANGE = 0.8;

export class ProjectileSystem {
  constructor(sim) {
    this.sim = sim;
  }

  fire(tower, stats, target) {
    const def = TOWERS[tower.type];
    tower.recoil = 1;
    this.sim.playSound(`shoot_${tower.type}`);

    if (tower.type === 'arc') {
      // 雷暴 T1：连锁目标 +N；雷暴 T2：连锁跳转范围 +N 格。0 点时二者均为 0，行为不变。
      // 过载教义（arc）：连锁 +1、连锁范围 +0.8 格，与雷暴同类键加算（§3.2）。
      const setMods = this.sim.factions?.setMods || {};
      const doctrineChain = this.sim.hasDoctrine('arc') ? 1 : 0;
      const doctrineRange = this.sim.hasDoctrine('arc') ? 0.8 : 0;
      const chain = Math.max(1, Math.round(stats.chain) + (setMods.chainExtra || 0) + doctrineChain);
      const chainRange = def.chainRange + (setMods.chainRange || 0) + doctrineRange;
      const hit = new Set();
      const points = [{ x: tower.x, y: tower.y }];
      let current = target;
      for (let i = 0; i < chain && current; i++) {
        hit.add(current.id);
        points.push({ x: current.x, y: current.y });
        // 雷暴 T3「连锁可以暴击」为既有行为：连锁命中走 dealDamage → computeHit 的常规暴击判定。
        this.sim.dealDamage(current, stats.dmg, 'arc', { ignoreArmor: true, tower });
        let next = null;
        let bestDist = Infinity;
        for (const enemy of this.sim.enemies) {
          if (enemy.dead || hit.has(enemy.id)) continue;
          const d = Math.hypot(enemy.x - current.x, enemy.y - current.y);
          if (d <= chainRange + enemy.r && d < bestDist) {
            bestDist = d;
            next = enemy;
          }
        }
        current = next;
      }
      // weapon 仅为表现字段：让渲染层按武器分派命中签名，不参与结算与随机数。
      this.sim.addEffect({ kind: 'bolt', points, ttl: 0.18, color: '#c9a8ff', weapon: 'arc' });
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
        weapon: proj.towerType,
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
      this.sim.addEffect({
        kind: 'spark',
        x: proj.x,
        y: proj.y,
        ttl: 0.15,
        color: '#ffe4b0',
        weapon: proj.towerType,
      });
      // 穿透教义（bolt）：命中后向最近另一名敌人再穿 1 层，第 2 个目标承受 60% 伤害；
      // 只穿 1 层，未选教义（hasDoctrine=false）时整段不执行，保持原行为字节一致。
      if (this.sim.hasDoctrine('bolt') && proj.towerType === 'arrow') {
        let pierce = null;
        let bestDist = Infinity;
        for (const enemy of this.sim.enemies) {
          if (enemy.dead || enemy === target) continue;
          const d = Math.hypot(enemy.x - target.x, enemy.y - target.y);
          if (d <= PIERCE_RANGE + enemy.r && d < bestDist) {
            bestDist = d;
            pierce = enemy;
          }
        }
        if (pierce) {
          this.sim.dealDamage(pierce, proj.dmg * 0.6, proj.towerType, {
            ignoreArmor: proj.ignoreArmor,
            tower: proj.tower || null,
          });
          this.sim.addEffect({
            kind: 'spark',
            x: pierce.x,
            y: pierce.y,
            ttl: 0.15,
            color: '#ffe4b0',
            weapon: proj.towerType,
          });
        }
      }
    }
  }
}
