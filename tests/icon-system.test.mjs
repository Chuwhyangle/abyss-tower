// 统一程序化图标系统（源码级）：单一图标表、Canvas/DOM 共用路径、UI 无遗留字符图标、
// 尺寸与描边只消费 styles.css 令牌；不引入第三方图标库或素材文件。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ICON_PATHS,
  ICON_NAMES,
  ICON_VIEWBOX,
  ICON_STROKE_WIDTH,
  iconSvg,
  hasIcon,
  relicIconName,
  CanvasShapes,
} from '../public/js/render/canvas-shapes.js';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const INDEX_HTML = read('public/index.html');
const STYLES = read('public/styles.css');
const UI_SOURCE_PATHS = [
  'public/index.html',
  'public/js/ui.js',
  'public/js/achievements-ui.js',
  'public/js/stats-ui.js',
  'public/js/leaderboard-ui.js',
  'public/js/season-ui.js',
  'public/js/daily-history-ui.js',
];
const UI_SOURCES = UI_SOURCE_PATHS.map((path) => ({ path, source: read(path) }));

// 这套图标系统要替换掉的字符/emoji 清单（条目按原 UI 实际出现过的字符维护）。
const LEGACY_GLYPHS = [
  '🔊',
  '🔇',
  '🔒',
  '✦',
  '✕',
  '★',
  '◈',
  '◇',
  '◆',
  '⚠',
  '✎',
  '⚙',
  '❚',
  '⛶',
  '▭',
  '➤',
  '◉',
  '❄',
  '⚡',
  '☣',
  '⚑',
  '◎',
  '⌖',
];

test('图标表覆盖塔 / 敌人 / 遗物稀有度 / 技能 / 设置五类语义', () => {
  for (const name of [
    'tower',
    'enemy',
    'skill',
    'settings',
    'relic-common',
    'relic-rare',
    'relic-epic',
  ]) {
    assert.ok(hasIcon(name), `图标表缺少基础图标：${name}`);
    assert.ok(ICON_NAMES.includes(name), `图标名未进入 ICON_NAMES：${name}`);
  }
  // 塔/敌人/技能/设置 + 三档稀有度已经 7 个，UI 还要求音效、锁定、关闭等常用图标。
  assert.ok(ICON_NAMES.length >= 18, `图标表只有 ${ICON_NAMES.length} 个图标，覆盖不足`);
  for (const name of ['sound', 'muted', 'lock', 'close', 'pause', 'fullscreen', 'cores', 'gold', 'victory', 'warning']) {
    assert.ok(hasIcon(name), `UI 缺少图标：${name}`);
  }
});

test('每个图标都是 24×24 坐标系内的程序化描边路径', () => {
  assert.equal(ICON_VIEWBOX, 24);
  assert.ok(ICON_STROKE_WIDTH >= 1.5, '描边过细，小尺寸下会看不清');
  const ALLOWED_COMMANDS = /^[MmLlHhVvAaCcSsQqTtZz0-9.,\-\s]+$/;
  for (const [name, d] of Object.entries(ICON_PATHS)) {
    assert.equal(typeof d, 'string', `${name} 的路径不是字符串`);
    assert.match(d, /^M/, `${name} 的路径必须以 M 开始`);
    assert.ok(d.length > 8, `${name} 的路径过短，无法构成图标`);
    assert.ok(ALLOWED_COMMANDS.test(d), `${name} 的路径包含非路径字符`);
    assert.doesNotMatch(d, /[<>&]/, `${name} 的路径不得包含标记字符`);
  }
});

