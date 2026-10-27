// 高潮演出规格（AC-017）：漏怪 / 清波 / 首领死亡三个低频事件的独立签名。
//
// 边界（docs/PHASE_FEEL_ART.md §3.6 / §3.8）：
//   - 纯数据 + 纯函数：不 import 模拟层 / 渲染层 / DOM，不出现未播种随机；
//   - 只描述「怎么演」：不读写结算、不决定胜负，模拟侧只负责记录事件；
//   - 三个 kind 的横幅键 / 闪光颜色 / 脉冲形态 / 慢动作倍率 / 时长两两不同，
//     这样「三段独立演出」可以被机械判定，而不是靠肉眼主观感受；
//   - 降级只削减运动分量（位移 / 缩放 / 扩散 / 慢动作），
//     横幅、色块与边框这些非运动反馈原样保留。

// 三个 kind 的固定顺序：新增 kind 必须同时改这里与 CULMINATION_SPECS。
export const CULMINATION_KINDS = Object.freeze(['leak', 'waveClear', 'bossKill']);

// 冻结表（与 docs/PHASE_FEEL_ART.md §3.6 的签名表一一对应；只改一处视为漂移）。
//   accent     横幅与静态边框的基色
//   flash      屏幕闪光：color 必须三者不同，peak 为峰值透明度，duration 为闪光时长（秒）
//   pulse      脉冲形态：ring = 基地同心环，sweep = 水平扫光，burst = 多层扩散环
//   motion     完整模式下的运动分量：timeScale 为视觉 dt 倍率（清波/首领慢动作）
const SPECS = {
  leak: {
    id: 'leak',
    bannerKey: 'feel.culmination.leak.title',
    detailKey: 'feel.culmination.leak.detail',
    accent: '#ff5d5d',
    flash: { color: '#e03a3a', peak: 0.5, duration: 0.6 },
    pulse: { shape: 'ring', color: '#ff6b6b', rings: 3 },
    duration: 0.9,
    motion: { timeScale: 1, shake: 0.5, zoom: 0.004 },
  },
  waveClear: {
    id: 'waveClear',
    bannerKey: 'feel.culmination.waveClear.title',
    detailKey: 'feel.culmination.waveClear.detail',
    accent: '#ffd36b',
    flash: { color: '#f2b53c', peak: 0.45, duration: 1 },
    pulse: { shape: 'sweep', color: '#ffe9a8', rings: 2 },
    duration: 1.6,
    motion: { timeScale: 0.55, shake: 0.15, zoom: 0.012 },
  },
  bossKill: {
    id: 'bossKill',
    bannerKey: 'feel.culmination.bossKill.title',
    detailKey: 'feel.culmination.bossKill.detail',
    accent: '#e8f0ff',
    flash: { color: '#ffffff', peak: 0.8, duration: 0.7 },
    pulse: { shape: 'burst', color: '#cfe2ff', rings: 4 },
    duration: 2.2,
    motion: { timeScale: 0.4, shake: 0.9, zoom: 0.02 },
  },
};

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

export const CULMINATION_SPECS = deepFreeze(SPECS);

// 未知 kind 返回 null：渲染层跳过并计数，不抛错。
export function culminationSpec(kind) {
  if (typeof kind !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(CULMINATION_SPECS, kind)
    ? CULMINATION_SPECS[kind]
    : null;
}

// 单条演出的播放计划：完整模式透传运动分量，降级模式把运动归零但保留非运动反馈。
export function culminationPlan(kind, { reducedMotion = false, shake = true } = {}) {
  const spec = culminationSpec(kind);
  if (!spec) return null;
  const reduced = reducedMotion === true || shake === false;
  return {
    kind: spec.id,
    bannerKey: spec.bannerKey,
    detailKey: spec.detailKey,
    accent: spec.accent,
    flash: { ...spec.flash },
    pulse: { ...spec.pulse },
    duration: spec.duration,
    motion: reduced
      ? { mode: 'reduced', timeScale: 1, shake: 0, zoom: 0, pulse: false }
      : {
          mode: 'full',
          timeScale: spec.motion.timeScale,
          shake: spec.motion.shake,
          zoom: spec.motion.zoom,
          pulse: true,
        },
  };
}
