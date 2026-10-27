// 可破坏物渲染层 + 确认面板的纯展示模型。
// 数据唯一来源是 shared/destructibles.js 的类型注册表（name/glyph/color/cost/effect）；
// 本模块不引用模拟层：DestructibleRenderer 只读 game.destructibles / game.hover，
// 展示模型（effect/warning/cost/failure）供 ui/modals.js 组装确认面板文案。
import { TILE } from '../shared/data.js';
import { DESTRUCTIBLE_BY_ID } from '../shared/destructibles.js';
import { Palette } from './palette.js';
import { destructibleSpriteId } from './sprite-coverage.js';

const T = TILE;

// 画质档位：低配只保留最小可读图形，去光晕/脉冲/阴影/细节。
// 与 QUALITY_PRESETS 对齐：high = glow:true + decorations:'full'，其余一律降级。
export const DESTRUCTIBLE_PROFILES = Object.freeze({
  low: Object.freeze({ tier: 'low', halo: false, pulse: 0, detail: false, shadow: false }),
  high: Object.freeze({ tier: 'high', halo: true, pulse: 0.08, detail: true, shadow: true }),
});

export function destructibleProfile(settings = {}) {
  return settings?.glow === true && settings?.decorations === 'full'
    ? DESTRUCTIBLE_PROFILES.high
    : DESTRUCTIBLE_PROFILES.low;
}

// 五种类型各自一种几何符号；未知类型回退通用方块（渲染永不因未知数据中断）。
export const DESTRUCTIBLE_SHAPES = Object.freeze({
  vein: 'diamond',
  obelisk: 'monolith',
  cache: 'crate',
  nest: 'nest',
  totem: 'ring',
});

export function destructibleShape(typeId) {
  return DESTRUCTIBLE_SHAPES[typeId] || 'block';
}

// 运行状态 → 视觉状态（纯函数）：alive 画图标，destroyed 画废墟残迹。
export function destructibleVisual(item, type = DESTRUCTIBLE_BY_ID[item?.type]) {
  if (!item || !type) return null;
  const c = Number(item.c);
  const r = Number(item.r);
  if (!Number.isFinite(c) || !Number.isFinite(r)) return null;
  const destroyed = item.destroyed === true;
  return Object.freeze({
    id: item.id,
    type: type.id,
    c,
    r,
    shape: destructibleShape(type.id),
    glyph: type.glyph,
    color: type.color,
    state: destroyed ? 'ruined' : 'alive',
    alpha: destroyed ? 0.35 : 1,
  });
}

export function destructibleVisuals(items) {
  const list = Array.isArray(items) ? items : [];
  const out = [];
  for (const item of list) {
    const visual = destructibleVisual(item);
    if (visual) out.push(visual);
  }
  return out;
}

// ---------- 确认面板展示模型（纯函数，只产出 i18n key + 参数） ----------

// 只有虫巢/图腾带负面前置警告；其余类型没有额外风险。
export const DESTRUCTIBLE_WARNING_KEYS = Object.freeze({
  nest: 'destructible.warn.nest',
  totem: 'destructible.warn.totem',
});

export function destructibleWarningKey(type) {
  return DESTRUCTIBLE_WARNING_KEYS[type?.id] || null;
}

export function destructibleCostSpec(type) {
  const cost = Number(type?.cost);
  if (!Number.isFinite(cost) || cost <= 0) {
    return { free: true, key: 'destructible.free', params: {} };
  }
  return { free: false, key: 'destructible.costValue', params: { n: cost } };
}

const auraPct = (mul) => Math.round((Number(mul) - 1) * 100);

export function destructibleEffectSpec(type) {
  const effect = type?.effect || {};
  if (effect.spawn) {
    return { key: 'destructible.effect.spawn', params: { count: effect.spawn.count } };
  }
  if (effect.aura) {
    return {
      key: 'destructible.effect.aura',
      params: { speed: auraPct(effect.aura.enemySpeedMul), hp: auraPct(effect.aura.enemyHpMul) },
    };
  }
  if (effect.towerDamageMul != null) {
    return {
      key: 'destructible.effect.damage',
      params: { pct: Math.round(effect.towerDamageMul * 100), max: effect.maxStacks ?? 3 },
    };
  }
  if (effect.gold != null && effect.baseHp != null) {
    return { key: 'destructible.effect.goldHp', params: { gold: effect.gold, hp: effect.baseHp } };
  }
  if (effect.gold != null) {
    return { key: 'destructible.effect.gold', params: { gold: effect.gold } };
  }
  if (effect.baseHp != null) {
    return { key: 'destructible.effect.hp', params: { hp: effect.baseHp } };
  }
  return { key: 'destructible.effect.none', params: {} };
}

