// 主动技能：冷却/释放、极光冻结、陨星落点、时停与全塔过载。
import { SKILLS, skillStats } from '../shared/data.js';
import { pushImpactEvent } from '../shared/impact-events.js';
import { RNG } from '../shared/rng.js';

// 主动技能常量：落点间距、预警时长、余烬连锁范围。
const SKILL_METEOR_WARNING = 0.55;
const SKILL_METEOR_SPACING = 2.5;
const SKILL_METEOR_CHAIN_RANGE = 2.5;
const SKILL_METEOR_CHAIN_MAX = 4;
const SKILL_METEOR_CHAIN_RATIO = 0.35;
const SKILL_STASIS_MAX_EXTEND = 1;
const SKILL_STASIS_KILL_EXTEND = 0.1;

// 技能效果幅度键（skillPower 乘进的字段）：冷却 cd、颗数 meteors 与固定乘法因子 atkSpeed/range
// 不随幅度缩放（skills.js「攻击速度/射程这类乘法因子固定」）。skillCd 只乘进 cd。
const SKILL_POWER_KEYS = [
  'freeze', 'vuln', 'slow', 'slowDur', 'shatter',
  'dmgPct', 'burnPct', 'radius',
  'stop', 'overdrive', 'novaPct', 'vulnDur',
];

export class SkillSystem {
  constructor(sim) {
    this.sim = sim;
  }

  // 天赋技能接线（死节点修复）：把 sim.mods 里的 skillCd/skillPower 折叠进技能属性。
  // skillCd（负值缩减）乘进 cd 并钳到 ≥0；skillPower（正值放大）乘进幅度键（SKILL_POWER_KEYS）。
  // 返回浅拷贝，绝不改写 skillStats 返回的共享 def.levels[lv-1] 引用。
  applyTalentSkillMods(stats) {
    const out = { ...stats };
    const skillCd = Number(this.sim.mods?.skillCd) || 0;
    const skillPower = Number(this.sim.mods?.skillPower) || 0;
    if (out.cd !== undefined) {
      out.cd = Math.max(0, Number(out.cd) * (1 + skillCd));
    }
    if (skillPower) {
      for (const key of SKILL_POWER_KEYS) {
        if (out[key] !== undefined) out[key] = Number(out[key]) * (1 + skillPower);
      }
    }
    return out;
  }

  initSkill(opts = {}) {
    const config = opts.skill;
    if (!config || typeof config.id !== 'string') return;
    const def = SKILLS[config.id];
    if (!def) return;
    const level = Math.max(1, Math.min(def.levels.length, Math.floor(Number(config.level) || 1)));
    const stats = this.applyTalentSkillMods(skillStats(def.id, level));
    let cooldown = Number(config.cooldown);
    if (!Number.isFinite(cooldown)) cooldown = 0;
    const readyAt = Number(opts.skillReadyAt ?? config.readyAt);
    if (Number.isFinite(readyAt) && readyAt > 0) {
      // 按真实时间扣减，并钳到 [0, 冷却]：防止“放大招 → 刷新 → 重打本波”。
      // skillSpeed：外层若记录的是按倍速换算过的真实时间，用当前倍速换回模拟秒。
      const speed = Math.max(0.25, Number(opts.skillSpeed) || 1);
      cooldown = ((readyAt - Date.now()) / 1000) * speed;
    }
    this.sim.skill = {
      id: def.id,
      level,
      stats,
      cooldown: Math.max(0, Math.min(stats.cd, cooldown)),
    };
  }

  isSkillReady() {
    return !!this.sim.skill && this.sim.skill.cooldown <= 0 && this.sim.phase === 'wave' && !this.sim.paused;
  }

