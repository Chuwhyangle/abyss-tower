// 视觉规范（源码级约束）：
// 1) 设计令牌集中定义；2) 关键容器引用令牌、不硬编码主色；
// 3) 按钮四态齐备（hover/active/disabled/focus-visible）；4) 支持 reduced-motion。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const CSS = read('public/styles.css');
const HTML = read('public/index.html');

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 取行首选择器的规则体（支持选择器里的伪类与点号）。返回大括号内的文本。
function ruleBody(source, selector) {
  const pattern = new RegExp(`(?:^|\\n)\\s*${escapeRegExp(selector)}\\s*\\{`, 'm');
  const match = pattern.exec(source);
  assert.ok(match, `缺少选择器 ${selector}`);
  const start = match.index + match[0].length;
  let depth = 1;
  let index = start;
  while (index < source.length && depth > 0) {
    const char = source[index];
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    index += 1;
  }
  assert.equal(depth, 0, `选择器 ${selector} 的大括号未闭合`);
  return source.slice(start, index - 1);
}

test('设计令牌在 :root 中集中定义', () => {
  const root = ruleBody(CSS, ':root');
  const tokens = [
    // 颜色
    '--bg',
    '--surface-1',
    '--surface-2',
    '--surface-deep',
    '--surface-raised',
    '--line',
    '--line-soft',
    '--text',
    '--muted',
    '--gold',
    '--green',
    '--red',
    '--focus-ring',
    // 间距阶梯
    '--space-1',
    '--space-2',
    '--space-3',
    '--space-4',
    '--space-5',
    '--space-6',
    // 圆角
    '--radius-sm',
    '--radius-md',
    '--radius-lg',
    '--radius-pill',
    // 阴影
    '--shadow-sm',
    '--shadow-md',
    '--shadow-lg',
    // 字号阶梯
    '--text-xs',
    '--text-sm',
    '--text-md',
    '--text-lg',
    '--text-xl',
    // 动效
    '--duration-fast',
    '--duration-base',
    '--duration-slow',
    '--ease-standard',
  ];

  for (const token of tokens) {
    assert.match(
      root,
      new RegExp(`${escapeRegExp(token)}\\s*:`),
      `设计令牌 ${token} 未在 :root 中定义`
    );
  }
});

