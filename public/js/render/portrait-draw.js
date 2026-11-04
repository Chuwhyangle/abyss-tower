// 程序化立绘：塔 / 敌人 / 首领变体的卡面画像，按实体 id 确定性生成（同一 id 永远同一张脸）。
// 只读共享数据与确定性哈希；导入期零 DOM、零随机；绘制只操作传入的 2D 上下文。
// 立绘供 UI / 图鉴 / 结算卡面使用，不进实体精灵图集（与 sprite-coverage.js 的登记表对齐）。
import { ENEMIES, TOWERS } from '../shared/data.js';
import { BOSS_VARIANTS } from '../shared/data/enemies.js';
import { Palette } from './palette.js';
import { CanvasShapes } from './canvas-shapes.js';
import { portraitEntityIds } from './sprite-coverage.js';

export { portraitEntityIds };

// 32 位 FNV-1a：确定性哈希，轮廓 / 特征 / 配色都由它派生，不引入任何随机源。
function hashString(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// 实体 id（<family>.<entity>）→ 共享数据定义；塔 / 敌人 / 首领变体三族，未知返回 null。
function resolvePortrait(entityId) {
  if (typeof entityId !== 'string') return null;
  const dot = entityId.indexOf('.');
  if (dot <= 0) return null;
  const family = entityId.slice(0, dot);
  const id = entityId.slice(dot + 1);
  if (family === 'tower' && TOWERS[id]) return { family: 'tower', id, def: TOWERS[id] };
  if (family === 'enemy' && ENEMIES[id]) return { family: 'enemy', id, def: ENEMIES[id] };
  if (family === 'enemy' && BOSS_VARIANTS[id]) return { family: 'boss', id, def: BOSS_VARIANTS[id] };
  return null;
}

// 立绘规格：轮廓 / 特征 / 配色按实体 id 确定性派生，未知 id 返回 null（纯函数，可单测）。
export function portraitSpec(entityId) {
  const target = resolvePortrait(entityId);
  if (!target) return null;
  const h = hashString(entityId);
  const color = target.def.color;
  const family = target.family;
  // 轮廓边数：塔偏几何（4/6 边），敌人 4–7 边，首领 5–7 边（更尖锐）。
  const sides = family === 'tower'
    ? (h % 2 === 0 ? 4 : 6)
    : family === 'boss'
      ? 5 + (h % 3)
      : 4 + (h % 4);
  // 头部占宽比与逐边抖动：由 id 哈希逐位展开，保证不同实体轮廓两两不同。
  const bulk = 0.66 + ((h >>> 3) % 20) / 100;
  const jitter = [];
  for (let i = 0; i < sides; i += 1) jitter.push(0.82 + (((h >>> (i * 3)) % 100) / 100) * 0.3);
  const spikeCount = family === 'boss' ? 3 + (h % 4) : (h >>> 5) % 3;
  const eyeGlow = ['#ffe6a6', '#bff4ff', '#ffd9f2'][h % 3];
  const accessory = ['none', 'horns', 'crown', 'antennae', 'visor'][(h >>> 7) % 5];
  const mouthStyle = h & 1 ? 'grin' : 'flat';
  return Object.freeze({
    id: entityId,
    family,
    color,
    dark: Palette.shade(color, -0.5),
    light: Palette.shade(color, 0.3),
    sides,
    bulk,
    jitter: Object.freeze(jitter),
    spikeCount,
    eyeGlow,
    accessory,
    mouthStyle,
  });
}

// 头部多边形：以 (cx, cy) 为心、r 为标称半径，逐边抖动出不平整的轮廓（确定性）。
function traceHead(g, cx, cy, r, sides, jitter) {
  g.beginPath();
  for (let i = 0; i <= sides; i += 1) {
    const angle = (i / sides) * Math.PI * 2 - Math.PI / 2;
    const radius = r * (jitter[i % sides] ?? 1);
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
}

// 塔徽记：八种塔型各画一个可区分的几何 emblem（弩 / 炮 / 霜 / 电 / 毒 / 旗 / 震 / 狙）。
function drawTowerEmblem(g, type, cx, cy, r, color, dark) {
  g.strokeStyle = color;
  g.lineWidth = Math.max(1.5, r * 0.08);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const u = r;
  if (type === 'arrow') {
    // 弩机：弓臂 + 弓弦 + 箭矢。
    g.beginPath();
    g.arc(cx, cy, u * 0.78, -Math.PI * 0.5, Math.PI * 0.5);
    g.stroke();
    g.beginPath();
    g.moveTo(cx + u * 0.78, cy - u * 0.78);
    g.lineTo(cx - u * 0.6, cy);
    g.lineTo(cx + u * 0.78, cy + u * 0.78);
    g.stroke();
    g.strokeStyle = Palette.shade(color, 0.4);
    g.beginPath();
    g.moveTo(cx - u * 0.9, cy);
    g.lineTo(cx + u * 0.55, cy);
    g.stroke();
  } else if (type === 'cannon') {
    // 炮管 + 炮口 + 底座。
    g.strokeStyle = dark;
    g.lineWidth = Math.max(3, u * 0.34);
    g.beginPath();
    g.moveTo(cx - u * 0.85, cy + u * 0.05);
    g.lineTo(cx + u * 0.55, cy + u * 0.05);
    g.stroke();
    g.strokeStyle = color;
    g.lineWidth = Math.max(1.5, u * 0.08);
    g.beginPath();
    g.arc(cx + u * 0.6, cy + u * 0.05, u * 0.22, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.moveTo(cx - u * 0.55, cy + u * 0.55);
    g.lineTo(cx - u * 0.3, cy + u * 0.05);
    g.lineTo(cx - u * 0.55, cy - u * 0.45);
    g.stroke();
  } else if (type === 'frost') {
    // 雪花：六条辐条。
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a) * u * 0.85, cy + Math.sin(a) * u * 0.85);
      g.stroke();
    }
  } else if (type === 'arc') {
    // 闪电折线。
    g.beginPath();
    g.moveTo(cx + u * 0.1, cy - u * 0.9);
    g.lineTo(cx - u * 0.35, cy + u * 0.1);
    g.lineTo(cx + u * 0.05, cy + u * 0.1);
    g.lineTo(cx - u * 0.15, cy + u * 0.9);
    g.stroke();
  } else if (type === 'poison') {
    // 毒瓶：瓶身 + 液滴。
    g.beginPath();
    g.moveTo(cx, cy - u * 0.85);
    g.quadraticCurveTo(cx + u * 0.55, cy + u * 0.15, cx, cy + u * 0.85);
    g.quadraticCurveTo(cx - u * 0.55, cy + u * 0.15, cx, cy - u * 0.85);
    g.stroke();
    g.beginPath();
    g.moveTo(cx, cy - u * 0.85);
    g.lineTo(cx, cy - u * 0.98);
    g.stroke();
    g.beginPath();
    g.arc(cx - u * 0.22, cy + u * 0.2, u * 0.1, 0, Math.PI * 2);
    g.stroke();
  } else if (type === 'banner') {
    // 战旗：旗杆 + 旗面。
    g.beginPath();
    g.moveTo(cx - u * 0.5, cy - u * 0.9);
    g.lineTo(cx - u * 0.5, cy + u * 0.9);
    g.stroke();
    g.beginPath();
    g.moveTo(cx - u * 0.5, cy - u * 0.85);
    g.lineTo(cx + u * 0.55, cy - u * 0.55);
    g.lineTo(cx - u * 0.5, cy - u * 0.25);
    g.closePath();
    g.stroke();
  } else if (type === 'shock') {
    // 震荡波：三层同心弧。
    for (let k = 1; k <= 3; k += 1) {
      g.beginPath();
      g.arc(cx, cy, u * (0.28 * k), 0, Math.PI * 2);
      g.stroke();
    }
  } else if (type === 'sniper') {
    // 狙击镜：十字准星 + 外环。
    g.beginPath();
    g.arc(cx, cy, u * 0.6, 0, Math.PI * 2);
    g.stroke();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      g.beginPath();
      g.moveTo(cx + dx * u * 0.2, cy + dy * u * 0.2);
      g.lineTo(cx + dx * u * 0.95, cy + dy * u * 0.95);
      g.stroke();
    }
  } else {
    // 未知塔型回退通用塔身。
    g.beginPath();
    g.moveTo(cx - u * 0.7, cy + u * 0.9);
    g.lineTo(cx - u * 0.35, cy - u * 0.6);
    g.lineTo(cx + u * 0.35, cy - u * 0.6);
    g.lineTo(cx + u * 0.7, cy + u * 0.9);
    g.closePath();
    g.stroke();
  }
}

