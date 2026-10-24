// 塔绘制：射程圈、塔身、炮塔造型与放置预览。依赖显式传入的光晕渲染器。
import { TILE, TOWERS } from '../shared/data.js';
import { BALANCE } from '../shared/config.js';
import { Palette } from './palette.js';
import { CanvasShapes } from './canvas-shapes.js';
import { activeSkin, skinColorFor } from '../shared/skins.js';

const T = TILE;

// 三档动画预算：off 静态、light 仅保留开火反馈、full 追加后坐细节与升级脉冲。
// 配置模块加载时冻结，渲染循环只查表。
export const TOWER_ANIMATIONS = Object.freeze({
  recoil: Object.freeze({ key: true, duration: 0.2, distance: 4, barrel: 0.6 }),
  upgradePulse: Object.freeze({
    key: false,
    speed: 0.45,
    baseRadius: 20,
    grow: 4,
    alpha: 0.3,
    minLevel: 1,
  }),
});

// 各塔型的后坐系数：重炮 > 狙击 > 弩塔，支援塔不后坐。
export const TOWER_RECOIL_SCALE = Object.freeze({
  arrow: 1,
  cannon: 1.5,
  frost: 0.5,
  arc: 0.6,
  poison: 0.6,
  banner: 0,
  shock: 0.9,
  sniper: 1.25,
});

function buildTowerAnim(tier) {
  const keyFeedback = tier !== 'off';
  const extras = tier === 'full';
  return Object.freeze({
    tier,
    recoil: Object.freeze({
      enabled: keyFeedback,
      duration: TOWER_ANIMATIONS.recoil.duration,
      distance: TOWER_ANIMATIONS.recoil.distance,
      barrel: extras ? TOWER_ANIMATIONS.recoil.barrel : 0,
    }),
    upgradePulse: Object.freeze({
      enabled: extras,
      speed: TOWER_ANIMATIONS.upgradePulse.speed,
      baseRadius: TOWER_ANIMATIONS.upgradePulse.baseRadius,
      grow: TOWER_ANIMATIONS.upgradePulse.grow,
      alpha: TOWER_ANIMATIONS.upgradePulse.alpha,
      minLevel: TOWER_ANIMATIONS.upgradePulse.minLevel,
    }),
  });
}

export const TOWER_ANIM_VARIANTS = Object.freeze({
  off: buildTowerAnim('off'),
  light: buildTowerAnim('light'),
  full: buildTowerAnim('full'),
});

export function towerAnimVariant(decorations) {
  return TOWER_ANIM_VARIANTS[decorations] || TOWER_ANIM_VARIANTS.light;
}

// 皮肤渲染预算：皮肤只改颜色与描边，不新增粒子/光晕。
// 低配把皮肤轮廓并进石台已有的外描边（零新增绘制调用），高配才单独描一圈皮肤环。
export const SKIN_OUTLINE_BUDGET = Object.freeze({
  off: 'none',
  light: 'merged',
  full: 'ring',
});

export function skinOutlineBudget(decorations) {
  return SKIN_OUTLINE_BUDGET[decorations] || SKIN_OUTLINE_BUDGET.light;
}

// 进化路线的视觉语言：每条路线一套「轮廓 + 符文」组合，全部程序化绘制、零素材。
// 同族三条路线的轮廓与符文两两不同；跨族的（形状, 符文）组合也不重复，共 24 条路线。
// radius 上限 25（塔位半格 24 附近），保证小尺寸下不压住相邻塔位与射程提示。
export const EVOLUTION_SILHOUETTE_KINDS = Object.freeze([
  'hex',
  'star',
  'blade',
  'gear',
  'wave',
  'spike',
  'crown',
]);

export const EVOLUTION_RUNE_KINDS = Object.freeze([
  'chevron',
  'triangle',
  'diamond',
  'bar',
  'cross',
  'dot',
]);

export const EVOLUTION_VISUAL_RADIUS = 25;

function evolutionVisualDef(family, route, shape, rune) {
  return Object.freeze({
    family,
    route,
    shape,
    rune,
    radius: EVOLUTION_VISUAL_RADIUS,
  });
}

