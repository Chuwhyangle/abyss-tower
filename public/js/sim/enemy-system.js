// 敌人与友方单位：移动、光环/远程、首领状态机，以及召唤物自动攻击。
import { BALANCE } from '../shared/config.js';
import { BOSS_SKILLS, ENEMIES } from '../shared/data.js';
import { BOSS_VARIANTS } from '../shared/data/enemies.js';

export class EnemySystem {
  constructor(sim) {
    this.sim = sim;
  }

  updateEnemies(dt) {
    const now = this.sim.time;
    // 光环与加速都只读上一帧位置，先取快照，避免遍历顺序影响结果。
    const auraSources = this.sim.enemies.filter((enemy) => !enemy.dead && enemy.aura);
    // 诅咒图腾光环：移速每帧实时读取，拆除后本帧即失效（生命加成在生成时已结算）。
    const curse = this.sim.destructibleAura();
    // 时之终章：敌人移动、治疗、中毒/灼烧计时与首领计时全部暂停。
    const stasisActive = this.sim.isStasisActive();
    for (const enemy of this.sim.enemies) {
      if (enemy.dead) continue;
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt * 4);
      this.sim.updateEnemySkillStatus(enemy, dt, now, stasisActive);
      if (enemy.dead) continue;

      const slowed = now < enemy.slowUntil;
      if (!slowed && enemy.slowAmt) enemy.slowAmt = 0;
      const buff = now < (enemy.speedBuffUntil || 0) ? enemy.speedBuff || 0 : 0;
      const auraBuff = this.sim.auraBuffFor(enemy, auraSources);
      const frozen = now < (enemy.freezeUntil || 0);
      let speed = enemy.baseSpeed * (1 - (slowed ? enemy.slowAmt : 0)) * (1 + buff) * (1 + auraBuff)
        * curse.speedMul;
      // 冻结只停移动，不打断首领蓄力；时停则连首领计时一起暂停。
      if (frozen || stasisActive) speed = 0;
      if (!stasisActive) {
        if (enemy.boss) speed = this.sim.updateBoss(enemy, dt, speed, now);
        enemy.progress += speed * dt;
        // 相位幽魂：周期性短距闪烁，只推进路径进度、不换车道，也不消耗战斗 RNG。
        const blink = !frozen ? ENEMIES[enemy.type]?.blink : null;
        if (blink) {
          if (!Number.isFinite(enemy.blinkTimer)) enemy.blinkTimer = blink.interval;
          enemy.blinkTimer -= dt;
          if (enemy.blinkTimer <= 0) {
            enemy.blinkTimer += blink.interval;
            const lane = this.sim.lanes[enemy.lane] || this.sim.lanes[0];
            this.sim.addEffect({
              kind: 'ring',
              x: enemy.x,
              y: enemy.y,
              r0: 0.05,
              r1: enemy.r + 0.35,
              ttl: 0.22,
              color: ENEMIES[enemy.type].color,
            });
            enemy.progress = Math.min(enemy.progress + blink.distance, lane.len - 0.001);
          }
        }
      }

      const pos = this.sim.posAt(enemy.progress, enemy.lane);
      enemy.x = pos.x;
      enemy.y = pos.y;
      enemy.angle = pos.angle;

      if (!stasisActive && now < enemy.poisonUntil && enemy.poisonDps > 0) {
        this.sim.damage(enemy, enemy.poisonDps * dt, {
          ignoreArmor: true,
          silent: true,
          dot: true,
          weapon: 'poison',
          source: 'dot',
        });
        if (Math.random() < dt * 2.2) {
          this.sim.addEffect({ kind: 'poison', x: enemy.x, y: enemy.y - 0.15, ttl: 0.5 });
        }
      }

      if (!stasisActive && enemy.heal > 0 && !enemy.dead) {
        enemy.healTimer += dt;
        if (enemy.healTimer >= 0.5) {
          enemy.healTimer = 0;
          const amount = enemy.maxHp * enemy.heal * 0.5;
          let healed = false;
          for (const other of this.sim.enemies) {
            if (other.dead || other === enemy) continue;
            if (Math.hypot(other.x - enemy.x, other.y - enemy.y) <= enemy.healRange) {
              other.hp = Math.min(other.maxHp, other.hp + amount);
              healed = true;
            }
          }
          if (healed) this.sim.addEffect({ kind: 'heal', x: enemy.x, y: enemy.y, ttl: 0.6 });
        }
      }

      // 远程敌人：冻结/时停期间无法开火。
      if (!stasisActive && !frozen && !enemy.dead) this.sim.updateRanged(enemy, dt, now);

      if (enemy.progress >= (this.sim.lanes[enemy.lane] || this.sim.lanes[0]).len) this.sim.leak(enemy);
    }
  }

  // 同一敌人在多个光环内取最高加成，不叠加，避免后期数值失控。
  auraBuffFor(enemy, sources) {
    let buff = 0;
    for (const source of sources) {
      if (source === enemy || source.dead) continue;
      const dx = source.x - enemy.x;
      const dy = source.y - enemy.y;
      if (dx * dx + dy * dy > source.aura.range * source.aura.range) continue;
      buff = Math.max(buff, source.aura.speed);
    }
    return buff;
  }

  // 远程敌人优先轰击射程内最近的塔；没有塔时，逼近路径终点的远程敌人直接轰击基地。
  updateRanged(enemy, dt, now) {
    const spec = enemy.ranged;
    if (!spec) return;
    enemy.rangedTimer = Math.max(0, enemy.rangedTimer - dt);
    if (enemy.rangedTimer > 0) return;

    let target = null;
    let best = Infinity;
    for (const tower of this.sim.towers) {
      if (now < (tower.disabledUntil || 0)) continue;
      const d = Math.hypot(tower.x - enemy.x, tower.y - enemy.y);
      if (d <= spec.range && d < best) {
        best = d;
        target = tower;
      }
    }
    if (target) {
      target.disabledUntil = now + spec.disable;
      this.sim.addEffect({
        kind: 'bolt',
        points: [{ x: enemy.x, y: enemy.y }, { x: target.x, y: target.y }],
        ttl: 0.18,
        color: '#b5c94a',
      });
      this.sim.addEffect({ kind: 'towerDisable', x: target.x, y: target.y, ttl: spec.disable, color: '#b5c94a' });
      enemy.rangedTimer = spec.interval;
      return;
    }

    const lane = this.sim.lanes[enemy.lane] || this.sim.lanes[0];
    if (spec.dmg > 0 && enemy.progress >= lane.len - (spec.baseRange || 1.5)) {
      this.sim.baseHp -= spec.dmg;
      this.sim.addEffect({ kind: 'leak', x: this.sim.map.base.x, y: this.sim.map.base.y, ttl: 0.4 });
      this.sim.addFloater(this.sim.map.base.x, this.sim.map.base.y - 0.4, `-${spec.dmg}`, '#ff6b6b', true, { key: true });
      this.sim.playSound('hurt');
      enemy.rangedTimer = spec.interval;
    }
  }

  // ---------- 首领状态机 ----------
  updateBoss(enemy, dt, speed, now) {
    const ratio = enemy.hp / enemy.maxHp;
    if (enemy.bossPhase < 2 && ratio <= 0.66) this.sim.enterBossPhase(enemy, 2);
    if (enemy.bossPhase < 3 && ratio <= 0.33) this.sim.enterBossPhase(enemy, 3);
    if (!enemy.enraged && ratio <= 0.25) {
      enemy.enraged = true;
      enemy.baseSpeed *= 1.2;
      this.sim.addFloater(enemy.x, enemy.y - 0.9, '狂怒', '#ff6b6b', true, { key: true });
      this.sim.addEffect({ kind: 'ring', x: enemy.x, y: enemy.y, r0: 0.2, r1: 1.8, ttl: 0.5, color: '#ff6b6b' });
      this.sim.shake = Math.min(12, this.sim.shake + 6);
      this.sim.playSound('bossCast');
    }

    for (const key of Object.keys(enemy.cooldowns)) {
      enemy.cooldowns[key] = Math.max(0, enemy.cooldowns[key] - dt);
    }

    if (enemy.stopped) {
      enemy.stopTimer -= dt;
      if (enemy.cast) {
        enemy.cast.progress = Math.min(1, enemy.cast.progress + dt / BALANCE.bossCastWindup);
        if (enemy.cast.progress >= 1) {
          const kind = enemy.cast.kind;
          enemy.cast = null;
          this.sim.castBossSkill(enemy, kind, now);
        }
      }
      if (enemy.stopTimer <= 0) {
        enemy.stopped = false;
        enemy.vulnUntil = now + BALANCE.bossVulnAfter;
        enemy.marchTimer = 0;
      }
      return 0;
    }

    enemy.marchTimer += dt;
    const interval = Math.max(2.2, BALANCE.bossStopInterval - (enemy.bossPhase - 1) * 0.35);
    if (enemy.marchTimer >= interval) {
      enemy.marchTimer = 0;
      enemy.stopped = true;
      enemy.stopTimer = BALANCE.bossStopDuration;
      enemy.vulnUntil = now + BALANCE.bossStopDuration + BALANCE.bossVulnAfter;
      const kind = this.sim.pickBossSkill(enemy);
      if (kind) {
        enemy.cast = { kind, progress: 0 };
        this.sim.addFloater(enemy.x, enemy.y - 1.0, BOSS_SKILLS[kind]?.name || kind, '#ffd36b', false, { key: false });
        this.sim.addEffect({
          kind: 'bossCast',
          x: enemy.x,
          y: enemy.y,
          skill: kind,
          ttl: BALANCE.bossCastWindup,
          color: '#ffd36b',
        });
        this.sim.playSound('bossCast');
      }
      return 0;
    }
    return speed;
  }

  enterBossPhase(enemy, phase) {
    enemy.bossPhase = phase;
    enemy.baseSpeed *= 1.06;
    this.sim.addEffect({ kind: 'ring', x: enemy.x, y: enemy.y, r0: 0.2, r1: 1.7, ttl: 0.5, color: '#ffd36b' });
    this.sim.addFloater(enemy.x, enemy.y - 0.9, `第 ${phase} 阶段`, '#ffd36b', true, { key: true });
    this.sim.shake = Math.min(10, this.sim.shake + 3);
    this.sim.playSound('bossCast');
  }

  // 按波次解锁技能，冷却好才进入候选；变体权重决定轮转序列中的出现次数。
  // 用 castIndex 做确定性权重轮转，不额外消耗 RNG，保证同种子轨迹不变。
  pickBossSkill(enemy) {
    const wave = this.sim.waveDef?.index || this.sim.wave || 1;
    const options = [];
    if (wave >= 5 && enemy.cooldowns.roar <= 0) options.push('roar');
    if (wave >= 10 && enemy.cooldowns.summon <= 0) options.push('summon');
    if (wave >= 15 && enemy.cooldowns.slam <= 0) options.push('slam');
    if (!options.length) return null;
    const weights = enemy.variant ? BOSS_VARIANTS[enemy.variant]?.skillWeights : null;
    const weightOf = (kind) => (weights ? Math.max(0, Math.round(weights[kind] || 0)) : 1);
    let total = 0;
    for (const kind of options) total += weightOf(kind);
    if (total <= 0) return null;
    let cursor = enemy.castIndex % total;
    enemy.castIndex += 1;
    for (const kind of options) {
      const weight = weightOf(kind);
      if (weight === 0) continue;
      if (cursor < weight) return kind;
      cursor -= weight;
    }
    return options[0];
  }

  castBossSkill(enemy, kind, now) {
    if (kind === 'roar') {
      enemy.cooldowns.roar = BALANCE.bossRoarCd;
      for (const other of this.sim.enemies) {
        if (other.dead || other === enemy) continue;
        if (Math.hypot(other.x - enemy.x, other.y - enemy.y) <= BALANCE.bossRoarRadius) {
          other.speedBuffUntil = now + BALANCE.bossRoarDur;
          other.speedBuff = BALANCE.bossRoarSpeed;
        }
      }
      this.sim.addEffect({ kind: 'bossRoar', x: enemy.x, y: enemy.y, r: BALANCE.bossRoarRadius, ttl: 0.6, color: '#ff8a6b' });
      this.sim.shake = Math.min(12, this.sim.shake + 4);
      this.sim.playSound('bossRoar');
    } else if (kind === 'summon') {
      enemy.cooldowns.summon = BALANCE.bossSummonCd;
      const wave = this.sim.waveDef?.index || this.sim.wave || 1;
      const count = Math.min(
        BALANCE.bossSummonMax,
        Math.round(BALANCE.bossSummonBase + wave * BALANCE.bossSummonPerWave)
      );
      for (let i = 0; i < count; i++) {
        this.sim.spawnEnemyAt('swarm', enemy.lane, enemy.progress - 0.25 - i * 0.12);
      }
      this.sim.addEffect({ kind: 'bossSummon', x: enemy.x, y: enemy.y, ttl: 0.7, color: '#e2609e' });
      this.sim.playSound('bossSummon');
    } else if (kind === 'slam') {
      enemy.cooldowns.slam = BALANCE.bossSlamCd;
      for (const tower of this.sim.towers) {
        if (Math.hypot(tower.x - enemy.x, tower.y - enemy.y) > BALANCE.bossSlamRadius) continue;
        tower.disabledUntil = now + BALANCE.bossSlamDisable;
        this.sim.addEffect({ kind: 'towerDisable', x: tower.x, y: tower.y, ttl: BALANCE.bossSlamDisable, color: '#ff8a6b' });
      }
      this.sim.addEffect({ kind: 'bossSlam', x: enemy.x, y: enemy.y, r: BALANCE.bossSlamRadius, ttl: 0.6, color: '#ffb066' });
      this.sim.shake = Math.min(14, this.sim.shake + 5);
      this.sim.playSound('bossSlam');
    }
  }

  leak(enemy) {
    if (enemy.dead) return;
    enemy.dead = true;
    this.sim.baseHp -= enemy.dmg;
    this.sim.shake = Math.min(16, this.sim.shake + 7);
    this.sim.addEffect({ kind: 'leak', x: enemy.x, y: enemy.y, ttl: 0.5 });
    this.sim.addFloater(enemy.x, enemy.y - 0.4, `-${enemy.dmg}`, '#ff6b6b', true, { key: true });
    // 高潮演出事件：只记录（含漏怪后的基地生命），结算与音效保持原有顺序。
    this.sim.addCulmination('leak', {
      damage: enemy.dmg,
      baseHp: this.sim.baseHp,
      x: enemy.x,
      y: enemy.y,
    });
    this.sim.playSound('hurt');
    this.sim.hexCall('onLeak', enemy, this.sim.hexCtx);
  }

  // ---------- 友方单位 ----------

  // 最小友方接口：存档内只有存活时长（ttl）与自动攻击最近敌人；
  // 生成时机/数值由海克斯通过 ctx.spawnAlly 决定，模拟层不内置任何具体召唤规则。
  // 攻击结算二选一：dmg 为固定伤害（走护甲/增伤）；pct 为目标最大生命百分比，
  // pctBoss 覆盖首领（与技能百分比伤害同语义：不吃护甲/增伤/暴击）。
  spawnAlly(spec = {}) {
    const x = Number(spec.x);
    const y = Number(spec.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const ttl = Math.max(0, Number(spec.ttl) || 0);
    const maxHp = Math.max(0, Number(spec.maxHp) || 0);
    const ally = {
      id: this.sim.nextId++,
      kind: typeof spec.kind === 'string' ? spec.kind : 'ally',
      x,
      y,
      angle: Number.isFinite(spec.angle) ? spec.angle : 0,
      r: Math.max(0.05, Number(spec.r) || 0.25),
      dmg: Math.max(0, Number(spec.dmg) || 0),
      pct: Math.max(0, Number(spec.pct) || 0),
      pctBoss: Math.max(0, Number(spec.pctBoss) || 0),
      maxHp: maxHp > 0 ? maxHp : null,
      hp: maxHp > 0 ? maxHp : null,
      range: Math.max(0, Number(spec.range) || 0),
      rate: Math.max(0, Number(spec.rate) || 0),
      ttl,
      life: ttl,
      cd: 0,
      recoil: 0,
      color: typeof spec.color === 'string' ? spec.color : '#cfe8ff',
      target: null,
      dead: false,
    };
    this.sim.allies.push(ally);
    return ally;
  }

  // 每步只读写盟友自身与敌人列表，不消耗战斗 RNG（暴击关闭），同种子结果稳定。
  updateAllies(dt) {
    if (!this.sim.allies.length) return;
    for (const ally of this.sim.allies) {
      if (ally.dead) continue;
      ally.ttl -= dt;
      ally.recoil = Math.max(0, (ally.recoil || 0) - dt * 5);
      if (ally.ttl <= 0) {
        ally.dead = true;
        continue;
      }
      if (!(ally.rate > 0) || !(ally.range > 0)) continue;
      ally.cd = Math.max(0, (ally.cd || 0) - dt);
      if (ally.cd > 0) continue;
      const target = this.sim.nearestSkillTarget(ally.x, ally.y, ally.range);
      if (!target) {
        ally.target = null;
        continue;
      }
      ally.target = target;
      ally.angle = Math.atan2(target.y - ally.y, target.x - ally.x);
      ally.recoil = 1;
      // 百分比路径直接按目标最大生命结算（与 skillPctDamage 同一语义），不走护甲/增伤/命中钩子。
      const pct = target.boss && ally.pctBoss > 0 ? ally.pctBoss : ally.pct;
      if (pct > 0) {
        this.sim.skillDamage(target, target.maxHp * pct, { source: 'ally', weapon: ally.kind });
      } else if (ally.dmg > 0) this.sim.dealDamage(target, ally.dmg, ally.kind, { noCrit: true, source: 'ally' });
      ally.cd = 1 / ally.rate;
    }
    if (this.sim.allies.some((ally) => ally.dead)) {
      this.sim.allies = this.sim.allies.filter((ally) => !ally.dead);
    }
  }
}
