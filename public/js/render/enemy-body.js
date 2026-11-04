// 敌人形体绘制：按 def.shape 程序化落笔（含首领变体），只读传入的几何与颜色。
//
// 挂在 EnemyRenderer 原型上；不接触模拟状态，纯绘制（方法签名与原类一致）。
import { Palette } from './palette.js';
import { CanvasShapes } from './canvas-shapes.js';

export const enemyBodyMethods = {
  drawEnemyBody(
    g,
    time,
    enemy,
    def,
    r,
    animated = true,
    color = def.color,
    outline = null,
    mergeOutline = false
  ) {
    const t = time;
    const body = color;
    const dark = Palette.shade(body, -0.45);
    const light = Palette.shade(body, 0.28);
    // 低配：皮肤轮廓并进本体主描边，不再额外描一圈外环。
    const primaryStroke = (width) => {
      if (mergeOutline && outline) {
        g.strokeStyle = Palette.hexToRgba(outline.color, outline.alpha);
        g.lineWidth = outline.width;
      } else {
        g.strokeStyle = dark;
        g.lineWidth = width;
      }
    };

    if (def.shape === 'blob') {
      // 兜帽游魂
      g.fillStyle = body;
      primaryStroke(2);
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
      primaryStroke(1.8);
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
        const swing = animated ? Math.sin(t * 16 + i * 2.1) * r * 0.28 : 0;
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
      primaryStroke(1.4);
      g.beginPath();
      g.ellipse(0, 0, r * 0.9, r * 1.05, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();

      g.strokeStyle = dark;
      g.lineWidth = Math.max(1, r * 0.14);
      for (let i = 0; i < 3; i++) {
        const y = -r * 0.45 + i * r * 0.45;
        const wiggle = animated ? Math.sin(t * 18 + i * 1.6 + enemy.id) * r * 0.2 : 0;
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
      primaryStroke(2.2);
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
      const flap = animated ? Math.sin(t * 16 + enemy.id) * 0.45 : 0;
      g.fillStyle = Palette.shade(body, -0.22);
      primaryStroke(1.4);
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
      g.quadraticCurveTo(-r * 1.4, animated ? Math.sin(t * 8) * r * 0.3 : 0, -r * 1.55, 0);
      g.stroke();
    } else if (def.shape === 'priest') {
      // 祭司
      g.fillStyle = body;
      primaryStroke(1.8);
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
    } else if (def.shape === 'shield') {
      // 石盾：厚重躯干 + 正面盾牌
      g.fillStyle = body;
      primaryStroke(2);
      g.beginPath();
      g.ellipse(0, 0, r * 0.92, r * 0.95, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();

      g.fillStyle = light;
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(-r * 0.8, -r * 0.7);
      g.quadraticCurveTo(0, -r * 1.1, r * 0.8, -r * 0.7);
      g.lineTo(r * 0.72, r * 0.4);
      g.quadraticCurveTo(0, r * 1.15, -r * 0.72, r * 0.4);
      g.closePath();
      g.fill();
      g.stroke();

      g.strokeStyle = '#3d4f5f';
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(0, -r * 0.95);
      g.lineTo(0, r * 0.95);
      g.moveTo(-r * 0.55, -r * 0.2);
      g.lineTo(r * 0.55, -r * 0.2);
      g.stroke();
      g.fillStyle = '#ffd36b';
      g.beginPath();
      g.arc(0, -r * 0.42, r * 0.1, 0, Math.PI * 2);
      g.fill();
    } else if (def.shape === 'split') {
      // 裂魂：两瓣身体 + 中央裂缝
      g.fillStyle = body;
      primaryStroke(1.8);
      g.beginPath();
      g.ellipse(-r * 0.34, 0, r * 0.6, r * 0.92, -0.16, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.beginPath();
      g.ellipse(r * 0.34, 0, r * 0.6, r * 0.92, 0.16, 0, Math.PI * 2);
      g.fill();
      g.stroke();

      g.strokeStyle = '#3a1a4a';
      g.lineWidth = 2.2;
      g.beginPath();
      g.moveTo(-r * 0.08, -r * 0.88);
      g.lineTo(r * 0.1, -r * 0.3);
      g.lineTo(-r * 0.1, r * 0.2);
      g.lineTo(r * 0.06, r * 0.9);
      g.stroke();

      g.fillStyle = '#ffe9a8';
      g.beginPath();
      g.arc(-r * 0.4, -r * 0.28, r * 0.1, 0, Math.PI * 2);
      g.arc(r * 0.4, -r * 0.28, r * 0.1, 0, Math.PI * 2);
      g.fill();
    } else if (def.shape === 'drum') {
      // 战鼓魔：圆鼓身躯 + 鼓棒与声波
      g.fillStyle = body;
      primaryStroke(2);
      g.beginPath();
      g.ellipse(0, 0, r * 0.8, r * 0.95, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();

      g.fillStyle = light;
      g.beginPath();
      g.ellipse(0, -r * 0.12, r * 0.6, r * 0.5, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = dark;
      g.lineWidth = 1.2;
      g.stroke();

      g.strokeStyle = '#6b4a20';
      g.lineWidth = Math.max(1.2, r * 0.12);
      g.beginPath();
      g.moveTo(-r * 0.85, -r * 0.95);
      g.lineTo(-r * 0.15, -r * 0.25);
      g.moveTo(r * 0.85, -r * 0.95);
      g.lineTo(r * 0.15, -r * 0.25);
      g.stroke();

      const pulse = animated ? (Math.sin(t * 6 + enemy.id) + 1) * 0.5 : 0.5;
      g.strokeStyle = Palette.hexToRgba(body, 0.55);
      g.lineWidth = 1.4;
      for (let i = 0; i < 2; i++) {
        const rr = r * (1.25 + i * 0.28 + pulse * 0.08);
        g.beginPath();
        g.arc(0, 0, rr, -Math.PI * 0.42, Math.PI * 0.42);
        g.stroke();
        g.beginPath();
        g.arc(0, 0, rr, Math.PI * 0.58, Math.PI * 1.42);
        g.stroke();
      }
    } else if (def.shape === 'caster') {
      // 咒术师：尖帽长袍 + 悬浮法球
      g.fillStyle = body;
      primaryStroke(1.8);
      g.beginPath();
      g.moveTo(0, -r * 0.55);
      g.lineTo(r * 0.85, r * 1.0);
      g.lineTo(-r * 0.85, r * 1.0);
      g.closePath();
      g.fill();
      g.stroke();
      g.beginPath();
      g.moveTo(0, -r * 1.55);
      g.lineTo(r * 0.5, -r * 0.5);
      g.lineTo(-r * 0.5, -r * 0.5);
      g.closePath();
      g.fill();
      g.stroke();

      g.fillStyle = 'rgba(10, 20, 14, 0.6)';
      g.beginPath();
      g.arc(0, -r * 0.42, r * 0.3, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#f4ffb0';
      g.beginPath();
      g.arc(-r * 0.1, -r * 0.45, r * 0.07, 0, Math.PI * 2);
      g.arc(r * 0.13, -r * 0.45, r * 0.07, 0, Math.PI * 2);
      g.fill();

      const orb = r * 0.18 + (animated ? Math.sin(t * 5 + enemy.id) * r * 0.04 : 0);
      g.fillStyle = '#f4ffb0';
      g.beginPath();
      g.arc(r * 0.78, r * 0.1, orb, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = Palette.hexToRgba('#f4ffb0', 0.5);
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(r * 0.78, r * 0.1, orb * 1.8, 0, Math.PI * 2);
      g.stroke();
    } else if (def.shape === 'wraith') {
      // 相位幽魂：半透明魂体 + 两点幽光。
      g.fillStyle = Palette.hexToRgba(body, 0.82);
      primaryStroke(1.6);
      g.beginPath();
      g.moveTo(0, -r * 1.2);
      g.bezierCurveTo(r * 0.9, -r * 0.7, r * 0.95, r * 0.55, 0, r * 1.0);
      g.bezierCurveTo(-r * 0.95, r * 0.55, -r * 0.9, -r * 0.7, 0, -r * 1.2);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = '#e6e0ff';
      g.beginPath();
      g.arc(-r * 0.22, -r * 0.18, r * 0.09, 0, Math.PI * 2);
      g.arc(r * 0.22, -r * 0.18, r * 0.09, 0, Math.PI * 2);
      g.fill();
    } else if (def.shape === 'golem') {
      // 岩石魔像：八边岩块 + 熔心裂纹。
      g.fillStyle = body;
      primaryStroke(2.6);
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        const px = Math.cos(a) * r * 1.12;
        const py = Math.sin(a) * r * 1.05;
        i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
      }
      g.closePath();
      g.fill();
      g.stroke();
      g.strokeStyle = 'rgba(24, 28, 34, 0.6)';
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(-r * 0.4, -r * 0.8);
      g.lineTo(-r * 0.12, -r * 0.2);
      g.lineTo(-r * 0.4, r * 0.3);
      g.stroke();
      g.fillStyle = '#ff8a5c';
      g.beginPath();
      g.arc(0, 0, r * 0.16, 0, Math.PI * 2);
      g.fill();
    } else if (def.shape === 'skywing') {
      // 穹翼精英：菱形躯干 + 一对大翼 + 精英光环。
      const flap = animated ? Math.sin(t * 15 + enemy.id) * 0.5 : 0;
      g.fillStyle = Palette.shade(body, -0.22);
      primaryStroke(1.4);
      g.beginPath();
      g.ellipse(-r * 0.62, -flap * r * 0.5, r * 0.78, r * 0.3, -0.5 - flap, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.beginPath();
      g.ellipse(r * 0.62, -flap * r * 0.5, r * 0.78, r * 0.3, 0.5 + flap, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = body;
      g.beginPath();
      g.moveTo(r * 0.95, 0);
      g.lineTo(0, -r * 0.52);
      g.lineTo(-r * 0.95, 0);
      g.lineTo(0, r * 0.52);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = '#ffe9a8';
      g.beginPath();
      g.arc(r * 0.16, -r * 0.1, r * 0.08, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = Palette.hexToRgba(body, 0.6);
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(0, -r * 0.9, r * 0.24, Math.PI, Math.PI * 2);
      g.stroke();
    } else if (def.shape === 'bomber') {
      // 自爆虫：多刺球体 + 引信火花，逼近基地即爆。
      const spikes = 12;
      g.fillStyle = body;
      primaryStroke(1.6);
      g.beginPath();
      for (let i = 0; i < spikes; i++) {
        const a = (i / spikes) * Math.PI * 2;
        const rad = i % 2 === 0 ? r * 1.05 : r * 0.62;
        const px = Math.cos(a) * rad;
        const py = Math.sin(a) * rad;
        i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
      }
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = dark;
      g.beginPath();
      g.arc(0, 0, r * 0.34, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = dark;
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(0, -r * 0.95);
      g.quadraticCurveTo(r * 0.2, -r * 1.25, r * 0.12, -r * 1.5);
      g.stroke();
      const spark = animated ? (Math.sin(t * 22 + enemy.id) + 1) * 0.5 : 0.5;
      g.fillStyle = Palette.hexToRgba('#fff3b0', 0.55 + spark * 0.45);
      g.beginPath();
      g.arc(r * 0.12, -r * 1.5, r * 0.14 + spark * r * 0.06, 0, Math.PI * 2);
      g.fill();
    } else if (def.shape === 'stalker') {
      // 潜行者：兜帽斗篷轮廓 + 斜向幽光眼，冲刺时如隐身般半透明。
      g.fillStyle = Palette.hexToRgba(body, 0.85);
      primaryStroke(1.6);
      g.beginPath();
      g.moveTo(0, -r * 1.25);
      g.bezierCurveTo(r * 0.9, -r * 0.75, r * 0.95, r * 0.5, 0, r * 1.05);
      g.bezierCurveTo(-r * 0.95, r * 0.5, -r * 0.9, -r * 0.75, 0, -r * 1.25);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = 'rgba(6, 14, 20, 0.6)';
      g.beginPath();
      g.moveTo(-r * 0.42, -r * 0.28);
      g.lineTo(0, -r * 0.62);
      g.lineTo(r * 0.42, -r * 0.28);
      g.lineTo(r * 0.3, r * 0.18);
      g.lineTo(-r * 0.3, r * 0.18);
      g.closePath();
      g.fill();
      g.fillStyle = '#bff7ff';
      g.beginPath();
      g.moveTo(-r * 0.26, -r * 0.1);
      g.lineTo(-r * 0.06, -r * 0.18);
      g.lineTo(-r * 0.26, -r * 0.3);
      g.closePath();
      g.moveTo(r * 0.26, -r * 0.1);
      g.lineTo(r * 0.06, -r * 0.18);
      g.lineTo(r * 0.26, -r * 0.3);
      g.closePath();
      g.fill();
    } else if (def.shape === 'boss') {
      if (enemy.variant === 'armored') {
        // 磐岩渊主：八边重甲壳 + 双层护板 + 横条面甲。
        g.fillStyle = body;
        primaryStroke(3);
        g.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
          const px = Math.cos(a) * r * 1.08;
          const py = Math.sin(a) * r * 1.08;
          i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
        }
        g.closePath();
        g.fill();
        g.stroke();

        g.strokeStyle = light;
        g.lineWidth = 1.6;
        g.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
          const px = Math.cos(a) * r * 0.82;
          const py = Math.sin(a) * r * 0.82;
          i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
        }
        g.closePath();
        g.stroke();

        g.fillStyle = '#1b2330';
        g.beginPath();
        CanvasShapes.roundRect(g, -r * 0.5, -r * 0.28, r * 1.0, r * 0.34, r * 0.1);
        g.fill();
        g.fillStyle = '#dff0ff';
        g.beginPath();
        g.arc(-r * 0.22, -r * 0.11, r * 0.08, 0, Math.PI * 2);
        g.arc(r * 0.22, -r * 0.11, r * 0.08, 0, Math.PI * 2);
        g.fill();

        g.fillStyle = '#ffd36b';
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          g.beginPath();
          g.arc(Math.cos(a) * r * 0.66, Math.sin(a) * r * 0.66, r * 0.055, 0, Math.PI * 2);
          g.fill();
        }
      } else if (enemy.variant === 'summoner') {
        // 裂隙亲王：长袍轮廓 + 兜帽 + 头顶悬浮裂隙宝珠。
        g.fillStyle = body;
        primaryStroke(2.4);
        g.beginPath();
        g.moveTo(0, -r * 1.0);
        g.bezierCurveTo(r * 0.85, -r * 0.6, r * 1.05, r * 0.5, r * 0.92, r * 1.05);
        g.lineTo(-r * 0.92, r * 1.05);
        g.bezierCurveTo(-r * 1.05, r * 0.5, -r * 0.85, -r * 0.6, 0, -r * 1.0);
        g.closePath();
        g.fill();
        g.stroke();

        g.fillStyle = 'rgba(24, 8, 28, 0.72)';
        g.beginPath();
        g.ellipse(0, -r * 0.32, r * 0.48, r * 0.56, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#ffe0ff';
        g.beginPath();
        g.arc(-r * 0.2, -r * 0.35, r * 0.08, 0, Math.PI * 2);
        g.arc(r * 0.2, -r * 0.35, r * 0.08, 0, Math.PI * 2);
        g.fill();

        const orbit = animated ? Math.sin(t * 2 + enemy.id) * r * 0.06 : 0;
        g.fillStyle = '#ffd6ff';
        g.beginPath();
        g.arc(0, -r * 1.5 + orbit, r * 0.17, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = Palette.hexToRgba('#ffd6ff', 0.55);
        g.lineWidth = 1.4;
        g.beginPath();
        g.ellipse(0, -r * 1.5 + orbit, r * 0.36, r * 0.12, 0, 0, Math.PI * 2);
        g.stroke();
      } else if (enemy.variant === 'berserk') {
        // 血怒渊主：更多更长的尖刺 + 三叉角 + 灼目。
        const spikes = 22;
        g.fillStyle = body;
        primaryStroke(2.4);
        g.beginPath();
        for (let i = 0; i < spikes; i++) {
          const a = (i / spikes) * Math.PI * 2;
          const rad = i % 2 === 0 ? r * 1.18 : r * 0.7;
          const px = Math.cos(a) * rad;
          const py = Math.sin(a) * rad;
          i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
        }
        g.closePath();
        g.fill();
        g.stroke();

        g.fillStyle = dark;
        g.beginPath();
        g.moveTo(-r * 0.5, -r * 0.9);
        g.lineTo(-r * 0.72, -r * 1.65);
        g.lineTo(-r * 0.18, -r * 1.08);
        g.closePath();
        g.moveTo(r * 0.5, -r * 0.9);
        g.lineTo(r * 0.72, -r * 1.65);
        g.lineTo(r * 0.18, -r * 1.08);
        g.closePath();
        g.fill();

        g.fillStyle = '#2a0505';
        g.beginPath();
        g.arc(0, 0, r * 0.46, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#ffec8a';
        g.beginPath();
        g.arc(-r * 0.29, -r * 0.1, r * 0.08, 0, Math.PI * 2);
        g.arc(r * 0.29, -r * 0.1, r * 0.08, 0, Math.PI * 2);
        g.fill();
      } else {
        const spikes = 16;
        g.fillStyle = body;
        primaryStroke(2.2);
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
};
