// 伤害管线：命中计算、护甲/护盾、击杀结算、分裂延后生成与清理。
import { BALANCE } from '../shared/config.js';
import { ENEMIES } from '../shared/data.js';
import { conditionSnapshot, hitBonuses } from '../shared/effects.js';
import { pushImpactEvent } from '../shared/impact-events.js';

// 觉醒（§7）：击杀钩子参数。frostheart-shatter 减速死亡霜爆 1.2 格冻结 0.4s；
// toxin-spread 中毒死亡传播 1 层（单槽取高），最多 3 跳（传播半径沿用蚀毒 T3 死亡传播 1.5 格）。
const FROSTHEART_BURST_RADIUS = 1.2;
const FROSTHEART_FREEZE_DURATION = 0.4;
const TOXIN_SPREAD_RADIUS = 1.5;
const TOXIN_SPREAD_MAX_HOPS = 3;

export class CombatSystem {
  constructor(sim) {
    this.sim = sim;
  }

  dealDamage(enemy, base, towerType, opts = {}) {
    if (enemy.dead) return 0;
    const hit = this.sim.computeHit(base, towerType, enemy, opts);
    // 事件字段随伤害一起透传：weapon 默认取塔类型/盟友种类，towerId 只属于塔的攻击。
    const dealt = this.sim.damage(enemy, hit.dmg, {
      ignoreArmor: opts.ignoreArmor,
      crit: hit.crit,
      weapon: opts.weapon ?? towerType,
      source: opts.source ?? 'tower',
      towerId: opts.tower?.id ?? null,
    });
    // 命中钩子：只有塔的攻击会带上出手的塔；盟友/技能命中以 tower = null 传入。
    if (this.sim.hexRuntime.active) {
      this.sim.hexCall('onHit', enemy, opts.tower || null, dealt, this.sim.hexCtx);
    }
    return dealt;
  }

  // base 必须来自 statsFor()（已包含塔专属与全局增伤），这里只应用条件增伤与暴击。
  // 面板显示 statsFor().dmg，对零护甲、无暴击、无条件增伤的目标应完全一致。
  computeHit(base, towerType, enemy, opts = {}) {
    const setMods = this.sim.factions?.setMods || {};
    let dmg = base;
    // 条件增伤由注册表按声明顺序给出，乘法顺序与重构前一致。
    // 条件上下文只读本局状态快照，不调用随机数，也不改变暴击的 RNG 顺序。
    const context = opts.conditionContext || conditionSnapshot(this.sim);
    for (const bonus of hitBonuses(this.sim, enemy, context)) dmg *= 1 + bonus;
    // 独塔为王 10 级狙击「处决线」：对生命低于阈值的敌人伤害 +mul（常驻，由 stats.executeThreshold 驱动）。
    const towerStats = opts.tower?.stats;
    if (
      towerStats?.executeThreshold > 0 &&
      enemy.maxHp > 0 &&
      enemy.hp < enemy.maxHp * towerStats.executeThreshold
    ) {
      dmg *= 1 + (towerStats.executeMul || 0);
    }
    let crit = false;
    // 强制暴击（crit: true）：大招触发当次的「必暴击」走此分支，不消耗战斗 RNG。
    if (opts.crit) {
      // 火力 T2：暴击额外倍率（默认 0；暴击总倍率 2.0 + 值）。
      dmg *= 2 + (setMods.critDamage || 0);
      crit = true;
    } else if (!opts.noCrit && this.sim.mods.crit > 0 && this.sim.combatRng.float() < this.sim.mods.crit) {
      dmg *= 2 + (setMods.critDamage || 0);
      crit = true;
    }
    return { dmg, crit };
  }

