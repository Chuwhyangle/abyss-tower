// 纯战斗模拟：不依赖 DOM / Canvas / 音频，浏览器与 Node 平衡模拟共用。
import {
  TOWERS,
  ENEMIES,
  MAX_WAVE,
  RELIC_BY_ID,
  RELIC_MAX_LEVEL,
  GLOBAL_MOD_CAPS,
  normalizeRelicStates,
  relicModsAtLevel,
} from './shared/data.js';
import { RNG } from './shared/rng.js';
import { BALANCE } from './shared/config.js';
import { computeOutcome } from './shared/scoring.js';
import { generateWave } from './shared/waves.js';

export class Simulation {
  constructor(opts) {
    this.opts = opts;
    this.map = opts.map;
    this.seed = opts.seed;
    this.difficulty = opts.difficulty || 'standard';
    this.runId = opts.runId || null;
    this.mode = opts.mode || 'normal';

    this.gold = opts.gold ?? 260;
    this.baseHp = opts.baseHp ?? 20;
    this.maxBaseHp = opts.maxBaseHp ?? 20;
    this.wave = opts.wave || 0;
    // 已清波次独立记录：wave 可能是正在重放的波次，clearedWave 只由清波结算推进。
    this.clearedWave = opts.clearedWave ?? opts.wave ?? 0;
    this.pendingDraft = !!opts.pendingDraft;
    // 清波尚未被服务端确认时，禁止覆盖波前快照，避免刷新后重复领取奖励。
    this.clearPending = false;
    this.kills = opts.kills || 0;
    this.relics = normalizeRelicStates(opts.relics || []);
    this.unlockedTowers = opts.unlockedTowers || ['arrow', 'cannon', 'frost'];
    this.startedAt = opts.startedAt || Date.now();

    this.enemies = [];
    this.towers = [];
    this.projectiles = [];
    this.effects = [];
    this.floaters = [];
    this.nextId = 1;

    this.phase = 'prep';
    this.paused = false;
    this.placementType = null;
    this.selectedTower = null;
    this.hover = null;
    this.waveDef = null;

    this.time = 0;
    this.waveTime = 0;
    this.spawnQueue = [];
    this.spawnIndex = 0;
    this.shake = 0;

    this._lastSound = new Map();
    this._hudDirty = true;
    // 视觉降级只影响特效/飘字的生成，不改变战斗逻辑。
    this.effectsLevel = 'full';
    this.floatersMode = 'all';
    this.mapMeta = this.map.meta || opts.mapMeta || {};
    this.modifier = this.mapMeta.modifier || null;
    this.activePortals = [];

    this.buildPath();
    this.recomputeMods();

    // 开局遗物中的基地生命加成（读档时不重复结算）
    if (!opts.restored) {
      let bonus = 0;
      for (const relic of this.relics) {
        bonus += relicModsAtLevel(relic.id, relic.level).baseHp || 0;
      }
      if (bonus) {
        this.maxBaseHp += bonus;
        this.baseHp += bonus;
      }
    }

    for (const tower of opts.towers || []) {
      this.towers.push(this.makeTower(tower.type, tower.c, tower.r, tower.level, tower.invested));
    }

    this.combatRng = new RNG(`${this.seed}:combat:0`);
  }

  // ---------- 路径 ----------

  buildPath() {
    const source = this.map.lanes?.length
      ? this.map.lanes
      : [{ id: 0, polyline: this.map.polyline, color: '#5ce2d0' }];
    this.lanes = source.map((lane) => {
      const pts = lane.polyline;
      const cum = [0];
      let len = 0;
      for (let i = 1; i < pts.length; i++) {
        len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        cum.push(len);
      }
      return { pts, cum, len, color: lane.color || '#5ce2d0' };
    });
    // 兼容旧代码：pathPts/posAt() 默认指向第一条路
    this.pathPts = this.lanes[0].pts;
    this.pathCum = this.lanes[0].cum;
    this.pathLen = this.lanes[0].len;
  }

