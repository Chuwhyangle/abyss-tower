// 首领特效绘制：蓄力、咆哮、召唤、震击四种首领技能的画法。
//
// 方法集合与 effect-draw.js 一起挂回 EffectRenderer 原型；配色走 palette 的语义规范。
import { TILE, BOSS_SKILLS } from '../shared/data.js';
import { BALANCE } from '../shared/config.js';
import { Palette, SKILL_WARNING_STYLE } from './palette.js';
import { eventVariant } from './effect-data.js';

const T = TILE;

export const effectBossDrawMethods = {
  drawBossCast(g, fx) {
    const { effect, p, x, y, glow, t, settings } = fx;
    // 蓄力：收缩的能量环 + 向心火花 + 旋转符文，随 progress 增强。
    // 预警配色/线宽/虚线走与玩家技能相同的语义规范（首领技能均为危险）。
    const skill = BOSS_SKILLS[effect.skill];
    const castColor = Palette.semanticColor(effect.skill, settings);
    const R = (skill?.radiusKey ? BALANCE[skill.radiusKey] || 2.5 : 2.2) * T;
    g.save();
    if (glow) g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.3 + p * 0.55;
    g.strokeStyle = castColor;
    g.lineWidth = SKILL_WARNING_STYLE.lineWidth;
    g.beginPath();
    g.arc(x, y, R * (0.55 - p * 0.35), 0, Math.PI * 2);
    g.stroke();

    g.save();
    g.translate(x, y);
    g.rotate(t * 2);
    g.setLineDash(SKILL_WARNING_STYLE.dash);
    g.beginPath();
    g.arc(0, 0, R * 0.3, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    g.restore();

    g.lineWidth = 1.6;
    g.lineCap = 'round';
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2 + t * 0.7;
      const outer = R * (0.42 - p * 0.26);
      const inner = Math.max(2, outer - 10 - p * 6);
      g.beginPath();
      g.moveTo(x + Math.cos(ang) * outer, y + Math.sin(ang) * outer);
      g.lineTo(x + Math.cos(ang) * inner, y + Math.sin(ang) * inner);
      g.stroke();
    }
    if (glow) this.glow.draw(g, castColor, x, y, R * 0.5, 0.15 + p * 0.25);
    g.restore();
  },

  drawBossRoar(g, fx) {
    const { effect, p, fade, x, y, color, glow } = fx;
    // 咆哮：扩散冲击波 + 声波刻度。
    const R = (effect.r || 2) * T;
    const rr = R * Math.min(1, p * 1.15);
    g.save();
    if (glow) g.globalCompositeOperation = 'lighter';
    if (glow && p < 0.5) this.glow.draw(g, color, x, y, rr * 0.8, 0.35 * (1 - p / 0.5));
    g.globalAlpha = fade * 0.95;
    g.strokeStyle = color;
    g.lineWidth = 1.5 + 4 * (1 - p);
    g.beginPath();
    g.arc(x, y, rr, 0, Math.PI * 2);
    g.stroke();

    g.globalAlpha = fade * 0.45;
    g.lineWidth = 1.3;
    g.beginPath();
    g.arc(x, y, rr * 0.7, 0, Math.PI * 2);
    g.stroke();

    g.globalAlpha = fade * 0.6;
    g.lineWidth = 2;
    g.lineCap = 'round';
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2 + p * 0.4;
      const tip = rr + 7 + (i % 2) * 3;
      g.beginPath();
      g.moveTo(x + Math.cos(ang) * (rr + 2), y + Math.sin(ang) * (rr + 2));
      g.lineTo(x + Math.cos(ang) * tip, y + Math.sin(ang) * tip);
      g.stroke();
    }
    g.restore();
  },

  drawBossSummon(g, fx) {
    const { p, fade, x, y, color, glow, t } = fx;
    // 召唤：旋转裂隙圈 + 上升光点 + 中心裂缝。
    const R = 0.9 * T;
    const rr = R * (0.6 + p * 0.5);
    g.save();
    if (glow) g.globalCompositeOperation = 'lighter';
    g.translate(x, y);
    g.rotate(t * 1.8);
    g.globalAlpha = fade;
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.setLineDash([6, 5]);
    g.beginPath();
    g.arc(0, 0, rr, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    g.globalAlpha = fade * 0.5;
    g.beginPath();
    g.arc(0, 0, rr * 0.6, 0, Math.PI * 2);
    g.stroke();
    g.restore();

    g.save();
    if (glow) g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      const ph = (p * 1.6 + i * 0.17) % 1;
      g.globalAlpha = fade * (1 - ph) * 0.8;
      g.fillStyle = i % 2 ? color : '#ffd7ef';
      g.beginPath();
      g.arc(x + Math.cos(i * 1.3) * R * 0.8, y - ph * 26, 1.6 + (1 - ph) * 1.4, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = fade * 0.55;
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x - 8, y + 4);
    g.lineTo(x, y - 14 - p * 6);
    g.lineTo(x + 8, y + 4);
    g.stroke();
    g.restore();
  },

  drawBossSlam(g, fx) {
    const { effect, p, fade, x, y, color, glow } = fx;
    // 震击：重型扩散环 + 地裂 + 碎石。
    const R = (effect.r || 2.5) * T;
    const rr = R * Math.min(1, p * 1.1);
    g.save();
    if (glow) g.globalCompositeOperation = 'lighter';
    if (glow && p < 0.55) this.glow.draw(g, color, x, y, rr, 0.45 * (1 - p / 0.55));
    g.globalAlpha = fade * 0.95;
    g.strokeStyle = color;
    g.lineWidth = 2 + 5 * (1 - p);
    g.beginPath();
    g.arc(x, y, rr, 0, Math.PI * 2);
    g.stroke();

    g.globalAlpha = fade * 0.5;
    g.lineWidth = 1.4;
    g.beginPath();
    g.arc(x, y, rr * 0.55, 0, Math.PI * 2);
    g.stroke();

    g.globalAlpha = fade * 0.7;
    g.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2 + 0.3;
      const r0 = rr * 0.35;
      const r1 = rr * (0.85 + (i % 3) * 0.1);
      g.beginPath();
      g.moveTo(x + Math.cos(ang) * r0, y + Math.sin(ang) * r0);
      g.lineTo(x + Math.cos(ang + 0.1) * (r0 + r1) * 0.5, y + Math.sin(ang + 0.1) * (r0 + r1) * 0.5);
      g.lineTo(x + Math.cos(ang) * r1, y + Math.sin(ang) * r1);
      g.stroke();
    }

    g.globalAlpha = fade * 0.8;
    for (let i = 0; i < 9; i++) {
      const ang = (i / 9) * Math.PI * 2 + 0.5;
      const dist = rr * (0.5 + p * 0.5);
      g.fillStyle = i % 3 === 0 ? '#efe6d8' : color;
      g.beginPath();
      g.arc(
        x + Math.cos(ang) * dist,
        y + Math.sin(ang) * dist - p * 7,
        Math.max(0.8, 3 * (1 - p)),
        0,
        Math.PI * 2
      );
      g.fill();
    }
    g.restore();
  },

};