// sim.destroyDestructible 的失败原因 → toast 文案 key（未知原因走通用失败文案）。
export const DESTRUCTIBLE_FAILURE_KEYS = Object.freeze({
  'not-found': 'destructible.toast.notFound',
  'already-destroyed': 'destructible.toast.already',
  'gold-insufficient': 'destructible.toast.noGold',
});

export function destructibleFailureKey(reason) {
  return DESTRUCTIBLE_FAILURE_KEYS[reason] || 'destructible.toast.failed';
}

// ---------- 渲染 ----------

function hashId(value) {
  let hash = 0;
  for (const char of String(value ?? '')) hash = (hash * 31 + char.charCodeAt(0)) % 1000;
  return hash;
}

export class DestructibleRenderer {
  constructor(game) {
    this.game = game;
    // 精灵管线由 Renderer 注入（setSprites）：未注入 / 缺资源时走程序化图形与废墟。
    this.sprites = null;
  }

  setSprites(sprites) {
    this.sprites = sprites || null;
    return this;
  }

  items() {
    return Array.isArray(this.game?.destructibles) ? this.game.destructibles : [];
  }

  visuals() {
    return destructibleVisuals(this.items());
  }

  // 绘制顺序：地面物件在塔之下（由 render.js 编排）。低配不做光晕/阴影/脉冲，且不新建粒子。
  render(g, time, settings = this.game?.settings || {}) {
    if (!g) return 0;
    const profile = destructibleProfile(settings);
    const t = Number.isFinite(time) ? time : 0;
    const hover = this.game?.hover || null;
    let drawn = 0;
    for (const item of this.items()) {
      const type = DESTRUCTIBLE_BY_ID[item?.type];
      if (!type) continue;
      const cx = (item.c + 0.5) * T;
      const cy = (item.r + 0.5) * T;
      const color = Palette.presentColor(type.color, settings);
      g.save();
      // 精灵优先：存活 / 已毁各有独立帧；draw 返回 false 时完整走程序化图形与废墟残迹。
      const spriteId = destructibleSpriteId(item);
      const spriteDrawn = spriteId ? this.sprites?.draw(g, spriteId, cx, cy) === true : false;
      if (item.destroyed) {
        if (!spriteDrawn) drawRuins(g, cx, cy, item, color);
      } else {
        if (hover && hover.c === item.c && hover.r === item.r) drawHover(g, cx, cy, color);
        if (!spriteDrawn) drawAlive(g, cx, cy, type, color, profile, t);
      }
      g.restore();
      drawn += 1;
    }
    return drawn;
  }
}

function drawAlive(g, cx, cy, type, color, profile, t) {
  const pulse = 1 + Math.sin(t * 2.2 + hashId(type.id) * 0.01) * profile.pulse;
  if (profile.shadow) {
    g.fillStyle = 'rgba(0, 0, 0, 0.28)';
    g.beginPath();
    g.ellipse(cx, cy + 14, 15, 6, 0, 0, Math.PI * 2);
    g.fill();
  }
  if (profile.halo) {
    const radius = 26 * pulse;
    const grad = g.createRadialGradient(cx, cy, 4, cx, cy, radius);
    grad.addColorStop(0, Palette.hexToRgba(color, 0.32));
    grad.addColorStop(1, Palette.hexToRgba(color, 0));
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, radius, 0, Math.PI * 2);
    g.fill();
  }

  g.save();
  g.translate(cx, cy);
  if (pulse !== 1) g.scale(pulse, pulse);
  g.lineWidth = 1.8;
  g.strokeStyle = Palette.hexToRgba(color, 0.9);
  g.fillStyle = Palette.hexToRgba(color, 0.22);
  switch (type.id) {
    case 'vein':
      drawVein(g, color, profile);
      break;
    case 'obelisk':
      drawMonolith(g, color, profile);
      break;
    case 'cache':
      drawCrate(g, color, profile);
      break;
    case 'nest':
      drawNest(g, color, profile);
      break;
    case 'totem':
      drawTotem(g, color, profile);
      break;
    default:
      g.beginPath();
      g.rect(-11, -11, 22, 22);
      g.fill();
      g.stroke();
      break;
  }
  g.restore();
}