  damage(enemy, amount, opts = {}) {
    if (enemy.dead) return 0;
    // 事件保留入参原值：护甲前、未含易伤乘区的「原始伤害」。
    const rawAmount = amount;
    const setMods = this.sim.factions?.setMods || {};
    // 火力 T1：独立增伤乘区（伤害入口），与遗物增伤相乘、不写 mods；0 点时值为 0，行为不变。
    let final = amount * (1 + (setMods.allDamage || 0));
    // 护甲减免与护盾吸收都记录到事件里：事后仍可还原这次命中的构成。
    let armorAbsorbed = 0;
    if (!opts.ignoreArmor) {
      const reduced = Math.max(1, final - enemy.armor * (1 - (this.sim.mods.armorPierce || 0)));
      // 1 点伤害下限可能让「减免」为负，事件里按 0 记（下限抬高的伤害照常进 hpLost）。
      armorAbsorbed = Math.max(0, final - reduced);
      final = reduced;
    }
    if (this.sim.mods.frostDmgBonus && this.sim.time < enemy.slowUntil) {
      final *= 1 + this.sim.mods.frostDmgBonus;
    }
    // 冰封教义（frost）：霜塔对已减速目标伤害 +25%（结算点「霜塔伤害」，未选教义时不生效）。
    if (this.sim.hasDoctrine('frost') && opts.weapon === 'frost' && this.sim.time < (enemy.slowUntil || 0)) {
      final *= 1.25;
    }
    // 首领停顿/蓄力时是破绽窗口，鼓励集火。
    if (enemy.boss && this.sim.time < (enemy.vulnUntil || 0)) {
      final *= BALANCE.bossVulnMul;
    }
    // 蚀毒 T2：中毒目标受到的所有伤害 +值（复用中毒单槽语义：有 DPS 且未到期）。
    if (setMods.poisonVulnerable && enemy.poisonDps > 0 && this.sim.time < (enemy.poisonUntil || 0)) {
      final *= 1 + setMods.poisonVulnerable;
    }
    // 技能易伤：冻结易伤（霜月）与星痕易伤（时之终章），统一用模拟时间判断。
    if (this.sim.time < (enemy.freezeVulnUntil || 0) && enemy.freezeVuln > 0) {
      final *= 1 + enemy.freezeVuln;
    }
    if (this.sim.time < (enemy.skillVulnUntil || 0) && enemy.skillVuln > 0) {
      final *= 1 + enemy.skillVuln;
    }
    // 护盾先于本体吸收伤害；本体在盾破前不掉血。
    let shieldAbsorbed = 0;
    if (enemy.shield > 0) {
      const absorbed = Math.min(enemy.shield, final);
      enemy.shield -= absorbed;
      final -= absorbed;
      shieldAbsorbed = absorbed;
    }
    enemy.hp -= final;
    const lethal = enemy.hp <= 0;
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
    // 事件与 silent/dot/floatersMode/effectsLevel 完全解耦：反馈开关只影响消费端。
    // 先记事件再结算死亡：击杀钩子可能连锁产生后续事件。
    pushImpactEvent(this.sim, {
      t: this.sim.time,
      x: enemy.x,
      y: enemy.y,
      target: { id: enemy.id, type: enemy.type },
      weapon: opts.weapon,
      source: opts.source,
      towerId: opts.towerId ?? null,
      amount: rawAmount,
      armorAbsorbed,
      shieldAbsorbed,
      hpLost: final,
      crit: opts.crit === true,
      lethal,
    });
    if (lethal) this.sim.killEnemy(enemy, final, { noExplosion: opts.noExplosion });
    return final;
  }

