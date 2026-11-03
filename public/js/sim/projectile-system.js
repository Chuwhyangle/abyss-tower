// 投射物：开火、飞行推进与落点命中。
import { TOWERS } from '../shared/data.js';

// 穿透教义（bolt）：命中后向 0.8 格内最近的另一名敌人再穿 1 层（第 2 个目标 60% 伤害）。
const PIERCE_RANGE = 0.8;

// 觉醒（sharp-pierce）：弩塔每第 6 发穿透 2 个目标（穿透目标承受 60% 伤害）。
const SHARP_PIERCE_INTERVAL = 6;

export class ProjectileSystem {
  constructor(sim) {
    this.sim = sim;
  }

  fire(tower, stats, target) {
    const def = TOWERS[tower.type];
    tower.recoil = 1;
    this.sim.playSound(`shoot_${tower.type}`);

    // 大招触发框架（独塔为王）：10 级解锁的被动大招，塔级确定性计数器「每 N 次攻击触发一次」，
    // 不消耗 RNG、不改 sim RNG 调用顺序。电弧塔的连锁大招在下面 arc 分支结算；
    // 其余塔的大招规格随投射物带到 impact / applyUltimate。
    let ultimate = null;
    const ultimateSpec = this.sim.hexRuntime.active
      ? this.sim.hexRuntime.ultimateSpec(tower, this.sim.hexCtx)
      : null;
    if (ultimateSpec && Number.isFinite(ultimateSpec.every) && ultimateSpec.every > 0) {
      tower.ultimateShots = (tower.ultimateShots || 0) + 1;
      if (tower.ultimateShots % ultimateSpec.every === 0) ultimate = ultimateSpec;
    }

    if (tower.type === 'arc') {
      // 雷暴 T1：连锁目标 +N；雷暴 T2：连锁跳转范围 +N 格。0 点时二者均为 0，行为不变。
      // 过载教义（arc）：连锁 +1、连锁范围 +0.8 格，与雷暴同类键加算（§3.2）。
      // 独塔为王 10 级：常驻连锁 +1、跳转 +0.6 已写入 stats；触发当次连锁必暴击、跳转 +1.2。
      const setMods = this.sim.factions?.setMods || {};
      const doctrineChain = this.sim.hasDoctrine('arc') ? 1 : 0;
      const doctrineRange = this.sim.hasDoctrine('arc') ? 0.8 : 0;
      const chain = Math.max(1, Math.round(stats.chain) + (setMods.chainExtra || 0) + doctrineChain);
      const chainRange =
        (stats.chainRange ?? def.chainRange) +
        (setMods.chainRange || 0) +
        doctrineRange +
        (ultimate ? ultimate.chainRangeBonus || 0 : 0);
      const hit = new Set();
      const points = [{ x: tower.x, y: tower.y }];
      let current = target;
      for (let i = 0; i < chain && current; i++) {
        hit.add(current.id);
        points.push({ x: current.x, y: current.y });
        // 雷暴 T3「连锁可以暴击」为既有行为：连锁命中走 dealDamage → computeHit 的常规暴击判定。
        // 触发当次必暴击：crit: true 走 computeHit 的强制暴击分支，不消耗 RNG。
        this.sim.dealDamage(current, stats.dmg, 'arc', {
          ignoreArmor: true,
          tower,
          crit: ultimate && ultimate.chainCrit ? true : undefined,
        });
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
      // ultimate/towerLevel 同属表现字段：大招连锁画专属爆发层，等级供枪口焰缩放。
      this.sim.addEffect({
        kind: 'bolt',
        points,
        ttl: 0.18,
        color: '#c9a8ff',
        weapon: 'arc',
        towerLevel: tower.level,
        ultimate: !!ultimate,
      });
      return;
    }

    // 觉醒（sharp-pierce）：弩塔每第 6 发穿透 2 个目标（穿透目标承受 60% 伤害）。
    // 发数计数挂在塔上（命中结算在 impact 读取 pierce2 标记）；未觉醒时不计数，保持原行为。
    let pierce2 = false;
    if (tower.type === 'arrow' && this.sim.hasAwakening('sharp')) {
      tower.arrowShots = (tower.arrowShots || 0) + 1;
      if (tower.arrowShots % SHARP_PIERCE_INTERVAL === 0) pierce2 = true;
    }

    // 触发当次的投射物属性改写：震荡溅射/击退/减速，狙击 250% 处决伤害与全图索敌。
    let dmg = stats.dmg;
    let splash = stats.splash || 0;
    let slow = stats.slow || 0;
    let knockback = stats.knockback || 0;
    let aimTarget = target;
    if (ultimate) {
      if (ultimate.splashMul) splash *= ultimate.splashMul;
      if (ultimate.knockbackMul) knockback *= ultimate.knockbackMul;
      if (ultimate.slowBonus) slow += ultimate.slowBonus;
      if (ultimate.execute) {
        if (ultimate.execute.damageMul) dmg *= ultimate.execute.damageMul;
        // 无视射程处决：触发当次全图索敌（复用炮台 fullMap 的确定性索敌口径）。
        if (ultimate.execute.fullMap) {
          let best = null;
          for (const enemy of this.sim.enemies) {
            if (enemy.dead) continue;
            if (def.groundOnly && enemy.flying && !(this.sim.time < (enemy.freezeUntil || 0))) continue;
            if (!best || enemy.progress > best.progress || (enemy.progress === best.progress && enemy.id < best.id)) {
              best = enemy;
            }
          }
          if (best) aimTarget = best;
        }
      }
    }

    // 战旗军令箭复用 bolt 投射物（战旗无 proj 表项，兜底为弩塔 bolt 参数）。
    const projDef = def.proj || { kind: 'bolt', speed: 17 };
    this.sim.projectiles.push({
      id: this.sim.nextId++,
      kind: projDef.kind,
      x: tower.x,
      y: tower.y,
      target: aimTarget,
      tx: aimTarget.x,
      ty: aimTarget.y,
      angle:
        aimTarget === target
          ? tower.angle
          : Math.atan2(aimTarget.y - tower.y, aimTarget.x - tower.x),
      speed: projDef.speed * (1 + (this.sim.mods.projSpeed || 0)),
      dmg,
      towerType: tower.type,
      // 命中钩子需要出手的塔（塔被卖掉后弹道仍按出手时的那座塔归属）。
      tower,
      splash,
      slow,
      slowDur: stats.slowDur || 0,
      dot: stats.dot || 0,
      dotDur: stats.dotDur || 0,
      knockback,
      ignoreArmor: !!def.ignoreArmor,
      pierce2,
      ultimate,
      ultimateSpec,
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
      // 表现字段：独塔模式 6/9/10 级枪口焰逐级拉长。
      towerLevel: tower.level,
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
        // 震荡塔大招即溅射强化：触发当次溅射环叠加专属爆发层。
        ultimate: !!(proj.ultimate && proj.ultimate.splashMul),
      });
      this.sim.shake = Math.min(10, this.sim.shake + (hits > 3 ? 2.4 : 1));
      this.applyUltimate(proj);
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
      // 觉醒（sharp-pierce）：第 6 发命中后向近邻依次穿透 2 个目标，各承受 60% 伤害；
      // 与穿透教义独立（教义每发、觉醒每 6 发），未觉醒时 pierce2 恒 false，保持原行为。
      if (proj.pierce2 && proj.towerType === 'arrow') {
        let current = target;
        for (let i = 0; i < 2; i++) {
          let pierce = null;
          let bestDist = Infinity;
          for (const enemy of this.sim.enemies) {
            if (enemy.dead || enemy === current || enemy === target) continue;
            const d = Math.hypot(enemy.x - current.x, enemy.y - current.y);
            if (d <= PIERCE_RANGE + enemy.r && d < bestDist) {
              bestDist = d;
              pierce = enemy;
            }
          }
          if (!pierce) break;
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
          current = pierce;
        }
      }
    }
    this.applyUltimate(proj, target);
  }