test('关键容器引用设计令牌且不硬编码主色', () => {
  const containers = ['.title-card', '.hud', '.shop', '.modal', '.result-grid', '.result.victory h2'];

  for (const selector of containers) {
    const body = ruleBody(CSS, selector);
    assert.match(body, /var\(--/, `${selector} 未引用设计令牌`);
    assert.doesNotMatch(body, /#[0-9a-fA-F]{3,8}\b/, `${selector} 仍硬编码十六进制颜色`);
    assert.doesNotMatch(body, /\brgba?\(/, `${selector} 仍硬编码 rgb/rgba 颜色`);
  }

  // 间距/圆角也必须走阶梯令牌。
  for (const selector of ['.title-card', '.hud', '.shop', '.modal']) {
    assert.match(ruleBody(CSS, selector), /var\(--space-/, `${selector} 未使用间距令牌`);
  }
  assert.match(ruleBody(CSS, '.title-card'), /var\(--radius-/, '.title-card 未使用圆角令牌');
  assert.match(ruleBody(CSS, '.modal'), /var\(--radius-/, '.modal 未使用圆角令牌');
});

test('按钮具备 hover / active / disabled / focus-visible 四态', () => {
  const buttons = [
    '.btn',
    '.icon-btn',
    '.speed-btn',
    '.tower-card',
    '.tab',
    '.relic-card',
    '.diff-card',
    '.map-card',
  ];

  assert.match(CSS, /\.btn:hover:not\(:disabled\)/);
  assert.match(CSS, /\.btn:active:not\(:disabled\)/);

  for (const selector of buttons) {
    assert.match(
      CSS,
      new RegExp(`${escapeRegExp(selector)}:focus-visible`),
      `${selector} 缺少 focus-visible 态`
    );
    assert.match(
      CSS,
      new RegExp(`${escapeRegExp(selector)}:disabled`),
      `${selector} 缺少 disabled 态`
    );
  }

  const focusBlock = /\.btn:focus-visible,[\s\S]*?\{([\s\S]*?)\}/.exec(CSS);
  assert.ok(focusBlock, '缺少统一的 focus-visible 规则');
  assert.match(focusBlock[1], /outline:\s*2px solid var\(--focus-ring\)/);
  assert.match(focusBlock[1], /outline-offset:\s*2px/);

  const disabledBlock = /\.btn:disabled,[\s\S]*?\{([\s\S]*?)\}/.exec(CSS);
  assert.ok(disabledBlock, '缺少统一的 disabled 规则');
  assert.match(disabledBlock[1], /opacity:\s*var\(--disabled-opacity\)/);
  assert.match(disabledBlock[1], /cursor:\s*not-allowed/);
});

test('系统开启减少动效时关闭动画与过渡', () => {
  const match = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*)\}\s*$/.exec(CSS);
  assert.ok(match, '缺少 prefers-reduced-motion 媒体查询');
  const block = match[1];
  assert.match(block, /animation-duration:\s*0\.01ms\s*!important/);
  assert.match(block, /transition-duration:\s*0\.01ms\s*!important/);
  assert.match(block, /scroll-behavior:\s*auto\s*!important/);
});

test('页面使用语义标签并补齐 aria 标注', () => {
  assert.match(HTML, /<main id="app">/, '根容器应为 main');
  assert.doesNotMatch(HTML, /<div id="app">/);

  const landmarks = [
    /<section id="title-screen"[^>]*aria-label=/,
    /<section id="game-screen"[^>]*aria-label=/,
    /<header class="hud"[^>]*aria-label=/,
    /<footer class="shop"[^>]*aria-label=/,
    /<aside class="relic-panel"[^>]*aria-label=/,
  ];
  for (const landmark of landmarks) {
    assert.match(HTML, landmark, `缺少地标 aria 标注：${landmark}`);
  }

  assert.match(
    HTML,
    /id="toast"[^>]*role="status"[^>]*aria-live="polite"/,
    'toast 应作为状态区播报'
  );
});

test('所有按钮显式声明 type，避免表单默认提交', () => {
  const buttons = HTML.match(/<button\b[^>]*>/g) || [];
  assert.ok(buttons.length > 0, '页面应包含按钮');
  for (const tag of buttons) {
    assert.match(tag, /type="button"/, `按钮缺少 type="button"：${tag}`);
  }
});

test('交互依赖的 DOM id 与结构保持不变', () => {
  const requiredIds = [
    'app',
    'title-screen',
    'btn-play',
    'btn-daily',
    'btn-resume',
    'btn-shop',
    'btn-board',
    'btn-help',
    'game-screen',
    'hud-wave',
    'hud-gold',
    'hud-hp',
    'btn-next-wave',
    'btn-settings-game',
    'btn-quit',
    'game-canvas',
    'relic-list',
    'tower-panel',
    'toast',
    'shop-list',
    'modal-root',
    'auth-root',
  ];
  for (const id of requiredIds) {
    assert.match(HTML, new RegExp(`id="${id}"`), `缺少 DOM id：${id}`);
  }

  const ids = [...HTML.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(duplicates, [], `DOM id 重复：${duplicates.join(', ')}`);

  // 关键类名继续存在，浏览器验收测试依赖它们。
  for (const className of ['title-screen', 'hud', 'shop', 'relic-panel']) {
    assert.match(HTML, new RegExp(`class="[^"]*\\b${className}\\b`), `缺少类名：${className}`);
  }
  // 塔卡由商店动态渲染，只能校验样式规则仍在。
  assert.match(CSS, /\.tower-card\b/, '缺少塔卡样式规则 .tower-card');
});
