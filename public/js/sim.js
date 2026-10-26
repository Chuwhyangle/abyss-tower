// 纯战斗模拟：状态根与系统编排；不依赖 DOM / Canvas / 音频，浏览器与 Node 平衡模拟共用。
// 具体职责下沉到 public/js/sim/ 下的系统对象，本类只保留状态字段与薄委派。
import { MAX_WAVE, normalizeRelicStates, relicModsAtLevel } from './shared/data.js';
import {
  chainsFromHistory,
  normalizeChains,
  normalizeEventHistory,
  resolveEventForWave,
  resolveEventOption,
} from './shared/events.js';
import { RNG } from './shared/rng.js';
import { computeOutcome } from './shared/scoring.js';
import { HexRuntime } from './shared/hexes/runtime.js';
import { CombatSystem } from './sim/combat-system.js';
import {
  DestructibleSystem,
  createDestructibleEntries,
  normalizeObeliskStacks,
} from './sim/destructible-system.js';
import { EnemySystem } from './sim/enemy-system.js';
import { ProjectileSystem } from './sim/projectile-system.js';
import { RelicSystem } from './sim/relic-system.js';
import { SkillSystem } from './sim/skill-system.js';
import { SnapshotMapper } from './sim/snapshot-mapper.js';
import { TowerSystem } from './sim/tower-system.js';
import { WaveDirector } from './sim/wave-director.js';

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
    // 事件历史：旧存档没有该字段时按“无事件”处理；事件波规则随模式变化。
    this.events = normalizeEventHistory(opts.events || [], this.mode);
    // 连锁排期：快照里的记录只是冗余，历史才是事实来源，二者合并去重。
    this.chains = normalizeChains(
      [...(opts.chains || []), ...chainsFromHistory(this.events, this.mode)],
      this.mode
    );
    this.unlockedTowers = opts.unlockedTowers || ['arrow', 'cannon', 'frost'];
    this.startedAt = opts.startedAt || Date.now();

    this.enemies = [];
    // 分裂敌人的子怪延后到本帧战斗结算完再生成，避免死亡瞬间被同一发溅射重复命中。
    this.pendingSplits = [];
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

    // 可破坏物：运行时状态由地图布点深拷贝（含 cost/effect/destroyed）。
    // 读档只恢复拆除结果——快照里只有 id 列表与石碑层数，布点位置始终以地图为准。
    this.destructibles = createDestructibleEntries(
      this.map.destructibles,
      opts.destructibleState?.destroyed
    );
    this.obeliskStacks = normalizeObeliskStacks(opts.destructibleState?.obeliskStacks);

    // 主海克斯运行时：钩子缺失时全部安全跳过，没有海克斯的旧对局行为完全不变。
    this.hexRuntime = new HexRuntime(opts.hex ?? null, opts.hexState ?? null);
    this.hex = this.hexRuntime.definition;
    this.hexState = this.hexRuntime.state;
    // 友方单位（亡者军团等召唤物）：由海克斯通过 ctx.spawnAlly 写入。
    this.allies = [];
    this.hexCtx = this.createHexContext();

    // 主动技能：每局只带一个；等级由外层（服务端开局规则集）冻结。
    this.skill = null;
    this.skillCastCount = 0;
    this.skillRng = null;
    this.skillCastState = null;
    // 技能表现事件独立于 sim.effects，避免被画质过滤与 320 上限吞掉。
    this.skillFx = [];
    // 按模拟时间结算的技能事件（陨星落点等）。
    this.skillPending = [];
    this.stasis = null;
    this.towerOverdrive = null;

    // 系统对象只接收状态根引用；不持有全局单例、不自行创建 RNG。
    this.waveDirector = new WaveDirector(this);
    this.enemySystem = new EnemySystem(this);
    this.towerSystem = new TowerSystem(this);
    this.combatSystem = new CombatSystem(this);
    this.projectileSystem = new ProjectileSystem(this);
    this.skillSystem = new SkillSystem(this);
    this.relicSystem = new RelicSystem(this);
    this.destructibleSystem = new DestructibleSystem(this);
    this.snapshotMapper = new SnapshotMapper(this);

    this.buildPath();
    this.relicSystem.recomputeMods();
    // 初始化顺序：基础 mods → onRunInit → 重算塔属性。读档时状态已包含开局效果，不重放。
    if (!opts.restored && this.hexRuntime.active) {
      this.hexCall('onRunInit', this.hexCtx);
      this.relicSystem.recomputeMods();
    }
    this.skillSystem.initSkill(opts);
    // 事件阶段：续玩时由已清波次 + 事件历史推导，已结算过的不再重复弹出。
    this.pendingEvent = this.computePendingEvent();

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
      this.towers.push(
        this.towerSystem.makeTower(
          tower.type,
          tower.c,
          tower.r,
          tower.level,
          tower.invested,
          tower.evolutions ?? tower.evolution,
          // 旧快照没有塔生命字段时按无敌恢复（maxHp 为 null）。
          tower.maxHp == null ? null : { maxHp: tower.maxHp, hp: tower.hp }
        )
      );
    }
    this.towerSystem.recomputeTowerStats();

    this.combatRng = new RNG(`${this.seed}:combat:0`);
  }

  // ---------- 主更新 ----------

  update(dt) {
    // 暂停时模拟时间与技能冷却都不走表（外层 GameApp 也会停发 update）。
    if (this.phase !== 'wave' || this.paused) return;
    this.time += dt;
    this.waveTime += dt;

    this.skillSystem.updateSkill(dt);
    this.waveDirector.spawnDue();
    this.enemySystem.updateEnemies(dt);
    this.towerSystem.updateTowers(dt);
    this.enemySystem.updateAllies(dt);
    this.projectileSystem.updateProjectiles(dt);
    this.combatSystem.cleanup();

    if (this.baseHp <= 0) {
      this.gameOver(false);
      return;
    }
    if (
      this.phase === 'wave' &&
      this.spawnIndex >= this.spawnQueue.length &&
      this.enemies.length === 0
    ) {
      this.waveDirector.completeWave();
    }
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

  // ---------- 主海克斯运行时 ----------

  // 钩子上下文：只暴露受控入口，海克斯不需要（也不应该）直接改模拟内部。

  createHexContext() {
    const sim = this;
    let rng = null;
    return {
      sim,
      seed: this.seed,
      difficulty: this.difficulty,
      mode: this.mode,
      get wave() {
        return sim.wave;
      },
      get state() {
        return sim.hexState;
      },
      get gold() {
        return sim.gold;
      },
      // 海克斯专用随机流：与战斗 RNG 隔离，抽取顺序不会影响固定种子的战斗结算。
      get rng() {
        if (!rng) rng = new RNG(`${sim.seed}:hex:${sim.hexRuntime.id || 'none'}`);
        return rng;
      },
      addTempMod(key, value) {
        // 写入后立即重算：临时 mod 必须对这一波马上生效。
        const applied = sim.hexRuntime.addTempMod(key, value);
        if (applied) sim.recomputeMods();
        return applied;
      },
      spawnAlly(spec) {
        return sim.spawnAlly(spec);
      },
      toast(message) {
        sim.opts.onToast?.(message);
      },
    };
  }

  // 统一调用出口：没有海克斯时直接返回 undefined，调用点不需要判空。

  hexCall(name, ...args) {
    return this.hexRuntime?.active ? this.hexRuntime.call(name, ...args) : undefined;
  }

  // ---------- 视觉 ----------

  updateVisuals(dt) {
    this.shake = Math.max(0, this.shake - dt * 31);
    for (const effect of this.effects) effect.ttl -= dt;
    if (this.effects.length) this.effects = this.effects.filter((e) => e.ttl > 0);
    // 技能表现走独立通道：只按真实时间淡出，不受画质档位/特效上限影响。
    for (const fx of this.skillFx) fx.ttl -= dt;
    if (this.skillFx.length) this.skillFx = this.skillFx.filter((fx) => fx.ttl > 0);
    for (const floater of this.floaters) {
      floater.ttl -= dt;
      floater.y -= dt * 0.7;
    }
    if (this.floaters.length) this.floaters = this.floaters.filter((f) => f.ttl > 0);
  }

  // ---------- 结算与局内事件 ----------

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
      mode: this.mode,
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

  computePendingEvent() {
    return resolveEventForWave(this.seed, this.clearedWave, {
      history: this.events,
      chains: this.chains,
      mode: this.mode,
    });
  }

  // 事件结算：效果由 shared/events.js 的纯函数给出，这里只做边界收敛与落盘。

  applyEventOption(index) {
    const event = this.pendingEvent;
    if (!event) return { ok: false, reason: 'no-event' };
    const option = event.options?.[Number(index)];
    if (!option) return { ok: false, reason: 'invalid-option' };

    const result = resolveEventOption(event, option.id, {
      seed: this.seed,
      wave: this.clearedWave,
      gold: this.gold,
      baseHp: this.baseHp,
      maxHp: this.maxBaseHp,
    });
    if (!result.ok) return result;

    const deltas = result.deltas || {};
    const base = this.map.base;
    if (deltas.gold) {
      this.gold = Math.max(0, this.gold + deltas.gold);
      this.addFloater(
        base.x,
        base.y - 0.7,
        `${deltas.gold > 0 ? '+' : ''}${deltas.gold}`,
        deltas.gold > 0 ? '#ffd36b' : '#ff8b7a',
        true
      );
    }
    if (deltas.maxHp) {
      this.maxBaseHp = Math.max(1, this.maxBaseHp + deltas.maxHp);
    }
    if (deltas.hp) {
      const before = this.baseHp;
      this.baseHp = Math.max(1, Math.min(this.maxBaseHp, this.baseHp + deltas.hp));
      const amount = this.baseHp - before;
      if (amount > 0) {
        this.addEffect({ kind: 'heal', x: base.x, y: base.y, ttl: 0.8 });
        this.addFloater(base.x, base.y - 0.7, `+${amount}`, '#7ef0a5', true);
      } else if (amount < 0) {
        this.addFloater(base.x, base.y - 0.7, `${amount}`, '#ff8b7a', true);
      }
    }
    this.baseHp = Math.min(this.baseHp, this.maxBaseHp);

    this.events.push({ wave: this.clearedWave, eventId: event.id, optionId: option.id });
    this.events = normalizeEventHistory(this.events, this.mode);
    // 连锁选项在此刻排期；后续波次由事件历史推导，不消耗战斗 RNG。
    this.chains = normalizeChains(chainsFromHistory(this.events, this.mode), this.mode);
    this.pendingEvent = null;
    this.phase = 'prep';
    this.playSound('draft');
    this.save();
    return { ...result, applied: true };
  }

  // ---------- 表现与音效 ----------

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

  playSound(name) {
    const now = performance.now();
    const last = this._lastSound.get(name) || 0;
    const gap = name === 'kill' ? 70 : 40;
    if (now - last < gap) return;
    this._lastSound.set(name, now);
    this.opts.onSound?.(name);
  }

  // ---------- 系统委派（公共 API 保持不变） ----------

  beginWave(waveDef) { return this.waveDirector.beginWave(waveDef); }
  spawnDue() { return this.waveDirector.spawnDue(); }
  spawnEnemy(type, laneIndex = 0, hpMulOverride = null, progress = 0) { return this.waveDirector.spawnEnemy(type, laneIndex, hpMulOverride, progress); }
  spawnEnemyAt(type, lane, progress) { return this.waveDirector.spawnEnemyAt(type, lane, progress); }
  completeWave() { return this.waveDirector.completeWave(); }
  updateEnemies(dt) { return this.enemySystem.updateEnemies(dt); }
  auraBuffFor(enemy, sources) { return this.enemySystem.auraBuffFor(enemy, sources); }
  updateRanged(enemy, dt, now) { return this.enemySystem.updateRanged(enemy, dt, now); }
  updateBoss(enemy, dt, speed, now) { return this.enemySystem.updateBoss(enemy, dt, speed, now); }
  enterBossPhase(enemy, phase) { return this.enemySystem.enterBossPhase(enemy, phase); }
  pickBossSkill(enemy) { return this.enemySystem.pickBossSkill(enemy); }
  castBossSkill(enemy, kind, now) { return this.enemySystem.castBossSkill(enemy, kind, now); }
  leak(enemy) { return this.enemySystem.leak(enemy); }
  spawnAlly(spec = {}) { return this.enemySystem.spawnAlly(spec); }
  updateAllies(dt) { return this.enemySystem.updateAllies(dt); }
  updateTowers(dt) { return this.towerSystem.updateTowers(dt); }
  findTarget(tower, range) { return this.towerSystem.findTarget(tower, range); }
  inRange(tower, enemy, range) { return this.towerSystem.inRange(tower, enemy, range); }
  fire(tower, stats, target) { return this.projectileSystem.fire(tower, stats, target); }
  updateProjectiles(dt) { return this.projectileSystem.updateProjectiles(dt); }
  impact(proj) { return this.projectileSystem.impact(proj); }
  hitEnemy(enemy, proj) { return this.combatSystem.hitEnemy(enemy, proj); }
  dealDamage(enemy, base, towerType, opts = {}) { return this.combatSystem.dealDamage(enemy, base, towerType, opts); }
  computeHit(base, towerType, enemy, opts = {}) { return this.combatSystem.computeHit(base, towerType, enemy, opts); }
  damage(enemy, amount, opts = {}) { return this.combatSystem.damage(enemy, amount, opts); }
  killEnemy(enemy) { return this.combatSystem.killEnemy(enemy); }
  flushSplits() { return this.combatSystem.flushSplits(); }
  cleanup() { return this.combatSystem.cleanup(); }
  get towerDamageMul() { return this.destructibleSystem.towerDamageMul; }
  get destructibleState() { return this.destructibleSystem.destructibleState; }
  destructibleAt(c, r) { return this.destructibleSystem.destructibleAt(c, r); }
  destructibleAura() { return this.destructibleSystem.destructibleAura(); }
  destroyDestructible(id) { return this.destructibleSystem.destroyDestructible(id); }
  applyDestructibleEffect(item) { return this.destructibleSystem.applyDestructibleEffect(item); }
  spawnDestructibleSwarm(item) { return this.destructibleSystem.spawnDestructibleSwarm(item); }
  currentWaveHpMul() { return this.waveDirector.currentWaveHpMul(); }
  laneProgressNear(c, r) { return this.waveDirector.laneProgressNear(c, r); }
  makeTower(type, c, r, level = 0, invested = 0, evolution = null, hpState = null) {
    return this.towerSystem.makeTower(type, c, r, level, invested, evolution, hpState);
  }
  towerCost(type) { return this.towerSystem.towerCost(type); }
  towerMaxLevel(tower) { return this.towerSystem.towerMaxLevel(tower); }
  upgradeCost(tower) { return this.towerSystem.upgradeCost(tower); }
  sellValue(tower) { return this.towerSystem.sellValue(tower); }
  towerAt(c, r) { return this.towerSystem.towerAt(c, r); }
  canBuild(c, r, type = null) { return this.towerSystem.canBuild(c, r, type); }
  removeTower(tower, reason = 'removed') { return this.towerSystem.removeTower(tower, reason); }
  damageTower(tower, amount) { return this.towerSystem.damageTower(tower, amount); }
  placeTower(type, c, r) { return this.towerSystem.placeTower(type, c, r); }
  upgradeTower(tower) { return this.towerSystem.upgradeTower(tower); }
  towerEvolutions(tower) { return this.towerSystem.towerEvolutions(tower); }
  towerEvolution(tower) { return this.towerSystem.towerEvolution(tower); }
  canEvolve(tower) { return this.towerSystem.canEvolve(tower); }
  evolutionOptions(tower) { return this.towerSystem.evolutionOptions(tower); }
  evolveTower(tower, evolutionIds) { return this.towerSystem.evolveTower(tower, evolutionIds); }
  sellTower(tower) { return this.towerSystem.sellTower(tower); }
  getRelicLevel(id) { return this.relicSystem.getRelicLevel(id); }
  addRelic(relicOrOffer) { return this.relicSystem.addRelic(relicOrOffer); }
  applyOffer(offer) { return this.relicSystem.applyOffer(offer); }
  recomputeMods() { return this.relicSystem.recomputeMods(); }
  computeTowerStats(tower) { return this.towerSystem.computeTowerStats(tower); }
  refreshTowerStats(tower) { return this.towerSystem.refreshTowerStats(tower); }
  recomputeTowerStats() { return this.towerSystem.recomputeTowerStats(); }
  statsFor(tower) { return this.towerSystem.statsFor(tower); }
  previewStats(type, level = 0) { return this.towerSystem.previewStats(type, level); }
  initSkill(opts = {}) { return this.skillSystem.initSkill(opts); }
  isSkillReady() { return this.skillSystem.isSkillReady(); }
  castSkill() { return this.skillSystem.castSkill(); }
  castAurora(stats, now) { return this.skillSystem.castAurora(stats, now); }
  updateEnemySkillStatus(enemy, dt, now, stasisActive) { return this.skillSystem.updateEnemySkillStatus(enemy, dt, now, stasisActive); }
  resolveThaw(enemy, now) { return this.skillSystem.resolveThaw(enemy, now); }
  castMeteor(stats, now) { return this.skillSystem.castMeteor(stats, now); }
  pickMeteorPoints(stats, count, level, avoid = []) { return this.skillSystem.pickMeteorPoints(stats, count, level, avoid); }
  queueMeteor(point, stats, now) { return this.skillSystem.queueMeteor(point, stats, now); }
  resolveMeteor(ev) { return this.skillSystem.resolveMeteor(ev); }
  emberChain(ev, hit) { return this.skillSystem.emberChain(ev, hit); }
  castChrono(stats, now) { return this.skillSystem.castChrono(stats, now); }
  isStasisActive() { return this.skillSystem.isStasisActive(); }
  updateSkill(dt) { return this.skillSystem.updateSkill(dt); }
  endStasis() { return this.skillSystem.endStasis(); }
  applyTowerOverdrive(until, atk, range) { return this.skillSystem.applyTowerOverdrive(until, atk, range); }
  inheritTowerOverdrive(tower) { return this.skillSystem.inheritTowerOverdrive(tower); }
  clearTowerOverdrive(tower) { return this.skillSystem.clearTowerOverdrive(tower); }
  onSkillKill(enemy) { return this.skillSystem.onSkillKill(enemy); }
  skillField() { return this.skillSystem.skillField(); }
  skillTargets() { return this.skillSystem.skillTargets(); }
  nearestSkillTarget(x, y, radius, excludeId = null) { return this.skillSystem.nearestSkillTarget(x, y, radius, excludeId); }
  skillPctDamage(enemy, pct, bossFactor = 1) { return this.skillSystem.skillPctDamage(enemy, pct, bossFactor); }
  skillDamage(...args) { return this.skillSystem.skillDamage(...args); }
  addSkillFx(event) { return this.skillSystem.addSkillFx(event); }
  toSnapshot() { return this.snapshotMapper.toSnapshot(); }
  save() { return this.snapshotMapper.save(); }
  savePreWave() { return this.snapshotMapper.savePreWave(); }
  nextWavePreview() { return this.snapshotMapper.nextWavePreview(); }
  getHud() { return this.snapshotMapper.getHud(); }
}
