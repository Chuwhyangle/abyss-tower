// 入口传送门与基地水晶：入口状态既用于绘制，也通过 portalStates() 暴露给验收测试。
import { TILE } from '../shared/data.js';
import { Palette } from './palette.js';

const T = TILE;

// 画质档位：低配减少光晕、环数与粒子，高配开启完整氛围。
export const PORTAL_PROFILES = Object.freeze({
  low: Object.freeze({
    tier: 'low',
    halo: false,
    haloRadius: 20,
    rings: 2,
    sparks: 3,
    trail: 0,
    pulseAmp: 0.06,
  }),
  high: Object.freeze({
    tier: 'high',
    halo: true,
    haloRadius: 34,
    rings: 3,
    sparks: 7,
    trail: 6,
    pulseAmp: 0.14,
  }),
});

// 单入口粒子硬上限：无论档位如何，每帧最多绘制这么多粒子。
export const PORTAL_SPARK_CAP = 8;

export function portalProfile(glowOn) {
  return glowOn ? PORTAL_PROFILES.high : PORTAL_PROFILES.low;
}

export function portalSparkCount(profile) {
  const raw = Number.isFinite(profile?.sparks) ? Math.floor(profile.sparks) : 0;
  return Math.max(0, Math.min(PORTAL_SPARK_CAP, raw));
}

// 充能预警强度：整备阶段呼吸式蓄能，波中满格，其余状态熄灭。纯函数。
export function portalChargeLevel(phase, time) {
  if (phase === 'wave') return 1;
  if (phase !== 'prep') return 0;
  const t = Number.isFinite(time) ? time : 0;
  return 0.55 + Math.sin(t * 2.4) * 0.18;
}

export class PortalRenderer {
  constructor(game) {
    this.game = game;
    const map = game.map;
    this.spawns = map.spawns?.length
      ? map.spawns
      : [{ x: map.spawn.x, y: map.spawn.y, color: '#c9a8ff' }];
    // 状态对象与粒子坐标都在构造时准备，render 内不再新建对象/数组。
    this._states = this.spawns.map((spawn, index) => ({
      index,
      label: index + 1,
      color: spawn.color || '#c9a8ff',
      active: true,
      dimmed: false,
      charge: 0,
    }));
  }

  // 入口视觉状态：整备阶段全部常态；波中仅激活入口高亮，其余变暗。
  // 返回缓存数组并原地更新，避免每帧分配。
  states(time = this.game.time) {
    const game = this.game;
    const inWave = game.phase === 'wave';
    const activePortals = game.activePortals;
    const hasActive = !!(activePortals && activePortals.length);
    const charge = portalChargeLevel(game.phase, time);
    for (let index = 0; index < this._states.length; index++) {
      const state = this._states[index];
      const isActive = !inWave || (hasActive ? activePortals.includes(index) : index === 0);
      state.active = isActive;
      state.dimmed = inWave && !isActive;
      state.charge = charge;
    }
    return this._states;
  }