function diamondPath(g, x, y, size) {
  g.beginPath();
  g.moveTo(x, y - size);
  g.lineTo(x + size, y);
  g.lineTo(x, y + size);
  g.lineTo(x - size, y);
  g.closePath();
}

function drawVein(g, color, profile) {
  diamondPath(g, 0, 0, 13);
  g.fill();
  g.stroke();
  g.fillStyle = Palette.hexToRgba(color, 0.85);
  diamondPath(g, -13, -10, 5);
  g.fill();
  diamondPath(g, 12, 9, 4);
  g.fill();
  if (profile.detail) {
    g.strokeStyle = Palette.hexToRgba('#ffffff', 0.5);
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(-6, 0);
    g.lineTo(6, 0);
    g.stroke();
  }
}

function drawMonolith(g, color, profile) {
  g.beginPath();
  g.moveTo(-9, 14);
  g.lineTo(-6, -14);
  g.lineTo(6, -14);
  g.lineTo(9, 14);
  g.closePath();
  g.fill();
  g.stroke();
  if (profile.detail) {
    g.strokeStyle = Palette.hexToRgba('#ffffff', 0.38);
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(0, -9);
    g.lineTo(0, 8);
    g.moveTo(-4, -3);
    g.lineTo(4, -3);
    g.stroke();
  }
}

function drawCrate(g, color, profile) {
  g.fillRect(-13, -11, 26, 22);
  g.strokeRect(-13, -11, 26, 22);
  if (profile.detail) {
    g.strokeStyle = Palette.hexToRgba('#ffffff', 0.32);
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(-13, 0);
    g.lineTo(13, 0);
    g.moveTo(0, -11);
    g.lineTo(0, 11);
    g.stroke();
  }
  g.fillStyle = Palette.hexToRgba(color, 0.75);
  g.fillRect(-4, -3, 8, 6);
}

function drawNest(g, color, profile) {
  g.beginPath();
  g.arc(0, 1, 14, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.beginPath();
  g.arc(0, 1, 9, 0, Math.PI * 2);
  g.stroke();
  if (profile.detail) {
    g.fillStyle = Palette.hexToRgba('#ffffff', 0.78);
    for (let i = 0; i < 3; i += 1) {
      g.beginPath();
      g.arc(-5.5 + i * 5.5, 1, 2.4, 0, Math.PI * 2);
      g.fill();
    }
  }
}

function drawTotem(g, color, profile) {
  g.lineWidth = 3;
  g.beginPath();
  g.arc(0, 0, 12, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 1.8;
  for (let i = 0; i < 4; i += 1) {
    const angle = (i * Math.PI) / 2;
    g.beginPath();
    g.moveTo(Math.cos(angle) * 7, Math.sin(angle) * 7);
    g.lineTo(Math.cos(angle) * 15, Math.sin(angle) * 15);
    g.stroke();
  }
  g.fillStyle = Palette.hexToRgba(color, profile.detail ? 0.95 : 0.75);
  g.beginPath();
  g.arc(0, 0, 4, 0, Math.PI * 2);
  g.fill();
}

function drawHover(g, cx, cy, color) {
  g.save();
  g.strokeStyle = Palette.hexToRgba('#ffffff', 0.82);
  g.lineWidth = 2;
  g.setLineDash([5, 4]);
  g.beginPath();
  g.arc(cx, cy, T * 0.44, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);
  g.strokeStyle = Palette.hexToRgba(color, 0.9);
  g.lineWidth = 1.4;
  g.beginPath();
  g.arc(cx, cy, T * 0.44 + 3, 0, Math.PI * 2);
  g.stroke();
  g.restore();
}

// 废墟：虚线残框 + 确定性碎石（位置由 id 哈希决定，不闪烁、不随机）。
function drawRuins(g, cx, cy, item, color) {
  const seed = hashId(item.id);
  g.save();
  g.globalAlpha = 0.38;
  g.strokeStyle = Palette.hexToRgba(color, 0.7);
  g.lineWidth = 1.4;
  g.setLineDash([4, 5]);
  g.beginPath();
  g.rect(cx - 15, cy - 15, 30, 30);
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = Palette.hexToRgba(color, 0.55);
  for (let i = 0; i < 3; i += 1) {
    const angle = ((seed + i * 111) % 360) * (Math.PI / 180);
    const radius = 4 + ((seed + i * 37) % 8);
    g.beginPath();
    g.arc(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, 1.6 + (i % 2), 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}
