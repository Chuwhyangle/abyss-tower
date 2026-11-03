// 防御塔：建造/升级/进化/出售、索敌开火调度与稳定属性缓存。
import { TOWERS } from '../shared/data.js';
import { effectValue } from '../shared/effects.js';

export class TowerSystem {
  constructor(sim) {
    this.sim = sim;
  }

  updateTowers(dt) {
    for (const tower of this.sim.towers) {
      tower.cd = Math.max(0, tower.cd - dt);
      tower.recoil = Math.max(0, (tower.recoil || 0) - dt * 5);
      // 支援塔不索敌、不攻击，只通过 recomputeTowerStats 产生的光环影响其他塔。
      if (TOWERS[tower.type].support) {
        tower.target = null;
        continue;
      }
      // 被首领震击停摆：不索敌、不开火，冷却照常流逝。
      if (this.sim.time < (tower.disabledUntil || 0)) continue;
      // 稳定属性缓存在建造/升级/遗物变化时刷新，不在每个模拟步重建对象。
      const stats = tower.stats || this.sim.refreshTowerStats(tower);

      let target = tower.target;
      if (target && (target.dead || !this.sim.inRange(tower, target, stats.range))) target = null;
      if (!target) target = this.sim.findTarget(tower, stats.range);
      tower.target = target;

      if (target) {
        const desired = Math.atan2(target.y - tower.y, target.x - tower.x);
        tower.angle = lerpAngle(tower.angle, desired, Math.min(1, dt * 12));
        if (tower.cd <= 0) {
          // 开火瞬间重选：锁定只用于瞄准，出手按 progress 最大（同 progress 按 id 升序）重新选，
          // 让塔在正打肉盾时也能切去打更靠基地的快怪；只在开火时重选，瞄准不逐帧抖动。
          const fireTarget = this.sim.findTarget(tower, stats.range);
          if (!fireTarget) {
            // 锁定目标此刻已不可打（如冻结刚结束的飞行怪），清锁让下一帧重新索敌。
            tower.target = null;
          } else {
            this.sim.fire(tower, stats, fireTarget);
            tower.cd = 1 / stats.rate;
          }
        }
      }
    }
  }

  findTarget(tower, range) {
    const def = TOWERS[tower.type];
    const range2 = range * range;
    const now = this.sim.time;
    let best = null;
    for (const enemy of this.sim.enemies) {
      if (enemy.dead) continue;
      // 地面塔打不到飞行怪；飞行怪被冻结（坠地）时解除该限制（与 updateEnemies 的 frozen 判定一致）。
      const frozen = now < (enemy.freezeUntil || 0);
      if (def.groundOnly && enemy.flying && !frozen) continue;
      const dx = enemy.x - tower.x;
      const dy = enemy.y - tower.y;
      if (dx * dx + dy * dy > range2) continue;
      // 确定性索敌：progress 降序，同 progress 按 id 升序（与 skillTargets 同一口径）。
      if (!best || enemy.progress > best.progress || (enemy.progress === best.progress && enemy.id < best.id)) {
        best = enemy;
      }
    }
    return best;
  }

  inRange(tower, enemy, range) {
    const dx = enemy.x - tower.x;
    const dy = enemy.y - tower.y;
    return dx * dx + dy * dy <= range * range;
  }

