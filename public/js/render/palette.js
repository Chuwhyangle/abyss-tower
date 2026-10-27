// 生物群系调色板、无障碍配色与颜色工具。纯数据/纯函数，不接触 Canvas。
// 所有字面色值都来自 art-tokens.js；本文件只做取值、派生与可访问性计算。
import {
  ACCESSIBILITY_TOKENS,
  CHARACTER_TOKENS,
  FALLBACK_TOKENS,
  PALETTE_TOKENS,
  SEMANTIC_COLORBLIND_TOKENS,
  SEMANTIC_TOKENS,
  SKILL_SEMANTIC_MAP,
  WARNING_TOKENS,
} from './art-tokens.js';

export { SKILL_SEMANTIC_MAP };

const BIOME_PALETTES = PALETTE_TOKENS;

// 两两颜色在 CIE Lab 下的最小距离；低于该值视为难以区分。
export const ACCESSIBILITY_MIN_DISTANCE = ACCESSIBILITY_TOKENS.minLabDistance;

const BASE_RARITY_COLORS = CHARACTER_TOKENS.rarity;
const BASE_TOWER_COLORS = CHARACTER_TOKENS.towers;
const BASE_ENEMY_COLORS = CHARACTER_TOKENS.enemies;

// 红绿色盲（deuteranopia/protanopia）保留蓝-黄轴，蓝黄色盲（tritanopia）保留红-绿轴；
// 两套重映射与语义重映射的定义都在 art-tokens.js。
export const ACCESSIBILITY_PALETTES = Object.freeze({
  none: Object.freeze({
    rarity: BASE_RARITY_COLORS,
    towers: BASE_TOWER_COLORS,
    enemies: BASE_ENEMY_COLORS,
  }),
  deuteranopia: ACCESSIBILITY_TOKENS.blueYellow,
  protanopia: ACCESSIBILITY_TOKENS.blueYellow,
  tritanopia: ACCESSIBILITY_TOKENS.redGreen,
});

// 技能预警的语义规范：危险=红橙、控制=蓝、增益=金。
// 形状由语义固定（危险=环、控制=六边、增益=星芒），玩家技能与首领技能共用同一套语言。
export const SKILL_SEMANTICS = SEMANTIC_TOKENS;

// 色盲模式下的语义重映射；三类语义在每种模式下仍保持 LAB 距离 ≥ ACCESSIBILITY_MIN_DISTANCE。
const SKILL_SEMANTICS_COLORBLIND = SEMANTIC_COLORBLIND_TOKENS;

// 预警几何：线宽、倒计时环、虚线节奏与填充只在这里定义，所有技能共用。
export const SKILL_WARNING_STYLE = WARNING_TOKENS;

function parseColor(color) {
  if (typeof color !== 'string') return null;
  const value = color.trim();
  if (value.startsWith('#')) {
    const hex = value.slice(1);
    const full = hex.length === 3 ? hex.split('').map((char) => char + char).join('') : hex;
    if (full.length !== 6) return null;
    return [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16));
  }
  const match = /^rgba?\(([^)]+)\)$/i.exec(value);
  if (!match) return null;
  return match[1]
    .split(',')
    .slice(0, 3)
    .map((part) => Number(part.trim()));
}