export const EVOLUTION_VISUALS = Object.freeze({
  'arrow-longbow': evolutionVisualDef('arrow', 0, 'crown', 'chevron'),
  'arrow-rapid': evolutionVisualDef('arrow', 1, 'spike', 'bar'),
  'arrow-ranger': evolutionVisualDef('arrow', 2, 'wave', 'dot'),

  'cannon-siege': evolutionVisualDef('cannon', 0, 'gear', 'cross'),
  'cannon-barrage': evolutionVisualDef('cannon', 1, 'spike', 'triangle'),
  'cannon-mortar': evolutionVisualDef('cannon', 2, 'wave', 'chevron'),

  'frost-deepfreeze': evolutionVisualDef('frost', 0, 'star', 'diamond'),
  'frost-icelance': evolutionVisualDef('frost', 1, 'blade', 'chevron'),
  'frost-blizzard': evolutionVisualDef('frost', 2, 'hex', 'dot'),

  'arc-storm': evolutionVisualDef('arc', 0, 'spike', 'cross'),
  'arc-overload': evolutionVisualDef('arc', 1, 'gear', 'diamond'),
  'arc-conductor': evolutionVisualDef('arc', 2, 'hex', 'triangle'),

  'poison-virulent': evolutionVisualDef('poison', 0, 'wave', 'diamond'),
  'poison-blight': evolutionVisualDef('poison', 1, 'blade', 'bar'),
  'poison-miasma': evolutionVisualDef('poison', 2, 'crown', 'dot'),

  'banner-horn': evolutionVisualDef('banner', 0, 'star', 'chevron'),
  'banner-standard': evolutionVisualDef('banner', 1, 'crown', 'bar'),
  'banner-drum': evolutionVisualDef('banner', 2, 'hex', 'cross'),

  'shock-quake': evolutionVisualDef('shock', 0, 'gear', 'bar'),
  'shock-glacier': evolutionVisualDef('shock', 1, 'star', 'cross'),
  'shock-resonance': evolutionVisualDef('shock', 2, 'blade', 'triangle'),

  'sniper-piercer': evolutionVisualDef('sniper', 0, 'spike', 'diamond'),
  'sniper-marksman': evolutionVisualDef('sniper', 1, 'star', 'bar'),
  'sniper-overwatch': evolutionVisualDef('sniper', 2, 'gear', 'triangle'),
});

// 未知/缺失进化 id 的回退：仍有轮廓可取，渲染不中断。
export const DEFAULT_EVOLUTION_VISUAL = evolutionVisualDef('unknown', -1, 'hex', 'dot');

export function evolutionVisual(id) {
  return (id && EVOLUTION_VISUALS[id]) || DEFAULT_EVOLUTION_VISUAL;
}

// 画质预算：off 只留静态轮廓；light 追加内层轮廓，仍不出现符文粒子；
// full 才在轮廓外绕塔旋转符文。三档开销单调递增。
export const EVOLUTION_VISUAL_BUDGET = Object.freeze({
  off: Object.freeze({ tier: 'off', outline: true, inner: false, runes: 0, spin: false }),
  light: Object.freeze({ tier: 'light', outline: true, inner: true, runes: 0, spin: false }),
  full: Object.freeze({ tier: 'full', outline: true, inner: true, runes: 3, spin: true }),
});

export function evolutionVisualBudget(decorations) {
  return EVOLUTION_VISUAL_BUDGET[decorations] || EVOLUTION_VISUAL_BUDGET.light;
}

// 单塔进化的绘制开销（描边次数 + 符文数），用于断言预算单调。
export function evolutionVisualCost(budget = EVOLUTION_VISUAL_BUDGET.full) {
  return (budget.outline ? 1 : 0) + (budget.inner ? 1 : 0) + budget.runes;
}

// recoil 是模拟层已有的瞬时字段；渲染只读取并换算成像素位移，不回写。
export function towerRecoilAmount(recoil, type, variant = TOWER_ANIM_VARIANTS.full) {
  if (!variant.recoil.enabled) return 0;
  const scale = TOWER_RECOIL_SCALE[type] || 0;
  if (!(scale > 0)) return 0;
  const amount = Number.isFinite(recoil) ? Math.min(1, Math.max(0, recoil)) : 0;
  return amount * scale;
}

// 升级脉冲：返回 0..1 的相位，等级越高环越亮，未升级的塔不出现。
export function towerUpgradePulse(level, time, variant = TOWER_ANIM_VARIANTS.full, phaseSeed = 0) {
  const cfg = variant.upgradePulse;
  if (!cfg.enabled || !(level >= cfg.minLevel)) return 0;
  const wave = Math.sin((time * cfg.speed + phaseSeed) * Math.PI * 2);
  return 0.5 + 0.5 * wave;
}

export class TowerRenderer {
  constructor(game, { glow }) {
    this.game = game;
    this.glow = glow;
  }

  renderRanges(g, settings) {
    const game = this.game;
    const tower = game.selectedTower;
    if (tower) {
      const stats = game.statsFor(tower);
      const color = skinColorFor(activeSkin('tower'), Palette.towerColor(tower.type, settings));
      this.drawRangeCircle(g, tower.x, tower.y, stats.range, color, 0.55);
    }
  }