  // 大招触发效果（独塔为王）：按规格分发到各塔的命中后效果。
  // target 是本次单目标命中的敌人（溅射类大招不依赖它，传 null）。
  applyUltimate(proj, target = null) {
    const spec = proj.ultimateSpec;
    if (!proj.ultimate || !spec) return;
    if (spec.aftershock) this.applyCannonAftershock(proj, spec);
    if (spec.pierce) this.applyArrowPierce(proj, spec, target);
    if (spec.freeze) this.applyFrostFreeze(proj, spec, target);
    if (spec.detonate) this.applyPoisonDetonate(proj, spec, target);
    if (spec.volley) this.applyBannerVolley(proj, spec);
    if (spec.execute) this.applySniperExecute(proj, spec, target);
  }

  // 炮台轰击「余波」：命中后在目标点对半径内敌人造成二次范围伤害（不参与暴击判定，确定性触发）。
  applyCannonAftershock(proj, spec) {
    const aftershock = spec.aftershock;
    if (!aftershock || !(aftershock.damageMul > 0) || !(aftershock.radius > 0)) return;
    let hits = 0;
    for (const enemy of this.sim.enemies) {
      if (enemy.dead) continue;
      if (Math.hypot(enemy.x - proj.x, enemy.y - proj.y) <= aftershock.radius + enemy.r) {
        this.sim.dealDamage(enemy, proj.dmg * aftershock.damageMul, proj.towerType, {
          ignoreArmor: proj.ignoreArmor,
          tower: proj.tower || null,
          noCrit: true,
        });
        hits++;
      }
    }
    this.sim.addEffect({
      kind: 'ring',
      x: proj.x,
      y: proj.y,
      r0: 0.2,
      r1: aftershock.radius,
      ttl: 0.35,
      color: '#ffd36b',
      weapon: proj.towerType,
      ultimate: true,
    });
    if (hits > 0) this.sim.shake = Math.min(12, this.sim.shake + 1.6);
  }

