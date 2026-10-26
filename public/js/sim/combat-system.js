// 伤害管线：命中计算、护甲/护盾、击杀结算、分裂延后生成与清理。
import { BALANCE } from '../shared/config.js';
import { ENEMIES } from '../shared/data.js';
import { conditionSnapshot, hitBonuses } from '../shared/effects.js';

export class CombatSystem {
  constructor(sim) {
    this.sim = sim;
  }

  dealDamage(enemy, base, towerType, opts = {}) {
    if (enemy.dead) return 0;
    const hit = this.sim.computeHit(base, towerType, enemy, opts);
    const dealt = this.sim.damage(enemy, hit.dmg, { ignoreArmor: opts.ignoreArmor, crit: hit.crit });
    // 命中钩子：只有塔的攻击会带上出手的塔；盟友/技能命中以 tower = null 传入。
    if (this.sim.hexRuntime.active) {
      this.sim.hexCall('onHit', enemy, opts.tower || null, dealt, this.sim.hexCtx);
    }
    return dealt;
  }

  // base 必须来自 statsFor()（已包含塔专属与全局增伤），这里只应用条件增伤与暴击。
  // 面板显示 statsFor().dmg，对零护甲、无暴击、无条件增伤的目标应完全一致。
  computeHit(base, towerType, enemy, opts = {}) {
    let dmg = base;
    // 条件增伤由注册表按声明顺序给出，乘法顺序与重构前一致。
    // 条件上下文只读本局状态快照，不调用随机数，也不改变暴击的 RNG 顺序。
    const context = opts.conditionContext || conditionSnapshot(this.sim);
    for (const bonus of hitBonuses(this.sim, enemy, context)) dmg *= 1 + bonus;
    let crit = false;
    if (!opts.noCrit && this.sim.mods.crit > 0 && this.sim.combatRng.float() < this.sim.mods.crit) {
      dmg *= 2;
      crit = true;
    }
    return { dmg, crit };
  }

  damage(enemy, amount, opts = {}) {
    if (enemy.dead) return 0;
    let final = amount;
    if (!opts.ignoreArmor) {
      final = Math.max(1, final - enemy.armor * (1 - (this.sim.mods.armorPierce || 0)));
    }
    if (this.sim.mods.frostDmgBonus && this.sim.time < enemy.slowUntil) {
      final *= 1 + this.sim.mods.frostDmgBonus;
    }
    // 首领停顿/蓄力时是破绽窗口，鼓励集火。
    if (enemy.boss && this.sim.time < (enemy.vulnUntil || 0)) {
      final *= BALANCE.bossVulnMul;
    }
    // 技能易伤：冻结易伤（霜月）与星痕易伤（时之终章），统一用模拟时间判断。
    if (this.sim.time < (enemy.freezeVulnUntil || 0) && enemy.freezeVuln > 0) {
      final *= 1 + enemy.freezeVuln;
    }
    if (this.sim.time < (enemy.skillVulnUntil || 0) && enemy.skillVuln > 0) {
      final *= 1 + enemy.skillVuln;
    }
    // 护盾先于本体吸收伤害；本体在盾破前不掉血。
    if (enemy.shield > 0) {
      const absorbed = Math.min(enemy.shield, final);
      enemy.shield -= absorbed;
      final -= absorbed;
    }
    enemy.hp -= final;
    if (!opts.dot) enemy.hitFlash = 1;

    if (!opts.silent && (final >= 12 || opts.crit)) {
      this.sim.addFloater(
        enemy.x,
        enemy.y - 0.45,
        opts.crit ? `${Math.round(final)}!` : `${Math.round(final)}`,
        opts.crit ? '#ffd36b' : '#eef3f8',
        opts.crit,
        { key: opts.crit || final >= 60 }
      );
    }
    if (enemy.hp <= 0) this.sim.killEnemy(enemy);
    return final;
  }

  hitEnemy(enemy, proj) {
    if (enemy.dead) return;
    this.sim.dealDamage(enemy, proj.dmg, proj.towerType, { ignoreArmor: proj.ignoreArmor, tower: proj.tower || null });

    if (proj.slow > 0) {
      const amount = Math.min(0.85, proj.slow + (this.sim.mods.slow || 0));
      const duration = (proj.slowDur || 1.5) * (1 + (this.sim.mods.slowDur || 0));
      enemy.slowAmt = Math.max(enemy.slowAmt, amount);
      enemy.slowUntil = Math.max(enemy.slowUntil, this.sim.time + duration);
    }
    if (proj.dot > 0) {
      const dps = proj.dot * (1 + (this.sim.mods.dot || 0));
      if (dps >= enemy.poisonDps || this.sim.time > enemy.poisonUntil) {
        enemy.poisonDps = Math.max(dps, this.sim.time > enemy.poisonUntil ? 0 : enemy.poisonDps);
        enemy.poisonUntil = this.sim.time + (proj.dotDur || 3);
      }
    }
    if (proj.knockback > 0) {
      // 击退只回退路径进度，位置在下个模拟步由 posAt 重新求得，不引入额外随机数。
      enemy.progress = Math.max(0, enemy.progress - proj.knockback);
    }
  }

  // ---------- 伤害 ----------
  killEnemy(enemy) {
    if (enemy.dead) return;
    enemy.dead = true;
    if (enemy.splits) {
      const count = Math.max(1, Math.floor(enemy.splits.count || 1));
      for (let i = 0; i < count; i++) {
        this.sim.pendingSplits.push({
          type: enemy.splits.type,
          lane: enemy.lane,
          progress: Math.max(0, enemy.progress - i * 0.12),
        });
      }
    }
    const multiplier =
      (1 + (this.sim.mods.goldMul || 0)) *
      (1 + this.sim.wave * BALANCE.killGoldWaveRate) *
      (this.sim.modifier?.goldMul || 1);
    const gold = Math.round(enemy.gold * multiplier) + (this.sim.mods.killGold || 0);
    this.sim.gold += gold;
    this.sim.kills++;
    this.sim.addEffect({
      kind: 'death',
      x: enemy.x,
      y: enemy.y,
      r: enemy.r,
      ttl: 0.45,
      color: ENEMIES[enemy.type].color,
    });
    if (enemy.boss) {
      this.sim.shake = Math.min(14, this.sim.shake + 10);
      this.sim.addFloater(enemy.x, enemy.y - 0.6, `+${gold}`, '#ffd36b', true, { key: true });
      this.sim.playSound('bossKill');
    } else {
      this.sim.playSound('kill');
    }
    // 里程碑击杀钩子（极光终章 / 终章延时）
    this.sim.hexCall('onEnemyKilled', enemy, this.sim.hexCtx);
    this.sim.onSkillKill(enemy);
  }

  // 本帧所有伤害结算完成后再生成分裂子怪：顺序固定，同种子结果一致。
  flushSplits() {
    if (!this.sim.pendingSplits.length) return;
    const pending = this.sim.pendingSplits;
    this.sim.pendingSplits = [];
    for (const item of pending) this.sim.spawnEnemy(item.type, item.lane, null, item.progress);
  }

  cleanup() {
    this.sim.flushSplits();
    if (this.sim.enemies.some((e) => e.dead)) this.sim.enemies = this.sim.enemies.filter((e) => !e.dead);
    if (this.sim.effects.length > 320) this.sim.effects.splice(0, this.sim.effects.length - 320);
    if (this.sim.floaters.length > 90) this.sim.floaters.splice(0, this.sim.floaters.length - 90);
  }
}
