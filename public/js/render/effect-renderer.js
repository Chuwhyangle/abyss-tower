// 特效绘制：环形冲击、火花、闪电、枪口、生成、死亡、治疗、放置、中毒、漏怪。
// 首领系列：蓄力、咆哮、召唤、震击、防御塔停摆。
import { TILE, BOSS_SKILLS } from '../shared/data.js';
import { BALANCE } from '../shared/config.js';
import { Palette } from './palette.js';

const T = TILE;

export class EffectRenderer {
  constructor(game, { glow }) {
    this.game = game;
    this.glow = glow;
  }

  render(g, time, settings) {
    const glow = settings.glow;
    const t = time;

    for (const effect of this.game.effects) {
      const k = effect.ttl / (effect.maxTtl || 0.3);
      const p = 1 - Math.max(0, Math.min(1, k));
      const fade = Math.max(0, Math.min(1, k));
      const x = effect.x * T;
      const y = effect.y * T;
      const color = effect.color || '#ffd36b';

      if (effect.kind === 'ring') {
        const radius = (effect.r0 + (effect.r1 - effect.r0) * p) * T;
        g.save();
        if (glow) g.globalCompositeOperation = 'lighter';
        if (glow && p < 0.45) {
          this.glow.draw(g, color, x, y, radius * 0.75, 0.42 * (1 - p / 0.45));
        }
        g.globalAlpha = fade * 0.95;
        g.strokeStyle = color;
        g.lineWidth = 0.8 + 3 * (1 - p);
        g.beginPath();
        g.arc(x, y, radius, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = fade * 0.4;
        g.lineWidth = 1.1;
        g.beginPath();
        g.arc(x, y, radius * 0.74, 0, Math.PI * 2);
        g.stroke();
        g.restore();
      } else if (effect.kind === 'spark') {
        g.save();
        if (glow) g.globalCompositeOperation = 'lighter';
        g.globalAlpha = fade;
        g.strokeStyle = color;
        g.lineWidth = 1.7;
        g.lineCap = 'round';
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + 0.35;
          const inner = 2.5 + p * 3;
          const outer = 6 + p * (9 + (i % 2) * 4);
          g.beginPath();
          g.moveTo(x + Math.cos(a) * inner, y + Math.sin(a) * inner);
          g.lineTo(x + Math.cos(a) * outer, y + Math.sin(a) * outer);
          g.stroke();
        }
        g.fillStyle = Palette.withAlpha('#ffffff', fade * 0.85);
        g.beginPath();
        g.arc(x, y, 2.6 * (1 - p * 0.6), 0, Math.PI * 2);
        g.fill();
        g.restore();
      } else if (effect.kind === 'bolt') {
        g.save();
        if (glow) {
          g.globalCompositeOperation = 'lighter';
          g.globalAlpha = (1 - p) * 0.28;
          g.strokeStyle = color;
          g.lineWidth = 7;
          this.strokeBolt(g, effect.points, x, y);
          g.globalAlpha = (1 - p) * 0.5;
          g.lineWidth = 3.5;
          this.strokeBolt(g, effect.points, x, y);
          g.globalCompositeOperation = 'source-over';
        }
        g.globalAlpha = 1 - p * 0.85;
        g.strokeStyle = '#f6f0ff';
        g.lineWidth = 1.6;
        this.strokeBolt(g, effect.points, x, y);
        g.restore();
      } else if (effect.kind === 'muzzle') {
        g.save();
        g.translate(x, y);
        g.rotate(effect.angle);
        if (glow) g.globalCompositeOperation = 'lighter';
        g.globalAlpha = fade;
        g.fillStyle = Palette.withAlpha(color, 0.55);
        g.beginPath();
        g.moveTo(0, -4.5);
        g.lineTo(18, -1.6);
        g.lineTo(18, 1.6);
        g.lineTo(0, 4.5);
        g.closePath();
        g.fill();
        g.fillStyle = Palette.withAlpha('#ffffff', fade * 0.8);
        g.beginPath();
        g.arc(2, 0, 2.6, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = fade * 0.22;
        g.fillStyle = '#c9c2b4';
        g.beginPath();
        g.arc(6 + p * 8, Math.sin(p * 5) * 2, 3 + p * 3.5, 0, Math.PI * 2);
        g.fill();
        g.restore();
      } else if (effect.kind === 'spawn') {
        g.save();
        if (glow) g.globalCompositeOperation = 'lighter';
        const rr = 8 + p * 22;
        g.globalAlpha = fade * 0.85;
        g.strokeStyle = color;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(x, y, rr, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = fade * 0.5;
        g.setLineDash([4, 6]);
        g.lineWidth = 1.4;
        g.beginPath();
        g.arc(x, y, rr * 0.66, t * 2, t * 2 + Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
        g.globalAlpha = fade * 0.35;
        g.beginPath();
        g.ellipse(x, y + 8, rr * 0.9, rr * 0.34, 0, 0, Math.PI * 2);
        g.stroke();
        g.restore();
      } else if (effect.kind === 'death') {
        g.save();
        g.globalAlpha = fade * 0.9;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + 0.4;
          const dist = p * (effect.r + 0.55) * T;
          const shard = Math.max(0.8, 3.6 * (1 - p));
          g.fillStyle = i % 3 === 0 ? '#efe6d8' : color;
          g.beginPath();
          g.arc(x + Math.cos(a) * dist, y + Math.sin(a) * dist - p * 6, shard, 0, Math.PI * 2);
          g.fill();
        }
        g.globalAlpha = fade * 0.14;
        g.fillStyle = '#0c0a10';
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2 + p;
          g.beginPath();
          g.arc(x + Math.cos(a) * p * 10, y - p * 8 - i, 7 + p * 9, 0, Math.PI * 2);
          g.fill();
        }
        if (glow) {
          g.globalCompositeOperation = 'lighter';
          g.globalAlpha = fade * 0.4;
          g.strokeStyle = color;
          g.lineWidth = 1.4;
          g.beginPath();
          g.arc(x, y, p * (effect.r + 0.9) * T, 0, Math.PI * 2);
          g.stroke();
        }
        g.restore();
      } else if (effect.kind === 'heal') {
        g.save();
        if (glow) g.globalCompositeOperation = 'lighter';
        g.strokeStyle = '#7cf0b8';
        g.lineWidth = 2.2;
        g.lineCap = 'round';
        for (let i = 0; i < 2; i++) {
          const rise = p * 22 + i * 9;
          const s = 4.5 - i * 1.2;
          const hx = x + (i === 0 ? 0 : 6);
          const hy = y - rise;
          g.globalAlpha = fade * (i === 0 ? 0.95 : 0.5);
          g.beginPath();
          g.moveTo(hx - s, hy);
          g.lineTo(hx + s, hy);
          g.moveTo(hx, hy - s);
          g.lineTo(hx, hy + s);
          g.stroke();
        }
        g.restore();
      } else if (effect.kind === 'place') {
        g.save();
        if (glow) g.globalCompositeOperation = 'lighter';
        const rr = 6 + p * 22;
        g.globalAlpha = fade * 0.85;
        g.strokeStyle = color;
        g.lineWidth = 2.2;
        g.beginPath();
        g.arc(x, y, rr, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = fade * 0.7;
        g.lineWidth = 1.6;
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + p * 1.6;
          g.beginPath();
          g.moveTo(x + Math.cos(a) * (rr + 3), y + Math.sin(a) * (rr + 3));
          g.lineTo(x + Math.cos(a) * (rr + 8), y + Math.sin(a) * (rr + 8));
          g.stroke();
        }
        g.globalAlpha = fade * 0.3;
        const beam = g.createLinearGradient(x, y - 26, x, y + 4);
        beam.addColorStop(0, Palette.withAlpha(color, 0));
        beam.addColorStop(0.7, Palette.withAlpha(color, 0.55));
        beam.addColorStop(1, Palette.withAlpha(color, 0));
        g.fillStyle = beam;
        g.fillRect(x - 3, y - 26, 6, 30);
        g.restore();
      } else if (effect.kind === 'poison') {
        g.save();
        if (glow) g.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 3; i++) {
          const ph = (p + i * 0.3) % 1;
          g.globalAlpha = fade * (1 - ph) * 0.75;
          g.fillStyle = '#9adf6a';
          g.beginPath();
          g.arc(x + Math.sin(ph * 8 + i) * 5, y - ph * 16, 2.4 * (1 - ph * 0.55), 0, Math.PI * 2);
          g.fill();
        }
        g.restore();
      } else if (effect.kind === 'leak') {
        g.save();
        const rr = 12 + p * 28;
        if (glow) this.glow.draw(g, '#ff4c4c', x, y, rr, fade * 0.45);
        g.globalAlpha = fade * 0.75;
        g.strokeStyle = '#ff5a5a';
        g.lineWidth = 2.4;
        g.beginPath();
        g.arc(x, y, rr, 0, Math.PI * 2);
        g.stroke();
        g.restore();
      } else if (effect.kind === 'bossCast') {
        // 蓄力：收缩的能量环 + 向心火花 + 旋转符文，随 progress 增强。
        const skill = BOSS_SKILLS[effect.skill];
        const castColor = skill?.color || color;
        const R = (skill?.radiusKey ? BALANCE[skill.radiusKey] || 2.5 : 2.2) * T;
        g.save();
        if (glow) g.globalCompositeOperation = 'lighter';
        g.globalAlpha = 0.3 + p * 0.55;
        g.strokeStyle = castColor;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(x, y, R * (0.55 - p * 0.35), 0, Math.PI * 2);
        g.stroke();

        g.save();
        g.translate(x, y);
        g.rotate(t * 2);
        g.setLineDash([5, 7]);
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
      } else if (effect.kind === 'bossRoar') {
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
      } else if (effect.kind === 'bossSummon') {
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
      } else if (effect.kind === 'bossSlam') {
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
      } else if (effect.kind === 'towerDisable') {
        // 停摆：短路环 + 闪烁电弧（持续整个停摆时长）。
        const flick = 0.55 + 0.45 * Math.sin(t * 26 + 1.3);
        const rr = 22;
        g.save();
        if (glow) g.globalCompositeOperation = 'lighter';
        g.globalAlpha = fade * (0.45 + 0.35 * flick);
        g.strokeStyle = color;
        g.lineWidth = 1.6;
        g.setLineDash([4, 6]);
        g.lineDashOffset = t * 30;
        g.beginPath();
        g.arc(x, y, rr, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);

        g.globalAlpha = fade * (0.5 + 0.5 * flick);
        g.lineWidth = 1.5;
        g.lineCap = 'round';
        for (let i = 0; i < 3; i++) {
          const a0 = t * 3 + (i / 3) * Math.PI * 2;
          const jitter = Math.sin(t * 17 + i * 2.1) * 3;
          g.beginPath();
          g.moveTo(x + Math.cos(a0) * (rr - 4), y + Math.sin(a0) * (rr - 4));
          g.lineTo(x + Math.cos(a0 + 0.25) * (rr + 3) + jitter, y + Math.sin(a0 + 0.25) * (rr + 3));
          g.lineTo(x + Math.cos(a0 + 0.5) * (rr - 2), y + Math.sin(a0 + 0.5) * (rr - 2) - jitter);
          g.stroke();
        }

        g.globalAlpha = fade * 0.35 * flick;
        g.fillStyle = color;
        g.beginPath();
        g.arc(x, y, 5 + flick * 2, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    }
  }

  strokeBolt(g, points, offsetX = 0, offsetY = 0) {
    if (!points || points.length < 2) return;
    g.beginPath();
    for (let i = 0; i < points.length; i++) {
      const px = points[i].x * T;
      const py = points[i].y * T;
      if (i === 0) {
        g.moveTo(px, py);
        continue;
      }
      const prev = points[i - 1];
      const ax = prev.x * T;
      const ay = prev.y * T;
      const midX = (ax + px) / 2 + (Math.random() - 0.5) * 12;
      const midY = (ay + py) / 2 + (Math.random() - 0.5) * 12;
      g.lineTo(midX, midY);
      g.lineTo(px, py);
    }
    g.stroke();
  }
}
