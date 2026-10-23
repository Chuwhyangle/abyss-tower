// 结算页演出（源码级约束）：
// 1) 胜利/失败分区、分数、星核、解锁与分享入口齐备；
// 2) 无解锁时不渲染空区块；
// 3) 动效尊重 prefers-reduced-motion；
// 4) 分享入口复用 share-ui 的既有生成按钮，不复制请求逻辑。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const UI = read('public/js/ui.js');
const CSS = read('public/styles.css');
const ZH = read('public/js/shared/i18n/zh-CN.js');
const EN = read('public/js/shared/i18n/en-US.js');

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

test('结算页包含层次化区块：结局、分数、星核、战绩、解锁、操作', () => {
  for (const marker of [
    'result-hero',
    'result-score',
    'result-cores',
    'result-grid',
    'result-unlocks',
    'data-score-target',
  ]) {
    assert.match(UI, new RegExp(marker), `结算页缺少 ${marker} 区块`);
  }
  assert.match(UI, /data-result="\$\{victory \? 'victory' : 'defeat'\}"/, '结算页需区分胜败');
  assert.match(UI, /id="btn-again"/, '缺少「再来一局」主按钮');
  assert.match(UI, /id="btn-home"/, '缺少返回大厅按钮');
});

test('胜利与失败有明确视觉区分', () => {
  for (const selector of ['.result.victory', '.result.defeat']) {
    assert.match(CSS, new RegExp(escapeRegExp(selector)), `缺少 ${selector} 样式`);
  }
  assert.match(ruleBody(CSS, '.result.defeat'), /--result-accent:\s*var\(--red\)/);
  assert.match(ruleBody(CSS, '.result.victory'), /--result-accent:\s*var\(--gold\)/);
  assert.match(CSS, /\.result\.defeat h2\s*\{[\s\S]*?color:/, '失败标题需与胜利区分');
});

test('没有解锁时不渲染空区块', () => {
  assert.match(
    UI,
    /const unlockBlock = unlockItems\.length\s*\?/,
    '解锁区块必须按 unlockItems.length 条件渲染'
  );
  assert.match(UI, /unlockedAchievements/, '应读取结算返回的成就解锁');
  assert.match(UI, /unlockedSkills/, '应读取结算返回的技能解锁');
});

test('分数滚动动画尊重 prefers-reduced-motion', () => {
  assert.match(UI, /_animateResultScore/, '缺少分数滚动实现');
  assert.match(UI, /prefers-reduced-motion:\s*reduce/, '动画需检测减少动效偏好');
  const media = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*)\}\s*$/.exec(CSS);
  assert.ok(media, '缺少 prefers-reduced-motion 媒体查询');
  for (const selector of ['.result-hero', '.result-score', '.result-cores', '.result-record']) {
    assert.match(media[1], new RegExp(escapeRegExp(selector)), `减少动效时未关闭 ${selector}`);
  }
  assert.match(media[1], /\.result-record\s*\{[\s\S]*?animation:\s*none\s*!important/);
});

test('分享入口复用小节 share-ui 的既有生成按钮', () => {
  assert.match(UI, /data-result-share/, '结算页缺少分享入口');
  assert.match(UI, /\[data-share-generate\]/, '分享入口应查找既有生成按钮');
  assert.match(
    UI,
    /querySelector\('\[data-share-generate\]'\)[\s\S]{0,200}?\.click\(\)/,
    '分享入口应触发既有生成 handler'
  );
});

test('新增文案在中英字典中都存在，且不引入第三方依赖', () => {
  for (const key of [
    'result.bestWave',
    'result.unlocks',
    'result.achievementUnlocked',
    'result.skillUnlocked',
    'result.share',
    'result.shareUnavailable',
  ]) {
    assert.match(ZH, new RegExp(`'${key.replaceAll('.', '\\.')}'`), `中文缺少 ${key}`);
    assert.match(EN, new RegExp(`'${key.replaceAll('.', '\\.')}'`), `英文缺少 ${key}`);
  }
  assert.doesNotMatch(UI, /from\s+['"](?!\.)/, 'ui.js 不得引入第三方/裸模块');
});
