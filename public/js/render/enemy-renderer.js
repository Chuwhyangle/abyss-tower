// 敌人绘制：阴影、光晕、形体、受击闪白、减速/中毒状态、血条与首领标签。
import { TILE, ENEMIES } from '../shared/data.js';
import { Palette } from './palette.js';
import { CanvasShapes } from './canvas-shapes.js';

const T = TILE;

export class EnemyRenderer {
  constructor(game, { glow }) {
    this.game = game;
    this.glow = glow;
  }

  render(g, time, settings) {
    const game = this.game;
    const t = time;
    const glow = settings.glow;

    for (const enemy of game.enemies) {
      if (enemy.dead) continue;
      const def = ENEMIES[enemy.type];
      const x = enemy.x * T;
      const y = enemy.y * T;
      const r = enemy.r * T;
      const lift = enemy.flying ? 12 : 0;
      const vr = r * 1.12;
      const bob = enemy.flying
        ? Math.sin(t * 10 + enemy.id) * 1.6
        : Math.sin(t * 7 + enemy.id) * 1.1;

      g.fillStyle = `rgba(0,0,0,${enemy.flying ? 0.2 : 0.32})`;
      g.beginPath();
      g.ellipse(x, y + 8, vr * 1.05, vr * 0.42, 0, 0, Math.PI * 2);
      g.fill();

      if (enemy.boss && glow) {
        this.glow.draw(g, '#e25096', x, y - lift, vr * 2.3, 0.3);
      } else if (enemy.heal > 0 && glow) {
        this.glow.draw(g, '#5af0aa', x, y - lift, vr * 2, 0.18);
      }

      g.save();
      g.translate(x, y - lift + bob);
      if (def.shape === 'dart') g.rotate(enemy.angle);
      else if (def.shape === 'hex') g.rotate(Math.sin(enemy.id) * 0.08);
      this.drawEnemyBody(g, time, enemy, def, vr);

      if (enemy.hitFlash > 0) {
        g.globalAlpha = enemy.hitFlash * 0.32;
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.arc(0, 0, vr * 1.08, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 1;
      }

      // 减速：冰晶与光环
      if (t < enemy.slowUntil) {
        g.strokeStyle = 'rgba(140, 225, 255, 0.8)';
        g.lineWidth = 1.6;
        g.beginPath();
        g.arc(0, 0, vr + 4, 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = 'rgba(190, 245, 255, 0.85)';
        for (let i = 0; i < 3; i++) {
          const a = t * 1.4 + (i / 3) * Math.PI * 2;
          const px = Math.cos(a) * (vr + 6);
          const py = Math.sin(a) * (vr + 6);
          g.beginPath();
          g.moveTo(px, py - 2.6);
          g.lineTo(px + 2, py);
          g.lineTo(px, py + 2.6);
          g.lineTo(px - 2, py);
          g.closePath();
          g.fill();
        }
      }

      // 中毒：绿色气泡
      if (t < enemy.poisonUntil) {
        g.strokeStyle = 'rgba(154, 223, 106, 0.5)';
        g.lineWidth = 1.6;
        g.beginPath();
        g.arc(0, 0, vr + 7, 0.3, 0.3 + Math.PI * 1.2);
        g.stroke();
        for (let i = 0; i < 2; i++) {
          const phase = (t * 1.6 + i * 0.5) % 1;
          g.fillStyle = `rgba(154, 223, 106, ${0.55 * (1 - phase)})`;
          g.beginPath();
          g.arc(
            Math.sin(t * 3 + i * 2) * vr * 0.6,
            -vr - phase * 12,
            1.4 + phase * 1.3,
            0,
            Math.PI * 2
          );
          g.fill();
        }
      }
      g.restore();

      // 血条
      if (enemy.hp < enemy.maxHp || enemy.boss) {
        const width = enemy.boss ? 76 : Math.max(24, vr * 2.4);
        const bx = x - width / 2;
        const by = y - lift - vr - (enemy.boss ? 18 : 12);
        g.fillStyle = 'rgba(4, 8, 10, 0.78)';
        CanvasShapes.roundRect(g, bx - 1.5, by - 1.5, width + 3, 7, 3);
        g.fill();
        const ratio = Math.max(0, enemy.hp / enemy.maxHp);
        g.fillStyle = ratio > 0.55 ? '#7ce38b' : ratio > 0.25 ? '#e8c35a' : '#ef5f5f';
        CanvasShapes.roundRect(g, bx, by, Math.max(2, width * ratio), 4, 2);
        g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.12)';
        g.lineWidth = 0.8;
        CanvasShapes.roundRect(g, bx - 1.5, by - 1.5, width + 3, 7, 3);
        g.stroke();
      }

      if (enemy.boss) {
        g.fillStyle = '#ffb3d9';
        g.font = '700 10px "Noto Sans SC", "DejaVu Sans", sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'bottom';
        g.fillText('渊主', x, y - lift - vr - 22);
      }
    }
  }

  drawEnemyBody(g, time, enemy, def, r) {
    const t = time;
    const body = def.color;
    const dark = Palette.shade(body, -0.45);
    const light = Palette.shade(body, 0.28);

    if (def.shape === 'blob') {
      // 兜帽游魂
      g.fillStyle = body;
      g.strokeStyle = dark;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(0, -r * 1.18);
      g.bezierCurveTo(r * 0.95, -r * 0.85, r * 1.0, r * 0.3, r * 0.78, r * 0.96);
      g.lineTo(r * 0.38, r * 0.55);
      g.lineTo(0, r * 1.08);
      g.lineTo(-r * 0.38, r * 0.55);
      g.lineTo(-r * 0.78, r * 0.96);
      g.bezierCurveTo(-r * 1.0, r * 0.3, -r * 0.95, -r * 0.85, 0, -r * 1.18);
      g.closePath();
      g.fill();
      g.stroke();

      g.fillStyle = 'rgba(14, 10, 18, 0.6)';
      g.beginPath();
      g.ellipse(0, -r * 0.08, r * 0.55, r * 0.62, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ffe6a6';
      g.beginPath();
      g.arc(-r * 0.24, -r * 0.16, r * 0.1, 0, Math.PI * 2);
      g.arc(r * 0.24, -r * 0.16, r * 0.1, 0, Math.PI * 2);
      g.fill();
    } else if (def.shape === 'dart') {
      // 疾影猎犬
      g.fillStyle = body;
      g.strokeStyle = dark;
      g.lineWidth = 1.8;
      g.beginPath();
      g.ellipse(-r * 0.1, 0, r * 1.05, r * 0.62, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();

      g.beginPath();
      g.moveTo(r * 0.95, -r * 0.42);
      g.lineTo(r * 1.6, 0);
      g.lineTo(r * 0.95, r * 0.42);
      g.closePath();
      g.fillStyle = light;
      g.fill();
      g.stroke();

      // 眼睛
      g.fillStyle = '#2a1a08';
      g.beginPath();
      g.arc(r * 1.05, -r * 0.12, r * 0.09, 0, Math.PI * 2);
      g.fill();

      // 四肢
      g.strokeStyle = dark;
      g.lineWidth = Math.max(1.2, r * 0.16);
      for (let i = 0; i < 3; i++) {
        const swing = Math.sin(t * 16 + i * 2.1) * r * 0.28;
        g.beginPath();
        g.moveTo(-r * 0.55 + i * r * 0.42, r * 0.35);
        g.lineTo(-r * 0.7 + i * r * 0.42 + swing, r * 0.9);
        g.stroke();
      }

      // 速度残影
      g.strokeStyle = Palette.hexToRgba(body, 0.28);
      g.lineWidth = 1.4;
      for (let i = 0; i < 2; i++) {
        g.beginPath();
        g.moveTo(-r * 1.4, -r * 0.28 + i * r * 0.35);
        g.lineTo(-r * 2.1, -r * 0.28 + i * r * 0.35);
        g.stroke();
      }
    } else if (def.shape === 'bug') {
      // 噬虫
      g.fillStyle = body;
      g.strokeStyle = dark;
      g.lineWidth = 1.4;
      g.beginPath();
      g.ellipse(0, 0, r * 0.9, r * 1.05, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();

      g.strokeStyle = dark;
      g.lineWidth = Math.max(1, r * 0.14);
      for (let i = 0; i < 3; i++) {
        const y = -r * 0.45 + i * r * 0.45;
        const wiggle = Math.sin(t * 18 + i * 1.6 + enemy.id) * r * 0.2;
        g.beginPath();
        g.moveTo(-r * 0.55, y);
        g.lineTo(-r * 1.15, y + wiggle);
        g.moveTo(r * 0.55, y);
        g.lineTo(r * 1.15, y + wiggle);
        g.stroke();
      }
      g.strokeStyle = light;
      g.lineWidth = 1.1;
      g.beginPath();
      g.moveTo(-r * 0.18, -r * 0.85);
      g.lineTo(-r * 0.45, -r * 1.35);
      g.moveTo(r * 0.18, -r * 0.85);
      g.lineTo(r * 0.45, -r * 1.35);
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.beginPath();
      g.ellipse(-r * 0.2, -r * 0.35, r * 0.24, r * 0.4, -0.3, 0, Math.PI * 2);
      g.fill();
    } else if (def.shape === 'hex') {
      // 石卫
      g.fillStyle = body;
      g.strokeStyle = dark;
      g.lineWidth = 2.2;
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        const px = Math.cos(a) * r * 1.18;
        const py = Math.sin(a) * r * 1.12;
        i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
      }
      g.closePath();
      g.fill();
      g.stroke();

      g.fillStyle = Palette.shade(body, -0.28);
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        const px = Math.cos(a) * r * 0.72;
        const py = Math.sin(a) * r * 0.68;
        i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
      }
      g.closePath();
      g.fill();

      // 裂纹
      g.strokeStyle = 'rgba(20,24,28,0.5)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(-r * 0.3, -r * 0.7);
      g.lineTo(-r * 0.05, -r * 0.2);
      g.lineTo(-r * 0.35, r * 0.25);
      g.stroke();

      // 眼睛
      g.fillStyle = '#ffb36b';
      g.beginPath();
      g.arc(r * 0.2, -r * 0.15, r * 0.12, 0, Math.PI * 2);
      g.arc(r * 0.52, -r * 0.02, r * 0.09, 0, Math.PI * 2);
      g.fill();
    } else if (def.shape === 'wing') {
      // 翼魔
      const flap = Math.sin(t * 16 + enemy.id) * 0.45;
      g.fillStyle = Palette.shade(body, -0.22);
      g.strokeStyle = dark;
      g.lineWidth = 1.4;
      g.beginPath();
      g.ellipse(-r * 0.62, -flap * r * 0.5, r * 0.72, r * 0.28, -0.55 - flap, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.beginPath();
      g.ellipse(r * 0.62, -flap * r * 0.5, r * 0.72, r * 0.28, 0.55 + flap, 0, Math.PI * 2);
      g.fill();
      g.stroke();

      g.fillStyle = body;
      g.beginPath();
      g.moveTo(r * 0.95, 0);
      g.lineTo(0, -r * 0.56);
      g.lineTo(-r * 0.95, 0);
      g.lineTo(0, r * 0.56);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = '#ffe9a8';
      g.beginPath();
      g.arc(r * 0.18, -r * 0.12, r * 0.09, 0, Math.PI * 2);
      g.fill();

      // 尾巴
      g.strokeStyle = dark;
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(-r * 0.9, 0);
      g.quadraticCurveTo(-r * 1.4, Math.sin(t * 8) * r * 0.3, -r * 1.55, 0);
      g.stroke();
    } else if (def.shape === 'priest') {
      // 祭司
      g.fillStyle = body;
      g.strokeStyle = dark;
      g.lineWidth = 1.8;
      g.beginPath();
      g.moveTo(0, -r * 1.05);
      g.quadraticCurveTo(r * 0.95, -r * 0.4, r * 0.82, r * 1.0);
      g.lineTo(-r * 0.82, r * 1.0);
      g.quadraticCurveTo(-r * 0.95, -r * 0.4, 0, -r * 1.05);
      g.closePath();
      g.fill();
      g.stroke();

      g.fillStyle = 'rgba(8, 26, 20, 0.55)';
      g.beginPath();
      g.arc(0, -r * 0.36, r * 0.42, 0, Math.PI * 2);
      g.fill();

      g.strokeStyle = '#d9fff0';
      g.lineWidth = 2.2;
      g.beginPath();
      g.moveTo(0, -r * 0.72);
      g.lineTo(0, r * 0.15);
      g.moveTo(-r * 0.28, -r * 0.42);
      g.lineTo(r * 0.28, -r * 0.42);
      g.stroke();

      // 法杖
      g.strokeStyle = '#8a7a55';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(r * 0.72, r * 0.9);
      g.lineTo(r * 0.9, -r * 0.7);
      g.stroke();
      g.fillStyle = '#a8ffd8';
      g.beginPath();
      g.arc(r * 0.9, -r * 0.82, r * 0.16, 0, Math.PI * 2);
      g.fill();
    } else if (def.shape === 'boss') {
      const spikes = 16;
      g.fillStyle = body;
      g.strokeStyle = dark;
      g.lineWidth = 2.2;
      g.beginPath();
      for (let i = 0; i < spikes; i++) {
        const a = (i / spikes) * Math.PI * 2;
        const rad = i % 2 === 0 ? r * 1.1 : r * 0.76;
        const px = Math.cos(a) * rad;
        const py = Math.sin(a) * rad;
        i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
      }
      g.closePath();
      g.fill();
      g.stroke();

      // 王冠
      g.fillStyle = '#ffd36b';
      g.beginPath();
      g.moveTo(0, -r * 1.05);
      g.lineTo(r * 0.55, -r * 1.45);
      g.lineTo(r * 0.28, -r * 1.12);
      g.lineTo(0, -r * 1.55);
      g.lineTo(-r * 0.28, -r * 1.12);
      g.lineTo(-r * 0.55, -r * 1.45);
      g.closePath();
      g.fill();

      g.fillStyle = '#260d1a';
      g.beginPath();
      g.arc(0, 0, r * 0.5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ffb3d9';
      g.beginPath();
      g.arc(0, 0, r * 0.23, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ffe9a8';
      g.beginPath();
      g.arc(-r * 0.28, -r * 0.16, r * 0.09, 0, Math.PI * 2);
      g.arc(r * 0.28, -r * 0.16, r * 0.09, 0, Math.PI * 2);
      g.fill();
    }
  }
}