  // 弩塔「连珠穿云」：命中后向近邻依次穿透 count 个目标，各 damageMul 伤害且必暴击。
  applyArrowPierce(proj, spec, target) {
    if (!target || target.dead) return;
    const pierce = spec.pierce;
    let current = target;
    for (let i = 0; i < (pierce.count || 0); i++) {
      let next = null;
      let bestDist = Infinity;
      for (const enemy of this.sim.enemies) {
        if (enemy.dead || enemy === current || enemy === target) continue;
        const d = Math.hypot(enemy.x - current.x, enemy.y - current.y);
        if (d <= PIERCE_RANGE + enemy.r && d < bestDist) {
          bestDist = d;
          next = enemy;
        }
      }
      if (!next) break;
      this.sim.dealDamage(next, proj.dmg * (pierce.damageMul || 0.6), proj.towerType, {
        ignoreArmor: proj.ignoreArmor,
        tower: proj.tower || null,
        crit: pierce.crit ? true : undefined,
      });
      this.sim.addEffect({
        kind: 'spark',
        x: next.x,
        y: next.y,
        ttl: 0.15,
        color: '#ffe4b0',
        weapon: proj.towerType,
        ultimate: true,
      });
      current = next;
    }
  }

  // 霜塔「急冻控杀」：命中目标冻结（首领减半），冻结期间受伤 +vuln。
  applyFrostFreeze(proj, spec, target) {
    if (!target || target.dead) return;
    const freeze = spec.freeze;
    const dur = target.boss ? (freeze.bossDuration ?? freeze.duration) : freeze.duration;
    if (!(dur > 0)) return;
    const now = this.sim.time;
    target.freezeUntil = Math.max(target.freezeUntil || 0, now + dur);
    target.freezeVuln = Math.max(target.freezeVuln || 0, freeze.vuln || 0);
    target.freezeVulnUntil = Math.max(target.freezeVulnUntil || 0, now + dur);
    this.sim.addEffect({
      kind: 'frostBurst',
      x: target.x,
      y: target.y,
      r0: 0.1,
      r1: 0.6,
      ttl: 0.3,
      color: '#7fd4ff',
      weapon: proj.towerType,
      ultimate: true,
    });
  }