  castSkill() {
    const skill = this.sim.skill;
    if (!skill) return false;
    if (this.sim.phase !== 'wave' || this.sim.paused) return false;
    if (skill.cooldown > 0) return false;

    const stats = skill.stats;
    skill.cooldown = stats.cd;
    this.sim.skillCastCount += 1;
    // 独立种子流：技能不碰 combatRng，战斗随机序列保持不变。
    this.sim.skillRng = new RNG(`${this.sim.seed}:skill:${this.sim.wave}:${this.sim.skillCastCount}`);
    this.sim.skillCastState = { meteorExtraUsed: false, meteorCenters: [] };
    const now = this.sim.time;

    if (skill.id === 'aurora') this.sim.castAurora(stats, now);
    else if (skill.id === 'meteor') this.sim.castMeteor(stats, now);
    else if (skill.id === 'chrono') this.sim.castChrono(stats, now);

    // 外层立即落一份含 skill.cooldown 的快照并补 skillReadyAt（epoch）。
    const snapshot = this.sim.toSnapshot();
    snapshot.skillReadyAt = Date.now() + skill.cooldown * 1000;
    this.sim.opts.onSkillCast?.(snapshot);
    return true;
  }

  // 霜月·极光：全场冻结 + 冻结易伤，解冻时碎晶并附加减速。
  castAurora(stats, now) {
    const level = this.sim.skill.level;
    const targets = this.sim.skillTargets();
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
    const field = this.sim.skillField();
    this.sim.addSkillFx({ kind: 'aurora', x: field.x, y: field.y, r: field.r, ttl: 2.4, color: SKILLS.aurora.color });
  }

  // 每帧状态推进：解冻结算、灼烧跳伤；时停期间暂停中毒/灼烧计时。
  updateEnemySkillStatus(enemy, dt, now, stasisActive) {
    if (enemy.freezeUntil > 0 && now >= enemy.freezeUntil) this.sim.resolveThaw(enemy, now);
    if (enemy.dead) return;

    if (stasisActive) {
      if (enemy.burnUntil > now) enemy.burnUntil += dt;
      if (enemy.poisonUntil > now) enemy.poisonUntil += dt;
      return;
    }

    if (enemy.burnUntil > now && enemy.burnDps > 0) {
      this.sim.skillDamage(enemy, enemy.burnDps * dt, { dot: true });
    }
  }

