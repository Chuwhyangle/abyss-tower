// 敌人表现层静态数据：三档动画预算、体型行走幅度、皮肤描边预算、受击闪白与高光几何。
//
// 纯常量与纯查表函数（不 import 任何运行时模块），供 enemy-feedback / enemy-renderer 共用。

// 三档动画预算：off 完全静态、light 只保留关键战斗反馈、full 保留全部程序化细节。
// 配置在模块加载时冻结，渲染循环只查表，不新建对象。
export const ENEMY_ANIMATIONS = Object.freeze({
  walk: Object.freeze({ key: false, speed: 7, flyingSpeed: 10 }),
  hitFlash: Object.freeze({ key: true, duration: 0.08, decay: 4 }),
  deathShatter: Object.freeze({
    key: false,
    source: 'effects',
    event: 'kill',
    duration: 0.3,
    maxParticles: 8,
  }),
});

// 各体型的行走幅度：摆动量只影响表现，不参与模拟。
export const ENEMY_WALK_PROFILES = Object.freeze({
  blob: Object.freeze({ bob: 1.1, stride: 0.45, lean: 0.05 }),
  dart: Object.freeze({ bob: 0.6, stride: 1.0, lean: 0.02 }),
  bug: Object.freeze({ bob: 0.8, stride: 0.7, lean: 0.035 }),
  hex: Object.freeze({ bob: 0.7, stride: 0.5, lean: 0.025 }),
  wing: Object.freeze({ bob: 1.6, stride: 0.6, lean: 0.03 }),
  priest: Object.freeze({ bob: 0.9, stride: 0.45, lean: 0.03 }),
  shield: Object.freeze({ bob: 0.7, stride: 0.45, lean: 0.02 }),
  split: Object.freeze({ bob: 0.9, stride: 0.55, lean: 0.03 }),
  drum: Object.freeze({ bob: 0.9, stride: 0.45, lean: 0.03 }),
  caster: Object.freeze({ bob: 1.0, stride: 0.45, lean: 0.03 }),
  wraith: Object.freeze({ bob: 1.3, stride: 0.55, lean: 0.03 }),
  golem: Object.freeze({ bob: 0.5, stride: 0.35, lean: 0.015 }),
  boss: Object.freeze({ bob: 0.8, stride: 0.35, lean: 0.02 }),
});

export function enemyWalkProfile(shape) {
  return ENEMY_WALK_PROFILES[shape] || ENEMY_WALK_PROFILES.blob;
}

function buildEnemyAnim(tier) {
  const keyFeedback = tier !== 'off';
  const extras = tier === 'full';
  return Object.freeze({
    tier,
    walk: Object.freeze({
      enabled: extras,
      speed: ENEMY_ANIMATIONS.walk.speed,
      flyingSpeed: ENEMY_ANIMATIONS.walk.flyingSpeed,
    }),
    hitFlash: Object.freeze({
      enabled: keyFeedback,
      duration: ENEMY_ANIMATIONS.hitFlash.duration,
      decay: ENEMY_ANIMATIONS.hitFlash.decay,
      alpha: extras ? 0.95 : 0.8,
      // 高光外沿相对本体的半径倍数：高光落在剪影边缘之外一点，切分才锐利。
      radius: 1.08,
    }),
    // 死亡碎裂沿用 EffectRenderer 的现有粒子池（模拟层 death 事件 → kill 特效），
    // 渲染层不再复制一套粒子系统，这里只声明低配裁剪预算。
    deathShatter: Object.freeze({
      enabled: extras,
      source: ENEMY_ANIMATIONS.deathShatter.source,
      event: ENEMY_ANIMATIONS.deathShatter.event,
      duration: ENEMY_ANIMATIONS.deathShatter.duration,
      maxParticles: ENEMY_ANIMATIONS.deathShatter.maxParticles,
    }),
  });
}

export const ENEMY_ANIM_VARIANTS = Object.freeze({
  off: buildEnemyAnim('off'),
  light: buildEnemyAnim('light'),
  full: buildEnemyAnim('full'),
});

export function enemyAnimVariant(decorations) {
  return ENEMY_ANIM_VARIANTS[decorations] || ENEMY_ANIM_VARIANTS.light;
}

// 皮肤渲染预算：皮肤只改颜色与描边，不新增粒子/光晕。
// 低配把皮肤轮廓并进本体已有的主描边（零新增绘制调用），高配才单独描一圈皮肤环。
export const SKIN_OUTLINE_BUDGET = Object.freeze({
  off: 'none',
  light: 'merged',
  full: 'ring',
});

export function skinOutlineBudget(decorations) {
  return SKIN_OUTLINE_BUDGET[decorations] || SKIN_OUTLINE_BUDGET.light;
}

// 受击高光几何（FEEL-001 观感回归修复）：整身白圆会把剪影与形体层次一起洗掉，
// 改成轮廓优先的短时高光——亮环落在剪影外沿（锐利切分的主要来源），
// 外沿再加一圈细环，内侧一条细环保留形体层次，中心只留一枚接触核；
// 内部不刷色，剪影可读性不受影响。闪白覆盖仍达标（combat 指标帧 0.0014 ≥ 阈值 0.0004），
// 但高光能量集中在边缘而不是整身。
export const HIT_HIGHLIGHT = Object.freeze({
  rimWidth: 3.6,
  rimAlpha: 0.95,
  rimColor: '#ffffff',
  // 外沿细环：剪影之外的一圈锐利切分（不覆盖本体），让命中在混战里也读得出「边界」。
  haloScale: 1.22,
  haloWidth: 1.4,
  haloAlpha: 0.55,
  innerScale: 0.66,
  innerWidth: 1,
  innerAlpha: 0.3,
  innerColor: '#ffe9f4',
  coreScale: 0.14,
  coreAlpha: 0.9,
});