// 生物头部附件：角 / 王冠 / 触须 / 面甲，落在头顶 (cx, cy - r) 一带。
function drawAccessory(g, accessory, cx, cy, r, color) {
  const top = cy - r * 0.86;
  g.strokeStyle = color;
  g.lineWidth = Math.max(1.4, r * 0.07);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  if (accessory === 'horns') {
    for (const dir of [-1, 1]) {
      g.beginPath();
      g.moveTo(cx + dir * r * 0.3, top + r * 0.1);
      g.quadraticCurveTo(cx + dir * r * 0.85, top - r * 0.3, cx + dir * r * 0.62, top - r * 0.62);
      g.stroke();
    }
  } else if (accessory === 'crown') {
    g.beginPath();
    g.moveTo(cx - r * 0.42, top + r * 0.22);
    g.lineTo(cx - r * 0.42, top - r * 0.28);
    g.lineTo(cx - r * 0.15, top + r * 0.02);
    g.lineTo(cx, top - r * 0.38);
    g.lineTo(cx + r * 0.15, top + r * 0.02);
    g.lineTo(cx + r * 0.42, top - r * 0.28);
    g.lineTo(cx + r * 0.42, top + r * 0.22);
    g.closePath();
    g.stroke();
  } else if (accessory === 'antennae') {
    for (const dir of [-1, 1]) {
      g.beginPath();
      g.moveTo(cx + dir * r * 0.28, top + r * 0.08);
      g.quadraticCurveTo(cx + dir * r * 0.5, top - r * 0.4, cx + dir * r * 0.34, top - r * 0.56);
      g.stroke();
      g.fillStyle = color;
      g.beginPath();
      g.arc(cx + dir * r * 0.34, top - r * 0.56, r * 0.07, 0, Math.PI * 2);
      g.fill();
    }
  } else if (accessory === 'visor') {
    g.fillStyle = Palette.withAlpha(color, 0.35);
    CanvasShapes.roundRect(g, cx - r * 0.5, top - r * 0.02, r * 1.0, r * 0.3, r * 0.12);
    g.fill();
  }
}