  makeTower(type, c, r, level = 0, invested = 0, evolution = null, hpState = null) {
    const evolutions = normalizeEvolutionIds(evolution);
    const maxHp = normalizeTowerMaxHp(hpState?.maxHp);
    return {
      id: this.sim.nextId++,
      type,
      c,
      r,
      x: c + 0.5,
      y: r + 0.5,
      level,
      invested,
      // 进化分支：evolutions 是完整列表（独塔为王可兼得全部），evolution 保留首个以兼容旧读取方。
      evolution: evolutions[0] || null,
      evolutions,
      maxHp,
      hp: maxHp === null ? null : clampTowerHp(hpState?.hp, maxHp),
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

  // 建造费用：海克斯可改写数据表原价（如独塔为王 ×0.70），随后统一套用遗物 costMul 与下限。
  towerCost(type) {
    const def = TOWERS[type];
    const base = this.sim.hexRuntime.active
      ? this.sim.hexRuntime.buildCost(type, def.cost, this.sim.hexCtx)
      : def.cost;
    return Math.max(20, Math.round(base * (1 + (this.sim.mods.costMul || 0))));
  }

  // 等级上限：默认取数据表的等级数；独塔为王等海克斯可扩展。
  towerMaxLevel(tower) {
    const base = TOWERS[tower.type]?.levels?.length || 1;
    if (!this.sim.hexRuntime.active) return base;
    return this.sim.hexRuntime.towerMaxLevel(tower, base);
  }

  // base 是数据表里的原始升级费用（未乘 costMul）；扩展等级没有表行时 base 为 null，
  // 由 upgradeCost 钩子给出费用，模拟层再统一套用 costMul 与下限。
  upgradeCost(tower) {
    if (!tower) return null;
    const def = TOWERS[tower.type];
    if (!def) return null;
    if (tower.level >= this.sim.towerMaxLevel(tower) - 1) return null;
    const row = def.levels[tower.level + 1];
    const base = row ? row.cost : null;
    const cost = this.sim.hexRuntime.active
      ? this.sim.hexRuntime.upgradeCost(tower, base, this.sim.hexCtx)
      : base;
    if (cost == null) return null;
    const parsed = Number(cost);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(10, Math.round(parsed * (1 + (this.sim.mods.costMul || 0))));
  }

  sellValue(tower) {
    const base = 0.7;
    const ratio = this.sim.hexRuntime.active ? this.sim.hexRuntime.sellRatio(base) : base;
    return Math.floor(tower.invested * ratio);
  }

  towerAt(c, r) {
    return this.sim.towers.find((t) => t.c === c && t.r === r) || null;
  }

  // 显式给出 type 时才询问海克斯建造限制（镜像工程等）；UI 预览仍走纯地形判断。
  canBuild(c, r, type = null) {
    if (r < 0 || r >= this.sim.map.rows || c < 0 || c >= this.sim.map.cols) return false;
    if (!this.sim.map.buildable[r][c] || this.sim.towerAt(c, r)) return false;
    // 未拆除的可破坏物占格；拆除后同一格立刻恢复可建造。
    if (this.sim.destructibleAt(c, r)) return false;
    if (type && this.sim.hexRuntime.active && !this.sim.hexRuntime.canBuild(type, c, r, this.sim.hexCtx)) {
      return false;
    }
    return true;
  }

  // 统一移除入口：塔位由 towers 数组隐式释放，钩子与属性刷新都收敛在这里。
  removeTower(tower, reason = 'removed') {
    const index = this.sim.towers.indexOf(tower);
    if (index < 0) return false;
    this.sim.towers.splice(index, 1);
    if (this.sim.selectedTower === tower) this.sim.selectedTower = null;
    this.sim.hexCall('onTowerRemoved', tower, reason, this.sim.hexCtx);
    this.sim.recomputeTowerStats();
    return true;
  }

  // 塔生命：maxHp 为 null 表示无敌。归零时移除塔、释放塔位，并按存档规则写快照。
  damageTower(tower, amount) {
    if (!tower || tower.maxHp == null) return false;
    const damage = Number(amount);
    if (!Number.isFinite(damage) || damage <= 0) return false;
    if (!this.sim.towers.includes(tower)) return false;
    const maxHp = normalizeTowerMaxHp(tower.maxHp);
    tower.maxHp = maxHp;
    tower.hp = clampTowerHp((Number.isFinite(Number(tower.hp)) ? Number(tower.hp) : maxHp) - damage, maxHp);
    if (tower.hp > 0) {
      return false;
    }
    this.sim.removeTower(tower, 'destroyed');
    this.sim.addEffect({ kind: 'towerDestroy', x: tower.x, y: tower.y, ttl: 0.7, color: '#ff8a6b' });
    this.sim.addFloater(tower.x, tower.y - 0.4, '塔被摧毁', '#ff8a6b', true, { key: true });
    // 与其它局内状态一致：整备阶段立即落盘，波中由波前快照负责回滚重放。
    this.sim.save();
    return true;
  }

  placeTower(type, c, r) {
    if (!TOWERS[type]) return false;
    if (!this.sim.unlockedTowers.includes(type)) {
      this.sim.opts.onToast?.('该防御塔尚未解锁');
      return false;
    }
    if (!this.sim.canBuild(c, r, type)) {
      this.sim.opts.onToast?.('这里无法建造');
      return false;
    }
    const cost = this.sim.towerCost(type);
    if (this.sim.gold < cost) {
      this.sim.opts.onToast?.('金币不足');
      return false;
    }
    this.sim.gold -= cost;
    const tower = this.sim.makeTower(type, c, r, 0, cost);
    this.sim.inheritTowerOverdrive(tower);
    this.sim.towers.push(tower);
    // 建塔钩子先于属性重算：海克斯可在此写入塔生命上限等逐塔状态。
    this.sim.hexCall('onTowerBuilt', tower, this.sim.hexCtx);
    this.sim.recomputeTowerStats();
    this.sim.addEffect({ kind: 'place', x: c + 0.5, y: r + 0.5, ttl: 0.45, color: TOWERS[type].color });
    this.sim.playSound('place');
    this.sim.save();
    return true;
  }

  upgradeTower(tower) {
    const cost = this.sim.upgradeCost(tower);
    if (cost == null) return false;
    if (this.sim.gold < cost) {
      this.sim.opts.onToast?.('金币不足');
      return false;
    }
    this.sim.gold -= cost;
    tower.level += 1;
    tower.invested += cost;
    this.sim.hexCall('onTowerUpgraded', tower, this.sim.hexCtx);
    this.sim.recomputeTowerStats();
    this.sim.addEffect({ kind: 'place', x: tower.x, y: tower.y, ttl: 0.5, color: '#ffd36b' });
    this.sim.playSound('upgrade');
    this.sim.save();
    return true;
  }

  // ---------- 分支进化 ----------

  // 已生效的全部进化（独塔为王可兼得三条）；旧存档没有该字段时按未进化处理。
  towerEvolutions(tower) {
    const def = TOWERS[tower.type];
    if (!def?.evolutions) return [];
    const ids = normalizeEvolutionIds(tower.evolutions ?? tower.evolution);
    const entries = [];
    for (const id of ids) {
      const entry = def.evolutions.find((item) => item.id === id);
      if (entry) entries.push(entry);
    }
    return entries;
  }

  towerEvolution(tower) {
    return this.sim.towerEvolutions(tower)[0] || null;
  }

  // 满级且尚未选择分支时才可进化；进化不消耗 RNG，也不改变基础塔数值。
  canEvolve(tower) {
    const def = TOWERS[tower.type];
    if (!def?.evolutions?.length || normalizeEvolutionIds(tower.evolutions).length) return false;
    return tower.level >= this.sim.towerMaxLevel(tower) - 1;
  }

  // 默认给出数据表的全部分支；allowedEvolutions 钩子可裁剪（独塔为王可一次兼得全部）。
  evolutionOptions(tower) {
    if (!this.sim.canEvolve(tower)) return [];
    const base = TOWERS[tower.type].evolutions;
    const allowed = this.sim.hexRuntime.active ? this.sim.hexRuntime.allowedEvolutions(tower, base) : base;
    const entries = [];
    for (const item of Array.isArray(allowed) ? allowed : base) {
      const entry = typeof item === 'string' ? base.find((option) => option.id === item) : item;
      if (entry && base.includes(entry) && !entries.includes(entry)) entries.push(entry);
    }
    return entries;
  }

  // 接受单个分支 id 或数组：一次应用多条进化，返回是否有任一进化生效。
  evolveTower(tower, evolutionIds) {
    if (!tower || !this.sim.towers.includes(tower)) return false;
    const options = this.sim.evolutionOptions(tower);
    if (!options.length) return false;
    const requested = normalizeEvolutionIds(evolutionIds);
    const applied = options.filter((entry) => requested.includes(entry.id));
    if (!applied.length) return false;
    tower.evolutions = applied.map((entry) => entry.id);
    tower.evolution = tower.evolutions[0];
    this.sim.recomputeTowerStats();
    const def = TOWERS[tower.type];
    for (const evolution of applied) {
      this.sim.addEffect({
        kind: 'evolve',
        x: tower.x,
        y: tower.y,
        ttl: 0.9,
        color: evolution.color || def.color,
      });
    }
    this.sim.playSound('upgrade');
    this.sim.save();
    return true;
  }

  sellTower(tower) {
    const value = this.sim.sellValue(tower);
    this.sim.gold += value;
    this.sim.removeTower(tower, 'sold');
    this.sim.addFloater(tower.x, tower.y - 0.4, `+${value}`, '#ffd36b');
    this.sim.playSound('sell');
    this.sim.save();
    return value;
  }

  // ---------- 局内事件 ----------
  computeTowerStats(tower) {
    const def = TOWERS[tower.type];
    const level = def.levels[Math.min(tower.level, def.levels.length - 1)];
    const mods = this.sim.mods;
    const dmg = effectValue(mods, 'dmg');
    // 进化分支只是纯数据系数，这里统一应用；多进化时系数依次相乘，未进化时全部为 1。
    const evolutions = this.sim.towerEvolutions(tower);
    const evoMul = (key) =>
      evolutions.reduce((mul, evolution) => mul * (evolution.mods?.[key] ?? 1), 1);
    let rate = level.rate * evoMul('rate') * (1 + effectValue(mods, 'fireRate'));
    let range = level.range * evoMul('range') + effectValue(mods, 'range');
    // 时之终章的过载窗口：攻速/射程只在窗口内生效，结束即刷新缓存。
    if (this.sim.time < (tower.skillOverdriveUntil || 0)) {
      rate *= 1 + (tower.skillOverdriveAtk || 0);
      range += tower.skillOverdriveRange || 0;
    }
    const stats = {
      // 石碑增伤是永久且独立于遗物的乘子（拆除石碑写入，清波/遗物重算都不清除）。
      dmg:
        level.dmg *
        evoMul('dmg') *
        (1 + (dmg[tower.type] || 0) + effectValue(mods, 'dmgAll')) *
        this.sim.towerDamageMul,
      rate,
      range: range * (this.sim.modifier?.rangeMul || 1),
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
      maxLevel: this.sim.towerMaxLevel(tower),
    };
    // 末尾交给海克斯改写（扩展等级成长、相邻加成等）；没有海克斯时原样返回。
    if (!this.sim.hexRuntime.active) return stats;
    return this.sim.hexRuntime.modifyTowerStats(tower, stats, this.sim.hexCtx);
  }

  refreshTowerStats(tower) {
    tower.stats = this.sim.computeTowerStats(tower);
    return tower.stats;
  }

  // 战旗塔光环：只读塔的位置与等级属性，不消耗 RNG，因此在建造/升级/出售/遗物变化时重算即可。
  // 单塔光环加成上限 80%，与遗物减速/增伤的封顶量级一致。
  recomputeTowerStats() {
    for (const tower of this.sim.towers) {
      tower.aura = null;
      tower.stats = this.sim.computeTowerStats(tower);
    }
    const banners = this.sim.towers.filter((tower) => TOWERS[tower.type].support);
    if (!banners.length) return;
    for (const tower of this.sim.towers) {
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
    return tower.stats || this.sim.refreshTowerStats(tower);
  }

  previewStats(type, level = 0) {
    return this.sim.computeTowerStats(this.sim.makeTower(type, 0, 0, level, 0));
  }

  // ---------- 主动技能 ----------

  // 技能等级由外层冻结；冷却只在这里恢复，后续仅随 update 递减。
}

function lerpAngle(current, target, t) {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * t;
}

// 进化分支统一成去重后的 id 数组：兼容旧存档的单个字符串与新的多进化数组。

function normalizeEvolutionIds(value) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  const ids = [];
  for (const item of list) {
    const id = typeof item === 'string' ? item : item?.id;
    if (typeof id === 'string' && id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

// 塔生命上限：null/非正数表示无敌（默认）；其余收敛到 ≥1 的整数。

function normalizeTowerMaxHp(value) {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(1, Math.floor(parsed));
}

function clampTowerHp(value, maxHp) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return maxHp;
  return Math.max(0, Math.min(maxHp, parsed));
}
