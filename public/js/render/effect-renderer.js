// 特效渲染编排：环形冲击、火花、闪电、枪口、生成、死亡、治疗、放置、中毒、漏怪。
// 画质分档只影响表现（粒子数/光晕/每帧预算），不读取也不修改模拟状态。
// 首领系列：蓄力、咆哮、召唤、震击、防御塔停摆。
//
// 事件表与变体在 effect-data.js，粒子池在 effect-pool.js，逐事件画法在 effect-draw.js /
// effect-boss.js（方法集合挂回本类原型，对外仍是同一个 EffectRenderer、同一套方法签名）。
import { registerRenderer } from './registry.js';
import { TILE } from '../shared/data.js';
import { Palette } from './palette.js';
import { IMPACT_POOL_CAPACITY, ImpactVfxPool, impactBudget } from './impact-vfx.js';
import {
  EFFECT_EVENTS,
  EFFECT_PROFILES,
  classifyEffect,
  effectProfile,
  eventVariant,
} from './effect-data.js';
import { ParticlePool } from './effect-pool.js';
import { effectDrawMethods, effectProgress } from './effect-draw.js';
import { effectBossDrawMethods } from './effect-boss.js';

const T = TILE;

export class EffectRenderer {
  constructor(game, { glow }) {
    this.game = game;
    this.glow = glow;
    // 池容量固定为高配上限，低配只通过每帧 poolBudget 收缩，不重建池。
    this.pool = new ParticlePool(EFFECT_PROFILES.high.poolBudget);
    // 命中层独立预算：与死亡/漏怪粒子分开计，36 敌混战时也不会互相挤掉。
    this.impactPool = new ImpactVfxPool(IMPACT_POOL_CAPACITY);
    this._progress = { p: 0, fade: 0 };
    this._impactPlan = { degraded: false, count: 0 };
    // 逐事件分派的复用参数包：与 _progress 同理，渲染循环里不新建对象。
    this._fx = {
      effect: null,
      style: null,
      event: '',
      p: 0,
      fade: 0,
      x: 0,
      y: 0,
      color: '',
      glow: false,
      halo: false,
      profile: EFFECT_PROFILES.high,
      t: 0,
      settings: null,
    };
    // 只读观测计数（与 ProjectileRenderer.drawn / drawCalls 同性质，供测试与性能记录读取）。
    this.impactDrawn = Object.create(null);
    // 类别层绘制计数：按事件键累计，浏览器验收读取三类各绘制 ≥1 次。
    this.classDrawn = Object.create(null);
    this.impactDegraded = 0;
    this.impactPeak = 0;
    this.auraPulses = 0;
  }

  render(g, time, settings) {
    const profile = effectProfile(settings);
    const glow = !!(settings && settings.glow);
    const halo = glow && profile.halo;
    const t = time;
    this.pool.reset(profile.poolBudget);
    this.impactPool.reset(impactBudget(profile));
    if (this.glow && typeof this.glow.configure === 'function') this.glow.configure(settings);

    let drawn = 0;
    for (const effect of this.game.effects) {
      if (drawn >= profile.frameBudget) break;

      const event = classifyEffect(effect);
      // 只有登记在事件表里的 kind 才按事件时长推进；其余分支沿用自身 ttl。
      const style = EFFECT_EVENTS[event] ? eventVariant(event, profile) : null;
      // 低配只保留关键事件，进化等细节层不占用绘制预算。
      if (style && !style.enabled) continue;
      drawn++;

      const { p, fade } = effectProgress(effect, style, this._progress);
      const x = effect.x * T;
      const y = effect.y * T;
      const color = effect.color || Palette.semanticColor('buff');

      const fx = this._fx;
      fx.effect = effect;
      fx.style = style;
      fx.event = event;
      fx.p = p;
      fx.fade = fade;
      fx.x = x;
      fx.y = y;
      fx.color = color;
      fx.glow = glow;
      fx.halo = halo;
      fx.profile = profile;
      fx.t = t;
      fx.settings = settings;

      if (effect.kind === 'ring') {
        this.drawRing(g, fx);
      } else if (effect.kind === 'frostBurst' || effect.kind === 'poisonSpread') {
        // 觉醒（§7）最小表现：霜爆/中毒传播复用环形冲击（r0→r1 外扩），不新增每帧渐变。
        this.drawRing(g, fx);
      } else if (effect.kind === 'spark') {
        this.drawSpark(g, fx);
      } else if (effect.kind === 'bolt') {
        this.drawBolt(g, fx);
      } else if (effect.kind === 'muzzle') {
        this.drawMuzzle(g, fx);
      } else if (effect.kind === 'spawn') {
        this.drawSpawn(g, fx);
      } else if (effect.kind === 'death') {
        this.drawDeath(g, fx);
      } else if (effect.kind === 'heal') {
        this.drawHeal(g, fx);
      } else if (effect.kind === 'place') {
        this.drawPlace(g, fx);
      } else if (effect.kind === 'poison') {
        this.drawPoison(g, fx);
      } else if (effect.kind === 'leak') {
        this.drawLeak(g, fx);
      } else if (effect.kind === 'bossCast') {
        this.drawBossCast(g, fx);
      } else if (effect.kind === 'bossRoar') {
        this.drawBossRoar(g, fx);
      } else if (effect.kind === 'bossSummon') {
        this.drawBossSummon(g, fx);
      } else if (effect.kind === 'bossSlam') {
        this.drawBossSlam(g, fx);
      } else if (event === 'bossHit' || event === 'shieldBreak' || event === 'armorAbsorb') {
        this.drawClassEvent(g, fx);
      } else if (effect.kind === 'towerDisable') {
        this.drawTowerDisable(g, fx);
      } else if (effect.kind === 'evolve') {
        this.drawEvolve(g, fx);
      }
    }

    // 命中层实测峰值：本帧命中粒子槽占用数（测试与性能记录读取）。
    if (this.impactPool.active > this.impactPeak) this.impactPeak = this.impactPool.active;
    // 战旗签名：光环脉冲是纯渲染层表现，不产生模拟事件。
    this.renderAuraPulses(g, t, profile);
  }
}

Object.assign(EffectRenderer.prototype, effectDrawMethods, effectBossDrawMethods);

// 自注册到渲染器注册表：render.js 经 id 创建实例，不再逐个静态 import。
registerRenderer('effect', EffectRenderer);
