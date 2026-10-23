// 特效绘制：环形冲击、火花、闪电、枪口、生成、死亡、治疗、放置、中毒、漏怪。
import { TILE } from '../shared/data.js';
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
