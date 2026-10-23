// 生物群系调色板与颜色工具。纯数据/纯函数，不接触 Canvas。

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

export class Palette {
  // 地图原型 → 调色板对象。未知原型回退 canyon。
  static resolve(map) {
    return BIOME_PALETTES[map.archetype] || BIOME_PALETTES.canyon;
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
}

export function biomePalette(map) {
  return Palette.resolve(map);
}
