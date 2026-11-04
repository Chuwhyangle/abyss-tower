// 程序化遗物图标：按遗物稀有度（边框层数）/ 颜色 / glyph 确定性绘制。
// 只读共享数据与确定性哈希；导入期零 DOM、零随机；绘制只操作传入的 2D 上下文。
// 与 canvas-shapes.js 的稀有度图标同源配色，但每个遗物多一个由 id 哈希选出的独特 glyph。
import { RELIC_BY_ID, RARITY } from '../shared/data.js';
import { Palette } from './palette.js';
import { CanvasShapes } from './canvas-shapes.js';
import { relicIconIds } from './sprite-coverage.js';

export { relicIconIds };

// 32 位 FNV-1a：与 portrait-draw.js 同款确定性哈希。
function hashString(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// glyph 表：十种几何母题（描边风格与 canvas-shapes.js 图标语言一致），由 id 哈希选取。
export const RELIC_GLYPH_NAMES = Object.freeze([
  'arrow',
  'bolt',
  'drop',
  'star',
  'coin',
  'shield',
  'hourglass',
  'eye',
  'snow',
  'flame',
]);

export function relicGlyphName(relicId) {
  if (typeof relicId !== 'string' || !relicId) return 'arrow';
  return RELIC_GLYPH_NAMES[hashString(relicId) % RELIC_GLYPH_NAMES.length];
}

// 遗物图标规格：稀有度 / 颜色 / glyph 按遗物 id 确定性派生，未知 id 返回 null（纯函数）。
export function relicIconSpec(relicId) {
  const relic = RELIC_BY_ID[relicId];
  if (!relic) return null;
  const rarity = RARITY[relic.rarity] || RARITY.common;
  const glyph = relicGlyphName(relicId);
  return Object.freeze({
    id: relicId,
    rarity: relic.rarity,
    faction: typeof relic.faction === 'string' ? relic.faction : 'neutral',
    color: rarity.color,
    dark: Palette.shade(rarity.color, -0.45),
    glyph,
  });
}

// glyph 描边：在 [−1, 1] 归一化盒内落笔，调用方负责 stroke 与样式。
function traceGlyph(g, glyph, r) {
  const u = r;
  if (glyph === 'arrow') {
    g.moveTo(0, -u * 0.85);
    g.lineTo(u * 0.62, u * 0.35);
    g.lineTo(u * 0.2, u * 0.35);
    g.lineTo(u * 0.2, u * 0.85);
    g.lineTo(-u * 0.2, u * 0.85);
    g.lineTo(-u * 0.2, u * 0.35);
    g.lineTo(-u * 0.62, u * 0.35);
    g.closePath();
  } else if (glyph === 'bolt') {
    g.moveTo(u * 0.15, -u * 0.9);
    g.lineTo(-u * 0.45, u * 0.05);
    g.lineTo(0, u * 0.05);
    g.lineTo(-u * 0.15, u * 0.9);
    g.lineTo(u * 0.45, -u * 0.05);
    g.lineTo(0, -u * 0.05);
    g.closePath();
  } else if (glyph === 'drop') {
    g.moveTo(0, -u * 0.85);
    g.quadraticCurveTo(u * 0.6, u * 0.25, 0, u * 0.85);
    g.quadraticCurveTo(-u * 0.6, u * 0.25, 0, -u * 0.85);
    g.closePath();
  } else if (glyph === 'star') {
    for (let i = 0; i < 4; i += 1) {
      const a = (i / 4) * Math.PI * 2;
      const b = a + Math.PI / 4;
      g.moveTo(Math.cos(a) * u * 0.85, Math.sin(a) * u * 0.85);
      g.lineTo(Math.cos(b) * u * 0.3, Math.sin(b) * u * 0.3);
    }
  } else if (glyph === 'coin') {
    g.moveTo(u * 0.8, 0);
    g.arc(0, 0, u * 0.8, 0, Math.PI * 2);
    g.moveTo(-u * 0.32, 0);
    g.lineTo(u * 0.32, 0);
  } else if (glyph === 'shield') {
    g.moveTo(0, -u * 0.8);
    g.lineTo(u * 0.62, -u * 0.5);
    g.quadraticCurveTo(u * 0.5, u * 0.4, 0, u * 0.85);
    g.quadraticCurveTo(-u * 0.5, u * 0.4, -u * 0.62, -u * 0.5);
    g.closePath();
  } else if (glyph === 'hourglass') {
    g.moveTo(-u * 0.55, -u * 0.85);
    g.lineTo(u * 0.55, -u * 0.85);
    g.lineTo(-u * 0.55, u * 0.85);
    g.lineTo(u * 0.55, u * 0.85);
    g.closePath();
  } else if (glyph === 'eye') {
    g.moveTo(-u * 0.75, 0);
    g.quadraticCurveTo(0, -u * 0.75, u * 0.75, 0);
    g.quadraticCurveTo(0, u * 0.75, -u * 0.75, 0);
    g.closePath();
    g.moveTo(u * 0.28, 0);
    g.arc(0, 0, u * 0.28, 0, Math.PI * 2);
  } else if (glyph === 'snow') {
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2;
      g.moveTo(Math.cos(a) * u * 0.18, Math.sin(a) * u * 0.18);
      g.lineTo(Math.cos(a) * u * 0.85, Math.sin(a) * u * 0.85);
    }
  } else if (glyph === 'flame') {
    g.moveTo(0, u * 0.85);
    g.quadraticCurveTo(-u * 0.62, u * 0.2, -u * 0.15, -u * 0.45);
    g.quadraticCurveTo(0, -u * 0.2, u * 0.28, -u * 0.75);
    g.quadraticCurveTo(u * 0.45, -u * 0.3, u * 0.28, 0);
    g.quadraticCurveTo(u * 0.62, u * 0.25, 0, u * 0.85);
    g.closePath();
  }
}

// 绘制遗物图标：稀有度边框（普通单层 / 稀有双层 / 史诗三层）+ 中心 glyph。
// 返回是否实际绘制（未知遗物 / 无上下文为 false）。
export function drawRelicIcon(g, relicId, size = 32) {
  const spec = relicIconSpec(relicId);
  if (!spec || !g) return false;
  const s = Number.isFinite(size) && size > 0 ? size : 32;
  const cx = s / 2;
  const cy = s / 2;
  const frameR = s * 0.46;

  g.save();

  // 徽章底：深色圆角底 + 稀有度描边。
  CanvasShapes.roundRect(g, s * 0.05, s * 0.05, s * 0.9, s * 0.9, s * 0.16);
  g.fillStyle = '#101820';
  g.fill();
  g.strokeStyle = spec.color;
  g.lineWidth = Math.max(1.2, s * 0.05);
  g.stroke();

  // 稀有度边框层：稀有加一内层，史诗再加一层（形状只靠层数，不依赖颜色）。
  const layers = spec.rarity === 'epic' ? 2 : spec.rarity === 'rare' ? 1 : 0;
  for (let i = 1; i <= layers; i += 1) {
    g.strokeStyle = Palette.withAlpha(spec.color, 0.7);
    g.lineWidth = Math.max(1, s * 0.03);
    g.beginPath();
    g.arc(cx, cy, frameR - i * s * 0.09, 0, Math.PI * 2);
    g.stroke();
  }

  // 中心 glyph。
  g.translate(cx, cy);
  g.strokeStyle = spec.color;
  g.lineWidth = Math.max(1.4, s * 0.05);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  traceGlyph(g, spec.glyph, frameR * 0.62);
  g.stroke();

  g.restore();
  return true;
}
