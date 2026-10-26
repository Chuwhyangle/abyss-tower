// UI kit · DOM 基础：全站唯一的 HTML 转义与图标注入实现，供各面板与 shared.js 复用。
// 兼容旧导出：ui/shared.js 从这里转出 escapeHtml / hydrateIcons，调用方无需改动。
import { iconSvg } from '../../render/canvas-shapes.js';

// 转义规则与所有面板迁移前保持一致：null/undefined 视为空串，避免把字面量 "null" 渲染进页面。
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 模板字面量：插值一律转义，静态片段原样输出；调用方仍可显式嵌套已渲染的 HTML。
export function html(strings, ...values) {
  return strings.reduce(
    (output, chunk, index) => output + chunk + (index < values.length ? escapeHtml(values[index]) : ''),
    ''
  );
}

// 静态页面用 data-icon 占位，初始化时统一注入程序化图标，避免在 HTML 里散落字符图标。
export function hydrateIcons(root = globalThis.document) {
  root.querySelectorAll('[data-icon]').forEach((node) => {
    const markup = iconSvg(node.dataset.icon);
    if (markup) node.innerHTML = markup;
  });
}
