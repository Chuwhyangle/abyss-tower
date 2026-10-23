// 生物群系调色板、无障碍配色与颜色工具。纯数据/纯函数，不接触 Canvas。
import { ENEMIES, RARITY, TOWERS } from '../shared/data.js';

const BIOME_PALETTES = {
  canyon: {
    grass1: '#13221a', grass2: '#101c16', grid: 'rgba(110, 190, 140, 0.05)',
    pathEdge: '#19130f', path: '#322619', pathInner: '#463425',
    pathLine: 'rgba(214, 178, 126, 0.22)', tuft: '96, 180, 128',
    rock: '#3c4a4f', rockEdge: '#66777d', accent: '#8fe0a8', ambient: 'rgba(120, 220, 160, ',
  },
  twin: {
    grass1: '#112228', grass2: '#0e1d22', grid: 'rgba(110, 200, 210, 0.05)',
    pathEdge: '#101b20', path: '#213238', pathInner: '#2e464e',
    pathLine: 'rgba(120, 210, 220, 0.2)', tuft: '80, 170, 180',
    rock: '#3a4c53', rockEdge: '#5f7c86', accent: '#5ce2d0', ambient: 'rgba(90, 210, 220, ',
  },
  triple: {
    grass1: '#241817', grass2: '#1e1413', grid: 'rgba(220, 120, 100, 0.045)',
    pathEdge: '#1d0f0c', path: '#3a211b', pathInner: '#523026',
    pathLine: 'rgba(255, 150, 110, 0.2)', tuft: '190, 100, 90',
    rock: '#4b3a38', rockEdge: '#76564f', accent: '#ff8a6b', ambient: 'rgba(255, 120, 90, ',
  },
  ring: {
    grass1: '#1a1630', grass2: '#151228', grid: 'rgba(150, 130, 220, 0.05)',
    pathEdge: '#140f22', path: '#2b2340', pathInner: '#403356',
    pathLine: 'rgba(190, 160, 255, 0.22)', tuft: '130, 110, 200',
    rock: '#413a58', rockEdge: '#6b5f8c', accent: '#b48cff', ambient: 'rgba(170, 130, 255, ',
  },
  cross: {
    grass1: '#222015', grass2: '#1c1a12', grid: 'rgba(220, 200, 120, 0.05)',
    pathEdge: '#1b160d', path: '#3a3320', pathInner: '#54492e',
    pathLine: 'rgba(255, 220, 130, 0.2)', tuft: '180, 170, 90',
    rock: '#4a4638', rockEdge: '#756c52', accent: '#ffd36b', ambient: 'rgba(255, 210, 110, ',
  },
};

// 两两颜色在 CIE Lab 下的最小距离；低于该值视为难以区分。
export const ACCESSIBILITY_MIN_DISTANCE = 15;

const BASE_RARITY_COLORS = Object.freeze(
  Object.fromEntries(Object.entries(RARITY).map(([id, def]) => [id, def.color]))
);
const BASE_TOWER_COLORS = Object.freeze(
  Object.fromEntries(Object.entries(TOWERS).map(([id, def]) => [id, def.color]))
);
const BASE_ENEMY_COLORS = Object.freeze(
  Object.fromEntries(Object.entries(ENEMIES).map(([id, def]) => [id, def.color]))
);

// 红绿色盲（deuteranopia/protanopia）保留蓝-黄轴：用明度阶梯 + 蓝/黄对立色区分。
const BLUE_YELLOW_COLORS = Object.freeze({
  rarity: Object.freeze({ common: '#455a64', rare: '#1e88e5', epic: '#ffb300' }),
  towers: Object.freeze({
    arrow: '#1a237e',
    cannon: '#4e342e',
    frost: '#1976d2',
    arc: '#827717',
    poison: '#4fc3f7',
    banner: '#ffca28',
    shock: '#f5f5f5',
    sniper: '#ef6c00',
  }),
  enemies: Object.freeze({
    grunt: '#0d47a1',
    runner: '#ffb300',
    swarm: '#64b5f6',
    tank: '#4e342e',
    flyer: '#ffe082',
    healer: '#1a237e',
    boss: '#827717',
    shielder: '#4fc3f7',
    splitter: '#ffca28',
    splitling: '#3e2723',
    herald: '#90caf9',
    caster: '#f5f5f5',
  }),
});

// 蓝黄色盲（tritanopia）保留红-绿轴：用明度阶梯 + 红/绿对立色区分。
const RED_GREEN_COLORS = Object.freeze({
  rarity: Object.freeze({ common: '#455a64', rare: '#2e7d32', epic: '#c62828' }),
  towers: Object.freeze({
    arrow: '#1b5e20',
    cannon: '#e53935',
    frost: '#66bb6a',
    arc: '#4a148c',
    poison: '#ff8a80',
    banner: '#a5d6a7',
    shock: '#f5f5f5',
    sniper: '#880e4f',
  }),
  enemies: Object.freeze({
    grunt: '#e53935',
    runner: '#1b5e20',
    swarm: '#ff8a80',
    tank: '#4a148c',
    flyer: '#66bb6a',
    healer: '#a5d6a7',
    boss: '#c62828',
    shielder: '#2e7d32',
    splitter: '#ef9a9a',
    splitling: '#7b1fa2',
    herald: '#388e3c',
    caster: '#f5f5f5',
  }),
});

export const ACCESSIBILITY_PALETTES = Object.freeze({
  none: Object.freeze({
    rarity: BASE_RARITY_COLORS,
    towers: BASE_TOWER_COLORS,
    enemies: BASE_ENEMY_COLORS,
  }),
  deuteranopia: BLUE_YELLOW_COLORS,
  protanopia: BLUE_YELLOW_COLORS,
  tritanopia: RED_GREEN_COLORS,
});

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
    if (!color) return `rgba(255, 255, 255, ${alpha})`;
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
