// 波次导演：开波、按时间召唤、生成敌人与清波结算。
import { ENEMIES, MAX_WAVE } from '../shared/data.js';
import { BOSS_VARIANTS, ENDLESS_BOSS_AFFIXES } from '../shared/data/enemies.js';
import { applyPeriodicWaveEffects } from '../shared/effects.js';
import { RNG } from '../shared/rng.js';
import { generateWave } from '../shared/waves.js';

export class WaveDirector {
  constructor(sim) {
    this.sim = sim;
  }

  beginWave(waveDef) {
    if (this.sim.phase !== 'prep' || !waveDef) return false;
    // 进入战斗前先落一份"该波开始前"的快照：战斗中刷新可重放本波。
    this.sim.savePreWave();
    this.sim.waveDef = waveDef;
    this.sim.wave = waveDef.index;
    this.sim.phase = 'wave';
    this.sim.paused = false;
    this.sim.placementType = null;
    this.sim.waveTime = 0;
    this.sim.spawnIndex = 0;
    this.sim.spawnQueue = [];
    this.sim.combatRng = new RNG(`${this.sim.seed}:combat:${waveDef.index}`);

    // 技能状态跨波保留（冷却继续走），但时停/待落陨星/过载属于当前波。
    this.sim.skillPending = [];
    this.sim.skillCastState = null;
    this.sim.stasis = null;
    if (this.sim.towerOverdrive) {
      this.sim.towerOverdrive = null;
      for (const tower of this.sim.towers) this.sim.clearTowerOverdrive(tower);
    }

    for (const group of waveDef.groups) {
      const portal = Number.isInteger(group.portal) ? group.portal : 0;
      for (let i = 0; i < group.count; i++) {
        this.sim.spawnQueue.push({
          type: group.type,
          time: group.delay + i * group.interval,
          portal,
          hpMul: group.hpMul,
        });
      }
    }
    this.sim.spawnQueue.sort((a, b) => a.time - b.time);
    this.sim.activePortals = Array.isArray(waveDef.portals) && waveDef.portals.length
      ? waveDef.portals.slice()
      : [...new Set(waveDef.groups.map((group) => group.portal || 0))];
    this.sim.hexCall('onWaveStart', waveDef.index, this.sim.hexCtx);
    this.sim.playSound(waveDef.boss ? 'boss' : 'wave');
    return true;
  }

  spawnDue() {
    while (
      this.sim.spawnIndex < this.sim.spawnQueue.length &&
      this.sim.spawnQueue[this.sim.spawnIndex].time <= this.sim.waveTime
    ) {
      const item = this.sim.spawnQueue[this.sim.spawnIndex++];
      this.sim.spawnEnemy(item.type, item.portal || 0, item.hpMul ?? null);
    }
  }

