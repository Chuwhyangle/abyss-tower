// 命中类别层：由结构化命中事件纯推导的三类表现分类（AC-030 / GOAL-005）。
// 无 DOM / Canvas / 随机源，不 import 模拟 / 渲染 / 设置；输入就是 shared/impact-events.js 的事件 schema。
// 判据与文案冻结在 docs/TECH_DESIGN.md §4.6，层序 / 配色 / 档位降级冻结在 docs/PHASE_FEEL_ART.md §3.2。
//
// 三类各自独立可辨识：色相、后缀、飘字层 z 两两不同，特效形态也不同；
// 类别表的 floater 字段是这三层的唯一定义处，FLOATER_LAYERS 从这里取色 / 字号 / 字重 / z。

const finiteOrZero = (value) => (Number.isFinite(value) ? value : 0);

// 类别表：priority 越小越先保留（与飘字帧预算的重要性序一致：暴击 1 → 破盾 2 → 首领 3 → 护甲 4）。
// event 是该类别在 effect-renderer 的 EFFECT_EVENTS 里的事件键（破盾层名 shield ≠ 类别名 shieldBreak）。
export const IMPACT_CLASSES = Object.freeze({
  shieldBreak: Object.freeze({
    priority: 2,
    event: 'shieldBreak',
    floater: Object.freeze({
      layer: 'shield',
      z: 80,
      // 类别飘字抬离普通伤害数字那一行：同一次命中往往会同时飘出武器层数字。
      lift: 1.25,
      size: 20,
      weight: 800,
      color: '#66d9ff',
      suffix: '破盾',
      big: true,
    }),
    vfx: Object.freeze({
      shape: 'hexring',
      color: '#66d9ff',
      accent: '#d6f6ff',
      particles: 14,
      ring: 1.05,
      spin: 0.3,
      duration: 0.4,
    }),
  }),
  bossHit: Object.freeze({
    priority: 3,
    event: 'bossHit',
    floater: Object.freeze({
      layer: 'bossHit',
      z: 70,
      lift: 1,
      size: 19,
      weight: 800,
      color: '#ff7ad9',
      suffix: '',
      big: true,
    }),
    vfx: Object.freeze({
      shape: 'burst',
      color: '#ff7ad9',
      accent: '#ffe9a8',
      particles: 10,
      ring: 1.2,
      spin: 0.12,
      duration: 0.35,
    }),
  }),
  armor: Object.freeze({
    priority: 4,
    event: 'armorAbsorb',
    floater: Object.freeze({
      layer: 'armor',
      z: 60,
      lift: 0.75,
      size: 18,
      weight: 700,
      color: '#9fb4c9',
      suffix: '甲',
      big: false,
    }),
    vfx: Object.freeze({
      shape: 'shards',
      color: '#9fb4c9',
      accent: '#e3ecf5',
      particles: 8,
      ring: 0.8,
      spin: 0.5,
      duration: 0.3,
    }),
  }),
});

export const IMPACT_CLASS_NAMES = Object.freeze(
  Object.keys(IMPACT_CLASSES).sort((a, b) => IMPACT_CLASSES[a].priority - IMPACT_CLASSES[b].priority)
);

// 事件 → 类别谓词（与 §4.6 判据表逐行对应）。
const PREDICATES = Object.freeze({
  // 首领三变体的 enemy.type 同为 'boss'；target.boss 兼容手工构造的事件。
  bossHit: (event) => {
    const target = event.target;
    return Boolean(target) && typeof target === 'object' && (target.boss === true || target.type === 'boss');
  },
  // 本击打穿盾（余量落到本体）才算破盾；纯吸收（hpLost === 0）不触发。
  shieldBreak: (event) => finiteOrZero(event.shieldAbsorbed) > 0 && finiteOrZero(event.hpLost) > 0,
  armor: (event) => finiteOrZero(event.armorAbsorbed) > 0,
});

// 文案构造：数值一律取整；后缀取自类别表，保证与 IMPACT_CLASSES[cls].floater.suffix 一致。
const TEXT_BUILDERS = Object.freeze({
  // 首领命中显示该击实际扣血；盾未破而完全吸收时退回吸收量，避免飘出「-0」。
  bossHit: (event) => `-${Math.round(bossHitNumber(event))}`,
  shieldBreak: (event) =>
    `${IMPACT_CLASSES.shieldBreak.floater.suffix} -${Math.round(finiteOrZero(event.shieldAbsorbed))}`,
  armor: (event) =>
    `-${Math.round(finiteOrZero(event.armorAbsorbed))} ${IMPACT_CLASSES.armor.floater.suffix}`,
});

function bossHitNumber(event) {
  const hpLost = finiteOrZero(event.hpLost);
  return hpLost > 0 ? hpLost : finiteOrZero(event.shieldAbsorbed);
}

// 纯推导：返回按 priority 升序的类别名数组；非法输入返回空数组，永不抛错。
export function classifyImpactClasses(event) {
  if (!event || typeof event !== 'object') return [];
  const matched = IMPACT_CLASS_NAMES.filter((cls) => PREDICATES[cls](event));
  return matched.sort((a, b) => IMPACT_CLASSES[a].priority - IMPACT_CLASSES[b].priority);
}

// 类别飘字文案；未知类别返回 null（调用方跳过，不产出空飘字）。
export function classFloaterText(event, cls) {
  if (!Object.prototype.hasOwnProperty.call(IMPACT_CLASSES, cls)) return null;
  if (!event || typeof event !== 'object') return null;
  return TEXT_BUILDERS[cls](event);
}

// 类别特效规格：按档位缩放粒子并以 maxParticles 钳制；任何档位至少 1 颗，
// 粒子耗尽 / 低档时渲染层仍有「核心闪白 + 类别色环」保底（见 degrade 字段）。
export function classVfxSpec(cls, profile = {}) {
  if (!Object.prototype.hasOwnProperty.call(IMPACT_CLASSES, cls)) return null;
  const vfx = IMPACT_CLASSES[cls].vfx;
  const source = profile && typeof profile === 'object' ? profile : {};
  const scale = Number.isFinite(source.particleScale) ? Math.max(0, source.particleScale) : 1;
  const cap = Number.isFinite(source.maxParticles) ? Math.max(0, Math.floor(source.maxParticles)) : vfx.particles;
  const particles = Math.max(1, Math.min(cap, Math.round(vfx.particles * scale)));
  return Object.freeze({
    class: cls,
    shape: vfx.shape,
    color: vfx.color,
    accent: vfx.accent,
    ring: vfx.ring,
    spin: vfx.spin,
    duration: vfx.duration,
    particles,
    // 保底层与档位无关：核心闪白 + 类别色环，粒子被裁到 1 时画面仍可辨识。
    degrade: Object.freeze({ core: '#ffffff', ring: true }),
  });
}

// 三类同帧粒子合计：与 profile.poolBudget 比较，供预算测试与性能记录使用。
export function classParticleTotal(profile = {}, classes = IMPACT_CLASS_NAMES) {
  return classes.reduce((sum, cls) => {
    const spec = classVfxSpec(cls, profile);
    return sum + (spec ? spec.particles : 0);
  }, 0);
}
