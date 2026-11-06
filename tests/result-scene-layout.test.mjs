// 结算场景修复的源码级约束（gap-result-scene-polish）：
// 1) 结算面板精灵宿主不再是空占位框（承载结局眉题 + 标题）；
// 2) 难度标签归属结算分数区；
// 3) 星核徽章使用金色奖励语义（--gold）；
// 4) 短视口媒体查询（max-height: 520px）压缩结算并把操作区提前到战绩表前。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCss } from './lib/css-source.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const RESULT_JS = read('public/js/ui/result.js');
const CSS = readCss();

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function ruleBody(source, selector) {
  const pattern = new RegExp(`(?:^|\\n)\\s*${escapeRegExp(selector)}\\s*\\{`, 'm');
  const match = pattern.exec(source);
  assert.ok(match, `缺少选择器 ${selector}`);
  let depth = 1;
  let index = match.index + match[0].length;
  while (index < source.length && depth > 0) {
    const char = source[index];
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    index += 1;
  }
  assert.equal(depth, 0, `选择器 ${selector} 的大括号未闭合`);
  return source.slice(match.index + match[0].length, index - 1);
}

function mediaBody(source, condition) {
  const pattern = new RegExp(`@media\\s*\\(${escapeRegExp(condition)}\\)\\s*\\{`, 'm');
  const match = pattern.exec(source);
  assert.ok(match, `缺少 @media (${condition}) 查询`);
  let depth = 1;
  let index = match.index + match[0].length;
  while (index < source.length && depth > 0) {
    const char = source[index];
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    index += 1;
  }
  assert.equal(depth, 0, `@media (${condition}) 的大括号未闭合`);
  return source.slice(match.index + match[0].length, index - 1);
}

test('结算面板精灵宿主承载结局标题，不再是空占位框', () => {
  assert.match(
    RESULT_JS,
    /class="result-panel"[^>]*data-sprite-id="\$\{SCENE_SPRITE_IDS\.resultPanel\}"[^>]*data-result-panel/,
    '结算面板需声明 resultPanel 精灵宿主'
  );
  assert.match(
    RESULT_JS,
    /<div class="result-panel"[^>]*>\s*<header class="result-hero">/,
    '精灵宿主内应直接承载 result-hero 标题块'
  );
  assert.doesNotMatch(RESULT_JS, /data-result-panel[^>]*>\s*<\/div>/, '精灵宿主不得为空占位框');
});

test('难度标签归属结算分数区并含难度名', () => {
  assert.match(RESULT_JS, /<p class="diff-tag"[^>]*>\$\{diffTag\}<\/p>/, '难度标签应渲染');
  assert.match(
    RESULT_JS,
    /class="result-score"[\s\S]{0,400}?class="diff-tag"/,
    '难度标签应位于结算分数区内，而非游离'
  );
});

test('星核徽章使用金色奖励语义（--gold）', () => {
  const cores = ruleBody(CSS, '.result-cores');
  assert.match(cores, /border: 1px solid color-mix\(in srgb, var\(--gold\)/, '星核徽章边框用金色');
  assert.match(cores, /background: color-mix\(in srgb, var\(--gold\)/, '星核徽章背景用金色');
  assert.match(ruleBody(CSS, '.result-cores-icon .icon'), /color: var\(--gold\)/, '星核图标用金色');
  assert.match(ruleBody(CSS, '.result-cores b'), /color: var\(--gold\)/, '星核数值用金色');
});

test('短视口媒体查询压缩结算并把操作区提前到战绩表前', () => {
  const media = mediaBody(CSS, 'max-height: 520px');
  assert.match(media, /\.result \.modal-actions\s*\{[\s\S]*?order:\s*4\b/, '短视口操作区应 order:4');
  assert.match(media, /\.result-grid\s*\{[\s\S]*?order:\s*5\b/, '短视口战绩表应 order:5');
  assert.match(media, /\.share-result-panel[\s\S]*?order:\s*6\b/, '短视口分享面板应让位于操作区与战绩表');
  assert.match(media, /\.replay-panel[\s\S]*?order:\s*6\b/, '短视口回放面板应让位于操作区与战绩表');
  assert.match(media, /\.score-big\s*\{[\s\S]*?font-size:\s*30px\b/, '短视口应压缩大分数字号');
  assert.match(media, /\.result-grid\s*\{[\s\S]*?margin:\s*0\b/, '短视口战绩表应去掉上下外边距');
});

test('结算面板固定 240×120，与精灵裁切尺寸一致', () => {
  const panel = ruleBody(CSS, '.result-panel');
  assert.match(panel, /width:\s*240px/, '面板宽度固定 240px');
  assert.match(panel, /min-height:\s*120px/, '面板最小高度固定 120px');
});