  resolveThaw(enemy, now) {
    const shatter = enemy.freezeShatter || 0;
    const slow = enemy.freezeSlow || 0;
    const slowDur = enemy.freezeSlowDur || 0;
    const level = this.sim.skill?.id === 'aurora' ? this.sim.skill.level : 0;
    const bossFactor = SKILLS.aurora.bossFactor;

    enemy.freezeUntil = 0;
    enemy.freezeVuln = 0;
    enemy.freezeVulnUntil = 0;
    enemy.freezeSlow = 0;
    enemy.freezeSlowDur = 0;
    enemy.freezeShatter = 0;
    // 霜缚 T3：解冻后 duration 秒内受伤 +mult（复用 freezeVuln/freezeVulnUntil 的易伤语义）。
    const freezeVulnMod = this.sim.factions?.setMods?.freezeVulnerable;
    if (freezeVulnMod) {
      enemy.freezeVuln = freezeVulnMod.mult;
      enemy.freezeVulnUntil = now + freezeVulnMod.duration;
    }

    const amount = this.sim.skillPctDamage(enemy, shatter, bossFactor);
    if (amount > 0) {
      const x = enemy.x;
      const y = enemy.y;
      const id = enemy.id;
      this.sim.skillDamage(enemy, amount);
      this.sim.addSkillFx({ kind: 'shatter', x, y, r: 0.5, ttl: 0.4, color: SKILLS.aurora.color });
      // L4 霜纹：25% 概率波及 0.8 格内另一名敌人（50% 碎晶伤害）。
      if (level >= 4) {
        const roll = this.sim.skillRng ? this.sim.skillRng.float() : 1;
        if (roll < 0.25) {
          const other = this.sim.nearestSkillTarget(x, y, 0.8, id);
          if (other) {
            this.sim.skillDamage(other, this.sim.skillPctDamage(other, shatter * 0.5, bossFactor));
            this.sim.addSkillFx({ kind: 'frostTrace', x: other.x, y: other.y, r: 0.8, ttl: 0.4, color: SKILLS.aurora.color });
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
    const level = this.sim.skill.level;
    this.sim.skillCastState = { meteorExtraUsed: false, meteorCenters: [] };
    const points = this.sim.pickMeteorPoints(stats, stats.meteors, level);
    for (const point of points) this.sim.queueMeteor(point, stats, now);
    const field = this.sim.skillField();
    this.sim.addSkillFx({ kind: 'meteorCast', x: field.x, y: field.y, r: field.r, ttl: 0.8, color: SKILLS.meteor.color });
  }

  // 选点：按敌人位置做密度评分，陨星之间强制 2.5 格分簇。
  // 候选顺序固定为 progress 降序、id 升序，保证同种子结果一致。
  pickMeteorPoints(stats, count, level, avoid = []) {
    const candidates = this.sim.skillTargets();
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
        if (!(this.sim.time < (other.burnUntil || 0) && other.burnDps > 0)) unburned++;
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
    if (this.sim.skillCastState) this.sim.skillCastState.meteorCenters.push({ x: point.x, y: point.y });
    this.sim.skillPending.push({
      type: 'meteor',
      at: now + SKILL_METEOR_WARNING,
      x: point.x,
      y: point.y,
      r: stats.radius,
      dmgPct: stats.dmgPct,
      burnPct: stats.burnPct,
      level: this.sim.skill?.level || 1,
    });
    this.sim.addSkillFx({
      kind: 'meteorWarn',
      x: point.x,
      y: point.y,
      r: stats.radius,
      ttl: SKILL_METEOR_WARNING,
      color: SKILLS.meteor.color,
    });
  }

  resolveMeteor(ev) {
    const now = this.sim.time;
    const bossFactor = SKILLS.meteor.bossFactor;
    const hit = [];
    for (const enemy of this.sim.skillTargets()) {
      if (enemy.dead) continue;
      if (Math.hypot(enemy.x - ev.x, enemy.y - ev.y) > ev.r + (enemy.r || 0) * 0.4) continue;
      const wasBurning = enemy.burnUntil > now && enemy.burnDps > 0;
      this.sim.skillDamage(enemy, this.sim.skillPctDamage(enemy, ev.dmgPct, bossFactor));
      if (!enemy.dead) {
        const previous = enemy.burnUntil > now ? enemy.burnDps || 0 : 0;
        enemy.burnDps = Math.max(previous, (enemy.maxHp * ev.burnPct) / 3);
        enemy.burnUntil = Math.max(enemy.burnUntil || 0, now + 3);
      }
      hit.push({ enemy, wasBurning });
    }
    this.sim.addSkillFx({ kind: 'meteor', x: ev.x, y: ev.y, r: ev.r, ttl: 0.55, color: SKILLS.meteor.color });

    // L10 天火终章：命中已灼烧目标触发余烬连锁（35% 伤害，最多 4 个）。
    if (ev.level >= 10 && hit.some((entry) => entry.wasBurning)) this.sim.emberChain(ev, hit);

    // L7 流火：单次落点命中 ≥10 敌，额外落 1 颗（每次释放最多 1 颗）。
    if (
      ev.level >= 7 &&
      hit.length >= 10 &&
      this.sim.skill &&
      this.sim.skillCastState &&
      !this.sim.skillCastState.meteorExtraUsed
    ) {
      this.sim.skillCastState.meteorExtraUsed = true;
      const centers = this.sim.skillCastState.meteorCenters || [];
      const extra = this.sim.pickMeteorPoints(this.sim.skill.stats, 1, this.sim.skill.level, centers);
      if (extra[0]) this.sim.queueMeteor(extra[0], this.sim.skill.stats, now);
    }
  }

  emberChain(ev, hit) {
    const hitIds = new Set(hit.map((entry) => entry.enemy.id));
    const candidates = [];
    for (const enemy of this.sim.skillTargets()) {
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
      this.sim.skillDamage(enemy, this.sim.skillPctDamage(enemy, pct, SKILLS.meteor.bossFactor));
      this.sim.addSkillFx({
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
    const level = this.sim.skill.level;
    const bossFactor = SKILLS.chrono.bossFactor;

    for (const enemy of this.sim.skillTargets()) {
      if (enemy.dead) continue;
      this.sim.skillDamage(enemy, this.sim.skillPctDamage(enemy, stats.novaPct, bossFactor));
    }

    // 星痕易伤：L7 的 +3s 已包含在 stats.vulnDur 中，不再重复叠加。
    const vulnUntil = now + stats.vulnDur;
    for (const enemy of this.sim.skillTargets()) {
      if (enemy.dead) continue;
      enemy.skillVuln = Math.max(enemy.skillVuln || 0, stats.vuln);
      enemy.skillVulnUntil = Math.max(enemy.skillVulnUntil || 0, vulnUntil);
    }

    // 时停从此刻开始；L10 击杀可延长（见 onSkillKill）。
    this.sim.stasis = {
      until: now + stats.stop,
      baseUntil: now + stats.stop,
      bonus: 0,
    };
    // L4 迟滞：时停期间攻速额外 +20%；射程固定 +1 格（会与塔数量相乘的因子不翻倍）。
    const atk = stats.atkSpeed + (level >= 4 ? 0.2 : 0);
    this.sim.applyTowerOverdrive(now + stats.stop, atk, stats.range);

    const field = this.sim.skillField();
    this.sim.addSkillFx({ kind: 'chronoNova', x: field.x, y: field.y, r: field.r, ttl: 1.2, color: SKILLS.chrono.color });
    this.sim.addSkillFx({ kind: 'stasis', x: field.x, y: field.y, r: field.r, ttl: stats.stop, color: SKILLS.chrono.color });
  }

  isStasisActive() {
    return !!this.sim.stasis && this.sim.time < this.sim.stasis.until;
  }

  // 冷却只在 update（战斗阶段）递减；陨星落点与时停结束也在这里按模拟时间结算。
  updateSkill(dt) {
    if (this.sim.skill && this.sim.skill.cooldown > 0) {
      this.sim.skill.cooldown = Math.max(0, this.sim.skill.cooldown - dt);
    }
    const now = this.sim.time;
    if (this.sim.stasis && now >= this.sim.stasis.until) this.sim.endStasis();
    // 过载窗口结束：清掉塔字段并刷新属性缓存，避免攻速/射程一直停留在加成值。
    if (this.sim.towerOverdrive && now >= this.sim.towerOverdrive.until) {
      this.sim.towerOverdrive = null;
      for (const tower of this.sim.towers) {
        if ((tower.skillOverdriveUntil || 0) > 0) this.sim.clearTowerOverdrive(tower);
      }
    }
    if (!this.sim.skillPending.length) return;

    const due = [];
    const pending = [];
    for (const ev of this.sim.skillPending) {
      if (ev.at <= now) due.push(ev);
      else pending.push(ev);
    }
    this.sim.skillPending = pending;
    for (const ev of due) {
      if (ev.type === 'meteor') this.sim.resolveMeteor(ev);
    }
  }

  endStasis() {
    const stats = this.sim.skill?.stats;
    this.sim.stasis = null;
    if (stats) this.sim.applyTowerOverdrive(this.sim.time + stats.overdrive, stats.atkSpeed, stats.range);
    const field = this.sim.skillField();
    this.sim.addSkillFx({
      kind: 'overdrive',
      x: field.x,
      y: field.y,
      r: field.r,
      ttl: stats ? stats.overdrive : 0.1,
      color: SKILLS.chrono.color,
    });
  }

  applyTowerOverdrive(until, atk, range) {
    this.sim.towerOverdrive = { until, atk, range };
    for (const tower of this.sim.towers) {
      tower.skillOverdriveUntil = until;
      tower.skillOverdriveAtk = atk;
      tower.skillOverdriveRange = range;
      this.sim.refreshTowerStats(tower);
    }
  }

  inheritTowerOverdrive(tower) {
    const overdrive = this.sim.towerOverdrive;
    if (!overdrive || this.sim.time >= overdrive.until) return;
    tower.skillOverdriveUntil = overdrive.until;
    tower.skillOverdriveAtk = overdrive.atk;
    tower.skillOverdriveRange = overdrive.range;
  }

  clearTowerOverdrive(tower) {
    tower.skillOverdriveUntil = 0;
    tower.skillOverdriveAtk = 0;
    tower.skillOverdriveRange = 0;
    this.sim.refreshTowerStats(tower);
  }

  // 里程碑击杀钩子：极光终章冰晶、终章延时。
  onSkillKill(enemy) {
    const skill = this.sim.skill;
    if (!skill) return;
    const now = this.sim.time;

    if (skill.id === 'aurora' && skill.level >= 10 && now < (enemy.freezeUntil || 0)) {
      const radius = 1;
      const x = enemy.x;
      const y = enemy.y;
      const bossFactor = SKILLS.aurora.bossFactor;
      for (const other of this.sim.skillTargets()) {
        if (other.dead) continue;
        if (Math.hypot(other.x - x, other.y - y) > radius + (other.r || 0)) continue;
        this.sim.skillDamage(other, this.sim.skillPctDamage(other, 0.04, bossFactor));
        other.slowAmt = Math.max(other.slowAmt, 0.2);
        other.slowUntil = Math.max(other.slowUntil, now + 2);
      }
      this.sim.addSkillFx({ kind: 'iceCrystal', x, y, r: radius, ttl: 0.5, color: SKILLS.aurora.color });
    }

    if (skill.id === 'chrono' && skill.level >= 10 && this.sim.stasis && now < this.sim.stasis.until) {
      const bonus = this.sim.stasis.bonus || 0;
      if (bonus < SKILL_STASIS_MAX_EXTEND) {
        const extend = Math.min(SKILL_STASIS_KILL_EXTEND, SKILL_STASIS_MAX_EXTEND - bonus);
        this.sim.stasis.bonus = bonus + extend;
        this.sim.stasis.until += extend;
        // 时停延长时，过载窗口同步延长到新的时停结束。
        const overdrive = this.sim.towerOverdrive;
        if (overdrive && now < overdrive.until) {
          overdrive.until += extend;
          for (const tower of this.sim.towers) {
            tower.skillOverdriveUntil = overdrive.until;
            this.sim.refreshTowerStats(tower);
          }
        }
      }
    }
  }

  // 全场技能（极光帘幕、时停穹顶）的表现中心与覆盖半径：地图中心 + 半对角线。
  skillField() {
    const cols = this.sim.map.cols || 22;
    const rows = this.sim.map.rows || 12;
    return {
      x: cols / 2,
      y: rows / 2,
      r: Math.hypot(cols, rows) / 2,
    };
  }

  // 确定性目标顺序：progress 降序、id 升序（与服务端/渲染层同一套顺序）。
  skillTargets() {
    return this.sim.enemies
      .filter((enemy) => !enemy.dead)
      .sort((a, b) => b.progress - a.progress || a.id - b.id);
  }

  nearestSkillTarget(x, y, radius, excludeId = null) {
    let best = null;
    let bestDistance = Infinity;
    for (const enemy of this.sim.skillTargets()) {
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

  skillDamage(enemy, amount, { dot = false, source = null, weapon = null } = {}) {
    if (!enemy || enemy.dead || !(amount > 0)) return 0;
    enemy.hp -= amount;
    const lethal = enemy.hp <= 0;
    if (!dot) enemy.hitFlash = 1;
    // 先记事件再结算死亡：击杀钩子可能连锁产生后续事件。
    // 技能伤害不走护甲/护盾/暴击，事件里这两项恒为 0；灼烧跳伤另标 source='burn'。
    pushImpactEvent(this.sim, {
      t: this.sim.time,
      x: enemy.x,
      y: enemy.y,
      target: { id: enemy.id, type: enemy.type },
      weapon: weapon ?? this.sim.skill?.id ?? 'skill',
      source: source ?? (dot ? 'burn' : 'skill'),
      towerId: null,
      amount,
      armorAbsorbed: 0,
      shieldAbsorbed: 0,
      hpLost: amount,
      crit: false,
      lethal,
    });
    if (lethal) this.sim.killEnemy(enemy, amount);
    return amount;
  }

  addSkillFx(event) {
    event.maxTtl = event.ttl;
    this.sim.skillFx.push(event);
    if (this.sim.skillFx.length > 96) this.sim.skillFx.splice(0, this.sim.skillFx.length - 96);
  }
}