  drawRangeCircle(g, x, y, range, color, alpha = 0.5) {
    g.save();
    g.beginPath();
    g.arc(x * T, y * T, range * T, 0, Math.PI * 2);
    g.fillStyle = Palette.hexToRgba(color, 0.07);
    g.fill();
    g.strokeStyle = Palette.hexToRgba(color, alpha);
    g.lineWidth = 1.5;
    g.setLineDash([6, 5]);
    g.stroke();
    g.restore();
  }

  render(g, time, settings) {
    const game = this.game;
    const glow = settings.glow;
    const anim = towerAnimVariant(settings.decorations);
    const skin = activeSkin('tower');
    const budget = skinOutlineBudget(settings.decorations);
    const outline = budget === 'none' ? null : skin.outline;
    const mergeOutline = budget === 'merged' && !!outline;
    for (const tower of game.towers) {
      const x = tower.x * T;
      const y = tower.y * T;
      const def = TOWERS[tower.type];
      const level = tower.level;
      const color = skinColorFor(skin, Palette.towerColor(tower.type, settings));
      // 进化分支的专属配色；未进化时退回塔的默认色。
      const evolution = tower.evolution
        ? def.evolutions?.find((entry) => entry.id === tower.evolution) || null
        : null;
      const accent = evolution ? Palette.presentColor(evolution.color, settings) : color;
      const disableLeft = (tower.disabledUntil || 0) - game.time;
      const disabled = disableLeft > 0;
      const recoil = towerRecoilAmount(tower.recoil || 0, tower.type, anim);

      g.fillStyle = 'rgba(0,0,0,0.38)';
      g.beginPath();
      g.ellipse(x, y + 12, 21, 9, 0, 0, Math.PI * 2);
      g.fill();

      if (glow && !disabled) {
        this.glow.draw(g, accent, x, y, evolution ? 34 : 30, evolution ? 0.26 : level >= 2 ? 0.2 : 0.12);
      }

      g.save();
      g.translate(x, y);
      g.scale(1.06, 1.06);

      // 升级脉冲：只在高配出现，相位固定到塔位避免整场同频闪烁。
      const pulse = towerUpgradePulse(level, time, anim, tower.x * 0.37 + tower.y * 0.21);
      if (pulse > 0) {
        g.strokeStyle = Palette.hexToRgba(accent, (anim.upgradePulse.alpha + level * 0.04) * (0.4 + pulse * 0.6));
        g.lineWidth = 1.2 + pulse * 0.8;
        g.beginPath();
        g.arc(0, 0, anim.upgradePulse.baseRadius + (1 - pulse) * anim.upgradePulse.grow, 0, Math.PI * 2);
        g.stroke();
      }

      const oct = (radius) => {
        g.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = Math.PI / 8 + (i / 8) * Math.PI * 2;
          const px = Math.cos(a) * radius;
          const py = Math.sin(a) * radius;
          i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
        }
        g.closePath();
      };

      // 石台：低配把皮肤轮廓并入这一圈外描边，避免额外 stroke。
      oct(22);
      g.fillStyle = '#0a1116';
      g.fill();
      if (mergeOutline) {
        g.strokeStyle = Palette.hexToRgba(outline.color, outline.alpha);
        g.lineWidth = outline.width;
      } else {
        g.strokeStyle = Palette.hexToRgba(color, 0.42);
        g.lineWidth = 2;
      }
      g.stroke();

      oct(17.5);
      g.fillStyle = '#121d24';
      g.fill();
      g.strokeStyle = Palette.hexToRgba(color, 0.16);
      g.lineWidth = 1;
      g.stroke();

      // 能量环
      g.strokeStyle = Palette.hexToRgba(color, 0.5);
      g.lineWidth = 1.4;
      g.beginPath();
      g.arc(0, 0, 14, time * 0.4, time * 0.4 + Math.PI * 1.1);
      g.stroke();

      // 皮肤轮廓：高配单独描环；低配已并进石台外描边，不再新增绘制调用。
      if (outline && !mergeOutline) {
        g.strokeStyle = Palette.hexToRgba(outline.color, outline.alpha);
        g.lineWidth = outline.width;
        g.beginPath();
        g.arc(0, 0, 24, 0, Math.PI * 2);
        g.stroke();
      }

      // 铆钉
      g.fillStyle = '#1c2a33';
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + (i / 4) * Math.PI * 2;
        g.beginPath();
        g.arc(Math.cos(a) * 19, Math.sin(a) * 19, 1.7, 0, Math.PI * 2);
        g.fill();
      }

