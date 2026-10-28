// 技能表现层静态数据：画质档位与粒子上限、前摇预警规格、演出时长、事件分类正则与颜色工具。
//
// 纯常量与纯函数（不 import 任何运行时模块），供 skill-warnings / skill-draw / skill-renderer 共用。

// 粒子上限显式声明；画质档位在此之上决定各表现层开关。
export const QUALITY_CAPS = { minimal: 48, standard: 120, full: 180 };

// 画质档位：粒子预算与表现开关。低配只保留预警与命中闪光（玩法信息），
// 光晕、余韵、氛围粒子、横幅一律关闭。
export const SKILL_QUALITY_PROFILES = {
  minimal: { particles: QUALITY_CAPS.minimal, glow: false, afterglow: false, ambient: false, banner: false, tint: 0.34 },
  standard: { particles: QUALITY_CAPS.standard, glow: true, afterglow: true, ambient: true, banner: true, tint: 0.5 },
  full: { particles: QUALITY_CAPS.full, glow: true, afterglow: true, ambient: true, banner: true, tint: 0.62 },
};

const DEFAULT_QUALITY_PROFILE = SKILL_QUALITY_PROFILES.standard;

export function qualityProfile(tier) {
  return SKILL_QUALITY_PROFILES[tier] || DEFAULT_QUALITY_PROFILE;
}

// 前摇预警：地面标记 + 倒计时环。语义色、形状、线宽、虚线节奏与倒计时样式
// 统一来自 palette，这里只声明每个技能的起搏来源、时长与范围。
// cast = 渲染层在释放瞬间起搏；event = 沿用模拟层的 meteorWarn 事件（逐落点、位置精确）。
export const WARNING_SPECS = {
  aurora: { source: 'cast', semantic: 'control', ttl: 0.85, radius: 3.2, spin: 0.5 },
  meteor: { source: 'event', semantic: 'danger', ttl: 0.55, radius: 1.8, spin: 0 },
  chrono: { source: 'cast', semantic: 'buff', ttl: 1, radius: 4.4, spin: -0.4 },
  roar: { source: 'cast', semantic: 'danger', ttl: 0.85, radius: 3, spin: 0 },
  summon: { source: 'cast', semantic: 'danger', ttl: 0.85, radius: 2.2, spin: 0 },
  slam: { source: 'cast', semantic: 'danger', ttl: 0.85, radius: 2.5, spin: 0 },
};

// 演出最短真实时长：不受 3× 模拟速度影响。
export const MIN_REAL_SECONDS = { aurora: 2.4, meteor: 1.8, chrono: 2.8 };

export const AURORA_RE = /aurora|frost|ice|freeze|shatter|crystal|curtain|snow|slow|chill/i;
export const METEOR_RE = /meteor|ember|scorch|starburst|fire|burn|impact|blaze/i;
export const CHRONO_RE = /chrono|time|stasis|nova|star|clock|overdrive|bubble|echo/i;

export const clamp01 = (v) => Math.max(0, Math.min(1, v));

function parseHex(hex) {
  const value = String(hex || '#ffffff').replace('#', '');
  return {
    r: parseInt(value.slice(0, 2), 16) || 0,
    g: parseInt(value.slice(2, 4), 16) || 0,
    b: parseInt(value.slice(4, 6), 16) || 0,
  };
}

function toHex({ r, g, b }) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

// 技能主色向地图 accent 偏移，避免与地面/路径撞色。
export function mixHex(a, b, amount) {
  const left = parseHex(a);
  const right = parseHex(b);
  return toHex({
    r: left.r + (right.r - left.r) * amount,
    g: left.g + (right.g - left.g) * amount,
    b: left.b + (right.b - left.b) * amount,
  });
}

export function rgba(hex, alpha) {
  const { r, g, b } = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