  hitEnemy(enemy, proj) {
    if (enemy.dead) return;
    const setMods = this.sim.factions?.setMods || {};
    this.sim.dealDamage(enemy, proj.dmg, proj.towerType, { ignoreArmor: proj.ignoreArmor, tower: proj.tower || null });

    // 燃烧教义（cannon）：炮台落点附加 2s 燃烧，每秒造成 15% 攻击力（复用 burnDps/burnUntil 单槽）。
    // 重复命中只刷新时长，DPS 取较高值（不叠层）；未选教义（hasDoctrine=false）时不执行。
    if (this.sim.hasDoctrine('cannon') && proj.towerType === 'cannon') {
      const now = this.sim.time;
      const activeDps = (enemy.burnUntil || 0) > now ? enemy.burnDps || 0 : 0;
      enemy.burnDps = Math.max(activeDps, proj.dmg * 0.15);
      enemy.burnUntil = Math.max(enemy.burnUntil || 0, now + 2);
    }

    // 觉醒（powder-ignite）：炮台命中同一目标 5 次后落点燃烧 2s，每秒 20% 攻击力。
    // 命中计数挂在目标身上（触发后清零）；未觉醒（hasAwakening=false）时不执行，保持原行为。
    if (this.sim.hasAwakening('powder') && proj.towerType === 'cannon') {
      enemy.cannonHits = (enemy.cannonHits || 0) + 1;
      if (enemy.cannonHits >= 5) {
        const now = this.sim.time;
        const activeDps = (enemy.burnUntil || 0) > now ? enemy.burnDps || 0 : 0;
        enemy.burnDps = Math.max(activeDps, proj.dmg * 0.2);
        enemy.burnUntil = Math.max(enemy.burnUntil || 0, now + 2);
        enemy.cannonHits = 0;
      }
    }

    if (proj.slow > 0) {
      const amount = Math.min(0.85, proj.slow + (this.sim.mods.slow || 0));
      // 霜缚 T1：减速时长倍率加成（独立于遗物 slowDur，0 点时乘 1 不变）。
      const duration = (proj.slowDur || 1.5) * (1 + (this.sim.mods.slowDur || 0)) * (1 + (setMods.slowDuration || 0));
      enemy.slowAmt = Math.max(enemy.slowAmt, amount);
      enemy.slowUntil = Math.max(enemy.slowUntil, this.sim.time + duration);
    }
    if (proj.dot > 0) {
      const dps = proj.dot * (1 + (this.sim.mods.dot || 0));
      if (dps >= enemy.poisonDps || this.sim.time > enemy.poisonUntil) {
        enemy.poisonDps = Math.max(dps, this.sim.time > enemy.poisonUntil ? 0 : enemy.poisonDps);
        enemy.poisonUntil = this.sim.time + (proj.dotDur || 3);
      }
      // 疫病教义（poison）：命中时向 0.8 格内最多 2 名敌人扩散 60% 毒伤（不叠层，单槽取高）。
      if (this.sim.hasDoctrine('poison') && proj.towerType === 'poison') {
        const spreadDps = dps * 0.6;
        const spreadUntil = this.sim.time + (proj.dotDur || 3);
        const candidates = [];
        for (const other of this.sim.enemies) {
          if (other.dead || other === enemy) continue;
          if (Math.hypot(other.x - enemy.x, other.y - enemy.y) <= 0.8) candidates.push(other);
        }
        for (let i = 0; i < Math.min(2, candidates.length); i++) {
          const other = candidates[i];
          if (spreadDps >= other.poisonDps || this.sim.time > other.poisonUntil) {
            other.poisonDps = Math.max(spreadDps, this.sim.time > other.poisonUntil ? 0 : other.poisonDps);
            other.poisonUntil = Math.max(other.poisonUntil, spreadUntil);
          }
        }
      }
    }
    if (proj.knockback > 0) {
      // 击退只回退路径进度，位置在下个模拟步由 posAt 重新求得，不引入额外随机数。
      enemy.progress = Math.max(0, enemy.progress - proj.knockback);
    }
    // 霜缚 T2：每 N 次霜塔命中冻结 duration 秒（复用 freezeUntil，解冻统一走 resolveThaw）。
    if (setMods.frostFreeze && proj.towerType === 'frost') {
      enemy.frostHits = (enemy.frostHits || 0) + 1;
      if (enemy.frostHits >= setMods.frostFreeze.hits) {
        enemy.freezeUntil = this.sim.time + setMods.frostFreeze.duration;
        enemy.frostHits = 0;
      }
    }
  }