test('iconSvg 从同一张图标表生成内联 SVG，未知图标返回空串', () => {
  const svg = iconSvg('tower');
  assert.match(svg, /^<svg class="icon"/);
  assert.match(svg, /viewBox="0 0 24 24"/);
  assert.match(svg, /aria-hidden="true"/);
  assert.ok(svg.includes(`d="${ICON_PATHS.tower}"`), 'SVG 路径没有复用图标表');
  assert.match(iconSvg('tower', 'icon-inline'), /class="icon icon-inline"/);
  assert.equal(iconSvg('does-not-exist'), '', '未知图标应返回空串');
  assert.doesNotMatch(svg, /<image|href=|url\(/, '图标不得引用外部素材');
});

test('遗物稀有度映射到图标名，未知稀有度回退普通', () => {
  assert.equal(relicIconName('common'), 'relic-common');
  assert.equal(relicIconName('rare'), 'relic-rare');
  assert.equal(relicIconName('epic'), 'relic-epic');
  assert.equal(relicIconName('legendary'), 'relic-common');
});

test('CanvasShapes.drawIcon 用同一份路径在 canvas 上描边绘制', () => {
  const calls = [];
  const previousPath2D = globalThis.Path2D;
  globalThis.Path2D = class {
    constructor(d) {
      this.d = d;
      calls.push(['path', d]);
    }
  };
  const g = {
    save: () => calls.push(['save']),
    restore: () => calls.push(['restore']),
    translate: (x, y) => calls.push(['translate', x, y]),
    scale: (x, y) => calls.push(['scale', x, y]),
    stroke: (path) => calls.push(['stroke', path]),
    strokeStyle: '',
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
  };
  try {
    assert.equal(CanvasShapes.drawIcon(g, 'enemy', 10, 20, 24), true);
    assert.equal(CanvasShapes.drawIcon(g, 'missing', 0, 0, 24), false, '未知图标不应绘制');
    assert.equal(CanvasShapes.drawIcon(g, 'tower', 0, 0, 0), false, '零尺寸不应绘制');
  } finally {
    if (previousPath2D === undefined) delete globalThis.Path2D;
    else globalThis.Path2D = previousPath2D;
  }

  const path = calls.find(([kind]) => kind === 'path');
  assert.ok(path && path[1] === ICON_PATHS.enemy, 'Canvas 绘制没有复用图标表路径');
  const stroke = calls.find(([kind]) => kind === 'stroke');
  assert.ok(stroke && stroke[1].d === ICON_PATHS.enemy, 'stroke 未接收 Path2D');
  assert.ok(calls.some(([kind, x, y]) => kind === 'translate' && x === 10 && y === 20));
  assert.ok(calls.some(([kind]) => kind === 'save'));
  assert.ok(calls.some(([kind]) => kind === 'restore'));
});

test('UI 源码不再出现字符 / emoji 图标', () => {
  for (const { path, source } of UI_SOURCES) {
    for (const glyph of LEGACY_GLYPHS) {
      assert.ok(!source.includes(glyph), `${path} 仍包含字符图标 ${glyph}`);
    }
  }
  // 塔不再消费数据表里的字符 glyph，改由程序化 tower 图标绘制。
  assert.doesNotMatch(read('public/js/ui.js'), /def\.glyph/, '塔卡仍在使用数据表字符 glyph');
});

test('静态页面图标全部走 data-icon 占位并命中图标表', () => {
  const names = [...INDEX_HTML.matchAll(/data-icon="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(names.length >= 10, `index.html 只有 ${names.length} 个图标占位`);
  for (const name of names) {
    assert.ok(hasIcon(name), `index.html 的 data-icon="${name}" 不在图标表中`);
  }
  for (const required of ['settings', 'sound', 'close', 'pause', 'fullscreen', 'skill', 'cores']) {
    assert.ok(names.includes(required), `index.html 缺少 ${required} 图标占位`);
  }
});

test('styles.css 集中定义图标尺寸 / 描边令牌并被组件消费', () => {
  for (const token of [
    '--icon-size-xs',
    '--icon-size-sm',
    '--icon-size-md',
    '--icon-size-lg',
    '--icon-size-xl',
    '--icon-stroke',
    '--icon-gap',
  ]) {
    assert.match(STYLES, new RegExp(`${token}\\s*:`), `styles.css 缺少图标令牌 ${token}`);
  }
  assert.match(STYLES, /\.icon\s*\{[^}]*width:\s*var\(--icon-size\)/s);
  assert.match(STYLES, /\.icon\s*\{[^}]*height:\s*var\(--icon-size\)/s);
  assert.match(STYLES, /\.icon\s*\{[^}]*stroke-width:\s*var\(--icon-stroke\)/s);
  // 小尺寸清晰度依赖非缩放描边。
  assert.match(STYLES, /\.icon path\s*\{[^}]*vector-effect:\s*non-scaling-stroke/s);

  for (const selector of [
    '.icon-btn .icon',
    '.tower-card .glyph .icon',
    '.skill-card .skill-glyph .icon',
    '.panel-empty-glyph .icon',
  ]) {
    assert.ok(STYLES.includes(selector), `styles.css 未为 ${selector} 指定图标尺寸`);
  }
  assert.match(STYLES, /\.icon-btn \.icon\s*\{[^}]*--icon-size:\s*var\(--icon-size-sm\)/s);
});

test('不引入第三方图标库、图片或网络素材', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.deepEqual(pkg.dependencies || {}, {}, 'package.json 不应新增依赖');
  const source = read('public/js/render/canvas-shapes.js');
  assert.doesNotMatch(source, /\.(?:svg|png|webp|jpe?g|gif|woff2?|ttf)\b/i, '图标实现不应读取素材文件');
  assert.doesNotMatch(source, /https?:\/\//, '图标实现不应引用网络素材');
});
