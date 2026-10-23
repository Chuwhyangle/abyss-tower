// 纯战斗模拟：不依赖 DOM / Canvas / 音频，浏览器与 Node 平衡模拟共用。
import {
  TOWERS,
  ENEMIES,
  BOSS_SKILLS,
  MAX_WAVE,
  RELIC_BY_ID,
  RELIC_MAX_LEVEL,
  GLOBAL_MOD_CAPS,
  SKILLS,
  skillStats,
  normalizeRelicStates,
  relicModsAtLevel,
} from './shared/data.js';
import {
  applyEffect,
  clampMods,
  createMods,
  effectValue,
  hitBonuses,
  relicSetTierBonuses,
} from './shared/effects.js';
import { RNG } from './shared/rng.js';
import {
  hasResolvedEvent,
  isEventWave,
  normalizeEventHistory,
  resolveEventOption,
  rollEvent,
} from './shared/events.js';
import { BALANCE } from './shared/config.js';
import { computeOutcome } from './shared/scoring.js';
import { generateWave } from './shared/waves.js';
import { toSnapshot } from './shared/snapshot.js';

// 主动技能常量：落点间距、预警时长、余烬连锁范围。
const SKILL_METEOR_WARNING = 0.55;
const SKILL_METEOR_SPACING = 2.5;
const SKILL_METEOR_CHAIN_RANGE = 2.5;
const SKILL_METEOR_CHAIN_MAX = 4;
const SKILL_METEOR_CHAIN_RATIO = 0.35;
const SKILL_STASIS_MAX_EXTEND = 1;
const SKILL_STASIS_KILL_EXTEND = 0.1;

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
    // 事件历史：旧存档没有该字段时按“无事件”处理。
    this.events = normalizeEventHistory(opts.events || []);
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

    this.buildPath();
    this.recomputeMods();
    this.initSkill(opts);
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
        this.makeTower(tower.type, tower.c, tower.r, tower.level, tower.invested, tower.evolution)
      );
    }
    this.recomputeTowerStats();

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
    // 暂停时模拟时间与技能冷却都不走表（外层 GameApp 也会停发 update）。
    if (this.phase !== 'wave' || this.paused) return;
    this.time += dt;
    this.waveTime += dt;

    this.updateSkill(dt);
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
    // 技能表现走独立通道：只按真实时间淡出，不受画质档位/特效上限影响。
    for (const fx of this.skillFx) fx.ttl -= dt;
    if (this.skillFx.length) this.skillFx = this.skillFx.filter((fx) => fx.ttl > 0);
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

    // 技能状态跨波保留（冷却继续走），但时停/待落陨星/过载属于当前波。
    this.skillPending = [];
    this.skillCastState = null;
    this.stasis = null;
    if (this.towerOverdrive) {
      this.towerOverdrive = null;
      for (const tower of this.towers) this.clearTowerOverdrive(tower);
    }

    for (const group of waveDef.groups) {
      const portal = Number.isInteger(group.portal) ? group.portal : 0;
      for (let i = 0; i < group.count; i++) {
        this.spawnQueue.push({
          type: group.type,
          time: group.delay + i * group.interval,
          portal,
          hpMul: group.hpMul,
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
      this.spawnEnemy(item.type, item.portal || 0, item.hpMul ?? null);
    }
  }

  // hpMul 允许按群组覆盖（首领使用独立血量曲线）；progress 用于首领召唤。
  spawnEnemy(type, laneIndex = 0, hpMulOverride = null, progress = 0) {
    const base = ENEMIES[type];
    const hpMul = hpMulOverride ?? this.waveDef?.hpMul ?? 1;
    const speedMul = this.waveDef?.speedMul || 1;
    const hp = Math.max(1, Math.round(base.hp * hpMul));
    const lane = Math.max(0, Math.min(this.lanes.length - 1, laneIndex || 0));
    const pos = this.posAt(progress, lane);
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
      // 机制型敌人：护盾优先吸收伤害，分裂死亡生成子怪，光环加速友军，远程攻击塔/基地。
      shield: base.shield || 0,
      maxShield: base.shield || 0,
      splits: base.splits || null,
      aura: base.aura || null,
      ranged: base.ranged || null,
      rangedTimer: 0,
      lane,
      progress,
      x: pos.x,
      y: pos.y,
      angle: pos.angle,
      slowUntil: 0,
      slowAmt: 0,
      poisonUntil: 0,
      poisonDps: 0,
      // 主动技能状态（霜月冻结 / 星陨灼烧 / 时之星痕）
      freezeUntil: 0,
      freezeVulnUntil: 0,
      freezeVuln: 0,
      freezeSlow: 0,
      freezeSlowDur: 0,
      freezeShatter: 0,
      burnUntil: 0,
      burnDps: 0,
      skillVulnUntil: 0,
      skillVuln: 0,
      hitFlash: 0,
      dead: false,
      // 首领状态机：走走停停 + 技能蓄力 + 破绽窗口 + 阶段/狂怒
      stopped: false,
      stopTimer: 0,
      marchTimer: 0,
      cast: null,
      castIndex: 0,
      vulnUntil: 0,
      bossPhase: 1,
      enraged: false,
      cooldowns: { roar: 0, summon: 0, slam: 0 },
      // 深渊咆哮给周围敌人施加的移速增益
      speedBuffUntil: 0,
      speedBuff: 0,
    });
    this.addEffect({ kind: 'spawn', x: pos.x, y: pos.y, ttl: 0.4, color: base.color });
  }

  // 在指定进度处生成敌人（首领召唤用），血量沿用普通波次曲线。
  spawnEnemyAt(type, lane, progress) {
    this.spawnEnemy(type, lane, null, Math.max(0, progress));
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

    // 无尽模式不清算通关：第 30 波后继续生成递增波次，直到基地被摧毁。
    if (this.mode !== 'endless' && cleared >= MAX_WAVE) {
      this.gameOver(true);
      return;
    }

    // 第 5/10/15/20/25 波结束后进入事件阶段；结算前不推进下一波。
    this.pendingEvent = this.computePendingEvent();
    this.phase = this.pendingEvent ? 'event' : 'prep';
    // 时停/待落陨星/过载都属于进行中的这一波，清波即收起。
    this.stasis = null;
    this.skillPending = [];
    this.towerOverdrive = null;
    for (const tower of this.towers) this.clearTowerOverdrive(tower);
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

  // ---------- 敌人 ----------

  updateEnemies(dt) {
    const now = this.time;
    // 光环与加速都只读上一帧位置，先取快照，避免遍历顺序影响结果。
    const auraSources = this.enemies.filter((enemy) => !enemy.dead && enemy.aura);
    // 时之终章：敌人移动、治疗、中毒/灼烧计时与首领计时全部暂停。
    const stasisActive = this.isStasisActive();
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt * 4);
      this.updateEnemySkillStatus(enemy, dt, now, stasisActive);
      if (enemy.dead) continue;

      const slowed = now < enemy.slowUntil;
      if (!slowed && enemy.slowAmt) enemy.slowAmt = 0;
      const buff = now < (enemy.speedBuffUntil || 0) ? enemy.speedBuff || 0 : 0;
      const auraBuff = this.auraBuffFor(enemy, auraSources);
      const frozen = now < (enemy.freezeUntil || 0);
      let speed = enemy.baseSpeed * (1 - (slowed ? enemy.slowAmt : 0)) * (1 + buff) * (1 + auraBuff);
      // 冻结只停移动，不打断首领蓄力；时停则连首领计时一起暂停。
      if (frozen || stasisActive) speed = 0;
      if (!stasisActive) {
        if (enemy.boss) speed = this.updateBoss(enemy, dt, speed, now);
        enemy.progress += speed * dt;
      }

      const pos = this.posAt(enemy.progress, enemy.lane);
      enemy.x = pos.x;
      enemy.y = pos.y;
      enemy.angle = pos.angle;

      if (!stasisActive && now < enemy.poisonUntil && enemy.poisonDps > 0) {
        this.damage(enemy, enemy.poisonDps * dt, { ignoreArmor: true, silent: true, dot: true });
        if (Math.random() < dt * 2.2) {
          this.addEffect({ kind: 'poison', x: enemy.x, y: enemy.y - 0.15, ttl: 0.5 });
        }
      }

      if (!stasisActive && enemy.heal > 0 && !enemy.dead) {
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

      // 远程敌人：冻结/时停期间无法开火。
      if (!stasisActive && !frozen && !enemy.dead) this.updateRanged(enemy, dt, now);

      if (enemy.progress >= (this.lanes[enemy.lane] || this.lanes[0]).len) this.leak(enemy);
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
    for (const tower of this.towers) {
      if (now < (tower.disabledUntil || 0)) continue;
      const d = Math.hypot(tower.x - enemy.x, tower.y - enemy.y);
      if (d <= spec.range && d < best) {
        best = d;
        target = tower;
      }
    }
    if (target) {
      target.disabledUntil = now + spec.disable;
      this.addEffect({
        kind: 'bolt',
        points: [{ x: enemy.x, y: enemy.y }, { x: target.x, y: target.y }],
        ttl: 0.18,
        color: '#b5c94a',
      });
      this.addEffect({ kind: 'towerDisable', x: target.x, y: target.y, ttl: spec.disable, color: '#b5c94a' });
      enemy.rangedTimer = spec.interval;
      return;
    }

    const lane = this.lanes[enemy.lane] || this.lanes[0];
    if (spec.dmg > 0 && enemy.progress >= lane.len - (spec.baseRange || 1.5)) {
      this.baseHp -= spec.dmg;
      this.addEffect({ kind: 'leak', x: this.map.base.x, y: this.map.base.y, ttl: 0.4 });
      this.addFloater(this.map.base.x, this.map.base.y - 0.4, `-${spec.dmg}`, '#ff6b6b', true, { key: true });
      this.playSound('hurt');
      enemy.rangedTimer = spec.interval;
    }
  }

  // ---------- 首领状态机 ----------

  updateBoss(enemy, dt, speed, now) {
    const ratio = enemy.hp / enemy.maxHp;
    if (enemy.bossPhase < 2 && ratio <= 0.66) this.enterBossPhase(enemy, 2);
    if (enemy.bossPhase < 3 && ratio <= 0.33) this.enterBossPhase(enemy, 3);
    if (!enemy.enraged && ratio <= 0.25) {
      enemy.enraged = true;
      enemy.baseSpeed *= 1.2;
      this.addFloater(enemy.x, enemy.y - 0.9, '狂怒', '#ff6b6b', true, { key: true });
      this.addEffect({ kind: 'ring', x: enemy.x, y: enemy.y, r0: 0.2, r1: 1.8, ttl: 0.5, color: '#ff6b6b' });
      this.shake = Math.min(12, this.shake + 6);
      this.playSound('bossCast');
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
          this.castBossSkill(enemy, kind, now);
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
      const kind = this.pickBossSkill(enemy);
      if (kind) {
        enemy.cast = { kind, progress: 0 };
        this.addFloater(enemy.x, enemy.y - 1.0, BOSS_SKILLS[kind]?.name || kind, '#ffd36b', false, { key: false });
        this.addEffect({
          kind: 'bossCast',
          x: enemy.x,
          y: enemy.y,
          skill: kind,
          ttl: BALANCE.bossCastWindup,
          color: '#ffd36b',
        });
        this.playSound('bossCast');
      }
      return 0;
    }
    return speed;
  }

  enterBossPhase(enemy, phase) {
    enemy.bossPhase = phase;
    enemy.baseSpeed *= 1.06;
    this.addEffect({ kind: 'ring', x: enemy.x, y: enemy.y, r0: 0.2, r1: 1.7, ttl: 0.5, color: '#ffd36b' });
    this.addFloater(enemy.x, enemy.y - 0.9, `第 ${phase} 阶段`, '#ffd36b', true, { key: true });
    this.shake = Math.min(10, this.shake + 3);
    this.playSound('bossCast');
  }

  // 按波次解锁技能，冷却好才进入候选；轮转选择，避免连续重复。
  pickBossSkill(enemy) {
    const wave = this.waveDef?.index || this.wave || 1;
    const options = [];
    if (wave >= 5 && enemy.cooldowns.roar <= 0) options.push('roar');
    if (wave >= 10 && enemy.cooldowns.summon <= 0) options.push('summon');
    if (wave >= 15 && enemy.cooldowns.slam <= 0) options.push('slam');
    if (!options.length) return null;
    const kind = options[enemy.castIndex % options.length];
    enemy.castIndex += 1;
    return kind;
  }

  castBossSkill(enemy, kind, now) {
    if (kind === 'roar') {
      enemy.cooldowns.roar = BALANCE.bossRoarCd;
      for (const other of this.enemies) {
        if (other.dead || other === enemy) continue;
        if (Math.hypot(other.x - enemy.x, other.y - enemy.y) <= BALANCE.bossRoarRadius) {
          other.speedBuffUntil = now + BALANCE.bossRoarDur;
          other.speedBuff = BALANCE.bossRoarSpeed;
        }
      }
      this.addEffect({ kind: 'bossRoar', x: enemy.x, y: enemy.y, r: BALANCE.bossRoarRadius, ttl: 0.6, color: '#ff8a6b' });
      this.shake = Math.min(12, this.shake + 4);
      this.playSound('bossRoar');
    } else if (kind === 'summon') {
      enemy.cooldowns.summon = BALANCE.bossSummonCd;
      const wave = this.waveDef?.index || this.wave || 1;
      const count = Math.min(
        BALANCE.bossSummonMax,
        Math.round(BALANCE.bossSummonBase + wave * BALANCE.bossSummonPerWave)
      );
      for (let i = 0; i < count; i++) {
        this.spawnEnemyAt('swarm', enemy.lane, enemy.progress - 0.25 - i * 0.12);
      }
      this.addEffect({ kind: 'bossSummon', x: enemy.x, y: enemy.y, ttl: 0.7, color: '#e2609e' });
      this.playSound('bossSummon');
    } else if (kind === 'slam') {
      enemy.cooldowns.slam = BALANCE.bossSlamCd;
      for (const tower of this.towers) {
        if (Math.hypot(tower.x - enemy.x, tower.y - enemy.y) > BALANCE.bossSlamRadius) continue;
        tower.disabledUntil = now + BALANCE.bossSlamDisable;
        this.addEffect({ kind: 'towerDisable', x: tower.x, y: tower.y, ttl: BALANCE.bossSlamDisable, color: '#ff8a6b' });
      }
      this.addEffect({ kind: 'bossSlam', x: enemy.x, y: enemy.y, r: BALANCE.bossSlamRadius, ttl: 0.6, color: '#ffb066' });
      this.shake = Math.min(14, this.shake + 5);
      this.playSound('bossSlam');
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
      // 支援塔不索敌、不攻击，只通过 recomputeTowerStats 产生的光环影响其他塔。
      if (TOWERS[tower.type].support) {
        tower.target = null;
        continue;
      }
      // 被首领震击停摆：不索敌、不开火，冷却照常流逝。
      if (this.time < (tower.disabledUntil || 0)) continue;
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
      knockback: stats.knockback || 0,
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
    if (proj.knockback > 0) {
      // 击退只回退路径进度，位置在下个模拟步由 posAt 重新求得，不引入额外随机数。
      enemy.progress = Math.max(0, enemy.progress - proj.knockback);
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
    // 条件增伤由注册表按声明顺序给出，乘法顺序与重构前一致。
    for (const bonus of hitBonuses(this, enemy)) dmg *= 1 + bonus;
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
    // 首领停顿/蓄力时是破绽窗口，鼓励集火。
    if (enemy.boss && this.time < (enemy.vulnUntil || 0)) {
      final *= BALANCE.bossVulnMul;
    }
    // 技能易伤：冻结易伤（霜月）与星痕易伤（时之终章），统一用模拟时间判断。
    if (this.time < (enemy.freezeVulnUntil || 0) && enemy.freezeVuln > 0) {
      final *= 1 + enemy.freezeVuln;
    }
    if (this.time < (enemy.skillVulnUntil || 0) && enemy.skillVuln > 0) {
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
    if (enemy.splits) {
      const count = Math.max(1, Math.floor(enemy.splits.count || 1));
      for (let i = 0; i < count; i++) {
        this.pendingSplits.push({
          type: enemy.splits.type,
          lane: enemy.lane,
          progress: Math.max(0, enemy.progress - i * 0.12),
        });
      }
    }
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
    // 里程碑击杀钩子（极光终章 / 终章延时）
    this.onSkillKill(enemy);
  }

  // 本帧所有伤害结算完成后再生成分裂子怪：顺序固定，同种子结果一致。
  flushSplits() {
    if (!this.pendingSplits.length) return;
    const pending = this.pendingSplits;
    this.pendingSplits = [];
    for (const item of pending) this.spawnEnemy(item.type, item.lane, null, item.progress);
  }

  cleanup() {
    this.flushSplits();
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

  makeTower(type, c, r, level = 0, invested = 0, evolution = null) {
    return {
      id: this.nextId++,
      type,
      c,
      r,
      x: c + 0.5,
      y: r + 0.5,
      level,
      invested,
      // 满级二选一的分支 id；旧存档没有该字段时按未进化处理。
      evolution: evolution || null,
      cd: 0,
      angle: TOWERS[type]?.support ? 0 : -Math.PI / 2,
      target: null,
      recoil: 0,
      disabledUntil: 0,
      // 时之终章过载（由 applyTowerOverdrive 写入）
      skillOverdriveUntil: 0,
      skillOverdriveAtk: 0,
      skillOverdriveRange: 0,
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
    this.inheritTowerOverdrive(tower);
    this.towers.push(tower);
    this.recomputeTowerStats();
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
    this.recomputeTowerStats();
    this.addEffect({ kind: 'place', x: tower.x, y: tower.y, ttl: 0.5, color: '#ffd36b' });
    this.playSound('upgrade');
    this.save();
    return true;
  }

  // ---------- 分支进化 ----------

  towerEvolution(tower) {
    const def = TOWERS[tower.type];
    if (!tower.evolution || !def?.evolutions) return null;
    return def.evolutions.find((entry) => entry.id === tower.evolution) || null;
  }

  // 满级且尚未选择分支时才可进化；进化不消耗 RNG，也不改变基础塔数值。
  canEvolve(tower) {
    const def = TOWERS[tower.type];
    if (!def?.evolutions?.length || tower.evolution) return false;
    return tower.level >= def.levels.length - 1;
  }

  evolutionOptions(tower) {
    return this.canEvolve(tower) ? TOWERS[tower.type].evolutions : [];
  }

  evolveTower(tower, evolutionId) {
    if (!tower || !this.towers.includes(tower) || !this.canEvolve(tower)) return false;
    const def = TOWERS[tower.type];
    const evolution = def.evolutions.find((entry) => entry.id === evolutionId);
    if (!evolution) return false;
    tower.evolution = evolution.id;
    this.recomputeTowerStats();
    this.addEffect({
      kind: 'evolve',
      x: tower.x,
      y: tower.y,
      ttl: 0.9,
      color: evolution.color || def.color,
    });
    this.playSound('upgrade');
    this.save();
    return true;
  }

  sellTower(tower) {
    const value = this.sellValue(tower);
    this.gold += value;
    this.towers = this.towers.filter((t) => t !== tower);
    this.recomputeTowerStats();
    if (this.selectedTower === tower) this.selectedTower = null;
    this.addFloater(tower.x, tower.y - 0.4, `+${value}`, '#ffd36b');
    this.playSound('sell');
    this.save();
    return value;
  }

  // ---------- 局内事件 ----------

  computePendingEvent() {
    if (!isEventWave(this.clearedWave)) return null;
    if (hasResolvedEvent(this.events, this.clearedWave)) return null;
    return rollEvent(this.seed, this.clearedWave);
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
    this.events = normalizeEventHistory(this.events);
    this.pendingEvent = null;
    this.phase = 'prep';
    this.playSound('draft');
    this.save();
    return { ...result, applied: true };
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

  // 聚合与封顶完全由效果注册表驱动：未注册的键会在 relicModsAtLevel/applyEffect 中报错。
  recomputeMods() {
    const mods = createMods();
    for (const relic of this.relics) {
      const levelMods = relicModsAtLevel(relic.id, relic.level);
      for (const [key, value] of Object.entries(levelMods)) {
        applyEffect(mods, key, value);
      }
    }
    // 套装按不同遗物计件：等级提升不重复计入，2/4 件档位依次叠加。
    const setPieces = new Map();
    const counted = new Set();
    for (const relic of this.relics) {
      const def = RELIC_BY_ID[relic.id];
      if (!def?.set || counted.has(relic.id)) continue;
      counted.add(relic.id);
      setPieces.set(def.set, (setPieces.get(def.set) || 0) + 1);
    }
    for (const [setId, pieces] of setPieces) {
      for (const tier of relicSetTierBonuses(setId, pieces)) {
        for (const [key, value] of Object.entries(tier.mods)) {
          applyEffect(mods, key, value);
        }
      }
    }
    clampMods(mods);

    this.mods = mods;
    // 遗物变化时统一刷新塔的稳定属性，模拟步内不再重算。
    this.recomputeTowerStats();
  }

  computeTowerStats(tower) {
    const def = TOWERS[tower.type];
    const level = def.levels[Math.min(tower.level, def.levels.length - 1)];
    const mods = this.mods;
    const dmg = effectValue(mods, 'dmg');
    // 进化分支只是纯数据系数，这里统一应用；未进化时全部为 1。
    const evolution = this.towerEvolution(tower);
    const evoMul = (key) => evolution?.mods?.[key] ?? 1;
    let rate = level.rate * evoMul('rate') * (1 + effectValue(mods, 'fireRate'));
    let range = level.range * evoMul('range') + effectValue(mods, 'range');
    // 时之终章的过载窗口：攻速/射程只在窗口内生效，结束即刷新缓存。
    if (this.time < (tower.skillOverdriveUntil || 0)) {
      rate *= 1 + (tower.skillOverdriveAtk || 0);
      range += tower.skillOverdriveRange || 0;
    }
    return {
      dmg: level.dmg * evoMul('dmg') * (1 + (dmg[tower.type] || 0) + effectValue(mods, 'dmgAll')),
      rate,
      range: range * (this.modifier?.rangeMul || 1),
      splash: (level.splash || 0) * evoMul('splash') * (1 + effectValue(mods, 'splash')),
      slow: (level.slow || 0) * evoMul('slow'),
      slowDur: (level.slowDur || 0) * evoMul('slowDur'),
      chain: Math.round((level.chain || 0) * evoMul('chain')) + effectValue(mods, 'chain'),
      dot: (level.dot || 0) * evoMul('dot'),
      dotDur: (level.dotDur || 0) * evoMul('dotDur'),
      knockback: (level.knockback || 0) * evoMul('knockback'),
      buffDmg: (level.buffDmg || 0) * evoMul('buffDmg'),
      buffRate: (level.buffRate || 0) * evoMul('buffRate'),
      support: !!def.support,
      maxLevel: def.levels.length,
    };
  }

  refreshTowerStats(tower) {
    tower.stats = this.computeTowerStats(tower);
    return tower.stats;
  }

  // 战旗塔光环：只读塔的位置与等级属性，不消耗 RNG，因此在建造/升级/出售/遗物变化时重算即可。
  // 单塔光环加成上限 80%，与遗物减速/增伤的封顶量级一致。
  recomputeTowerStats() {
    for (const tower of this.towers) {
      tower.aura = null;
      tower.stats = this.computeTowerStats(tower);
    }
    const banners = this.towers.filter((tower) => TOWERS[tower.type].support);
    if (!banners.length) return;
    for (const tower of this.towers) {
      if (TOWERS[tower.type].support) continue;
      let dmg = 0;
      let rate = 0;
      for (const banner of banners) {
        const range = banner.stats.range;
        const dx = banner.x - tower.x;
        const dy = banner.y - tower.y;
        if (dx * dx + dy * dy <= range * range) {
          dmg += banner.stats.buffDmg;
          rate += banner.stats.buffRate;
        }
      }
      if (dmg <= 0 && rate <= 0) continue;
      dmg = Math.min(0.8, dmg);
      rate = Math.min(0.8, rate);
      tower.aura = { dmg, rate };
      tower.stats = {
        ...tower.stats,
        dmg: tower.stats.dmg * (1 + dmg),
        rate: tower.stats.rate * (1 + rate),
        auraDmg: dmg,
        auraRate: rate,
      };
    }
  }

  statsFor(tower) {
    return tower.stats || this.refreshTowerStats(tower);
  }

  previewStats(type, level = 0) {
    return this.computeTowerStats(this.makeTower(type, 0, 0, level, 0));
  }

  // ---------- 主动技能 ----------

  // 技能等级由外层冻结；冷却只在这里恢复，后续仅随 update 递减。
  initSkill(opts = {}) {
    const config = opts.skill;
    if (!config || typeof config.id !== 'string') return;
    const def = SKILLS[config.id];
    if (!def) return;
    const level = Math.max(1, Math.min(def.levels.length, Math.floor(Number(config.level) || 1)));
    const stats = skillStats(def.id, level);
    let cooldown = Number(config.cooldown);
    if (!Number.isFinite(cooldown)) cooldown = 0;
    const readyAt = Number(opts.skillReadyAt ?? config.readyAt);
    if (Number.isFinite(readyAt) && readyAt > 0) {
      // 按真实时间扣减，并钳到 [0, 冷却]：防止“放大招 → 刷新 → 重打本波”。
      // skillSpeed：外层若记录的是按倍速换算过的真实时间，用当前倍速换回模拟秒。
      const speed = Math.max(0.25, Number(opts.skillSpeed) || 1);
      cooldown = ((readyAt - Date.now()) / 1000) * speed;
    }
    this.skill = {
      id: def.id,
      level,
      stats,
      cooldown: Math.max(0, Math.min(stats.cd, cooldown)),
    };
  }

  isSkillReady() {
    return !!this.skill && this.skill.cooldown <= 0 && this.phase === 'wave' && !this.paused;
  }

  castSkill() {
    const skill = this.skill;
    if (!skill) return false;
    if (this.phase !== 'wave' || this.paused) return false;
    if (skill.cooldown > 0) return false;

    const stats = skill.stats;
    skill.cooldown = stats.cd;
    this.skillCastCount += 1;
    // 独立种子流：技能不碰 combatRng，战斗随机序列保持不变。
    this.skillRng = new RNG(`${this.seed}:skill:${this.wave}:${this.skillCastCount}`);
    this.skillCastState = { meteorExtraUsed: false, meteorCenters: [] };
    const now = this.time;

    if (skill.id === 'aurora') this.castAurora(stats, now);
    else if (skill.id === 'meteor') this.castMeteor(stats, now);
    else if (skill.id === 'chrono') this.castChrono(stats, now);

    // 外层立即落一份含 skill.cooldown 的快照并补 skillReadyAt（epoch）。
    const snapshot = this.toSnapshot();
    snapshot.skillReadyAt = Date.now() + skill.cooldown * 1000;
    this.opts.onSkillCast?.(snapshot);
    return true;
  }

  // 霜月·极光：全场冻结 + 冻结易伤，解冻时碎晶并附加减速。
  castAurora(stats, now) {
    const level = this.skill.level;
    const targets = this.skillTargets();
    // L7 月蚀：场上 ≥12 敌时冻结延长 0.3s
    const freezeDur = stats.freeze + (level >= 7 && targets.length >= 12 ? 0.3 : 0);
    for (const enemy of targets) {
      if (enemy.dead) continue;
      enemy.freezeUntil = now + freezeDur;
      enemy.freezeVuln = stats.vuln;
      enemy.freezeVulnUntil = now + freezeDur;
      // 解冻参数先挂在敌人身上，由 resolveThaw 在解冻当帧结算。
      enemy.freezeSlow = stats.slow;
      enemy.freezeSlowDur = stats.slowDur;
      enemy.freezeShatter = stats.shatter;
    }
    const field = this.skillField();
    this.addSkillFx({ kind: 'aurora', x: field.x, y: field.y, r: field.r, ttl: 2.4, color: SKILLS.aurora.color });
  }

  // 每帧状态推进：解冻结算、灼烧跳伤；时停期间暂停中毒/灼烧计时。
  updateEnemySkillStatus(enemy, dt, now, stasisActive) {
    if (enemy.freezeUntil > 0 && now >= enemy.freezeUntil) this.resolveThaw(enemy, now);
    if (enemy.dead) return;

    if (stasisActive) {
      if (enemy.burnUntil > now) enemy.burnUntil += dt;
      if (enemy.poisonUntil > now) enemy.poisonUntil += dt;
      return;
    }

    if (enemy.burnUntil > now && enemy.burnDps > 0) {
      this.skillDamage(enemy, enemy.burnDps * dt, { dot: true });
    }
  }

  resolveThaw(enemy, now) {
    const shatter = enemy.freezeShatter || 0;
    const slow = enemy.freezeSlow || 0;
    const slowDur = enemy.freezeSlowDur || 0;
    const level = this.skill?.id === 'aurora' ? this.skill.level : 0;
    const bossFactor = SKILLS.aurora.bossFactor;

    enemy.freezeUntil = 0;
    enemy.freezeVuln = 0;
    enemy.freezeVulnUntil = 0;
    enemy.freezeSlow = 0;
    enemy.freezeSlowDur = 0;
    enemy.freezeShatter = 0;

    const amount = this.skillPctDamage(enemy, shatter, bossFactor);
    if (amount > 0) {
      const x = enemy.x;
      const y = enemy.y;
      const id = enemy.id;
      this.skillDamage(enemy, amount);
      this.addSkillFx({ kind: 'shatter', x, y, r: 0.5, ttl: 0.4, color: SKILLS.aurora.color });
      // L4 霜纹：25% 概率波及 0.8 格内另一名敌人（50% 碎晶伤害）。
      if (level >= 4) {
        const roll = this.skillRng ? this.skillRng.float() : 1;
        if (roll < 0.25) {
          const other = this.nearestSkillTarget(x, y, 0.8, id);
          if (other) {
            this.skillDamage(other, this.skillPctDamage(other, shatter * 0.5, bossFactor));
            this.addSkillFx({ kind: 'frostTrace', x: other.x, y: other.y, r: 0.8, ttl: 0.4, color: SKILLS.aurora.color });
          }
        }
      }
    }
    if (slow > 0) {
      enemy.slowAmt = Math.max(enemy.slowAmt, slow);
      enemy.slowUntil = Math.max(enemy.slowUntil, now + slowDur);
    }
  }

  // 星陨·天火：按密度确定性选点，0.55s 预警后落点 AoE + 灼烧。
  castMeteor(stats, now) {
    const level = this.skill.level;
    this.skillCastState = { meteorExtraUsed: false, meteorCenters: [] };
    const points = this.pickMeteorPoints(stats, stats.meteors, level);
    for (const point of points) this.queueMeteor(point, stats, now);
    const field = this.skillField();
    this.addSkillFx({ kind: 'meteorCast', x: field.x, y: field.y, r: field.r, ttl: 0.8, color: SKILLS.meteor.color });
  }

  // 选点：按敌人位置做密度评分，陨星之间强制 2.5 格分簇。
  // 候选顺序固定为 progress 降序、id 升序，保证同种子结果一致。
  pickMeteorPoints(stats, count, level, avoid = []) {
    const candidates = this.skillTargets();
    if (!candidates.length || count <= 0) return [];
    const radius2 = stats.radius * stats.radius;
    const scored = candidates.map((enemy) => {
      let total = 0;
      let unburned = 0;
      for (const other of candidates) {
        const dx = other.x - enemy.x;
        const dy = other.y - enemy.y;
        if (dx * dx + dy * dy > radius2) continue;
        total++;
        if (!(this.time < (other.burnUntil || 0) && other.burnDps > 0)) unburned++;
      }
      return { enemy, total, unburned };
    });
    const points = [];
    // avoid：本次释放已排队的落点（L7 额外陨星也要参与 2.5 格分簇）。
    const occupied = Array.isArray(avoid) ? avoid.slice() : [];
    for (let i = 0; i < count; i++) {
      let best = null;
      let bestScore = -Infinity;
      for (const cand of scored) {
        if (occupied.some((p) => Math.hypot(p.x - cand.enemy.x, p.y - cand.enemy.y) < SKILL_METEOR_SPACING)) continue;
        // L4 星轨：优先未被灼烧的群落（同密集度下取未灼烧更多的点）。
        const score = level >= 4 ? cand.unburned * 1000 + cand.total : cand.total;
        if (score > bestScore) {
          bestScore = score;
          best = cand;
        }
      }
      if (!best) {
        // 敌人不足以满足分簇：退化为“离已选点最远”，保证颗数全部落地。
        let farDist = -Infinity;
        for (const cand of scored) {
          let nearest = Infinity;
          for (const p of occupied) {
            nearest = Math.min(nearest, Math.hypot(p.x - cand.enemy.x, p.y - cand.enemy.y));
          }
          if (nearest > farDist) {
            farDist = nearest;
            best = cand;
          }
        }
        if (!best) break;
      }
      const point = { x: best.enemy.x, y: best.enemy.y };
      points.push(point);
      occupied.push(point);
    }
    return points;
  }

  queueMeteor(point, stats, now) {
    if (this.skillCastState) this.skillCastState.meteorCenters.push({ x: point.x, y: point.y });
    this.skillPending.push({
      type: 'meteor',
      at: now + SKILL_METEOR_WARNING,
      x: point.x,
      y: point.y,
      r: stats.radius,
      dmgPct: stats.dmgPct,
      burnPct: stats.burnPct,
      level: this.skill?.level || 1,
    });
    this.addSkillFx({
      kind: 'meteorWarn',
      x: point.x,
      y: point.y,
      r: stats.radius,
      ttl: SKILL_METEOR_WARNING,
      color: SKILLS.meteor.color,
    });
  }

  resolveMeteor(ev) {
    const now = this.time;
    const bossFactor = SKILLS.meteor.bossFactor;
    const hit = [];
    for (const enemy of this.skillTargets()) {
      if (enemy.dead) continue;
      if (Math.hypot(enemy.x - ev.x, enemy.y - ev.y) > ev.r + (enemy.r || 0) * 0.4) continue;
      const wasBurning = enemy.burnUntil > now && enemy.burnDps > 0;
      this.skillDamage(enemy, this.skillPctDamage(enemy, ev.dmgPct, bossFactor));
      if (!enemy.dead) {
        const previous = enemy.burnUntil > now ? enemy.burnDps || 0 : 0;
        enemy.burnDps = Math.max(previous, (enemy.maxHp * ev.burnPct) / 3);
        enemy.burnUntil = Math.max(enemy.burnUntil || 0, now + 3);
      }
      hit.push({ enemy, wasBurning });
    }
    this.addSkillFx({ kind: 'meteor', x: ev.x, y: ev.y, r: ev.r, ttl: 0.55, color: SKILLS.meteor.color });

    // L10 天火终章：命中已灼烧目标触发余烬连锁（35% 伤害，最多 4 个）。
    if (ev.level >= 10 && hit.some((entry) => entry.wasBurning)) this.emberChain(ev, hit);

    // L7 流火：单次落点命中 ≥10 敌，额外落 1 颗（每次释放最多 1 颗）。
    if (
      ev.level >= 7 &&
      hit.length >= 10 &&
      this.skill &&
      this.skillCastState &&
      !this.skillCastState.meteorExtraUsed
    ) {
      this.skillCastState.meteorExtraUsed = true;
      const centers = this.skillCastState.meteorCenters || [];
      const extra = this.pickMeteorPoints(this.skill.stats, 1, this.skill.level, centers);
      if (extra[0]) this.queueMeteor(extra[0], this.skill.stats, now);
    }
  }

  emberChain(ev, hit) {
    const hitIds = new Set(hit.map((entry) => entry.enemy.id));
    const candidates = [];
    for (const enemy of this.skillTargets()) {
      if (hitIds.has(enemy.id)) continue;
      const distance = Math.hypot(enemy.x - ev.x, enemy.y - ev.y);
      if (distance <= SKILL_METEOR_CHAIN_RANGE + (enemy.r || 0)) candidates.push({ enemy, distance });
    }
    candidates.sort(
      (a, b) =>
        a.distance - b.distance ||
        b.enemy.progress - a.enemy.progress ||
        a.enemy.id - b.enemy.id
    );
    for (const { enemy } of candidates.slice(0, SKILL_METEOR_CHAIN_MAX)) {
      const pct = ev.dmgPct * SKILL_METEOR_CHAIN_RATIO;
      this.skillDamage(enemy, this.skillPctDamage(enemy, pct, SKILLS.meteor.bossFactor));
      this.addSkillFx({
        kind: 'ember',
        x: enemy.x,
        y: enemy.y,
        r: 0.6,
        ttl: 0.4,
        color: SKILLS.meteor.color,
      });
    }
  }

  // 时之终章：瞬发星辉 + 星痕易伤 + 时停 + 全塔过载。
  castChrono(stats, now) {
    const level = this.skill.level;
    const bossFactor = SKILLS.chrono.bossFactor;

    for (const enemy of this.skillTargets()) {
      if (enemy.dead) continue;
      this.skillDamage(enemy, this.skillPctDamage(enemy, stats.novaPct, bossFactor));
    }

    // 星痕易伤：L7 的 +3s 已包含在 stats.vulnDur 中，不再重复叠加。
    const vulnUntil = now + stats.vulnDur;
    for (const enemy of this.skillTargets()) {
      if (enemy.dead) continue;
      enemy.skillVuln = Math.max(enemy.skillVuln || 0, stats.vuln);
      enemy.skillVulnUntil = Math.max(enemy.skillVulnUntil || 0, vulnUntil);
    }

    // 时停从此刻开始；L10 击杀可延长（见 onSkillKill）。
    this.stasis = {
      until: now + stats.stop,
      baseUntil: now + stats.stop,
      bonus: 0,
    };
    // L4 迟滞：时停期间攻速额外 +20%；射程固定 +1 格（会与塔数量相乘的因子不翻倍）。
    const atk = stats.atkSpeed + (level >= 4 ? 0.2 : 0);
    this.applyTowerOverdrive(now + stats.stop, atk, stats.range);

    const field = this.skillField();
    this.addSkillFx({ kind: 'chronoNova', x: field.x, y: field.y, r: field.r, ttl: 1.2, color: SKILLS.chrono.color });
    this.addSkillFx({ kind: 'stasis', x: field.x, y: field.y, r: field.r, ttl: stats.stop, color: SKILLS.chrono.color });
  }

  isStasisActive() {
    return !!this.stasis && this.time < this.stasis.until;
  }

  // 冷却只在 update（战斗阶段）递减；陨星落点与时停结束也在这里按模拟时间结算。
  updateSkill(dt) {
    if (this.skill && this.skill.cooldown > 0) {
      this.skill.cooldown = Math.max(0, this.skill.cooldown - dt);
    }
    const now = this.time;
    if (this.stasis && now >= this.stasis.until) this.endStasis();
    // 过载窗口结束：清掉塔字段并刷新属性缓存，避免攻速/射程一直停留在加成值。
    if (this.towerOverdrive && now >= this.towerOverdrive.until) {
      this.towerOverdrive = null;
      for (const tower of this.towers) {
        if ((tower.skillOverdriveUntil || 0) > 0) this.clearTowerOverdrive(tower);
      }
    }
    if (!this.skillPending.length) return;

    const due = [];
    const pending = [];
    for (const ev of this.skillPending) {
      if (ev.at <= now) due.push(ev);
      else pending.push(ev);
    }
    this.skillPending = pending;
    for (const ev of due) {
      if (ev.type === 'meteor') this.resolveMeteor(ev);
    }
  }

  endStasis() {
    const stats = this.skill?.stats;
    this.stasis = null;
    if (stats) this.applyTowerOverdrive(this.time + stats.overdrive, stats.atkSpeed, stats.range);
    const field = this.skillField();
    this.addSkillFx({
      kind: 'overdrive',
      x: field.x,
      y: field.y,
      r: field.r,
      ttl: stats ? stats.overdrive : 0.1,
      color: SKILLS.chrono.color,
    });
  }

  applyTowerOverdrive(until, atk, range) {
    this.towerOverdrive = { until, atk, range };
    for (const tower of this.towers) {
      tower.skillOverdriveUntil = until;
      tower.skillOverdriveAtk = atk;
      tower.skillOverdriveRange = range;
      this.refreshTowerStats(tower);
    }
  }

  inheritTowerOverdrive(tower) {
    const overdrive = this.towerOverdrive;
    if (!overdrive || this.time >= overdrive.until) return;
    tower.skillOverdriveUntil = overdrive.until;
    tower.skillOverdriveAtk = overdrive.atk;
    tower.skillOverdriveRange = overdrive.range;
  }

  clearTowerOverdrive(tower) {
    tower.skillOverdriveUntil = 0;
    tower.skillOverdriveAtk = 0;
    tower.skillOverdriveRange = 0;
    this.refreshTowerStats(tower);
  }

  // 里程碑击杀钩子：极光终章冰晶、终章延时。
  onSkillKill(enemy) {
    const skill = this.skill;
    if (!skill) return;
    const now = this.time;

    if (skill.id === 'aurora' && skill.level >= 10 && now < (enemy.freezeUntil || 0)) {
      const radius = 1;
      const x = enemy.x;
      const y = enemy.y;
      const bossFactor = SKILLS.aurora.bossFactor;
      for (const other of this.skillTargets()) {
        if (other.dead) continue;
        if (Math.hypot(other.x - x, other.y - y) > radius + (other.r || 0)) continue;
        this.skillDamage(other, this.skillPctDamage(other, 0.04, bossFactor));
        other.slowAmt = Math.max(other.slowAmt, 0.2);
        other.slowUntil = Math.max(other.slowUntil, now + 2);
      }
      this.addSkillFx({ kind: 'iceCrystal', x, y, r: radius, ttl: 0.5, color: SKILLS.aurora.color });
    }

    if (skill.id === 'chrono' && skill.level >= 10 && this.stasis && now < this.stasis.until) {
      const bonus = this.stasis.bonus || 0;
      if (bonus < SKILL_STASIS_MAX_EXTEND) {
        const extend = Math.min(SKILL_STASIS_KILL_EXTEND, SKILL_STASIS_MAX_EXTEND - bonus);
        this.stasis.bonus = bonus + extend;
        this.stasis.until += extend;
        // 时停延长时，过载窗口同步延长到新的时停结束。
        const overdrive = this.towerOverdrive;
        if (overdrive && now < overdrive.until) {
          overdrive.until += extend;
          for (const tower of this.towers) {
            tower.skillOverdriveUntil = overdrive.until;
            this.refreshTowerStats(tower);
          }
        }
      }
    }
  }

  // 全场技能（极光帘幕、时停穹顶）的表现中心与覆盖半径：地图中心 + 半对角线。
  skillField() {
    const cols = this.map.cols || 22;
    const rows = this.map.rows || 12;
    return {
      x: cols / 2,
      y: rows / 2,
      r: Math.hypot(cols, rows) / 2,
    };
  }

  // 确定性目标顺序：progress 降序、id 升序（与服务端/渲染层同一套顺序）。
  skillTargets() {
    return this.enemies
      .filter((enemy) => !enemy.dead)
      .sort((a, b) => b.progress - a.progress || a.id - b.id);
  }

  nearestSkillTarget(x, y, radius, excludeId = null) {
    let best = null;
    let bestDistance = Infinity;
    for (const enemy of this.skillTargets()) {
      if (enemy.id === excludeId) continue;
      const distance = Math.hypot(enemy.x - x, enemy.y - y);
      if (distance <= radius + (enemy.r || 0) && distance < bestDistance) {
        best = enemy;
        bestDistance = distance;
      }
    }
    return best;
  }

  // 技能伤害：最大生命百分比 × 首领效率，不吃暴击、不走护甲/战斗 RNG。
  skillPctDamage(enemy, pct, bossFactor = 1) {
    if (!enemy || !(pct > 0)) return 0;
    return enemy.maxHp * pct * (enemy.boss ? bossFactor : 1);
  }

  skillDamage(enemy, amount, { dot = false } = {}) {
    if (!enemy || enemy.dead || !(amount > 0)) return 0;
    enemy.hp -= amount;
    if (!dot) enemy.hitFlash = 1;
    if (enemy.hp <= 0) this.killEnemy(enemy);
    return amount;
  }

  addSkillFx(event) {
    event.maxTtl = event.ttl;
    this.skillFx.push(event);
    if (this.skillFx.length > 96) this.skillFx.splice(0, this.skillFx.length - 96);
  }

  // ---------- 存档 / HUD ----------

  toSnapshot() {
    return toSnapshot(this);
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
    const endless = this.mode === 'endless';
    if (!endless && next > MAX_WAVE) return null;
    const meta = this.map?.meta || {};
    const key = `${next}|${this.difficulty}|${meta.modifier?.id || ''}|${meta.portalCount || 1}|${this.mode}`;
    if (this._previewCache?.key === key) return this._previewCache.value;
    const def = generateWave(
      this.seed,
      next,
      this.difficulty,
      {
        portalCount: meta.portalCount || 1,
        modifier: meta.modifier || null,
      },
      { endless }
    );
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
      skill: this.skill
        ? { id: this.skill.id, level: this.skill.level, cooldown: this.skill.cooldown }
        : null,
      difficulty: this.difficulty,
      mode: this.mode,
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