  posAt(distance, laneIndex = 0) {
    const lane = this.lanes[laneIndex] || this.lanes[0];
    const pts = lane.pts;
    if (pts.length < 2) return { x: pts[0].x, y: pts[0].y, angle: 0 };
    if (distance <= 0) {
      const a = pts[0];
      const b = pts[1];
      return { x: a.x, y: a.y, angle: Math.atan2(b.y - a.y, b.x - a.x) };
    }
    if (distance >= lane.len) {
      const a = pts[pts.length - 1];
      const b = pts[pts.length - 2];
      return { x: a.x, y: a.y, angle: Math.atan2(a.y - b.y, a.x - b.x) };
    }
    let lo = 0;
    let hi = lane.cum.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (lane.cum[mid] <= distance) lo = mid;
      else hi = mid;
    }
    const a = pts[lo];
    const b = pts[lo + 1];
    const seg = lane.cum[lo + 1] - lane.cum[lo] || 1;
    const t = (distance - lane.cum[lo]) / seg;
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      angle: Math.atan2(b.y - a.y, b.x - a.x),
    };
  }

  // ---------- 主更新 ----------

  update(dt) {
    if (this.phase !== 'wave') return;
    this.time += dt;
    this.waveTime += dt;

    this.spawnDue();
    this.updateEnemies(dt);
    this.updateTowers(dt);
    this.updateProjectiles(dt);
    this.cleanup();

    if (this.baseHp <= 0) {
      this.gameOver(false);
      return;
    }
    if (
      this.phase === 'wave' &&
      this.spawnIndex >= this.spawnQueue.length &&
      this.enemies.length === 0
    ) {
      this.completeWave();
    }
  }

  updateVisuals(dt) {
    this.shake = Math.max(0, this.shake - dt * 31);
    for (const effect of this.effects) effect.ttl -= dt;
    if (this.effects.length) this.effects = this.effects.filter((e) => e.ttl > 0);
    for (const floater of this.floaters) {
      floater.ttl -= dt;
      floater.y -= dt * 0.7;
    }
    if (this.floaters.length) this.floaters = this.floaters.filter((f) => f.ttl > 0);
  }

  // ---------- 波次 ----------

  beginWave(waveDef) {
    if (this.phase !== 'prep' || !waveDef) return false;
    // 进入战斗前先落一份"该波开始前"的快照：战斗中刷新可重放本波。
    this.savePreWave();
    this.waveDef = waveDef;
    this.wave = waveDef.index;
    this.phase = 'wave';
    this.paused = false;
    this.placementType = null;
    this.waveTime = 0;
    this.spawnIndex = 0;
    this.spawnQueue = [];
    this.combatRng = new RNG(`${this.seed}:combat:${waveDef.index}`);

    for (const group of waveDef.groups) {
      const portal = Number.isInteger(group.portal) ? group.portal : 0;
      for (let i = 0; i < group.count; i++) {
        this.spawnQueue.push({
          type: group.type,
          time: group.delay + i * group.interval,
          portal,
        });
      }
    }
    this.spawnQueue.sort((a, b) => a.time - b.time);
    this.activePortals = Array.isArray(waveDef.portals) && waveDef.portals.length
      ? waveDef.portals.slice()
      : [...new Set(waveDef.groups.map((group) => group.portal || 0))];
    this.playSound(waveDef.boss ? 'boss' : 'wave');
    return true;
  }

  spawnDue() {
    while (
      this.spawnIndex < this.spawnQueue.length &&
      this.spawnQueue[this.spawnIndex].time <= this.waveTime
    ) {
      const item = this.spawnQueue[this.spawnIndex++];
      this.spawnEnemy(item.type, item.portal || 0);
    }
  }

  spawnEnemy(type, laneIndex = 0) {
    const base = ENEMIES[type];
    const hpMul = this.waveDef?.hpMul || 1;
    const speedMul = this.waveDef?.speedMul || 1;
    const hp = Math.max(1, Math.round(base.hp * hpMul));
    const lane = Math.max(0, Math.min(this.lanes.length - 1, laneIndex || 0));
    const pos = this.posAt(0, lane);
    this.enemies.push({
      id: this.nextId++,
      type,
      hp,
      maxHp: hp,
      armor: base.armor,
      baseSpeed: base.speed * speedMul,
      r: base.r,
      gold: base.gold,
      dmg: base.dmg,
      flying: !!base.flying,
      boss: !!base.boss,
      heal: base.heal || 0,
      healRange: base.healRange || 0,
      healTimer: 0,
      lane,
      progress: 0,
      x: pos.x,
      y: pos.y,
      angle: pos.angle,
      slowUntil: 0,
      slowAmt: 0,
      poisonUntil: 0,
      poisonDps: 0,
      hitFlash: 0,
      dead: false,
    });
    this.addEffect({ kind: 'spawn', x: pos.x, y: pos.y, ttl: 0.4, color: base.color });
  }

  completeWave() {
    if (this.phase !== 'wave' || !this.waveDef) return;
    const goldMul = this.modifier?.goldMul || 1;
    const reward = Math.round(this.waveDef.reward * goldMul);
    const interest = this.mods.interest ? Math.floor(this.gold * this.mods.interest) : 0;
    this.gold += reward + interest;
    const cleared = this.wave;
    this.waveDef = null;
    this.clearedWave = cleared;

    if (cleared >= MAX_WAVE) {
      this.gameOver(true);
      return;
    }

    this.phase = 'prep';
    // 快照由调用方在服务端确认清波后写入，避免清波未确认时重复领奖。
    this.opts.onWaveClear?.(cleared, { reward, interest });
  }

  gameOver(victory) {
    if (this.phase === 'over') return;
    this.phase = 'over';
    this.paused = true;
    this.playSound(victory ? 'victory' : 'gameover');

    // 只按已清波次结算：进行中波次（含重放）不算清波。
    const clearedWave = victory ? MAX_WAVE : Math.max(0, this.clearedWave);
    this.clearedWave = clearedWave;
    const outcome = computeOutcome({
      waveReached: clearedWave,
      wavesServed: clearedWave,
      kills: this.kills,
      goldLeft: Math.max(0, this.gold),
      baseHp: Math.max(0, Math.ceil(this.baseHp)),
      difficulty: this.difficulty,
      scoreMul: this.mapMeta?.scoreMul || 1,
    });
    const stats = {
      wave: this.wave,
      clearedWave,
      kills: this.kills,
      gold: Math.max(0, this.gold),
      baseHp: Math.max(0, this.baseHp),
      victory: outcome.victory,
      score: outcome.score,
      rawScore: outcome.rawScore,
      cores: outcome.cores,
      mode: this.mode,
      difficulty: this.difficulty,
      maxWave: MAX_WAVE,
    };
    this.opts.onGameOver?.(stats);
  }

  // ---------- 敌人 ----------

  updateEnemies(dt) {
    const now = this.time;
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt * 4);

      const slowed = now < enemy.slowUntil;
      if (!slowed && enemy.slowAmt) enemy.slowAmt = 0;
      const speed = enemy.baseSpeed * (1 - (slowed ? enemy.slowAmt : 0));
      enemy.progress += speed * dt;

      const pos = this.posAt(enemy.progress, enemy.lane);
      enemy.x = pos.x;
      enemy.y = pos.y;
      enemy.angle = pos.angle;

      if (now < enemy.poisonUntil && enemy.poisonDps > 0) {
        this.damage(enemy, enemy.poisonDps * dt, { ignoreArmor: true, silent: true, dot: true });
        if (Math.random() < dt * 2.2) {
          this.addEffect({ kind: 'poison', x: enemy.x, y: enemy.y - 0.15, ttl: 0.5 });
        }
      }

      if (enemy.heal > 0 && !enemy.dead) {
        enemy.healTimer += dt;
        if (enemy.healTimer >= 0.5) {
          enemy.healTimer = 0;
          const amount = enemy.maxHp * enemy.heal * 0.5;
          let healed = false;
          for (const other of this.enemies) {
            if (other.dead || other === enemy) continue;
            if (Math.hypot(other.x - enemy.x, other.y - enemy.y) <= enemy.healRange) {
              other.hp = Math.min(other.maxHp, other.hp + amount);
              healed = true;
            }
          }
          if (healed) this.addEffect({ kind: 'heal', x: enemy.x, y: enemy.y, ttl: 0.6 });
        }
      }

      if (enemy.progress >= (this.lanes[enemy.lane] || this.lanes[0]).len) this.leak(enemy);
    }
  }

  leak(enemy) {
    if (enemy.dead) return;
    enemy.dead = true;
    this.baseHp -= enemy.dmg;
    this.shake = Math.min(16, this.shake + 7);
    this.addEffect({ kind: 'leak', x: enemy.x, y: enemy.y, ttl: 0.5 });
    this.addFloater(enemy.x, enemy.y - 0.4, `-${enemy.dmg}`, '#ff6b6b', true, { key: true });
    this.playSound('hurt');
  }

  // ---------- 防御塔 ----------

  updateTowers(dt) {
    for (const tower of this.towers) {
      tower.cd = Math.max(0, tower.cd - dt);
      tower.recoil = Math.max(0, (tower.recoil || 0) - dt * 5);
      // 稳定属性缓存在建造/升级/遗物变化时刷新，不在每个模拟步重建对象。
      const stats = tower.stats || this.refreshTowerStats(tower);

      let target = tower.target;
      if (target && (target.dead || !this.inRange(tower, target, stats.range))) target = null;
      if (!target) target = this.findTarget(tower, stats.range);
      tower.target = target;

      if (target) {
        const desired = Math.atan2(target.y - tower.y, target.x - tower.x);
        tower.angle = lerpAngle(tower.angle, desired, Math.min(1, dt * 12));
        if (tower.cd <= 0) {
          this.fire(tower, stats, target);
          tower.cd = 1 / stats.rate;
        }
      }
    }
  }

  findTarget(tower, range) {
    const def = TOWERS[tower.type];
    const range2 = range * range;
    let best = null;
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      if (def.groundOnly && enemy.flying) continue;
      const dx = enemy.x - tower.x;
      const dy = enemy.y - tower.y;
      if (dx * dx + dy * dy > range2) continue;
      if (!best || enemy.progress > best.progress) best = enemy;
    }
    return best;
  }

  inRange(tower, enemy, range) {
    const dx = enemy.x - tower.x;
    const dy = enemy.y - tower.y;
    return dx * dx + dy * dy <= range * range;
  }

  fire(tower, stats, target) {
    const def = TOWERS[tower.type];
    tower.recoil = 1;
    this.playSound(`shoot_${tower.type}`);

    if (tower.type === 'arc') {
      const chain = Math.max(1, Math.round(stats.chain));
      const hit = new Set();
      const points = [{ x: tower.x, y: tower.y }];
      let current = target;
      for (let i = 0; i < chain && current; i++) {
        hit.add(current.id);
        points.push({ x: current.x, y: current.y });
        this.dealDamage(current, stats.dmg, 'arc', { ignoreArmor: true });
        let next = null;
        let bestDist = Infinity;
        for (const enemy of this.enemies) {
          if (enemy.dead || hit.has(enemy.id)) continue;
          const d = Math.hypot(enemy.x - current.x, enemy.y - current.y);
          if (d <= def.chainRange + enemy.r && d < bestDist) {
            bestDist = d;
            next = enemy;
          }
        }
        current = next;
      }
      this.addEffect({ kind: 'bolt', points, ttl: 0.18, color: '#c9a8ff' });
      return;
    }

    this.projectiles.push({
      id: this.nextId++,
      kind: def.proj.kind,
      x: tower.x,
      y: tower.y,
      target,
      tx: target.x,
      ty: target.y,
      angle: tower.angle,
      speed: def.proj.speed * (1 + (this.mods.projSpeed || 0)),
      dmg: stats.dmg,
      towerType: tower.type,
      splash: stats.splash || 0,
      slow: stats.slow || 0,
      slowDur: stats.slowDur || 0,
      dot: stats.dot || 0,
      dotDur: stats.dotDur || 0,
      ignoreArmor: !!def.ignoreArmor,
      ttl: 4,
      done: false,
    });
    this.addEffect({
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
    for (const proj of this.projectiles) {
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
        this.impact(proj);
        proj.done = true;
        continue;
      }
      proj.x += (dx / dist) * step;
      proj.y += (dy / dist) * step;
      proj.angle = Math.atan2(dy, dx);
    }
    this.projectiles = this.projectiles.filter((p) => !p.done);
  }

  impact(proj) {
    if (proj.splash > 0) {
      let hits = 0;
      for (const enemy of this.enemies) {
        if (enemy.dead) continue;
        if (Math.hypot(enemy.x - proj.x, enemy.y - proj.y) <= proj.splash + enemy.r * 0.4) {
          this.hitEnemy(enemy, proj);
          hits++;
        }
      }
      this.addEffect({
        kind: 'ring',
        x: proj.x,
        y: proj.y,
        r0: 0.15,
        r1: proj.splash,
        ttl: 0.25,
        color: '#ffb066',
      });
      this.shake = Math.min(10, this.shake + (hits > 3 ? 2.4 : 1));
      return;
    }

    let target = proj.target;
    if (!target || target.dead) {
      let best = null;
      let bestDist = 0.45;
      for (const enemy of this.enemies) {
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
      this.hitEnemy(target, proj);
      this.addEffect({ kind: 'spark', x: proj.x, y: proj.y, ttl: 0.15, color: '#ffe4b0' });
    }
  }

  hitEnemy(enemy, proj) {
    if (enemy.dead) return;
    this.dealDamage(enemy, proj.dmg, proj.towerType, { ignoreArmor: proj.ignoreArmor });

    if (proj.slow > 0) {
      const amount = Math.min(0.85, proj.slow + (this.mods.slow || 0));
      const duration = (proj.slowDur || 1.5) * (1 + (this.mods.slowDur || 0));
      enemy.slowAmt = Math.max(enemy.slowAmt, amount);
      enemy.slowUntil = Math.max(enemy.slowUntil, this.time + duration);
    }
    if (proj.dot > 0) {
      const dps = proj.dot * (1 + (this.mods.dot || 0));
      if (dps >= enemy.poisonDps || this.time > enemy.poisonUntil) {
        enemy.poisonDps = Math.max(dps, this.time > enemy.poisonUntil ? 0 : enemy.poisonDps);
        enemy.poisonUntil = this.time + (proj.dotDur || 3);
      }
    }
  }

  // ---------- 伤害 ----------

  dealDamage(enemy, base, towerType, opts = {}) {
    if (enemy.dead) return;
    const hit = this.computeHit(base, towerType, enemy, opts);
    this.damage(enemy, hit.dmg, { ignoreArmor: opts.ignoreArmor, crit: hit.crit });
  }

  // base 必须来自 statsFor()（已包含塔专属与全局增伤），这里只应用条件增伤与暴击。
  // 面板显示 statsFor().dmg，对零护甲、无暴击、无条件增伤的目标应完全一致。
  computeHit(base, towerType, enemy, opts = {}) {
    let dmg = base;
    if (this.mods.bossDmg && enemy.boss) dmg *= 1 + this.mods.bossDmg;
    if (this.mods.lowHpDmg && this.baseHp / this.maxBaseHp < 0.4) dmg *= 1 + this.mods.lowHpDmg;
    let crit = false;
    if (!opts.noCrit && this.mods.crit > 0 && this.combatRng.float() < this.mods.crit) {
      dmg *= 2;
      crit = true;
    }
    return { dmg, crit };
  }

  damage(enemy, amount, opts = {}) {
    if (enemy.dead) return;
    let final = amount;
    if (!opts.ignoreArmor) {
      final = Math.max(1, final - enemy.armor * (1 - (this.mods.armorPierce || 0)));
    }
    if (this.mods.frostDmgBonus && this.time < enemy.slowUntil) {
      final *= 1 + this.mods.frostDmgBonus;
    }
    enemy.hp -= final;
    if (!opts.dot) enemy.hitFlash = 1;

    if (!opts.silent && (final >= 12 || opts.crit)) {
      this.addFloater(
        enemy.x,
        enemy.y - 0.45,
        opts.crit ? `${Math.round(final)}!` : `${Math.round(final)}`,
        opts.crit ? '#ffd36b' : '#eef3f8',
        opts.crit,
        { key: opts.crit || final >= 60 }
      );
    }
    if (enemy.hp <= 0) this.killEnemy(enemy);
  }

  killEnemy(enemy) {
    if (enemy.dead) return;
    enemy.dead = true;
    const multiplier =
      (1 + (this.mods.goldMul || 0)) *
      (1 + this.wave * BALANCE.killGoldWaveRate) *
      (this.modifier?.goldMul || 1);
    const gold = Math.round(enemy.gold * multiplier) + (this.mods.killGold || 0);
    this.gold += gold;
    this.kills++;
    this.addEffect({
      kind: 'death',
      x: enemy.x,
      y: enemy.y,
      r: enemy.r,
      ttl: 0.45,
      color: ENEMIES[enemy.type].color,
    });
    if (enemy.boss) {
      this.shake = Math.min(14, this.shake + 10);
      this.addFloater(enemy.x, enemy.y - 0.6, `+${gold}`, '#ffd36b', true, { key: true });
      this.playSound('bossKill');
    } else {
      this.playSound('kill');
    }
  }

  cleanup() {
    if (this.enemies.some((e) => e.dead)) this.enemies = this.enemies.filter((e) => !e.dead);
    if (this.effects.length > 320) this.effects.splice(0, this.effects.length - 320);
    if (this.floaters.length > 90) this.floaters.splice(0, this.floaters.length - 90);
  }

  setVisualQuality({ effects, floaters } = {}) {
    if (effects) this.effectsLevel = effects;
    if (floaters) this.floatersMode = floaters;
  }

  addEffect(effect) {
    const level = this.effectsLevel;
    if (level === 'off' && !['bolt', 'ring', 'leak'].includes(effect.kind)) return;
    if (level === 'light' && ['spawn', 'death', 'heal', 'poison', 'place'].includes(effect.kind)) {
      return;
    }
    effect.maxTtl = effect.ttl;
    this.effects.push(effect);
  }

  addFloater(x, y, text, color = '#fff', big = false, { key = false } = {}) {
    if (this.floatersMode === 'off') return;
    if (this.floatersMode === 'key' && !key && !big) return;
    const ttl = big ? 0.9 : 0.65;
    this.floaters.push({ x, y, text, color, big, ttl, maxTtl: ttl });
  }

  // ---------- 建造 ----------

  makeTower(type, c, r, level = 0, invested = 0) {
    return {
      id: this.nextId++,
      type,
      c,
      r,
      x: c + 0.5,
      y: r + 0.5,
      level,
      invested,
      cd: 0,
      angle: -Math.PI / 2,
      target: null,
      recoil: 0,
      stats: null,
    };
  }

  towerCost(type) {
    return Math.max(20, Math.round(TOWERS[type].cost * (1 + (this.mods.costMul || 0))));
  }

  upgradeCost(tower) {
    const def = TOWERS[tower.type];
    if (tower.level >= def.levels.length - 1) return null;
    return Math.max(10, Math.round(def.levels[tower.level + 1].cost * (1 + (this.mods.costMul || 0))));
  }

  sellValue(tower) {
    return Math.floor(tower.invested * 0.7);
  }

  towerAt(c, r) {
    return this.towers.find((t) => t.c === c && t.r === r) || null;
  }

  canBuild(c, r) {
    if (r < 0 || r >= this.map.rows || c < 0 || c >= this.map.cols) return false;
    return this.map.buildable[r][c] && !this.towerAt(c, r);
  }

  placeTower(type, c, r) {
    if (!TOWERS[type]) return false;
    if (!this.unlockedTowers.includes(type)) {
      this.opts.onToast?.('该防御塔尚未解锁');
      return false;
    }
    if (!this.canBuild(c, r)) {
      this.opts.onToast?.('这里无法建造');
      return false;
    }
    const cost = this.towerCost(type);
    if (this.gold < cost) {
      this.opts.onToast?.('金币不足');
      return false;
    }
    this.gold -= cost;
    const tower = this.makeTower(type, c, r, 0, cost);
    this.towers.push(tower);
    this.refreshTowerStats(tower);
    this.addEffect({ kind: 'place', x: c + 0.5, y: r + 0.5, ttl: 0.45, color: TOWERS[type].color });
    this.playSound('place');
    this.save();
    return true;
  }

  upgradeTower(tower) {
    const cost = this.upgradeCost(tower);
    if (cost == null) return false;
    if (this.gold < cost) {
      this.opts.onToast?.('金币不足');
      return false;
    }
    this.gold -= cost;
    tower.level += 1;
    tower.invested += cost;
    this.refreshTowerStats(tower);
    this.addEffect({ kind: 'place', x: tower.x, y: tower.y, ttl: 0.5, color: '#ffd36b' });
    this.playSound('upgrade');
    this.save();
    return true;
  }

  sellTower(tower) {
    const value = this.sellValue(tower);
    this.gold += value;
    this.towers = this.towers.filter((t) => t !== tower);
    if (this.selectedTower === tower) this.selectedTower = null;
    this.addFloater(tower.x, tower.y - 0.4, `+${value}`, '#ffd36b');
    this.playSound('sell');
    this.save();
    return value;
  }

  getRelicLevel(id) {
    const state = this.relics.find((item) => item.id === id);
    return state ? state.level : 0;
  }

  // 接受遗物 ID、{id, level} 或服务端 offer（{kind:'relic', id, toLevel}）。
  addRelic(relicOrOffer) {
    let id = null;
    let requestedLevel = null;
    if (typeof relicOrOffer === 'string') {
      id = relicOrOffer;
    } else if (relicOrOffer && relicOrOffer.kind === 'relic') {
      id = relicOrOffer.id;
      requestedLevel = relicOrOffer.toLevel;
    } else if (relicOrOffer) {
      id = relicOrOffer.id;
      requestedLevel = relicOrOffer.level ?? relicOrOffer.toLevel;
    }
    if (!RELIC_BY_ID[id]) return { applied: false, reason: 'unknown' };

    const existing = this.relics.find((item) => item.id === id);
    const fromLevel = existing?.level || 0;
    if (fromLevel >= RELIC_MAX_LEVEL) return { applied: false, reason: 'max' };
    const toLevel = Math.min(
      RELIC_MAX_LEVEL,
      Math.max(fromLevel + 1, Math.floor(Number(requestedLevel) || fromLevel + 1))
    );

    // 即时生命效果只补发本次升级新增的部分。
    const oldBonus = fromLevel ? relicModsAtLevel(id, fromLevel).baseHp || 0 : 0;
    const newBonus = relicModsAtLevel(id, toLevel).baseHp || 0;
    const delta = Math.max(0, newBonus - oldBonus);
    if (delta) {
      this.maxBaseHp += delta;
      this.baseHp = Math.min(this.maxBaseHp, this.baseHp + delta);
      this.addEffect({ kind: 'heal', x: this.map.base.x, y: this.map.base.y, ttl: 0.8 });
    }

    if (existing) existing.level = toLevel;
    else this.relics.push({ id, level: toLevel });

    this.recomputeMods();
    this.save();
    return { applied: true, id, fromLevel, toLevel, baseHpDelta: delta };
  }

  applyOffer(offer) {
    if (!offer) return { applied: false };
    if (offer.kind === 'relic') return this.addRelic(offer);
    if (offer.kind === 'gold') {
      const amount = Math.max(0, Math.floor(Number(offer.amount) || 0));
      this.gold += amount;
      this.addFloater(this.map.base.x, this.map.base.y - 0.6, `+${amount}`, '#ffd36b', true);
      this.save();
      return { applied: true, kind: 'gold', amount };
    }
    if (offer.kind === 'repair') {
      const amount = Math.max(0, Math.floor(Number(offer.amount) || 0));
      const before = this.baseHp;
      this.baseHp = Math.min(this.maxBaseHp, this.baseHp + amount);
      this.addEffect({ kind: 'heal', x: this.map.base.x, y: this.map.base.y, ttl: 0.8 });
      this.save();
      return { applied: true, kind: 'repair', amount: this.baseHp - before };
    }
    return { applied: false };
  }

  recomputeMods() {
    const mods = {
      dmg: {}, dmgAll: 0, fireRate: 0, range: 0, splash: 0,
      slow: 0, slowDur: 0, chain: 0, dot: 0,
      goldMul: 0, killGold: 0, interest: 0, crit: 0,
      armorPierce: 0, costMul: 0, frostDmgBonus: 0,
      lowHpDmg: 0, projSpeed: 0, bossDmg: 0, baseHp: 0,
    };
    for (const relic of this.relics) {
      const levelMods = relicModsAtLevel(relic.id, relic.level);
      for (const [key, value] of Object.entries(levelMods)) {
        if (key === 'dmg') {
          for (const [type, amount] of Object.entries(value)) {
            mods.dmg[type] = (mods.dmg[type] || 0) + amount;
          }
        } else if (typeof mods[key] === 'number') {
          mods[key] += value;
        }
      }
    }

    for (const type of Object.keys(mods.dmg)) {
      mods.dmg[type] = Math.min(mods.dmg[type], GLOBAL_MOD_CAPS.dmgType);
    }
    for (const [key, cap] of Object.entries(GLOBAL_MOD_CAPS)) {
      if (key === 'dmgType' || typeof mods[key] !== 'number') continue;
      mods[key] = key === 'costMul' ? Math.max(mods[key], cap) : Math.min(mods[key], cap);
    }

    this.mods = mods;
    // 遗物变化时统一刷新塔的稳定属性，模拟步内不再重算。
    for (const tower of this.towers) this.refreshTowerStats(tower);
  }

  computeTowerStats(tower) {
    const def = TOWERS[tower.type];
    const level = def.levels[Math.min(tower.level, def.levels.length - 1)];
    const mods = this.mods;
    return {
      dmg: level.dmg * (1 + (mods.dmg[tower.type] || 0) + mods.dmgAll),
      rate: level.rate * (1 + mods.fireRate),
      range: (level.range + mods.range) * (this.modifier?.rangeMul || 1),
      splash: (level.splash || 0) * (1 + mods.splash),
      slow: level.slow || 0,
      slowDur: level.slowDur || 0,
      chain: (level.chain || 0) + mods.chain,
      dot: level.dot || 0,
      dotDur: level.dotDur || 0,
      maxLevel: def.levels.length,
    };
  }

  refreshTowerStats(tower) {
    tower.stats = this.computeTowerStats(tower);
    return tower.stats;
  }

  statsFor(tower) {
    return tower.stats || this.refreshTowerStats(tower);
  }

  previewStats(type, level = 0) {
    return this.computeTowerStats(this.makeTower(type, 0, 0, level, 0));
  }

  // ---------- 存档 / HUD ----------

  toSnapshot() {
    return {
      version: 3,
      runId: this.runId,
      seed: this.seed,
      mode: this.mode,
      difficulty: this.difficulty,
      wave: this.clearedWave,
      clearedWave: this.clearedWave,
      pendingDraft: this.pendingDraft,
      gold: Math.floor(this.gold),
      baseHp: Math.max(0, this.baseHp),
      maxBaseHp: this.maxBaseHp,
      kills: this.kills,
      relics: this.relics.map((r) => ({ id: r.id, level: r.level || 1 })),
      towers: this.towers.map((t) => ({
        type: t.type, c: t.c, r: t.r, level: t.level, invested: t.invested,
      })),
      startedAt: this.startedAt,
      savedAt: Date.now(),
    };
  }

  save() {
    if (this.phase !== 'prep' || this.clearPending) return;
    this.opts.onSave?.(this.toSnapshot());
  }

  savePreWave() {
    if (this.clearPending) return;
    const snapshot = this.toSnapshot();
    snapshot.preWave = true;
    this.opts.onSave?.(snapshot);
  }

  // 下一波情报：整备阶段展示。波次由种子确定性生成，客户端只做预测展示，
  // 真正放行仍由服务端 /wave 决定，不改变波次流程。
  nextWavePreview() {
    if (this.phase !== 'prep') return null;
    const next = this.clearedWave + 1;
    if (next > MAX_WAVE) return null;
    const meta = this.map?.meta || {};
    const key = `${next}|${this.difficulty}|${meta.modifier?.id || ''}|${meta.portalCount || 1}`;
    if (this._previewCache?.key === key) return this._previewCache.value;
    const def = generateWave(this.seed, next, this.difficulty, {
      portalCount: meta.portalCount || 1,
      modifier: meta.modifier || null,
    });
    const totals = new Map();
    for (const group of def.groups) {
      totals.set(group.type, (totals.get(group.type) || 0) + group.count);
    }
    const value = {
      index: def.index,
      boss: !!def.boss,
      finalBoss: !!def.finalBoss,
      totalCount: def.totalCount,
      portals: def.portals?.length || 1,
      enemies: [...totals.entries()].map(([type, count]) => ({ type, count })),
    };
    this._previewCache = { key, value };
    return value;
  }

  getHud() {
    return {
      gold: Math.floor(this.gold),
      baseHp: Math.max(0, Math.ceil(this.baseHp)),
      maxBaseHp: this.maxBaseHp,
      wave: this.wave,
      clearedWave: this.clearedWave,
      kills: this.kills,
      phase: this.phase,
      paused: this.paused,
      enemies: this.enemies.length,
      relicCount: this.relics.length,
      difficulty: this.difficulty,
      portalCount: this.map.spawns?.length || 1,
      activePortals: this.activePortals.slice(),
      nextWave: this.nextWavePreview(),
      waveDef: this.waveDef
        ? {
            index: this.waveDef.index,
            totalCount: this.waveDef.totalCount,
            boss: this.waveDef.boss,
            finalBoss: !!this.waveDef.finalBoss,
          }
        : null,
    };
  }

  playSound(name) {
    const now = performance.now();
    const last = this._lastSound.get(name) || 0;
    const gap = name === 'kill' ? 70 : 40;
    if (now - last < gap) return;
    this._lastSound.set(name, now);
    this.opts.onSound?.(name);
  }
}

function lerpAngle(current, target, t) {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * t;
}
