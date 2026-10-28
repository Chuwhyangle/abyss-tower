// 塔体造型：八种塔型（弩/炮/冰/电/毒/旗/震荡/狙击）的程序化画法。
//
// 方法集合挂回 TowerRenderer 原型；精灵命中时整段跳过（由 sprite 管线接管塔身）。
import { TOWERS } from '../shared/data.js';
import { Palette } from './palette.js';
import { CanvasShapes } from './canvas-shapes.js';

export const towerBodyMethods = {
  drawTowerShape(g, time, type, recoil, alpha, level = 0, glowOn = false, color = TOWERS[type].color) {
    const push = -recoil * 3;
    g.globalAlpha = alpha;

    if (type === 'arrow') {
      // 木质弩机
      g.fillStyle = '#2b2118';
      g.strokeStyle = '#8c6b45';
      g.lineWidth = 2;
      CanvasShapes.roundRect(g, -4 + push, -3.2, 17, 6.4, 2);
      g.fill();
      g.stroke();

      // 弩臂
      g.strokeStyle = color;
      g.lineWidth = 2.4;
      g.beginPath();
      g.moveTo(7 + push, -12);
      g.quadraticCurveTo(20 + push, -7, 20 + push, 0);
      g.quadraticCurveTo(20 + push, 7, 7 + push, 12);
      g.stroke();

      // 弓弦
      g.strokeStyle = 'rgba(225,255,235,0.55)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(12 + push, -9.5);
      g.lineTo(5 + push, 0);
      g.lineTo(12 + push, 9.5);
      g.stroke();

      // 弩箭
      g.strokeStyle = '#e6fff0';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(2 + push, 0);
      g.lineTo(23 + push, 0);
      g.stroke();
      g.fillStyle = '#f2fff7';
      g.beginPath();
      g.moveTo(27 + push, 0);
      g.lineTo(21 + push, -3.6);
      g.lineTo(21 + push, 3.6);
      g.closePath();
      g.fill();

      if (level >= 1) {
        g.strokeStyle = Palette.hexToRgba(color, 0.6);
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(0, 0, 9.5, 0, Math.PI * 2);
        g.stroke();
      }
    } else if (type === 'cannon') {
      // 铁制炮塔
      g.fillStyle = '#2a2c2b';
      g.strokeStyle = '#6d604e';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(0, 0, 10, 0, Math.PI * 2);
      g.fill();
      g.stroke();

      // 炮管
      g.fillStyle = '#3d3f3c';
      g.strokeStyle = '#7a6c56';
      g.lineWidth = 2;
      CanvasShapes.roundRect(g, 4 + push, -6.5, 19, 13, 4);
      g.fill();
      g.stroke();

      // 加固环
      g.strokeStyle = '#a08b68';
      g.lineWidth = 1.8;
      for (const bx of [9, 16]) {
        g.beginPath();
        g.moveTo(bx + push, -6.1);
        g.lineTo(bx + push, 6.1);
        g.stroke();
      }

      // 炮口
      g.fillStyle = '#1b1c1b';
      g.beginPath();
      g.arc(23 + push, 0, 4.6, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = color;
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(23 + push, 0, 5.6, 0, Math.PI * 2);
      g.stroke();

      if (level >= 1) {
        g.strokeStyle = Palette.hexToRgba(color, 0.55);
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(0, 0, 9.5, 0, Math.PI * 2);
        g.stroke();
      }
    } else if (type === 'frost') {
      // 冰晶核心
      g.save();
      g.rotate(time * 0.35);
      g.strokeStyle = 'rgba(160,230,255,0.35)';
      g.lineWidth = 1.2;
      for (let i = 0; i < 6; i++) {
        g.rotate(Math.PI / 3);
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(15, 0);
        g.stroke();
      }
      g.restore();

      // 主水晶
      g.fillStyle = '#2b6d8a';
      g.strokeStyle = color;
      g.lineWidth = 1.8;
      g.beginPath();
      g.moveTo(0, -13);
      g.lineTo(8, -3);
      g.lineTo(5, 11);
      g.lineTo(0, 14);
      g.lineTo(-5, 11);
      g.lineTo(-8, -3);
      g.closePath();
      g.fill();
      g.stroke();

      // 侧晶
      const shard = (ax, ay, sx, sy, rot) => {
        g.save();
        g.translate(ax, ay);
        g.rotate(rot);
        g.beginPath();
        g.moveTo(0, -sy);
        g.lineTo(sx, 0);
        g.lineTo(0, sy);
        g.lineTo(-sx, 0);
        g.closePath();
        g.fillStyle = '#4a9cbc';
        g.fill();
        g.strokeStyle = '#a8e6ff';
        g.lineWidth = 1.2;
        g.stroke();
        g.restore();
      };
      shard(-9, 2, 2.6, 6, -0.5);
      shard(9, 1, 2.6, 7, 0.6);
      if (level >= 2) shard(0, 15, 2.2, 5, 0);

      // 顶部高光
      g.fillStyle = 'rgba(220,255,255,0.85)';
      g.beginPath();
      g.arc(0, -8, 2.2, 0, Math.PI * 2);
      g.fill();
    } else if (type === 'arc') {
      // 特斯拉线圈
      g.fillStyle = '#221d33';
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(0, 0, 9, 0, Math.PI * 2);
      g.fill();
      g.stroke();

      g.strokeStyle = 'rgba(201,168,255,0.75)';
      g.lineWidth = 1.8;
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.ellipse(3 + i * 3, 0, 2.4, 8 - i * 1.4, 0, 0, Math.PI * 2);
        g.stroke();
      }

      // 电球
      const pulse = 1 + Math.sin(time * 8) * 0.15;
      if (glowOn) this.glow.draw(g, '#d2b9ff', 15, 0, 13, 0.55);
      g.fillStyle = '#e8dcff';
      g.beginPath();
      g.arc(15, 0, 4.6 * pulse, 0, Math.PI * 2);
      g.fill();

      // 电弧
      g.strokeStyle = '#f2eaff';
      g.lineWidth = 1.4;
      for (let i = 0; i < 2; i++) {
        g.beginPath();
        g.moveTo(15, 0);
        g.lineTo(15 + 8, -6 + i * 12 + Math.sin(time * 20 + i) * 3);
        g.lineTo(15 + 13, 2 - i * 4);
        g.stroke();
      }
    } else if (type === 'poison') {
      // 炼金装置
      g.fillStyle = '#1c2a18';
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(0, 0, 9, 0, Math.PI * 2);
      g.fill();
      g.stroke();

      // 导管
      g.strokeStyle = '#6e7f55';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(4, 0);
      g.lineTo(19, 0);
      g.stroke();

      // 药瓶
      g.fillStyle = 'rgba(160, 230, 120, 0.22)';
      g.strokeStyle = '#b6e88a';
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(13, 0, 8.5, 0, Math.PI * 2);
      g.fill();
      g.stroke();

      g.fillStyle = 'rgba(120, 210, 80, 0.75)';
      g.beginPath();
      g.arc(13, 2.4, 6.4, 0.15, Math.PI - 0.15);
      g.fill();

      // 气泡
      for (let i = 0; i < 3; i++) {
        const phase = (time * 0.7 + i * 0.37) % 1;
        g.fillStyle = `rgba(190,255,140,${0.65 * (1 - phase)})`;
        g.beginPath();
        g.arc(
          13 + Math.sin(time * 2.2 + i * 2) * 4,
          3 - phase * 9,
          1.1 + phase * 1.4,
          0,
          Math.PI * 2
        );
        g.fill();
      }

      // 喷嘴
      g.fillStyle = '#7f8f63';
      CanvasShapes.roundRect(g, 20, -3.5, 6, 7, 2);
      g.fill();

      if (level >= 2) {
        g.fillStyle = 'rgba(180, 240, 120, 0.8)';
        g.beginPath();
        g.arc(0, -9, 2.2, 0, Math.PI * 2);
        g.fill();
      }
    } else if (type === 'banner') {
      // 旗杆与底座
      g.strokeStyle = '#c9b47a';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(0, 15);
      g.lineTo(0, -14);
      g.stroke();

      g.fillStyle = '#2a2318';
      g.strokeStyle = Palette.hexToRgba(color, 0.7);
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(0, 15, 3.4, 0, Math.PI * 2);
      g.fill();
      g.stroke();

      // 旗面：随时间轻微摆动
      const wave = Math.sin(time * 3) * 2.2;
      g.fillStyle = Palette.hexToRgba(color, 0.85);
      g.strokeStyle = color;
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(1, -14);
      g.quadraticCurveTo(10 + wave, -11, 18, -8);
      g.lineTo(18, 2);
      g.quadraticCurveTo(9 + wave, -1, 1, 2);
      g.closePath();
      g.fill();
      g.stroke();

      // 旗面纹章
      g.strokeStyle = 'rgba(60, 42, 10, 0.7)';
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(9 + wave * 0.5, -8);
      g.lineTo(9 + wave * 0.5, -2);
      g.moveTo(5 + wave * 0.5, -5);
      g.lineTo(13 + wave * 0.5, -5);
      g.stroke();

      // 顶端旗尖
      g.fillStyle = '#ffe6a0';
      g.beginPath();
      g.moveTo(0, -19);
      g.lineTo(3, -14);
      g.lineTo(-3, -14);
      g.closePath();
      g.fill();

      if (level >= 1) {
        g.strokeStyle = Palette.hexToRgba(color, 0.6);
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(0, 0, 9.5, 0, Math.PI * 2);
        g.stroke();
      }
    } else if (type === 'shock') {
      // 震荡核心
      g.fillStyle = '#1d3a36';
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(0, 0, 9, 0, Math.PI * 2);
      g.fill();
      g.stroke();

      // 发射喇叭
      g.fillStyle = '#28524b';
      g.strokeStyle = '#8ff0dc';
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(4, -5);
      g.lineTo(18, -9);
      g.lineTo(18, 9);
      g.lineTo(4, 5);
      g.closePath();
      g.fill();
      g.stroke();

      // 口部的同心震荡环
      const pulse = (time * 1.6) % 1;
      for (let i = 0; i < 2; i++) {
        const phase = (pulse + i * 0.5) % 1;
        g.strokeStyle = `rgba(111, 227, 200, ${0.55 * (1 - phase)})`;
        g.lineWidth = 1.4;
        g.beginPath();
        g.arc(18, 0, 3 + phase * 7, -1.1, 1.1);
        g.stroke();
      }

      // 核心亮点
      g.fillStyle = 'rgba(190, 255, 240, 0.85)';
      g.beginPath();
      g.arc(0, 0, 2.6, 0, Math.PI * 2);
      g.fill();

      if (level >= 1) {
        g.strokeStyle = Palette.hexToRgba(color, 0.55);
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(0, 0, 9.5, 0, Math.PI * 2);
        g.stroke();
      }
    } else if (type === 'sniper') {
      // 支架
      g.fillStyle = '#1b2537';
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(0, 0, 9, 0, Math.PI * 2);
      g.fill();
      g.stroke();

      // 长枪管
      g.strokeStyle = '#9fb4d6';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(4 + push, 0);
      g.lineTo(26 + push, 0);
      g.stroke();

      // 瞄准镜
      g.fillStyle = '#2b3d5c';
      g.strokeStyle = '#cfe2ff';
      g.lineWidth = 1.4;
      CanvasShapes.roundRect(g, -2 + push, -7.5, 11, 5.4, 2.4);
      g.fill();
      g.stroke();
      g.fillStyle = 'rgba(180, 220, 255, 0.85)';
      g.beginPath();
      g.arc(6 + push, -4.8, 1.4, 0, Math.PI * 2);
      g.fill();

      // 枪口制退器
      g.strokeStyle = color;
      g.lineWidth = 1.8;
      g.beginPath();
      g.moveTo(24 + push, -3.2);
      g.lineTo(24 + push, 3.2);
      g.moveTo(28 + push, -3.2);
      g.lineTo(28 + push, 3.2);
      g.stroke();

      if (level >= 1) {
        g.strokeStyle = Palette.hexToRgba(color, 0.6);
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(0, 0, 9.5, 0, Math.PI * 2);
        g.stroke();
      }
    }

    g.globalAlpha = 1;
  }
};