function channelLuminance(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

function encodeGamma(value) {
  return value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
}

function colorToLab(color) {
  const rgb = parseColor(color);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(channelLuminance);
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (value) => (value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labToHex([lightness, a, b]) {
  const fy = (lightness + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inverse = (value) => {
    const cube = value * value * value;
    return cube > 0.008856 ? cube : (value - 16 / 116) / 7.787;
  };
  const x = inverse(fx) * 0.95047;
  const y = inverse(fy);
  const z = inverse(fz) * 1.08883;
  const channels = [
    x * 3.2406 + y * -1.5372 + z * -0.4986,
    x * -0.9689 + y * 1.8758 + z * 0.0415,
    x * 0.0557 + y * -0.204 + z * 1.057,
  ];
  return `#${channels
    .map((channel) =>
      Math.round(Math.max(0, Math.min(255, encodeGamma(channel) * 255)))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;
}

// 拉开明度差（保留色相/彩度），提升与背景的分离度；用于高对比预设。
function boostContrast(color, factor = 1.2) {
  const lab = colorToLab(color);
  if (!lab) return color;
  const lightness = Math.max(5, Math.min(97, 50 + (lab[0] - 50) * factor));
  return labToHex([lightness, lab[1], lab[2]]);
}

function boostAlpha(color, factor, maxAlpha) {
  const match = /^rgba?\(([^)]+)\)$/i.exec(String(color));
  if (!match) return color;
  const parts = match[1].split(',').map((part) => part.trim());
  const alpha = parts.length > 3 ? Number(parts[3]) : 1;
  const next = Number.isFinite(alpha) ? Math.min(maxAlpha, alpha * factor) : maxAlpha;
  return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${Number(next.toFixed(3))})`;
}

function mapColors(colors) {
  return Object.freeze(
    Object.fromEntries(Object.entries(colors).map(([id, color]) => [id, boostContrast(color)]))
  );
}

export class Palette {
  // 地图原型 → 调色板对象。未知原型回退 canyon。
  static resolve(map) {
    return BIOME_PALETTES[map.archetype] || BIOME_PALETTES.canyon;
  }

  // 高对比预设：加深路径边缘、提亮路径与描边，保留群系色相。
  static highContrast(palette) {
    return {
      ...palette,
      pathEdge: Palette.shade(palette.pathEdge, -0.55),
      path: Palette.shade(palette.path, 0.55),
      pathInner: Palette.shade(palette.pathInner, 0.65),
      pathLine: boostAlpha(palette.pathLine, 1.7, 0.65),
      grid: boostAlpha(palette.grid, 1.9, 0.5),
      rockEdge: Palette.shade(palette.rockEdge, 0.35),
    };
  }

  static normalizeMode(value) {
    if (typeof value === 'string') {
      return ACCESSIBILITY_PALETTES[value] ? value : 'none';
    }
    const mode = value?.colorBlind;
    return ACCESSIBILITY_PALETTES[mode] ? mode : 'none';
  }

  // settings 可以是完整设置对象，也可以直接传模式字符串。
  static colorsFor(settings) {
    const mode = Palette.normalizeMode(settings);
    const base = ACCESSIBILITY_PALETTES[mode];
    if (!settings?.highContrast) return base;
    return {
      rarity: mapColors(base.rarity),
      towers: mapColors(base.towers),
      enemies: mapColors(base.enemies),
    };
  }

  // 技能 id 或语义 id → 语义定义；未知输入回退危险（fail-safe：宁可显眼）。
  static semantic(kindOrId) {
    const id = SKILL_SEMANTIC_MAP[kindOrId] || kindOrId;
    return SKILL_SEMANTICS[id] || SKILL_SEMANTICS.danger;
  }

  static semanticColor(kindOrId, settings) {
    const { id } = Palette.semantic(kindOrId);
    const mode = Palette.normalizeMode(settings);
    const mapped = SKILL_SEMANTICS_COLORBLIND[mode]?.[id];
    const color = mapped || SKILL_SEMANTICS[id].color;
    return settings?.highContrast ? boostContrast(color) : color;
  }

  static semanticAccent(kindOrId, settings) {
    const { id } = Palette.semantic(kindOrId);
    return settings?.highContrast ? boostContrast(SKILL_SEMANTICS[id].accent) : SKILL_SEMANTICS[id].accent;
  }

  static semanticShape(kindOrId) {
    return Palette.semantic(kindOrId).shape;
  }

  static rarityColor(rarity, settings) {
    return Palette.colorsFor(settings).rarity[rarity] || BASE_RARITY_COLORS[rarity] || null;
  }

  static towerColor(type, settings) {
    return Palette.colorsFor(settings).towers[type] || BASE_TOWER_COLORS[type] || null;
  }

  static enemyColor(type, settings) {
    return Palette.colorsFor(settings).enemies[type] || BASE_ENEMY_COLORS[type] || null;
  }

  // 进化等派生色不走角色映射，只在开启高对比时提亮。
  static presentColor(color, settings) {
    return settings?.highContrast ? boostContrast(color) : color;
  }

  static withAlpha(color, alpha) {
    if (!color) return Palette.hexToRgba(FALLBACK_TOKENS.color, alpha);
    if (color.startsWith('#')) return Palette.hexToRgba(color, alpha);
    const match = /^rgba?\(([^)]+)\)/.exec(color);
    if (match) {
      const [r, g, b] = match[1].split(',').map((v) => v.trim());
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return color;
  }

  static hexToRgba(hex, alpha) {
    const value = hex.replace('#', '');
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  static shade(hex, amount) {
    const value = hex.replace('#', '');
    const r = Math.max(0, Math.min(255, parseInt(value.slice(0, 2), 16) * (1 + amount)));
    const g = Math.max(0, Math.min(255, parseInt(value.slice(2, 4), 16) * (1 + amount)));
    const b = Math.max(0, Math.min(255, parseInt(value.slice(4, 6), 16) * (1 + amount)));
    return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
  }

  // CIE L*a*b*（D65）。用于验收两两色差，不参与绘制。
  static lab(color) {
    return colorToLab(color);
  }

  static labDistance(a, b) {
    const left = Palette.lab(a);
    const right = Palette.lab(b);
    if (!left || !right) return 0;
    return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
  }

  static relativeLuminance(color) {
    const rgb = parseColor(color);
    if (!rgb) return 0;
    const [r, g, b] = rgb.map(channelLuminance);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  static contrastRatio(a, b) {
    const left = Palette.relativeLuminance(a);
    const right = Palette.relativeLuminance(b);
    const lighter = Math.max(left, right);
    const darker = Math.min(left, right);
    return (lighter + 0.05) / (darker + 0.05);
  }
}

export function biomePalette(map, settings) {
  const base = Palette.resolve(map);
  return settings?.highContrast ? Palette.highContrast(base) : base;
}