  // 毒雾塔「疫爆扩散」：即时结算目标当前毒伤（无视护甲），并把毒传播给半径内敌人（单槽取高）。
  applyPoisonDetonate(proj, spec, target) {
    if (!target || target.dead) return;
    const now = this.sim.time;
    const active = target.poisonUntil > now && target.poisonDps > 0;
    const dps = active ? target.poisonDps : 0;
    if (dps > 0) {
      this.sim.damage(target, dps * (target.poisonUntil - now), {
        ignoreArmor: true,
        weapon: 'poison',
        source: 'tower',
        towerId: proj.tower?.id ?? null,
      });
      target.poisonDps = 0;
      target.poisonUntil = 0;
    }
    if (dps <= 0) return;
    const radius = spec.spread?.radius ?? 1.5;
    const spreadUntil = now + (proj.dotDur || 3);
    for (const other of this.sim.enemies) {
      if (other.dead || other === target) continue;
      if (Math.hypot(other.x - target.x, other.y - target.y) > radius) continue;
      if (dps >= (other.poisonDps || 0) || now > (other.poisonUntil || 0)) {
        other.poisonDps = Math.max(dps, now > (other.poisonUntil || 0) ? 0 : other.poisonDps);
        other.poisonUntil = Math.max(other.poisonUntil || 0, spreadUntil);
      }
    }
    this.sim.addEffect({
      kind: 'poisonSpread',
      x: target.x,
      y: target.y,
      r0: 0.1,
      r1: radius,
      ttl: 0.35,
      color: '#9be15d',
      weapon: proj.towerType,
      ultimate: true,
    });
  }

  // 战旗「号令齐射」：光环内最多 targets 个敌人受 damageMul 倍军令箭伤害，并进入攻速 surge 窗口。
  applyBannerVolley(proj, spec) {
    const tower = proj.tower;
    if (!tower) return;
    const volley = spec.volley;
    const range = tower.stats?.range ?? 3;
    const candidates = [];
    for (const enemy of this.sim.enemies) {
      if (enemy.dead) continue;
      if (Math.hypot(enemy.x - tower.x, enemy.y - tower.y) <= range + (enemy.r || 0)) candidates.push(enemy);
    }
    // 确定性目标顺序：progress 降序、id 升序（与 findTarget 同一口径），不引入随机数。
    candidates.sort((a, b) => b.progress - a.progress || a.id - b.id);
    for (let i = 0; i < Math.min(volley.targets || 0, candidates.length); i++) {
      const enemy = candidates[i];
      this.sim.dealDamage(enemy, proj.dmg * (volley.damageMul || 1.5), proj.towerType, {
        ignoreArmor: proj.ignoreArmor,
        tower,
        noCrit: true,
      });
      this.sim.addEffect({
        kind: 'spark',
        x: enemy.x,
        y: enemy.y,
        ttl: 0.18,
        color: '#ffd36b',
        weapon: proj.towerType,
        ultimate: true,
      });
    }
    // 攻速 surge 写在塔上，由 modifyTowerStats 读取；到期由 tower-system 清掉并刷新缓存。
    if (spec.surgeRate) {
      tower.bannerSurgeUntil = this.sim.time + (spec.surgeDuration || 3);
      this.sim.recomputeTowerStats();
    }
    this.sim.addEffect({
      kind: 'ring',
      x: tower.x,
      y: tower.y,
      r0: 0.2,
      r1: range,
      ttl: 0.35,
      color: '#ffd36b',
      weapon: proj.towerType,
      ultimate: true,
    });
  }

  // 狙击塔「无视射程处决」：命中目标额外承受最大生命百分比（首领降额，走百分比路径无视护甲）。
  applySniperExecute(proj, spec, target) {
    if (!target || target.dead) return;
    const exe = spec.execute;
    const pct = target.boss ? (exe.bossPct ?? exe.hpPct) : exe.hpPct;
    if (!(pct > 0)) return;
    const amount = target.maxHp * pct;
    if (!(amount > 0)) return;
    this.sim.damage(target, amount, {
      ignoreArmor: true,
      weapon: proj.towerType,
      source: 'tower',
      towerId: proj.tower?.id ?? null,
    });
    this.sim.addEffect({
      kind: 'spark',
      x: target.x,
      y: target.y,
      ttl: 0.2,
      color: '#ffd36b',
      weapon: proj.towerType,
      ultimate: true,
    });
  }
}