  // hpMul 允许按群组覆盖（首领使用独立血量曲线）；progress 用于首领召唤。
  spawnEnemy(type, laneIndex = 0, hpMulOverride = null, progress = 0) {
    const base = ENEMIES[type];
    const hpMul = hpMulOverride ?? this.sim.waveDef?.hpMul ?? 1;
    const speedMul = this.sim.waveDef?.speedMul || 1;
    const variant = base.boss ? BOSS_VARIANTS[this.sim.waveDef?.bossVariant] || null : null;
    // 深渊首领词条：仅无尽模式首领波携带，普通模式 waveDef 无此字段 → 命中全为 0。
    const affixes = base.boss ? this.sim.waveDef?.bossAffixes || null : null;
    const stacks = (id) => Math.max(0, Math.floor(affixes?.[id] || 0));
    // 诅咒图腾的存活光环：生命加成只在生成时结算（拆除后已生成敌人不回滚）。
    const hp = Math.max(
      1,
      Math.round(base.hp * hpMul * (variant?.hpMul || 1) * this.sim.destructibleAura().hpMul)
    );
    const shieldStacks = stacks('shield');
    const splitStacks = stacks('split');
    const frenzyStacks = stacks('frenzy');
    const shield =
      (base.shield || 0) +
      Math.round(hp * ENDLESS_BOSS_AFFIXES.shield.shieldPct * shieldStacks);
    const splits =
      base.splits ||
      (splitStacks > 0
        ? {
            type: ENDLESS_BOSS_AFFIXES.split.splitType,
            count: ENDLESS_BOSS_AFFIXES.split.splitPerStack * splitStacks,
          }
        : null);
    const frenzyMul = 1 + frenzyStacks * ENDLESS_BOSS_AFFIXES.frenzy.speedPerStack;
    const lane = Math.max(0, Math.min(this.sim.lanes.length - 1, laneIndex || 0));
    const pos = this.sim.posAt(progress, lane);
    this.sim.enemies.push({
      id: this.sim.nextId++,
      type,
      variant: variant?.id || null,
      hp,
      maxHp: hp,
      armor: base.armor + (variant?.armorBonus || 0),
      baseSpeed: base.speed * speedMul * (variant?.speedMul || 1) * frenzyMul,
      affixes: affixes ? { ...affixes } : null,
      r: base.r,
      gold: base.gold,
      dmg: base.dmg,
      flying: !!base.flying,
      boss: !!base.boss,
      heal: base.heal || 0,
      healRange: base.healRange || 0,
      healTimer: 0,
      // 机制型敌人：护盾优先吸收伤害，分裂死亡生成子怪，光环加速友军，远程攻击塔/基地。
      shield,
      maxShield: shield,
      splits,
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
    this.sim.addEffect({ kind: 'spawn', x: pos.x, y: pos.y, ttl: 0.4, color: base.color });
  }

  // 在指定进度处生成敌人（首领召唤用），血量沿用普通波次曲线。
  spawnEnemyAt(type, lane, progress) {
    this.sim.spawnEnemy(type, lane, null, Math.max(0, progress));
  }

  completeWave() {
    if (this.sim.phase !== 'wave' || !this.sim.waveDef) return;
    const goldMul = this.sim.modifier?.goldMul || 1;
    const reward = Math.round(this.sim.waveDef.reward * goldMul);
    const interest = this.sim.mods.interest ? Math.floor(this.sim.gold * this.sim.mods.interest) : 0;
    this.sim.gold += reward + interest;
    // 回合型遗物在波末按注册表周期结算；纯状态读写，不消耗随机数。
    const periodic = applyPeriodicWaveEffects(this.sim, this.sim.wave);
    // 海克斯波末结算：先让钩子读到本波临时 mod，再统一清理（临时 mod 不跨波）。
    if (this.sim.hexRuntime.active) {
      this.sim.hexCall('onWaveEnd', this.sim.wave, this.sim.hexCtx);
      if (this.sim.hexRuntime.hasTempMods) {
        this.sim.hexRuntime.clearTempMods();
        this.sim.recomputeMods();
      }
    }
    const cleared = this.sim.wave;
    this.sim.waveDef = null;
    this.sim.clearedWave = cleared;

    // 无尽模式不清算通关：第 30 波后继续生成递增波次，直到基地被摧毁。
    if (this.sim.mode !== 'endless' && cleared >= MAX_WAVE) {
      this.sim.gameOver(true);
      return;
    }

    // 第 5/10/15/20/25 波结束后进入事件阶段；结算前不推进下一波。
    this.sim.pendingEvent = this.sim.computePendingEvent();
    this.sim.phase = this.sim.pendingEvent ? 'event' : 'prep';
    // 时停/待落陨星/过载都属于进行中的这一波，清波即收起。
    this.sim.stasis = null;
    this.sim.skillPending = [];
    this.sim.towerOverdrive = null;
    for (const tower of this.sim.towers) this.sim.clearTowerOverdrive(tower);
    // 快照由调用方在服务端确认清波后写入，避免清波未确认时重复领奖。
    this.sim.opts.onWaveClear?.(cleared, { reward, interest, periodic });
  }

  currentWaveHpMul() {
    if (this.sim.waveDef?.hpMul) return this.sim.waveDef.hpMul;
    const next = this.sim.clearedWave + 1;
    const endless = this.sim.mode === 'endless';
    if (!endless && next > MAX_WAVE) return 1;
    const meta = this.sim.map?.meta || {};
    const def = generateWave(
      this.sim.seed,
      next,
      this.sim.difficulty,
      { portalCount: meta.portalCount || 1, modifier: meta.modifier || null },
      { endless }
    );
    return def?.hpMul ?? 1;
  }

  // 把格子中心投影到最近的车道上，返回该处的 { lane, progress }。
  // 虫巢生成用它把「巢穴位置」翻译成 spawnEnemy 认识的车道进度。
  laneProgressNear(c, r) {
    const x = c + 0.5;
    const y = r + 0.5;
    let best = { lane: 0, progress: 0, dist: Infinity };
    this.sim.lanes.forEach((lane, laneIndex) => {
      const pts = lane.pts;
      for (let i = 1; i < pts.length; i += 1) {
        const a = pts[i - 1];
        const b = pts[i];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const segLen = lane.cum[i] - lane.cum[i - 1];
        const t = segLen > 0
          ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (segLen * segLen)))
          : 0;
        const dist = Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t));
        if (dist < best.dist) {
          best = { lane: laneIndex, progress: lane.cum[i - 1] + segLen * t, dist };
        }
      }
    });
    return { lane: best.lane, progress: best.progress };
  }
}