      // 等级宝石
      for (let i = 0; i < 3; i++) {
        const filled = i <= level;
        const offset = (i - 1) * 7;
        g.beginPath();
        g.moveTo(offset, 25);
        g.lineTo(offset + 2.4, 27.5);
        g.lineTo(offset, 30);
        g.lineTo(offset - 2.4, 27.5);
        g.closePath();
        g.fillStyle = filled ? '#ffd36b' : 'rgba(255,211,107,0.15)';
        g.fill();
        if (filled && glow) {
          g.strokeStyle = 'rgba(255,211,107,0.5)';
          g.lineWidth = 0.8;
          g.stroke();
        }
      }

      // 进化标识：每条路线独有的轮廓 + 符文组合，开销随画质档位递增。
      if (evolution) {
        this.drawEvolutionMark(
          g,
          time,
          evolutionVisual(evolution.id),
          evolutionVisualBudget(settings.decorations),
          accent
        );
      }

      // 炮塔：整机后退 + 高配追加炮管回缩，二者都只读模拟层已有的 recoil。
      g.save();
      g.rotate(tower.angle);
      g.translate(-recoil * anim.recoil.distance, 0);
      this.drawTowerShape(
        g,
        time,
        tower.type,
        Math.min(1, recoil * anim.recoil.barrel),
        1,
        level,
        glow,
        color
      );
      g.restore();

      // 被首领震击停摆：变暗 + 电弧 + 剩余时间弧线。
      if (disabled) this.drawDisabled(g, time, disableLeft);