  render(g, time, glowOn) {
    const game = this.game;
    const map = game.map;
    const t = time;
    const profile = portalProfile(glowOn);
    const states = this.states(t);
    const spawns = this.spawns;
    const sparks = portalSparkCount(profile);

    for (let index = 0; index < spawns.length; index++) {
      const spawn = spawns[index];
      const sx = spawn.x * T;
      const sy = spawn.y * T;
      const color = spawn.color || '#c9a8ff';
      const isActive = states[index].active;
      const charge = states[index].charge;
      const pulse = 1 + Math.sin(t * 2.6 + index * 1.7) * profile.pulseAmp;

      g.save();
      if (!isActive) g.globalAlpha = 0.42;

      if (profile.halo) {
        const radius = profile.haloRadius * pulse;
        const grad = g.createRadialGradient(sx, sy, 2, sx, sy, radius);
        grad.addColorStop(0, Palette.hexToRgba(color, 0.5));
        grad.addColorStop(0.55, Palette.hexToRgba(color, 0.16 * charge));
        grad.addColorStop(1, Palette.hexToRgba(color, 0));
        g.fillStyle = grad;
        g.beginPath();
        g.arc(sx, sy, radius, 0, Math.PI * 2);
        g.fill();
      } else {
        g.fillStyle = Palette.hexToRgba(color, 0.18);
        g.beginPath();
        g.arc(sx, sy, profile.haloRadius * pulse, 0, Math.PI * 2);
        g.fill();
      }

      g.translate(sx, sy);

      // 充能预警：整备阶段外圈虚线环随蓄能呼吸，环上扫描弧指示即将开启。
      if (charge > 0 && game.phase === 'prep') {
        const warn = 0.18 + charge * 0.45;
        g.save();
        g.rotate(-t * 0.9);
        g.setLineDash([5, 5]);
        g.strokeStyle = Palette.hexToRgba(color, warn);
        g.lineWidth = 1.6;
        g.beginPath();
        g.arc(0, 0, profile.haloRadius + 3, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
        g.strokeStyle = Palette.hexToRgba(color, 0.35 + charge * 0.4);
        g.lineWidth = 2.2;
        g.beginPath();
        g.arc(0, 0, profile.haloRadius + 6, 0, charge * Math.PI * 2);
        g.stroke();
        g.restore();
      }

      g.rotate(t * 1.6 + index);
      g.strokeStyle = Palette.hexToRgba(color, 0.85);
      g.lineWidth = 2.3;
      for (let i = 0; i < profile.rings; i++) {
        g.beginPath();
        g.arc(0, 0, 13 + i * 4, i * 2.1, i * 2.1 + 1.9);
        g.stroke();
      }

      // 环绕粒子：位置由时间解析计算，不保存、不新建粒子对象。
      for (let i = 0; i < sparks; i++) {
        const a = (i / sparks) * Math.PI * 2 + t * (0.8 + (i % 3) * 0.16) + index * 1.3;
        const r = 13 + (i % 4) * 3.6 + Math.sin(t * 2 + i) * 1.8;
        g.fillStyle = Palette.hexToRgba(color, 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(t * 3 + i)));
        g.beginPath();
        g.arc(Math.cos(a) * r, Math.sin(a) * r, 1.1 + (i % 2) * 0.6, 0, Math.PI * 2);
        g.fill();
      }

      g.rotate(-(t * 1.6 + index));

      // 入口编号
      g.fillStyle = color;
      g.font = '700 10px "DejaVu Sans Mono", ui-monospace, monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(states[index].label), 0, 0);

      // 方向标识：沿入口 lane 的初始朝向画箭头，提示敌人行进方向。
      const lane = game.lanes?.[index];
      const lanePts = lane && (lane.pts || lane.polyline);
      const dirAngle = lanePts && lanePts.length > 1
        ? Math.atan2(lanePts[1].y - lanePts[0].y, lanePts[1].x - lanePts[0].x)
        : 0;
      g.save();
      g.rotate(dirAngle);
      g.strokeStyle = Palette.hexToRgba(color, 0.7);
      g.lineWidth = 1.8;
      g.beginPath();
      g.moveTo(profile.haloRadius + 1, -4);
      g.lineTo(profile.haloRadius + 6, 0);
      g.lineTo(profile.haloRadius + 1, 4);
      g.stroke();
      // 高配补一条尾迹，低配不画。
      for (let i = 1; i <= profile.trail; i++) {
        g.strokeStyle = Palette.hexToRgba(color, 0.32 * (1 - i / (profile.trail + 1)));
        g.beginPath();
        g.moveTo(profile.haloRadius + 1 + i * 3, -2.4);
        g.lineTo(profile.haloRadius + 1 + i * 3, 2.4);
        g.stroke();
      }
      g.restore();

      g.restore();
    }

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
