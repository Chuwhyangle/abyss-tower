// Canvas 基础图形工具：不持有状态，只操作传入的 2D 上下文。
// 文件同时保存全站唯一的一套程序化图标（24×24 描边路径），Canvas 与 DOM 共用同一份路径表，
// 不依赖任何图标字体、图片或第三方图标库。

export const ICON_VIEWBOX = 24;
// 以 CSS 像素为单位，配合 vector-effect: non-scaling-stroke，确保小尺寸下描边不虚化。
export const ICON_STROKE_WIDTH = 1.75;

// 图标表：键为语义名，值为 24×24 坐标系下的 SVG path。
// 只使用描边（fill: none），保持统一的几何语言；塔/敌人/遗物稀有度/技能/设置是五类基础图标。
export const ICON_PATHS = Object.freeze({
  // 塔
  tower: 'M5 20.5h14M8 20.5V9h8v11.5M6 9h12M8 9V5h2v2h4V5h2v4M12 13v4',
  // 敌人
  enemy:
    'M12 3.5a7 7 0 0 1 7 7v2a7 7 0 0 1-2.2 5.1V20H7.2v-2.4A7 7 0 0 1 5 12.5v-2a7 7 0 0 1 7-7z' +
    'M7.8 11.5a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0-2.4 0M13.8 11.5a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0-2.4 0M9 15.5h6',
  // 技能
  skill: 'M12 3l2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3z',
  // 设置
  settings:
    'M4 7h8M16 7h4M4 12h4M12 12h8M4 17h10M18 17h2' +
    'M10 7a2 2 0 1 1 4 0a2 2 0 1 1-4 0M6 12a2 2 0 1 1 4 0a2 2 0 1 1-4 0M14 17a2 2 0 1 1 4 0a2 2 0 1 1-4 0',
  // 遗物稀有度（普通 / 稀有 / 史诗）：层数递增，不依赖颜色也能区分
  'relic-common': 'M12 3l7 6-7 12L5 9z',
  'relic-rare': 'M12 3l7 6-7 12L5 9zM5 9h14',
  'relic-epic': 'M12 3l7 6-7 12L5 9zM12 8.5l1.3 2.7 2.7.8-2.7 1.3L12 16l-1.3-2.7L8 12l2.7-.8z',
  // UI 常用图标
  sound: 'M4 9.5h4l5-4v13l-5-4H4zM16 8.5a4.5 4.5 0 0 1 0 7M18.5 6a8 8 0 0 1 0 12',
  muted: 'M4 9.5h4l5-4v13l-5-4H4zM16 9.5l5 5M21 9.5l-5 5',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6zM12 15v2',
  close: 'M6 6l12 12M18 6L6 18',
  pause: 'M9 5v14M15 5v14',
  fullscreen: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  rename: 'M4 20l4-1L19 8l-3-3L5 16zM13.5 7.5l3 3',
  cores: 'M12 3l6.5 9-6.5 9-6.5-9zM12 7.5l2.8 4.5-2.8 4.5-2.8-4.5z',
  gold: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16M12 7.5v9M14.5 9.5c0-1-1.1-1.6-2.5-1.6s-2.5.7-2.5 1.8 1.1 1.5 2.5 1.5 2.5.5 2.5 1.6-1.1 1.8-2.5 1.8-2.5-.6-2.5-1.6',
  victory: 'M12 3.5l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6L3.4 9.8l6-.8z',
  warning: 'M12 3.5L22 20H2zM12 9v5M13 17a1 1 0 1 1-2 0a1 1 0 1 1 2 0',
  empty: 'M12 3l8 9-8 9-8-9z',
  rotate: 'M20 4v5h-5M20 9a8 8 0 1 1-2.3-5.6',
  bell: 'M12 4a5 5 0 0 0-5 5v3.5L5 16h14l-2-3.5V9a5 5 0 0 0-5-5M10 19a2 2 0 0 0 4 0M12 3v1',
});

export const ICON_NAMES = Object.freeze(Object.keys(ICON_PATHS));

export function hasIcon(name) {
  return Object.hasOwn(ICON_PATHS, name);
}

// 稀有度 → 图标名；未知稀有度回退普通，保证 UI 不会出现空图标。
export function relicIconName(rarity) {
  const name = `relic-${rarity}`;
  return hasIcon(name) ? name : 'relic-common';
}

// DOM 侧渲染：返回内联 SVG 字符串。尺寸与描边由 styles.css 的 .icon / --icon-* 令牌控制。
export function iconSvg(name, extraClass = '') {
  const path = ICON_PATHS[name];
  if (!path) return '';
  const className = extraClass ? `icon ${extraClass}` : 'icon';
  return `<svg class="${className}" viewBox="0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}" aria-hidden="true" focusable="false"><path d="${path}"/></svg>`;
}

export class CanvasShapes {
  static roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.lineTo(x + w - r, y);
    g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r);
    g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r);
    g.quadraticCurveTo(x, y, x + r, y);
    g.closePath();
  }

  // Canvas 侧渲染：与 iconSvg 共用 ICON_PATHS，描边宽度换算回 CSS 像素保持视觉一致。
  // x/y 为图标左上角；返回是否实际绘制（未知图标或非浏览器环境下为 false）。
  static drawIcon(g, name, x, y, size, { color = null, strokeWidth = ICON_STROKE_WIDTH } = {}) {
    const path = ICON_PATHS[name];
    if (!path || !g || typeof Path2D === 'undefined') return false;
    const scale = size / ICON_VIEWBOX;
    if (!(scale > 0)) return false;
    g.save();
    g.translate(x, y);
    g.scale(scale, scale);
    if (color) g.strokeStyle = color;
    g.lineWidth = strokeWidth / scale;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.stroke(new Path2D(path));
    g.restore();
    return true;
  }
}
