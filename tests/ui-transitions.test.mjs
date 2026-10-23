// 界面转场与首领横幅（源码级约束）：
// 1) 三个转场类与关键帧齐备、时长 ≤400ms；
// 2) reduced-motion 下转场直接显示；
// 3) 首领横幅 1.5s 自动收起、每波一次，且不拦截输入。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const CSS = read('public/styles.css');
const UI_SRC = read('public/js/ui.js');

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

function reducedMotionBlock() {
  const start = CSS.indexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(start >= 0, '缺少 prefers-reduced-motion 媒体查询');
  return CSS.slice(start);
}

test('转场类与关键帧齐备', () => {
  const pairs = [
    ['.view-enter', 'view-enter'],
    ['.boss-banner', 'boss-banner'],
    ['.result-fade', 'result-fade'],
  ];
  for (const [selector, keyframe] of pairs) {
    assert.match(
      ruleBody(CSS, selector),
      new RegExp(`animation:\\s*${keyframe}\\b`),
      `${selector} 未绑定动画 ${keyframe}`
    );
    assert.match(
      CSS,
      new RegExp(`@keyframes\\s+${keyframe}\\b`),
      `缺少关键帧 @keyframes ${keyframe}`
    );
  }
});

test('界面转场时长不超过 400ms', () => {
  for (const selector of ['.view-enter', '.result-fade']) {
    const duration = /animation:\s*[\w-]+\s+(\d+)ms/.exec(ruleBody(CSS, selector));
    assert.ok(duration, `${selector} 未声明毫秒时长`);
    assert.ok(
      Number(duration[1]) <= 400,
      `${selector} 转场 ${duration[1]}ms 超过 400ms 上限`
    );
  }
});

test('首领横幅停留 1.5s 且每波只播一次', () => {
  const body = ruleBody(CSS, '.boss-banner');
  assert.match(body, /animation:\s*boss-banner\s+1500ms/, '横幅应停留 1.5s');

  const method = /showBossBanner\(wave, waveDef\)\s*\{[\s\S]*?\n  \}/.exec(UI_SRC);
  assert.ok(method, '缺少 showBossBanner 实现');
  assert.match(method[0], /_bossBannerWave\s*===\s*wave/, '横幅应带每波一次的去重判断');
  assert.match(method[0], /\},\s*1500\)/, '横幅应在 1500ms 后自动收起');
  assert.match(
    UI_SRC,
    /hud\.waveDef\?\.boss\s*\|\|\s*hud\.waveDef\?\.finalBoss[\s\S]{0,160}showBossBanner\(/,
    '首领波开始时未触发横幅'
  );
});

test('首领横幅不拦截输入', () => {
  assert.match(
    ruleBody(CSS, '.boss-banner'),
    /pointer-events:\s*none/,
    '横幅必须 pointer-events: none，避免挡住操作'
  );

  const method = /showBossBanner\(wave, waveDef\)\s*\{[\s\S]*?\n  \}/.exec(UI_SRC);
  assert.ok(method, '缺少 showBossBanner 实现');
  assert.doesNotMatch(
    method[0],
    /addEventListener|onclick|ondblclick|ontouchstart|onkeydown/,
    '横幅是纯展示元素，不得绑定任何交互事件'
  );
});

test('视图切换接入转场类', () => {
  assert.match(UI_SRC, /playViewEnter\(this\.el\.title\)/, '标题页切换缺少转场');
  assert.match(UI_SRC, /playViewEnter\(this\.el\.game\)/, '战场切换缺少转场');
  assert.match(UI_SRC, /playViewEnter\(modal\)/, '选图弹窗缺少转场');
  assert.match(UI_SRC, /classList\.add\('result-fade'\)/, '结算弹窗缺少淡入');
});

test('reduced-motion 下转场直接显示', () => {
  const block = reducedMotionBlock();
  assert.match(
    block,
    /\.view-enter,\s*\n\s*\.boss-banner,\s*\n\s*\.result-fade\s*\{\s*animation:\s*none\s*!important;/,
    'reduced-motion 未关闭新增转场动画'
  );
});