  // ---------- 伤害 ----------
  killEnemy(enemy, killingDamage = 0, opts = {}) {
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
      // 「是不是首领」由模拟侧显式记录，渲染层不再按死亡特效半径反推。
      this.sim.addCulmination('bossKill', {
        type: enemy.type,
        name: ENEMIES[enemy.type]?.name || enemy.type,
      });
      this.sim.playSound('bossKill');
    } else {
      this.sim.playSound('kill');
    }
    // 里程碑击杀钩子（极光终章 / 终章延时）
    this.sim.hexCall('onEnemyKilled', enemy, this.sim.hexCtx);
    this.sim.onSkillKill(enemy);
    // 派系击杀钩子（§3.2）：火力 T3 击杀爆炸 / 蚀毒 T3 中毒传播。
    this.applyKillSetMods(enemy, killingDamage, opts);
    // 觉醒击杀钩子（§7）：frostheart-shatter 减速死亡霜爆、toxin-spread 中毒死亡传播。
    this.applyKillAwakenings(enemy);
  }

  // 击杀派生效果（独立于技能与海克斯钩子，结算在击杀尾部）。
  // noExplosion 防递归：爆炸/传播引起的二次击杀不再触发同类钩子，避免连锁失控。
  applyKillSetMods(enemy, killingDamage, opts = {}) {
    const setMods = this.sim.factions?.setMods || {};
    if (opts.noExplosion) return;

    // 火力 T3：对半径内敌人造成 ratio × 本次伤害（走常规伤害入口，护甲/易伤照常结算）。
    if (setMods.killExplosion && killingDamage > 0) {
      const dmg = killingDamage * setMods.killExplosion.ratio;
      const radius = setMods.killExplosion.radius;
      for (const other of this.sim.enemies) {
        if (other.dead || other === enemy) continue;
        if (Math.hypot(other.x - enemy.x, other.y - enemy.y) <= radius) {
          this.sim.damage(other, dmg, { noExplosion: true, weapon: 'killExplosion', source: 'setmod' });
        }
      }
    }

    // 蚀毒 T3：中毒死亡向半径内 targets 个敌人传播（单槽模型：取更高 DPS，传播源剩余的层时长）。
    if (
      setMods.poisonSpread &&
      enemy.poisonDps > 0 &&
      this.sim.time < (enemy.poisonUntil || 0)
    ) {
      const candidates = [];
      for (const other of this.sim.enemies) {
        if (other.dead || other === enemy) continue;
        if (Math.hypot(other.x - enemy.x, other.y - enemy.y) <= setMods.poisonSpread.radius) {
          candidates.push(other);
        }
      }
      for (let i = 0; i < Math.min(setMods.poisonSpread.targets, candidates.length); i++) {
        const other = candidates[i];
        if (enemy.poisonDps >= other.poisonDps || this.sim.time > other.poisonUntil) {
          other.poisonDps = Math.max(
            enemy.poisonDps,
            this.sim.time > other.poisonUntil ? 0 : other.poisonDps
          );
          other.poisonUntil = Math.max(other.poisonUntil, enemy.poisonUntil);
        }
      }
    }
  }

  // 觉醒击杀钩子（§7）：未觉醒时 hasAwakening 恒 false，整段空跑，不改变 RNG 顺序。
  // 二者都不产生立即击杀（霜爆只冻结、传播只挂 DoT），无需 noExplosion 防递归。
  applyKillAwakenings(enemy) {
    // frostheart-shatter：被减速目标死亡时，1.2 格内敌人霜爆冻结 0.4s（复用 freezeUntil）。
    if (this.sim.hasAwakening('frostheart') && this.sim.time < (enemy.slowUntil || 0)) {
      for (const other of this.sim.enemies) {
        if (other.dead || other === enemy) continue;
        if (Math.hypot(other.x - enemy.x, other.y - enemy.y) <= FROSTHEART_BURST_RADIUS) {
          other.freezeUntil = Math.max(other.freezeUntil || 0, this.sim.time + FROSTHEART_FREEZE_DURATION);
        }
      }
      this.sim.addEffect({
        kind: 'frostBurst',
        x: enemy.x,
        y: enemy.y,
        r0: 0.1,
        r1: FROSTHEART_BURST_RADIUS,
        ttl: 0.3,
        color: '#7fd4ff',
      });
    }

    // toxin-spread：中毒死亡传播 1 层（单槽取高 + 刷新时长），最多 3 跳。
    // poisonHop 记录毒素已经跳过的次数：自然中毒为 0，第 3 跳落地的毒素不再传播。
    if (
      this.sim.hasAwakening('toxin') &&
      enemy.poisonDps > 0 &&
      this.sim.time < (enemy.poisonUntil || 0) &&
      (enemy.poisonHop || 0) < TOXIN_SPREAD_MAX_HOPS
    ) {
      let nearest = null;
      let bestDist = Infinity;
      for (const other of this.sim.enemies) {
        if (other.dead || other === enemy) continue;
        const d = Math.hypot(other.x - enemy.x, other.y - enemy.y);
        if (d <= TOXIN_SPREAD_RADIUS && d < bestDist) {
          bestDist = d;
          nearest = other;
        }
      }
      if (nearest) {
        nearest.poisonDps = Math.max(nearest.poisonDps || 0, enemy.poisonDps);
        nearest.poisonUntil = Math.max(nearest.poisonUntil || 0, enemy.poisonUntil);
        nearest.poisonHop = (enemy.poisonHop || 0) + 1;
        this.sim.addEffect({
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
