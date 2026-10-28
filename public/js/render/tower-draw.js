// 塔体绘制：进化轮廓/符文、停摆表现与八种塔型的造型。
//
// 方法集合挂回 TowerRenderer 原型（同一实例字段、同一方法签名）；预算与视觉表见 tower-data.js。
import { BALANCE } from '../shared/config.js';
import { Palette } from './palette.js';

export const towerDrawMethods = {
  // 进化标识：先描路线专属轮廓，再按预算叠内层轮廓与绕塔符文。
  // 调用时坐标系已平移到塔心并缩放，这里只画相对几何。
  drawEvolutionMark(g, time, visual, budget, color) {
    const spin = budget.spin ? time * 0.9 : 0;
    g.save();

    g.strokeStyle = Palette.hexToRgba(color, 0.8);
    g.lineWidth = 1.8;
    if (budget.spin) g.setLineDash([5, 4]);
    if (budget.outline) {
      this.traceEvolutionSilhouette(g, visual.shape, visual.radius, spin);
      g.stroke();
    }
    if (budget.spin) g.setLineDash([]);

    if (budget.inner) {
      g.strokeStyle = Palette.hexToRgba(color, 0.4);
      g.lineWidth = 1;
      this.traceEvolutionSilhouette(g, visual.shape, visual.radius - 3.5, -spin * 0.5);
      g.stroke();
    }

    if (budget.runes > 0) {
      g.fillStyle = color;
      const orbit = visual.radius - 3;
      for (let i = 0; i < budget.runes; i++) {
        const a = -spin * 0.6 + (i / budget.runes) * Math.PI * 2;
        this.drawEvolutionRune(g, visual.rune, Math.cos(a) * orbit, Math.sin(a) * orbit, a);
      }
    }

    g.restore();
  },

  // 路线轮廓：闭合路径，调用方负责 stroke。未知形状回退六边形。
  traceEvolutionSilhouette(g, kind, radius, rotation = 0) {
    const r = radius;
    g.beginPath();
    if (kind === 'hex') {
      for (let i = 0; i < 6; i++) {
        const a = rotation + (i / 6) * Math.PI * 2;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
      }
    } else if (kind === 'star') {
      // 四角星：内外半径交替。
      for (let i = 0; i < 8; i++) {
        const a = rotation + (i / 8) * Math.PI * 2;
        const rr = i % 2 === 0 ? r : r * 0.62;
        const px = Math.cos(a) * rr;
        const py = Math.sin(a) * rr;
        i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
      }
    } else if (kind === 'blade') {
      // 柳叶形：上下两尖、两侧内收。
      g.moveTo(0, -r);
      g.quadraticCurveTo(r * 0.9, 0, 0, r);
      g.quadraticCurveTo(-r * 0.9, 0, 0, -r);
    } else if (kind === 'gear') {
      // 八齿齿轮：十六个顶点深浅交替。
      for (let i = 0; i < 16; i++) {
        const a = rotation + (i / 16) * Math.PI * 2;
        const rr = i % 2 === 0 ? r : r * 0.78;
        const px = Math.cos(a) * rr;
        const py = Math.sin(a) * rr;
        i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
      }
    } else if (kind === 'wave') {
      // 十二瓣波纹：半径随正弦起伏。
      for (let i = 0; i <= 24; i++) {
        const a = rotation + (i / 24) * Math.PI * 2;
        const rr = r * (0.86 + 0.14 * Math.sin((i / 24) * Math.PI * 2 * 12));
        const px = Math.cos(a) * rr;
        const py = Math.sin(a) * rr;
        i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
      }
    } else if (kind === 'spike') {
      // 三枚锐刺：深内凹，远看也能区分。
      for (let i = 0; i < 6; i++) {
        const a = rotation + (i / 6) * Math.PI * 2;
        const rr = i % 2 === 0 ? r : r * 0.35;
        const px = Math.cos(a) * rr;
        const py = Math.sin(a) * rr;
        i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
      }
    } else if (kind === 'crown') {
      // 三峰王冠：三个外凸圆峰，峰间内凹。
      for (let i = 0; i <= 3; i++) {
        const a = rotation + (i / 3) * Math.PI * 2;
        const px = Math.cos(a) * r * 0.82;
        const py = Math.sin(a) * r * 0.82;
        if (i === 0) {
          g.moveTo(px, py);
        } else {
          const mid = a - Math.PI / 3;
          g.quadraticCurveTo(Math.cos(mid) * r * 1.24, Math.sin(mid) * r * 1.24, px, py);
        }
      }
    } else {
      for (let i = 0; i < 6; i++) {
        const a = rotation + (i / 6) * Math.PI * 2;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
      }
    }
    g.closePath();
  },

  // 单枚符文：以落点为原点朝外朝向，纯 path 填充。
  drawEvolutionRune(g, kind, x, y, angle = 0) {
    const s = 2.8;
    g.save();
    g.translate(x, y);
    g.rotate(angle + Math.PI / 2);
    if (kind === 'chevron') {
      g.beginPath();
      g.moveTo(-s, -s * 0.7);
      g.lineTo(0, s * 0.4);
      g.lineTo(s, -s * 0.7);
      g.lineTo(s, -s * 0.1);
      g.lineTo(0, s * 1.1);
      g.lineTo(-s, -s * 0.1);
      g.closePath();
      g.fill();
    } else if (kind === 'triangle') {
      g.beginPath();
      g.moveTo(0, -s);
      g.lineTo(s, s);
      g.lineTo(-s, s);
      g.closePath();
      g.fill();
    } else if (kind === 'diamond') {
      g.beginPath();
      g.moveTo(0, -s);
      g.lineTo(s, 0);
      g.lineTo(0, s);
      g.lineTo(-s, 0);
      g.closePath();
      g.fill();
    } else if (kind === 'bar') {
      g.beginPath();
      g.rect(-s * 0.45, -s, s * 0.9, s * 2);
      g.closePath();
      g.fill();
    } else if (kind === 'cross') {
      g.beginPath();
      g.rect(-s, -s * 0.4, s * 2, s * 0.8);
      g.closePath();
      g.fill();
      g.beginPath();
      g.rect(-s * 0.4, -s, s * 0.8, s * 2);
      g.closePath();
      g.fill();
    } else {
      g.beginPath();
      g.arc(0, 0, s * 0.75, 0, Math.PI * 2);
      g.closePath();
      g.fill();
    }
    g.restore();
  },

  // 停摆表现：压暗塔身、环绕电弧、外圈剩余时间弧（调用时已平移到塔心）。
  drawDisabled(g, time, disableLeft) {
    const max = BALANCE.bossSlamDisable || 1;
    const frac = Math.max(0, Math.min(1, disableLeft / max));
    const flick = 0.5 + 0.5 * Math.sin(time * 24);

    g.save();
    g.fillStyle = 'rgba(6, 9, 12, 0.66)';
    g.beginPath();
    g.arc(0, 0, 23, 0, Math.PI * 2);
    g.fill();
    g.restore();

    g.save();
    g.strokeStyle = `rgba(255, 138, 107, ${0.5 + flick * 0.4})`;
    g.lineWidth = 1.6;
    g.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const a0 = time * 2.6 + (i / 3) * Math.PI * 2;
      const jitter = Math.sin(time * 15 + i * 2.3) * 2.5;
      g.beginPath();
      g.moveTo(Math.cos(a0) * 16, Math.sin(a0) * 16);
      g.lineTo(Math.cos(a0 + 0.3) * 24 + jitter, Math.sin(a0 + 0.3) * 24);
      g.lineTo(Math.cos(a0 + 0.6) * 18, Math.sin(a0 + 0.6) * 18 - jitter);
      g.stroke();
    }
    g.restore();

    g.save();
    g.strokeStyle = 'rgba(255, 138, 107, 0.3)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(0, 0, 26, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = `rgba(255, 168, 120, ${0.7 + flick * 0.25})`;
    g.beginPath();
    g.arc(0, 0, 26, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    g.stroke();
    g.restore();
  }
};
