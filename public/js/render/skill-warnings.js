// 前摇预警：把每个技能的起搏来源/时长/范围（原始规格在 skill-data.js）解析成语义色与形状配置。
//
// 另含地面标记 + 倒计时环的绘制方法集（挂回 SkillRenderer 原型，签名不变）。
import { BOSS_SKILLS, SKILL_ORDER, TILE } from '../shared/data.js';
import { Palette, SKILL_WARNING_STYLE } from './palette.js';
import { WARNING_SPECS, clamp01, rgba } from './skill-data.js';

const T = TILE;

function buildWarningProfile(entry) {
  const semantic = Palette.semantic(entry.semantic);
  return Object.freeze({
    source: entry.source,
    semantic: semantic.id,
    shape: semantic.shape,
    ttl: entry.ttl,
    radius: entry.radius,
    spin: entry.spin,
    dash: SKILL_WARNING_STYLE.dash,
    fill: SKILL_WARNING_STYLE.fill,
    lineWidth: SKILL_WARNING_STYLE.lineWidth,
    countdownWidth: SKILL_WARNING_STYLE.countdownWidth,
    ring: true,
  });
}

// 玩家技能的预警配置与 SKILL_ORDER 一一对应（既有契约）。
export const SKILL_WARNING_PROFILES = Object.freeze(
  Object.fromEntries(SKILL_ORDER.map((id) => [id, buildWarningProfile(WARNING_SPECS[id])]))
);

// 完整预警注册表：玩家技能 + 首领技能，保证“所有技能都有预警定义”。
export const SKILL_WARNING_REGISTRY = Object.freeze({
  ...SKILL_WARNING_PROFILES,
  ...Object.fromEntries(Object.keys(BOSS_SKILLS).map((id) => [id, buildWarningProfile(WARNING_SPECS[id])])),
});

const DEFAULT_WARNING_PROFILE = buildWarningProfile({
  source: 'cast',
  semantic: 'danger',
  ttl: 0.7,
  radius: 2.2,
  spin: 0,
});

export function warningProfile(id) {
  return SKILL_WARNING_REGISTRY[id] || DEFAULT_WARNING_PROFILE;
}

// 倒计时环比例：剩余时间 / 总时长，1 → 0；非法输入回退 0（不画环）。
export function warningCountdown(remaining, duration) {
  const total = Number(duration);
  const left = Number(remaining);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(left)) return 0;
  return clamp01(left / total);
}

// 绘制方法集：挂在 SkillRenderer 原型上，实例字段（_warn / profile / settings）由类持有。
export const skillWarningMethods = {
  // 前摇地面标记 + 倒计时环：只描边与低透明填充，不遮挡路径信息。
  _drawTelegraph(g, time) {
    const warn = this._warn;
    if (!warn.id || warn.ttl <= 0) return;
    const profile = warn.profile || warningProfile(warn.id);
    const color = Palette.semanticColor(profile.semantic, this.settings);
    const left = warningCountdown(warn.ttl, warn.maxTtl);
    if (left <= 0) return;
    const r = profile.radius * T;
    const alpha = 0.35 + 0.5 * left;

    g.save();
    g.translate(warn.x, warn.y);
    g.globalAlpha = alpha;
    g.strokeStyle = rgba(color, 0.6);
    g.fillStyle = rgba(color, profile.fill);
    g.lineWidth = profile.lineWidth;
    g.setLineDash(SKILL_WARNING_STYLE.dash);
    g.lineDashOffset = -time * SKILL_WARNING_STYLE.dashScroll;
    this._traceWarningShape(g, profile.shape, r, time * profile.spin);
    g.fill();
    g.stroke();
    g.setLineDash([]);

    // 倒计时环：剩余比例收缩，越接近命中越短。
    const start = -Math.PI / 2;
    g.strokeStyle = rgba(SKILL_WARNING_STYLE.countdownColor, 0.72);
    g.lineWidth = profile.countdownWidth;
    g.beginPath();
    g.arc(0, 0, r * 0.82, start, start + Math.PI * 2 * left);
    g.stroke();

    if (this.profile.glow) {
      // 高配才画内圈刻度；低配只保留预警与命中闪光。
      g.strokeStyle = rgba(color, 0.35);
      g.lineWidth = 1;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + time * 0.8;
        g.beginPath();
        g.moveTo(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62);
        g.lineTo(Math.cos(a) * r * 0.74, Math.sin(a) * r * 0.74);
        g.stroke();
      }
    }
    g.restore();
  },

  _traceWarningShape(g, shape, r, spin) {
    g.beginPath();
    if (shape === 'hex') {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + spin;
        if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
    } else if (shape === 'star') {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + spin;
        const radius = i % 2 === 0 ? r : r * 0.58;
        if (i === 0) g.moveTo(Math.cos(a) * radius, Math.sin(a) * radius);
        else g.lineTo(Math.cos(a) * radius, Math.sin(a) * radius);
      }
    } else {
      g.arc(0, 0, r, 0, Math.PI * 2);
      return;
    }
    g.closePath();
  }
};
