// 弹道绘制：炮弹/冰锥/毒液/箭矢四种形态。
import { TILE } from '../shared/data.js';

const T = TILE;

export class ProjectileRenderer {
  constructor(game, { glow }) {
    this.game = game;
    this.glow = glow;
  }

  render(g, settings) {
    for (const proj of this.game.projectiles) {
      const x = proj.x * T;
      const y = proj.y * T;
      g.save();
      g.translate(x, y);
      g.rotate(proj.angle || 0);

      if (proj.kind === 'shell') {
        g.strokeStyle = 'rgba(255, 160, 90, 0.22)';
        g.lineWidth = 7;
        g.beginPath();
        g.moveTo(-22, 0);
        g.lineTo(-4, 0);
        g.stroke();
        g.strokeStyle = 'rgba(120, 90, 70, 0.28)';
        g.lineWidth = 10;
        g.beginPath();
        g.moveTo(-30, 0);
        g.lineTo(-18, 0);
        g.stroke();
        if (settings.glow) this.glow.draw(g, '#ffb066', 0, 0, 12, 0.55);
        g.fillStyle = '#23282e';
        g.strokeStyle = '#ffb066';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(0, 0, 5.6, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.fillStyle = 'rgba(255, 210, 150, 0.7)';
        g.beginPath();
        g.arc(-1.4, -1.4, 1.5, 0, Math.PI * 2);
        g.fill();
      } else if (proj.kind === 'frost') {
        g.strokeStyle = 'rgba(124, 212, 245, 0.3)';
        g.lineWidth = 5;
        g.beginPath();
        g.moveTo(-18, 0);
        g.lineTo(-3, 0);
        g.stroke();
        if (settings.glow) this.glow.draw(g, '#a0ebff', 0, 0, 11, 0.5);
        g.fillStyle = '#e6fbff';
        g.strokeStyle = '#7cd4f5';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(6, 0);
        g.lineTo(0, -5);
        g.lineTo(-6, 0);
        g.lineTo(0, 5);
        g.closePath();
        g.fill();
        g.stroke();
        g.strokeStyle = 'rgba(220,250,255,0.55)';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(-3, 0);
        g.lineTo(3, 0);
        g.stroke();
      } else if (proj.kind === 'poison') {
        g.strokeStyle = 'rgba(154, 223, 106, 0.28)';
        g.lineWidth = 5;
        g.beginPath();
        g.moveTo(-16, 0);
        g.lineTo(-3, 0);
        g.stroke();
        if (settings.glow) this.glow.draw(g, '#9adf6a', 0, 0, 10, 0.45);
        g.fillStyle = '#9adf6a';
        g.beginPath();
        g.arc(0, 0, 4.8, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#3f6b2c';
        g.lineWidth = 1.2;
        g.stroke();
        g.fillStyle = 'rgba(225,255,190,0.8)';
        g.beginPath();
        g.arc(-1.4, -1.6, 1.5, 0, Math.PI * 2);
        g.fill();
      } else {
        g.strokeStyle = 'rgba(255, 233, 176, 0.35)';
        g.lineWidth = 5;
        g.beginPath();
        g.moveTo(-16, 0);
        g.lineTo(2, 0);
        g.stroke();
        g.strokeStyle = '#ffe9b0';
        g.lineWidth = 2.2;
        g.beginPath();
        g.moveTo(-9, 0);
        g.lineTo(6, 0);
        g.stroke();
        g.fillStyle = '#fff8dd';
        g.beginPath();
        g.moveTo(9, 0);
        g.lineTo(3, -3);
        g.lineTo(3, 3);
        g.closePath();
        g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.6)';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(-8, 0);
        g.lineTo(-12, -3);
        g.moveTo(-8, 0);
        g.lineTo(-12, 3);
        g.stroke();
      }
      g.restore();
    }
  }
}