// 生物头像：多边形头部 + 发光眼 + 嘴 + 附件；首领额外叠加尖刺。
function drawCreatureHead(g, spec, cx, cy, r) {
  const { sides, jitter, bulk, spikeCount, eyeGlow, accessory, mouthStyle, color, dark, light, family } = spec;
  // 尖刺（首领）：先落在头部后面。
  if (family === 'boss' && spikeCount > 0) {
    g.fillStyle = dark;
    g.strokeStyle = dark;
    for (let i = 0; i < spikeCount; i += 1) {
      const angle = -Math.PI / 2 + ((i - (spikeCount - 1) / 2) / spikeCount) * Math.PI * 0.9;
      const bx = cx + Math.cos(angle) * r * bulk;
      const by = cy + Math.sin(angle) * r * bulk;
      const px = cx + Math.cos(angle) * r * (bulk + 0.38);
      const py = cy + Math.sin(angle) * r * (bulk + 0.38);
      const perp = angle + Math.PI / 2;
      g.beginPath();
      g.moveTo(bx + Math.cos(perp) * r * 0.1, by + Math.sin(perp) * r * 0.1);
      g.lineTo(px, py);
      g.lineTo(bx - Math.cos(perp) * r * 0.1, by - Math.sin(perp) * r * 0.1);
      g.closePath();
      g.fill();
    }
  }

  traceHead(g, cx, cy, r * bulk, sides, jitter);
  g.fillStyle = color;
  g.fill();
  g.strokeStyle = dark;
  g.lineWidth = Math.max(1.6, r * 0.07);
  g.lineJoin = 'round';
  g.stroke();

  // 眼睛：发光双瞳，间距由 bulk 决定。
  const eyeGap = r * bulk * 0.32;
  const eyeR = r * 0.11;
  g.fillStyle = eyeGlow;
  g.beginPath();
  g.arc(cx - eyeGap, cy - r * 0.06, eyeR, 0, Math.PI * 2);
  g.arc(cx + eyeGap, cy - r * 0.06, eyeR, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(12, 10, 16, 0.85)';
  g.beginPath();
  g.arc(cx - eyeGap, cy - r * 0.06, eyeR * 0.42, 0, Math.PI * 2);
  g.arc(cx + eyeGap, cy - r * 0.06, eyeR * 0.42, 0, Math.PI * 2);
  g.fill();

  // 嘴：咧嘴或平线。
  g.strokeStyle = dark;
  g.lineWidth = Math.max(1.4, r * 0.06);
  g.beginPath();
  if (mouthStyle === 'grin') {
    g.moveTo(cx - r * 0.22, cy + r * 0.32);
    g.quadraticCurveTo(cx, cy + r * 0.52, cx + r * 0.22, cy + r * 0.32);
  } else {
    g.moveTo(cx - r * 0.2, cy + r * 0.34);
    g.lineTo(cx + r * 0.2, cy + r * 0.34);
  }
  g.stroke();

  // 附件。
  drawAccessory(g, accessory, cx, cy, r, light);
}

// 绘制立绘：卡面底 + 辉光 + 内容。返回是否实际绘制（未知实体 / 无上下文为 false）。
export function drawPortrait(g, entityId, size = 96, { time = 0 } = {}) {
  const spec = portraitSpec(entityId);
  if (!spec || !g) return false;
  const s = Number.isFinite(size) && size > 0 ? size : 96;
  const cx = s / 2;
  const cy = s * 0.52;
  const r = s * 0.3;
  const pulse = 1 + 0.04 * Math.sin(Number.isFinite(time) ? time * 2 : 0);

  g.save();

  // 卡面底。
  CanvasShapes.roundRect(g, 1, 1, s - 2, s - 2, s * 0.1);
  g.fillStyle = '#101820';
  g.fill();
  g.strokeStyle = Palette.withAlpha(spec.color, 0.5);
  g.lineWidth = 1.5;
  g.stroke();

  // 主体辉光。
  g.fillStyle = Palette.withAlpha(spec.color, 0.1);
  g.beginPath();
  g.arc(cx, cy, r * 1.6 * pulse, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = Palette.withAlpha(spec.color, 0.16);
  g.beginPath();
  g.arc(cx, cy, r * 1.12 * pulse, 0, Math.PI * 2);
  g.fill();

  if (spec.family === 'tower') {
    // 塔座。
    g.fillStyle = Palette.shade(spec.color, -0.3);
    CanvasShapes.roundRect(g, cx - r * 0.62, cy + r * 0.55, r * 1.24, r * 0.28, r * 0.1);
    g.fill();
    drawTowerEmblem(g, spec.id.slice('tower.'.length), cx, cy - r * 0.05, r * 0.8, spec.color, spec.dark);
  } else {
    drawCreatureHead(g, spec, cx, cy, r);
  }

  g.restore();
  return true;
}
