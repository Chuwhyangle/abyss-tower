// 塔表现层静态数据：三档动画预算、后坐系数、皮肤描边预算与进化路线的视觉表。
//
// 纯常量与纯查表函数（零 import），供 tower-draw / tower-body / tower-renderer 共用。
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
