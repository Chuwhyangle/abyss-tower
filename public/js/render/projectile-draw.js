// 弹道形态表与绘制函数：按塔型（八座塔各自的箭矢/炮弹/冰晶/电弧/毒滴/战旗脉冲/震荡波/狙击弹）
// 与投射物 kind（炮弹/冰锥/电球/毒液/箭矢）两套入口提供贴图绘制规格。
//
// 每个形态 = { w, h, ox, oy, draw(g) }：draw 在已平移到中心的逻辑坐标系里绘制；
// 光栅化与缓存由 projectile-renderer.js 的 ProjectileSpriteCache 负责，本模块不碰 canvas。
// 图形定义：w/h 为逻辑尺寸，ox/oy 为贴图内弹体中心偏移。
// draw(g) 在已平移到中心的逻辑坐标系里绘制，坐标与原逐帧绘制完全一致。
export const PROJECTILE_ART = {
  shell: {
    trail: {
      w: 30, h: 12, ox: 30, oy: 6,
      draw(g) {
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
      },
    },
    body: {
      w: 20, h: 20, ox: 10, oy: 10,
      draw(g) {
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
      },
    },
    glow: { color: '#ffb066', radius: 12, alpha: 0.55 },
  },
  frost: {
    trail: {
      w: 20, h: 8, ox: 19, oy: 4,
      draw(g) {
        g.strokeStyle = 'rgba(124, 212, 245, 0.3)';
        g.lineWidth = 5;
        g.beginPath();
        g.moveTo(-18, 0);
        g.lineTo(-3, 0);
        g.stroke();
      },
    },
    body: {
      w: 16, h: 16, ox: 8, oy: 8,
      draw(g) {
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
      },
    },
    glow: { color: '#a0ebff', radius: 11, alpha: 0.5 },
  },
  shock: {
    trail: {
      w: 18, h: 8, ox: 17, oy: 4,
      draw(g) {
        g.strokeStyle = 'rgba(111, 227, 200, 0.3)';
        g.lineWidth = 5;
        g.beginPath();
        g.moveTo(-16, 0);
        g.lineTo(-3, 0);
        g.stroke();
      },
    },
    body: {
      w: 20, h: 20, ox: 10, oy: 10,
      draw(g) {
        g.fillStyle = '#b9fff0';
        g.strokeStyle = '#6fe3c8';
        g.lineWidth = 1.6;
        g.beginPath();
        g.arc(0, 0, 4.6, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.strokeStyle = 'rgba(210, 255, 246, 0.7)';
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(0, 0, 7.4, -0.9, 0.9);
        g.stroke();
      },
    },
    glow: { color: '#6fe3c8', radius: 11, alpha: 0.5 },
  },
  poison: {
    trail: {
      w: 18, h: 8, ox: 17, oy: 4,
      draw(g) {
        g.strokeStyle = 'rgba(154, 223, 106, 0.28)';
        g.lineWidth = 5;
        g.beginPath();
        g.moveTo(-16, 0);
        g.lineTo(-3, 0);
        g.stroke();
      },
    },
    body: {
      w: 14, h: 14, ox: 7, oy: 7,
      draw(g) {
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
      },
    },
    glow: { color: '#9adf6a', radius: 10, alpha: 0.45 },
  },
  bolt: {
    trail: {
      w: 20, h: 8, ox: 17, oy: 4,
      draw(g) {
        g.strokeStyle = 'rgba(255, 233, 176, 0.35)';
        g.lineWidth = 5;
        g.beginPath();
        g.moveTo(-16, 0);
        g.lineTo(2, 0);
        g.stroke();
      },
    },
    body: {
      w: 24, h: 10, ox: 13, oy: 5,
      draw(g) {
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
      },
    },
    glow: null,
  },
};

export function projectileArt(kind) {
  const known = typeof kind === 'string' && Object.hasOwn(PROJECTILE_ART, kind);
  return known ? PROJECTILE_ART[kind] : PROJECTILE_ART.bolt;
}

// 八座塔各自的弹道形态。shape 用于回归断言「每种塔形态可辨识」，
// kind 是该塔在模拟层使用的投射物类型（战旗塔不发射弹道，故为 null）。
// 未注册的 towerType 一律回退到 kind 形态，渲染不会因未知类型中断。
export const TOWER_PROJECTILE_FORMS = {
  arrow: {
    id: 'arrow', kind: 'bolt', shape: 'arrow', color: '#8fe0a8',
    trail: {
      w: 26, h: 8, ox: 22, oy: 4,
      draw(g) {
        g.strokeStyle = 'rgba(143, 224, 168, 0.22)';
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(-20, 0);
        g.lineTo(-2, 0);
        g.stroke();
        g.strokeStyle = 'rgba(210, 255, 226, 0.3)';
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(-24, 0);
        g.lineTo(-10, 0);
        g.stroke();
      },
    },
    body: {
      w: 24, h: 12, ox: 12, oy: 6,
      draw(g) {
        g.fillStyle = '#eafff2';
        g.strokeStyle = '#8fe0a8';
        g.lineWidth = 1.3;
        g.beginPath();
        g.moveTo(10, 0);
        g.lineTo(2, -3.4);
        g.lineTo(-6, -2.2);
        g.lineTo(-8, 0);
        g.lineTo(-6, 2.2);
        g.lineTo(2, 3.4);
        g.closePath();
        g.fill();
        g.stroke();
        g.strokeStyle = 'rgba(143, 224, 168, 0.9)';
        g.lineWidth = 1.1;
        g.beginPath();
        g.moveTo(-7, 0);
        g.lineTo(-10, -3.2);
        g.moveTo(-7, 0);
        g.lineTo(-10, 3.2);
        g.stroke();
        g.fillStyle = '#8fe0a8';
        g.beginPath();
        g.arc(2, 0, 1.1, 0, Math.PI * 2);
        g.fill();
      },
    },
    glow: { color: '#a8ffc0', radius: 9, alpha: 0.4 },
  },
  cannon: {
    id: 'cannon', kind: 'shell', shape: 'shot', color: '#f0a35e',
    trail: {
      w: 30, h: 12, ox: 28, oy: 6,
      draw(g) {
        g.strokeStyle = 'rgba(255, 160, 90, 0.22)';
        g.lineWidth = 7;
        g.beginPath();
        g.moveTo(-20, 0);
        g.lineTo(-3, 0);
        g.stroke();
        g.strokeStyle = 'rgba(120, 90, 70, 0.28)';
        g.lineWidth = 10;
        g.beginPath();
        g.moveTo(-27, 0);
        g.lineTo(-16, 0);
        g.stroke();
      },
    },
    body: {
      w: 22, h: 22, ox: 11, oy: 11,
      draw(g) {
        g.fillStyle = '#23282e';
        g.strokeStyle = '#ffb066';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(0, 0, 6, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.fillStyle = 'rgba(255, 210, 150, 0.72)';
        g.beginPath();
        g.arc(-1.8, -1.8, 1.6, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#8a5a2c';
        g.lineWidth = 1.4;
        g.beginPath();
        g.moveTo(6, 0);
        g.lineTo(8.5, 0);
        g.stroke();
      },
    },
    glow: { color: '#ffb066', radius: 13, alpha: 0.55 },
  },
  frost: {
    id: 'frost', kind: 'frost', shape: 'crystal', color: '#7cd4f5',
    trail: {
      w: 22, h: 8, ox: 20, oy: 4,
      draw(g) {
        g.strokeStyle = 'rgba(124, 212, 245, 0.26)';
        g.lineWidth = 4;
        g.beginPath();
        g.moveTo(-18, 0);
        g.lineTo(-3, 0);
        g.stroke();
        g.strokeStyle = 'rgba(220, 250, 255, 0.32)';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(-21, -2);
        g.lineTo(-14, 2);
        g.moveTo(-17, 2);
        g.lineTo(-10, -2);
        g.stroke();
      },
    },
    body: {
      w: 18, h: 18, ox: 9, oy: 9,
      draw(g) {
        g.fillStyle = '#e6fbff';
        g.strokeStyle = '#7cd4f5';
        g.lineWidth = 1.4;
        g.beginPath();
        g.moveTo(7.4, 0);
        g.lineTo(2.6, -4.2);
        g.lineTo(0, -7.2);
        g.lineTo(-2.6, -4.2);
        g.lineTo(-7.4, 0);
        g.lineTo(-2.6, 4.2);
        g.lineTo(0, 7.2);
        g.lineTo(2.6, 4.2);
        g.closePath();
        g.fill();
        g.stroke();
        g.strokeStyle = 'rgba(180, 235, 255, 0.7)';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(-4.4, 0);
        g.lineTo(4.4, 0);
        g.moveTo(0, -5);
        g.lineTo(0, 5);
        g.stroke();
      },
    },
    glow: { color: '#a0ebff', radius: 11, alpha: 0.5 },
  },
  arc: {
    id: 'arc', kind: 'arc', shape: 'arc', color: '#b48cff',
    trail: {
      w: 24, h: 8, ox: 20, oy: 4,
      draw(g) {
        g.strokeStyle = 'rgba(180, 140, 255, 0.24)';
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(-19, 0);
        g.lineTo(-12, -2);
        g.moveTo(-14, 0);
        g.lineTo(-6, 2);
        g.stroke();
      },
    },
    body: {
      w: 22, h: 16, ox: 11, oy: 8,
      draw(g) {
        g.strokeStyle = 'rgba(180, 140, 255, 0.35)';
        g.lineWidth = 4;
        g.beginPath();
        g.moveTo(-9, 3);
        g.lineTo(-4.5, -3);
        g.lineTo(0, 3);
        g.lineTo(4.5, -4);
        g.lineTo(9, 2);
        g.stroke();
        g.strokeStyle = '#e3d6ff';
        g.lineWidth = 1.6;
        g.stroke();
        g.fillStyle = '#c9a8ff';
        g.beginPath();
        g.arc(9, 2, 1.4, 0, Math.PI * 2);
        g.fill();
      },
    },
    glow: { color: '#c9a8ff', radius: 12, alpha: 0.55 },
  },
  poison: {
    id: 'poison', kind: 'poison', shape: 'droplet', color: '#9adf6a',
    trail: {
      w: 20, h: 8, ox: 18, oy: 4,
      draw(g) {
        g.fillStyle = 'rgba(154, 223, 106, 0.26)';
        g.beginPath();
        g.arc(-16, 0, 2.4, 0, Math.PI * 2);
        g.fill();
        g.beginPath();
        g.arc(-10, 0, 1.6, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = 'rgba(154, 223, 106, 0.22)';
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(-4, 0);
        g.lineTo(-1, 0);
        g.stroke();
      },
    },
    body: {
      w: 16, h: 16, ox: 8, oy: 8,
      draw(g) {
        g.fillStyle = '#9adf6a';
        g.strokeStyle = '#3f6b2c';
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(0, 1, 4.4, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.beginPath();
        g.moveTo(0, -6.8);
        g.lineTo(2.6, -1.2);
        g.lineTo(-2.6, -1.2);
        g.closePath();
        g.fill();
        g.fillStyle = 'rgba(225, 255, 190, 0.8)';
        g.beginPath();
        g.arc(-1.4, -0.4, 1.3, 0, Math.PI * 2);
        g.fill();
      },
    },
    glow: { color: '#7fdf4f', radius: 10, alpha: 0.45 },
  },
  banner: {
    id: 'banner', kind: null, shape: 'pulse', color: '#f5c451',
    trail: {
      w: 20, h: 8, ox: 17, oy: 4,
      draw(g) {
        g.strokeStyle = 'rgba(245, 196, 81, 0.3)';
        g.lineWidth = 1.6;
        g.beginPath();
        g.moveTo(-15, -3);
        g.lineTo(-9, 0);
        g.lineTo(-15, 3);
        g.moveTo(-8, -2.4);
        g.lineTo(-3, 0);
        g.lineTo(-8, 2.4);
        g.stroke();
      },
    },
    body: {
      w: 20, h: 20, ox: 10, oy: 10,
      draw(g) {
        g.strokeStyle = 'rgba(245, 196, 81, 0.75)';
        g.lineWidth = 1.6;
        g.beginPath();
        g.arc(0, 0, 4.4, -0.7, 0.7);
        g.stroke();
        g.strokeStyle = 'rgba(245, 196, 81, 0.4)';
        g.lineWidth = 1.3;
        g.beginPath();
        g.arc(0, 0, 7.2, -0.55, 0.55);
        g.stroke();
        g.strokeStyle = '#a87a1c';
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(-3, -7);
        g.lineTo(-3, 6);
        g.stroke();
        g.fillStyle = '#ffe9a8';
        g.beginPath();
        g.moveTo(-3, -6.4);
        g.lineTo(3.2, -4.4);
        g.lineTo(-3, -2.4);
        g.closePath();
        g.fill();
      },
    },
    glow: { color: '#f5c451', radius: 12, alpha: 0.5 },
  },
  shock: {
    id: 'shock', kind: 'shock', shape: 'wave', color: '#6fe3c8',
    trail: {
      w: 18, h: 8, ox: 16, oy: 4,
      draw(g) {
        g.strokeStyle = 'rgba(111, 227, 200, 0.26)';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(-15, -2.6);
        g.lineTo(-10, 0);
        g.lineTo(-15, 2.6);
        g.moveTo(-8, -2);
        g.lineTo(-4, 0);
        g.lineTo(-8, 2);
        g.stroke();
      },
    },
    body: {
      w: 20, h: 20, ox: 10, oy: 10,
      draw(g) {
        g.strokeStyle = 'rgba(111, 227, 200, 0.6)';
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(-1, 0, 4.2, -1.1, 1.1);
        g.stroke();
        g.strokeStyle = 'rgba(185, 255, 240, 0.45)';
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(-1, 0, 7, -0.8, 0.8);
        g.stroke();
        g.fillStyle = '#b9fff0';
        g.beginPath();
        g.arc(1, 0, 2.2, 0, Math.PI * 2);
        g.fill();
      },
    },
    glow: { color: '#6fe3c8', radius: 11, alpha: 0.5 },
  },
  sniper: {
    id: 'sniper', kind: 'bolt', shape: 'tracer', color: '#8fb8ff',
    trail: {
      w: 40, h: 10, ox: 32, oy: 5,
      draw(g) {
        g.strokeStyle = 'rgba(143, 184, 255, 0.18)';
        g.lineWidth = 4;
        g.beginPath();
        g.moveTo(-30, 0);
        g.lineTo(-3, 0);
        g.stroke();
        g.strokeStyle = 'rgba(200, 225, 255, 0.32)';
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(-32, 0);
        g.lineTo(-18, 0);
        g.moveTo(-12, 0);
        g.lineTo(-4, 0);
        g.stroke();
      },
    },
    body: {
      w: 24, h: 12, ox: 11, oy: 6,
      draw(g) {
        g.fillStyle = '#e9f1ff';
        g.strokeStyle = '#8fb8ff';
        g.lineWidth = 1.3;
        g.beginPath();
        g.moveTo(13, 0);
        g.lineTo(4, -2.4);
        g.lineTo(-6, -2.4);
        g.lineTo(-9, 0);
        g.lineTo(-6, 2.4);
        g.lineTo(4, 2.4);
        g.closePath();
        g.fill();
        g.stroke();
        g.strokeStyle = 'rgba(143, 184, 255, 0.85)';
        g.lineWidth = 1.1;
        g.beginPath();
        g.moveTo(-4, -4);
        g.lineTo(-4, -1);
        g.moveTo(-4, 1);
        g.lineTo(-4, 4);
        g.stroke();
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.arc(5, 0, 1.3, 0, Math.PI * 2);
        g.fill();
      },
    },
    glow: { color: '#8fb8ff', radius: 10, alpha: 0.4 },
  },
};

export function projectileTowerForm(towerType) {
  const known = typeof towerType === 'string' && Object.hasOwn(TOWER_PROJECTILE_FORMS, towerType);
  return known ? TOWER_PROJECTILE_FORMS[towerType] : null;
}

// 渲染入口的形态解析顺序：塔型形态 → 投射物 kind 形态 → 箭矢兜底。
export function projectileForm(projectile) {
  const source = projectile && typeof projectile === 'object' ? projectile : {};
  return projectileTowerForm(source.towerType) || projectileArt(source.kind);
}
