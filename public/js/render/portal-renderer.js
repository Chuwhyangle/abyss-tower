// 入口传送门与基地水晶：入口状态既用于绘制，也通过 portalStates() 暴露给验收测试。
import { TILE } from '../shared/data.js';
import { Palette } from './palette.js';

const T = TILE;

export class PortalRenderer {
  constructor(game) {
    this.game = game;
  }

  // 入口视觉状态：整备阶段全部常态；波中仅激活入口高亮，其余变暗。
  states() {
    const game = this.game;
    const map = game.map;
    const spawns = map.spawns?.length
      ? map.spawns
      : [{ x: map.spawn.x, y: map.spawn.y, color: '#c9a8ff' }];
    const inWave = game.phase === 'wave';
    const active = new Set(
      inWave
        ? game.activePortals?.length
          ? game.activePortals
          : [0]
        : spawns.map((_, index) => index)
    );
    return spawns.map((spawn, index) => {
      const isActive = active.has(index);
      return {
        index,
        label: index + 1,
        color: spawn.color || '#c9a8ff',
        active: isActive,
        dimmed: inWave && !isActive,
      };
    });
  }

  render(g, time, glowOn) {
    const game = this.game;
    const map = game.map;
    const t = time;
    const states = this.states();
    const spawns = map.spawns?.length
      ? map.spawns
      : [{ x: map.spawn.x, y: map.spawn.y, color: '#c9a8ff' }];
    const pulse = 0.85 + Math.sin(t * 3) * 0.15;

    spawns.forEach((spawn, index) => {
      const sx = spawn.x * T;
      const sy = spawn.y * T;
      const color = spawn.color || '#c9a8ff';
      const isActive = states[index]?.active !== false;
      g.save();
      if (!isActive) g.globalAlpha = 0.42;

      if (glowOn) {
        const grad = g.createRadialGradient(sx, sy, 2, sx, sy, 30 * pulse);
        grad.addColorStop(0, Palette.hexToRgba(color, 0.5));
        grad.addColorStop(1, Palette.hexToRgba(color, 0));
        g.fillStyle = grad;
        g.beginPath();
        g.arc(sx, sy, 30 * pulse, 0, Math.PI * 2);
        g.fill();
      } else {
        g.fillStyle = Palette.hexToRgba(color, 0.18);
        g.beginPath();
        g.arc(sx, sy, 18, 0, Math.PI * 2);
        g.fill();
      }

      g.translate(sx, sy);
      g.rotate(t * 1.6 + index);
      g.strokeStyle = Palette.hexToRgba(color, 0.85);
      g.lineWidth = 2.3;
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.arc(0, 0, 13 + i * 4, i * 2.1, i * 2.1 + 1.9);
        g.stroke();
      }
      g.rotate(-(t * 1.6 + index));
      g.fillStyle = color;
      g.font = '700 10px "DejaVu Sans Mono", ui-monospace, monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(states[index]?.label ?? index + 1), 0, 0);
      g.restore();
    });

    const bx = map.base.x * T;
    const by = map.base.y * T;
    const ratio = Math.max(0, Math.min(1, game.baseHp / game.maxBaseHp));
    if (glowOn) {
      const glow = 0.8 + Math.sin(t * 2.4) * 0.2;
      const bgGrad = g.createRadialGradient(bx, by, 3, bx, by, 40);
      bgGrad.addColorStop(0, `rgba(90, 235, 220, ${0.32 * glow})`);
      bgGrad.addColorStop(1, 'rgba(90, 235, 220, 0)');
      g.fillStyle = bgGrad;
      g.beginPath();
      g.arc(bx, by, 40, 0, Math.PI * 2);
      g.fill();
    }

    // 生命环
    g.strokeStyle = 'rgba(10, 20, 18, 0.8)';
    g.lineWidth = 5;
    g.beginPath();
    g.arc(bx, by, 25, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = ratio > 0.5 ? '#5ce2b0' : ratio > 0.25 ? '#e8c35a' : '#ef5f5f';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(bx, by, 25, -Math.PI / 2, -Math.PI / 2 + ratio * Math.PI * 2);
    g.stroke();

    // 水晶
    g.save();
    g.translate(bx, by);
    g.rotate(Math.sin(t * 1.2) * 0.08);
    if (glowOn) {
      const crystal = g.createLinearGradient(0, -18, 0, 18);
      crystal.addColorStop(0, '#c8fff5');
      crystal.addColorStop(0.5, '#4fd8c8');
      crystal.addColorStop(1, '#1c7d86');
      g.fillStyle = crystal;
    } else {
      g.fillStyle = '#3fc8bb';
    }
    g.strokeStyle = 'rgba(220, 255, 250, 0.8)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(0, -19);
    g.lineTo(12, -5);
    g.lineTo(8, 14);
    g.lineTo(0, 19);
    g.lineTo(-8, 14);
    g.lineTo(-12, -5);
    g.closePath();
    g.fill();
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.beginPath();
    g.moveTo(0, -19);
    g.lineTo(0, 17);
    g.stroke();
    g.restore();
  }
}