      if (game.selectedTower === tower) {
        g.strokeStyle = 'rgba(255, 211, 107, 0.95)';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(0, 0, 24, 0, Math.PI * 2);
        g.stroke();
      }
      g.restore();
    }
  }

  // 进化标识：先描路线专属轮廓，再按预算叠内层轮廓与绕塔符文。
  // 调用时坐标系已平移到塔心并缩放，这里只画相对几何。
  drawEvolutionMark(g, time, visual, budget, color) {
    const spin = budget.spin ? time * 0.9 : 0;
    g.save();

    g.strokeStyle = Palette.hexToRgba(color, 0.8);
    g.lineWidth = 1.8;
    if (budget.spin) g.setLineDash([5, 4]);
    if (budget.outline) {
      this.traceEvolutionSilhouette(g, visual.shape, visual.radius, spin);
      g.stroke();
    }
    if (budget.spin) g.setLineDash([]);

    if (budget.inner) {
      g.strokeStyle = Palette.hexToRgba(color, 0.4);
      g.lineWidth = 1;
      this.traceEvolutionSilhouette(g, visual.shape, visual.radius - 3.5, -spin * 0.5);
      g.stroke();
    }

    if (budget.runes > 0) {
      g.fillStyle = color;
      const orbit = visual.radius - 3;
      for (let i = 0; i < budget.runes; i++) {
        const a = -spin * 0.6 + (i / budget.runes) * Math.PI * 2;
        this.drawEvolutionRune(g, visual.rune, Math.cos(a) * orbit, Math.sin(a) * orbit, a);
      }
    }

    g.restore();
  }

  // 路线轮廓：闭合路径，调用方负责 stroke。未知形状回退六边形。
  traceEvolutionSilhouette(g, kind, radius, rotation = 0) {
    const r = radius;
    g.beginPath();
    if (kind === 'hex') {
      for (let i = 0; i < 6; i++) {
        const a = rotation + (i / 6) * Math.PI * 2;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
      }
    } else if (kind === 'star') {
      // 四角星：内外半径交替。
      for (let i = 0; i < 8; i++) {
        const a = rotation + (i / 8) * Math.PI * 2;
        const rr = i % 2 === 0 ? r : r * 0.62;
        const px = Math.cos(a) * rr;
        const py = Math.sin(a) * rr;
        i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
      }
    } else if (kind === 'blade') {
      // 柳叶形：上下两尖、两侧内收。
      g.moveTo(0, -r);
      g.quadraticCurveTo(r * 0.9, 0, 0, r);
      g.quadraticCurveTo(-r * 0.9, 0, 0, -r);
    } else if (kind === 'gear') {
      // 八齿齿轮：十六个顶点深浅交替。
      for (let i = 0; i < 16; i++) {
        const a = rotation + (i / 16) * Math.PI * 2;
        const rr = i % 2 === 0 ? r : r * 0.78;
        const px = Math.cos(a) * rr;
        const py = Math.sin(a) * rr;
        i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
      }
    } else if (kind === 'wave') {
      // 十二瓣波纹：半径随正弦起伏。
      for (let i = 0; i <= 24; i++) {
        const a = rotation + (i / 24) * Math.PI * 2;
        const rr = r * (0.86 + 0.14 * Math.sin((i / 24) * Math.PI * 2 * 12));
        const px = Math.cos(a) * rr;
        const py = Math.sin(a) * rr;
        i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
      }
    } else if (kind === 'spike') {
      // 三枚锐刺：深内凹，远看也能区分。
      for (let i = 0; i < 6; i++) {
        const a = rotation + (i / 6) * Math.PI * 2;
        const rr = i % 2 === 0 ? r : r * 0.35;
        const px = Math.cos(a) * rr;
        const py = Math.sin(a) * rr;
        i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
      }
    } else if (kind === 'crown') {
      // 三峰王冠：三个外凸圆峰，峰间内凹。
      for (let i = 0; i <= 3; i++) {
        const a = rotation + (i / 3) * Math.PI * 2;
        const px = Math.cos(a) * r * 0.82;
        const py = Math.sin(a) * r * 0.82;
        if (i === 0) {
          g.moveTo(px, py);
        } else {
          const mid = a - Math.PI / 3;
          g.quadraticCurveTo(Math.cos(mid) * r * 1.24, Math.sin(mid) * r * 1.24, px, py);
        }
      }
    } else {
      for (let i = 0; i < 6; i++) {
        const a = rotation + (i / 6) * Math.PI * 2;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
      }
    }
    g.closePath();
  }

  // 单枚符文：以落点为原点朝外朝向，纯 path 填充。
  drawEvolutionRune(g, kind, x, y, angle = 0) {
    const s = 2.8;
    g.save();
    g.translate(x, y);
    g.rotate(angle + Math.PI / 2);
    if (kind === 'chevron') {
      g.beginPath();
      g.moveTo(-s, -s * 0.7);
      g.lineTo(0, s * 0.4);
      g.lineTo(s, -s * 0.7);
      g.lineTo(s, -s * 0.1);
      g.lineTo(0, s * 1.1);
      g.lineTo(-s, -s * 0.1);
      g.closePath();
      g.fill();
    } else if (kind === 'triangle') {
      g.beginPath();
      g.moveTo(0, -s);
      g.lineTo(s, s);
      g.lineTo(-s, s);
      g.closePath();
      g.fill();
    } else if (kind === 'diamond') {
      g.beginPath();
      g.moveTo(0, -s);
      g.lineTo(s, 0);
      g.lineTo(0, s);
      g.lineTo(-s, 0);
      g.closePath();
      g.fill();
    } else if (kind === 'bar') {
      g.beginPath();
      g.rect(-s * 0.45, -s, s * 0.9, s * 2);
      g.closePath();
      g.fill();
    } else if (kind === 'cross') {
      g.beginPath();
      g.rect(-s, -s * 0.4, s * 2, s * 0.8);
      g.closePath();
      g.fill();
      g.beginPath();
      g.rect(-s * 0.4, -s, s * 0.8, s * 2);
      g.closePath();
      g.fill();
    } else {
      g.beginPath();
      g.arc(0, 0, s * 0.75, 0, Math.PI * 2);
      g.closePath();
      g.fill();
    }
    g.restore();
  }

  // 停摆表现：压暗塔身、环绕电弧、外圈剩余时间弧（调用时已平移到塔心）。
  drawDisabled(g, time, disableLeft) {
    const max = BALANCE.bossSlamDisable || 1;
    const frac = Math.max(0, Math.min(1, disableLeft / max));
    const flick = 0.5 + 0.5 * Math.sin(time * 24);

    g.save();
    g.fillStyle = 'rgba(6, 9, 12, 0.66)';
    g.beginPath();
    g.arc(0, 0, 23, 0, Math.PI * 2);
    g.fill();
    g.restore();

    g.save();
    g.strokeStyle = `rgba(255, 138, 107, ${0.5 + flick * 0.4})`;
    g.lineWidth = 1.6;
    g.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const a0 = time * 2.6 + (i / 3) * Math.PI * 2;
      const jitter = Math.sin(time * 15 + i * 2.3) * 2.5;
      g.beginPath();
      g.moveTo(Math.cos(a0) * 16, Math.sin(a0) * 16);
      g.lineTo(Math.cos(a0 + 0.3) * 24 + jitter, Math.sin(a0 + 0.3) * 24);
      g.lineTo(Math.cos(a0 + 0.6) * 18, Math.sin(a0 + 0.6) * 18 - jitter);
      g.stroke();
    }
    g.restore();

    g.save();
    g.strokeStyle = 'rgba(255, 138, 107, 0.3)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(0, 0, 26, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = `rgba(255, 168, 120, ${0.7 + flick * 0.25})`;
    g.beginPath();
    g.arc(0, 0, 26, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    g.stroke();
    g.restore();
  }

  drawTowerShape(g, time, type, recoil, alpha, level = 0, glowOn = false, color = TOWERS[type].color) {
    const push = -recoil * 3;
    g.globalAlpha = alpha;

    if (type === 'arrow') {
      // 木质弩机
      g.fillStyle = '#2b2118';
      g.strokeStyle = '#8c6b45';
      g.lineWidth = 2;
      CanvasShapes.roundRect(g, -4 + push, -3.2, 17, 6.4, 2);
      g.fill();
      g.stroke();

      // 弩臂
      g.strokeStyle = color;
      g.lineWidth = 2.4;
      g.beginPath();
      g.moveTo(7 + push, -12);
      g.quadraticCurveTo(20 + push, -7, 20 + push, 0);
      g.quadraticCurveTo(20 + push, 7, 7 + push, 12);
      g.stroke();

      // 弓弦
      g.strokeStyle = 'rgba(225,255,235,0.55)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(12 + push, -9.5);
      g.lineTo(5 + push, 0);
      g.lineTo(12 + push, 9.5);
      g.stroke();

      // 弩箭
      g.strokeStyle = '#e6fff0';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(2 + push, 0);
      g.lineTo(23 + push, 0);
      g.stroke();
      g.fillStyle = '#f2fff7';
      g.beginPath();
      g.moveTo(27 + push, 0);
      g.lineTo(21 + push, -3.6);
      g.lineTo(21 + push, 3.6);
      g.closePath();
      g.fill();

      if (level >= 1) {
        g.strokeStyle = Palette.hexToRgba(color, 0.6);
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(0, 0, 9.5, 0, Math.PI * 2);
        g.stroke();
      }
    } else if (type === 'cannon') {
      // 铁制炮塔
      g.fillStyle = '#2a2c2b';
      g.strokeStyle = '#6d604e';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(0, 0, 10, 0, Math.PI * 2);
      g.fill();
      g.stroke();

      // 炮管
      g.fillStyle = '#3d3f3c';
      g.strokeStyle = '#7a6c56';
      g.lineWidth = 2;
      CanvasShapes.roundRect(g, 4 + push, -6.5, 19, 13, 4);
      g.fill();
      g.stroke();

      // 加固环
      g.strokeStyle = '#a08b68';
      g.lineWidth = 1.8;
      for (const bx of [9, 16]) {
        g.beginPath();
        g.moveTo(bx + push, -6.1);
        g.lineTo(bx + push, 6.1);
        g.stroke();
      }

      // 炮口
      g.fillStyle = '#1b1c1b';
      g.beginPath();
      g.arc(23 + push, 0, 4.6, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = color;
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(23 + push, 0, 5.6, 0, Math.PI * 2);
      g.stroke();

      if (level >= 1) {
        g.strokeStyle = Palette.hexToRgba(color, 0.55);
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(0, 0, 9.5, 0, Math.PI * 2);
        g.stroke();
      }
    } else if (type === 'frost') {
      // 冰晶核心
      g.save();
      g.rotate(time * 0.35);
      g.strokeStyle = 'rgba(160,230,255,0.35)';
      g.lineWidth = 1.2;
      for (let i = 0; i < 6; i++) {
        g.rotate(Math.PI / 3);
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(15, 0);
        g.stroke();
      }
      g.restore();

      // 主水晶
      g.fillStyle = '#2b6d8a';
      g.strokeStyle = color;
      g.lineWidth = 1.8;
      g.beginPath();
      g.moveTo(0, -13);
      g.lineTo(8, -3);
      g.lineTo(5, 11);
      g.lineTo(0, 14);
      g.lineTo(-5, 11);
      g.lineTo(-8, -3);
      g.closePath();
      g.fill();
      g.stroke();

      // 侧晶
      const shard = (ax, ay, sx, sy, rot) => {
        g.save();
        g.translate(ax, ay);
        g.rotate(rot);
        g.beginPath();
        g.moveTo(0, -sy);
        g.lineTo(sx, 0);
        g.lineTo(0, sy);
        g.lineTo(-sx, 0);
        g.closePath();
        g.fillStyle = '#4a9cbc';
        g.fill();
        g.strokeStyle = '#a8e6ff';
        g.lineWidth = 1.2;
        g.stroke();
        g.restore();
      };
      shard(-9, 2, 2.6, 6, -0.5);
      shard(9, 1, 2.6, 7, 0.6);
      if (level >= 2) shard(0, 15, 2.2, 5, 0);

      // 顶部高光
      g.fillStyle = 'rgba(220,255,255,0.85)';
      g.beginPath();
      g.arc(0, -8, 2.2, 0, Math.PI * 2);
      g.fill();
    } else if (type === 'arc') {
      // 特斯拉线圈
      g.fillStyle = '#221d33';
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(0, 0, 9, 0, Math.PI * 2);
      g.fill();
      g.stroke();

      g.strokeStyle = 'rgba(201,168,255,0.75)';
      g.lineWidth = 1.8;
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.ellipse(3 + i * 3, 0, 2.4, 8 - i * 1.4, 0, 0, Math.PI * 2);
        g.stroke();
      }

      // 电球
      const pulse = 1 + Math.sin(time * 8) * 0.15;
      if (glowOn) this.glow.draw(g, '#d2b9ff', 15, 0, 13, 0.55);
      g.fillStyle = '#e8dcff';
      g.beginPath();
      g.arc(15, 0, 4.6 * pulse, 0, Math.PI * 2);
      g.fill();

      // 电弧
      g.strokeStyle = '#f2eaff';
      g.lineWidth = 1.4;
      for (let i = 0; i < 2; i++) {
        g.beginPath();
        g.moveTo(15, 0);
        g.lineTo(15 + 8, -6 + i * 12 + Math.sin(time * 20 + i) * 3);
        g.lineTo(15 + 13, 2 - i * 4);
        g.stroke();
      }
    } else if (type === 'poison') {
      // 炼金装置
      g.fillStyle = '#1c2a18';
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(0, 0, 9, 0, Math.PI * 2);
      g.fill();
      g.stroke();

      // 导管
      g.strokeStyle = '#6e7f55';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(4, 0);
      g.lineTo(19, 0);
      g.stroke();

      // 药瓶
      g.fillStyle = 'rgba(160, 230, 120, 0.22)';
      g.strokeStyle = '#b6e88a';
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(13, 0, 8.5, 0, Math.PI * 2);
      g.fill();
      g.stroke();

      g.fillStyle = 'rgba(120, 210, 80, 0.75)';
      g.beginPath();
      g.arc(13, 2.4, 6.4, 0.15, Math.PI - 0.15);
      g.fill();

      // 气泡
      for (let i = 0; i < 3; i++) {
        const phase = (time * 0.7 + i * 0.37) % 1;
        g.fillStyle = `rgba(190,255,140,${0.65 * (1 - phase)})`;
        g.beginPath();
        g.arc(
          13 + Math.sin(time * 2.2 + i * 2) * 4,
          3 - phase * 9,
          1.1 + phase * 1.4,
          0,
          Math.PI * 2
        );
        g.fill();
      }

      // 喷嘴
      g.fillStyle = '#7f8f63';
      CanvasShapes.roundRect(g, 20, -3.5, 6, 7, 2);
      g.fill();

      if (level >= 2) {
        g.fillStyle = 'rgba(180, 240, 120, 0.8)';
        g.beginPath();
        g.arc(0, -9, 2.2, 0, Math.PI * 2);
        g.fill();
      }
    } else if (type === 'banner') {
      // 旗杆与底座
      g.strokeStyle = '#c9b47a';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(0, 15);
      g.lineTo(0, -14);
      g.stroke();

      g.fillStyle = '#2a2318';
      g.strokeStyle = Palette.hexToRgba(color, 0.7);
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(0, 15, 3.4, 0, Math.PI * 2);
      g.fill();
      g.stroke();

      // 旗面：随时间轻微摆动
      const wave = Math.sin(time * 3) * 2.2;
      g.fillStyle = Palette.hexToRgba(color, 0.85);
      g.strokeStyle = color;
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(1, -14);
      g.quadraticCurveTo(10 + wave, -11, 18, -8);
      g.lineTo(18, 2);
      g.quadraticCurveTo(9 + wave, -1, 1, 2);
      g.closePath();
      g.fill();
      g.stroke();

      // 旗面纹章
      g.strokeStyle = 'rgba(60, 42, 10, 0.7)';
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(9 + wave * 0.5, -8);
      g.lineTo(9 + wave * 0.5, -2);
      g.moveTo(5 + wave * 0.5, -5);
      g.lineTo(13 + wave * 0.5, -5);
      g.stroke();

      // 顶端旗尖
      g.fillStyle = '#ffe6a0';
      g.beginPath();
      g.moveTo(0, -19);
      g.lineTo(3, -14);
      g.lineTo(-3, -14);
      g.closePath();
      g.fill();

      if (level >= 1) {
        g.strokeStyle = Palette.hexToRgba(color, 0.6);
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(0, 0, 9.5, 0, Math.PI * 2);
        g.stroke();
      }
    } else if (type === 'shock') {
      // 震荡核心
      g.fillStyle = '#1d3a36';
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(0, 0, 9, 0, Math.PI * 2);
      g.fill();
      g.stroke();

      // 发射喇叭
      g.fillStyle = '#28524b';
      g.strokeStyle = '#8ff0dc';
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(4, -5);
      g.lineTo(18, -9);
      g.lineTo(18, 9);
      g.lineTo(4, 5);
      g.closePath();
      g.fill();
      g.stroke();

      // 口部的同心震荡环
      const pulse = (time * 1.6) % 1;
      for (let i = 0; i < 2; i++) {
        const phase = (pulse + i * 0.5) % 1;
        g.strokeStyle = `rgba(111, 227, 200, ${0.55 * (1 - phase)})`;
        g.lineWidth = 1.4;
        g.beginPath();
        g.arc(18, 0, 3 + phase * 7, -1.1, 1.1);
        g.stroke();
      }

      // 核心亮点
      g.fillStyle = 'rgba(190, 255, 240, 0.85)';
      g.beginPath();
      g.arc(0, 0, 2.6, 0, Math.PI * 2);
      g.fill();

      if (level >= 1) {
        g.strokeStyle = Palette.hexToRgba(color, 0.55);
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(0, 0, 9.5, 0, Math.PI * 2);
        g.stroke();
      }
    } else if (type === 'sniper') {
      // 支架
      g.fillStyle = '#1b2537';
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(0, 0, 9, 0, Math.PI * 2);
      g.fill();
      g.stroke();

      // 长枪管
      g.strokeStyle = '#9fb4d6';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(4 + push, 0);
      g.lineTo(26 + push, 0);
      g.stroke();

      // 瞄准镜
      g.fillStyle = '#2b3d5c';
      g.strokeStyle = '#cfe2ff';
      g.lineWidth = 1.4;
      CanvasShapes.roundRect(g, -2 + push, -7.5, 11, 5.4, 2.4);
      g.fill();
      g.stroke();
      g.fillStyle = 'rgba(180, 220, 255, 0.85)';
      g.beginPath();
      g.arc(6 + push, -4.8, 1.4, 0, Math.PI * 2);
      g.fill();

      // 枪口制退器
      g.strokeStyle = color;
      g.lineWidth = 1.8;
      g.beginPath();
      g.moveTo(24 + push, -3.2);
      g.lineTo(24 + push, 3.2);
      g.moveTo(28 + push, -3.2);
      g.lineTo(28 + push, 3.2);
      g.stroke();

      if (level >= 1) {
        g.strokeStyle = Palette.hexToRgba(color, 0.6);
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(0, 0, 9.5, 0, Math.PI * 2);
        g.stroke();
      }
    }

    g.globalAlpha = 1;
  }

  renderPlacement(g, time, glowOn, settings) {
    const game = this.game;
    const hover = game.hover;

    if (!game.placementType || !hover) return;
    const { c, r } = hover;
    const inBounds = r >= 0 && r < game.map.rows && c >= 0 && c < game.map.cols;
    if (!inBounds) return;

    const ok = game.canBuild(c, r) && game.gold >= game.towerCost(game.placementType);
    const x = (c + 0.5) * T;
    const y = (r + 0.5) * T;
    const color = ok ? '#7ce38b' : '#ef5f5f';
    const stats = game.previewStats(game.placementType, 0);

    g.save();
    g.globalAlpha = 0.9;
    g.fillStyle = ok ? 'rgba(124, 227, 139, 0.12)' : 'rgba(239, 95, 95, 0.14)';
    g.fillRect(c * T + 2, r * T + 2, T - 4, T - 4);
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.strokeRect(c * T + 2, r * T + 2, T - 4, T - 4);

    g.beginPath();
    g.arc(x, y, stats.range * T, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255, 255, 255, 0.04)';
    g.fill();
    g.setLineDash([5, 5]);
    g.strokeStyle = ok ? 'rgba(124, 227, 139, 0.5)' : 'rgba(239, 95, 95, 0.5)';
    g.lineWidth = 1.4;
    g.stroke();
    g.setLineDash([]);

    g.globalAlpha = 0.6;
    g.save();
    g.translate(x, y);
    g.rotate(-Math.PI / 2);
    this.drawTowerShape(
      g,
      time,
      game.placementType,
      0,
      1,
      0,
      glowOn,
      skinColorFor(activeSkin('tower'), Palette.towerColor(game.placementType, settings))
    );
    g.restore();
    g.globalAlpha = 1;
    g.restore();
  }
}
