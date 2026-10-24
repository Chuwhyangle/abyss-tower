// 战绩分享卡片：布局常量、文本截断/折行、缺数据占位、绘制边界与下载接线。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  CARD_HEIGHT,
  CARD_LABELS,
  CARD_MAX_CODE_LINES,
  CARD_MAX_RELICS,
  CARD_PADDING,
  CARD_WIDTH,
  buildShareCardData,
  canvasToBlob,
  createShareCardCanvas,
  drawShareCard,
  formatCardNumber,
  normalizeShareCardRelics,
  shareCardFilename,
  truncateText,
  wrapText,
} from '../public/js/share-card.js';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const SOURCE = read('public/js/share-card.js');
const RESULT = read('public/js/ui/result.js');

// 等宽测试桩：每个字符 10px；记录 fillText 的位置与内容，用于检查文本是否出界。
function fakeContext(charWidth = 10) {
  const calls = [];
  const measureText = (text) => ({ width: String(text).length * charWidth });
  return {
    calls,
    measureText,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillRect() {},
    strokeRect() {},
    fillText(text, x, y) {
      calls.push({ text, x, y, width: measureText(text).width });
    },
  };
}

test('卡片为固定尺寸，并保留清晰留白', () => {
  assert.ok(CARD_WIDTH > 0 && CARD_HEIGHT > CARD_WIDTH, '卡片应为竖版固定尺寸');
  assert.ok(CARD_PADDING > 0 && CARD_PADDING * 2 < CARD_WIDTH, '留白不能吃掉内容区');
  assert.equal(CARD_MAX_RELICS, 5);
  assert.equal(CARD_MAX_CODE_LINES, 3);
  assert.equal(formatCardNumber(1234567), '1,234,567');
  assert.equal(formatCardNumber('2500'), '2,500');
  assert.equal(formatCardNumber(undefined), '0');
});

test('文本截断保证不超出给定宽度', () => {
  const measure = (text) => String(text).length * 10;
  assert.equal(truncateText('abc', 50, measure), 'abc');
  const fitted = truncateText('abcdefghij', 50, measure);
  assert.ok(fitted.endsWith('…'), '超出宽度必须加省略号');
  assert.ok(measure(fitted) <= 50, `截断后 ${measure(fitted)}px 仍超宽`);
  assert.equal(truncateText('', 50, measure), '');
  assert.equal(truncateText('abc', 5, measure), '', '连省略号都放不下时返回空串');
});

test('分享码按行宽折行，最多三行且末行截断', () => {
  const measure = (text) => String(text).length * 10;
  assert.deepEqual(wrapText('', 100, measure), []);
  assert.deepEqual(wrapText('abcdefghij', 100, measure), ['abcdefghij']);
  const lines = wrapText('a'.repeat(50), 100, measure, 3);
  assert.equal(lines.length, 3);
  for (const line of lines) assert.ok(measure(line) <= 100, `折行后 ${line} 超宽`);
  assert.ok(lines[2].endsWith('…'), '超出最大行数时末行需截断');
});

test('关键遗物按稀有度与等级排序，未知遗物忽略并限制数量', () => {
  const relics = normalizeShareCardRelics([
    { id: 'sharp', level: 1 },
    { id: 'warlord', level: 2 },
    { id: 'missing', level: 3 },
    { id: 'crit', level: 9 },
  ]);
  assert.deepEqual(relics.map((relic) => relic.id), ['warlord', 'crit', 'sharp']);
  assert.equal(relics[0].level, 2);
  assert.ok(relics.every((relic) => relic.name && relic.color), '遗物需带名称与颜色');

  const many = Array.from({ length: 8 }, (_, index) => ({ id: `r${index}`, level: 1 }));
  assert.equal(normalizeShareCardRelics(many).length, 0, '未知遗物不会凑数');
  assert.ok(normalizeShareCardRelics([{ id: 'sharp', level: 2 }], 0).length === 0);
});

test('卡片内容与结算数据一致', () => {
  const data = buildShareCardData({
    stats: { score: 1234567, clearedWave: 18, wave: 19 },
    res: { victory: true, difficulty: 'abyss', score: 987654 },
    mode: 'daily',
    relics: [
      { id: 'sharp', level: 2 },
      { id: 'warlord', level: 3 },
    ],
    shareCode: ' RTD1.abc.12345678 ',
  });
  assert.equal(data.victory, true);
  assert.equal(data.score, 987654, '成绩优先取结算返回的分数');
  assert.equal(data.scoreText, '987,654');
  assert.equal(data.wave, 18, '波次取已清波次');
  assert.equal(data.difficultyId, 'abyss');
  assert.equal(data.difficultyText, '深渊 / Abyss');
  assert.equal(data.modeText, '每日 / Daily');
  assert.deepEqual(data.relics.map((relic) => relic.id), ['warlord', 'sharp']);
  assert.equal(data.shareCode, 'RTD1.abc.12345678', '分享码需去掉首尾空白');
  assert.equal(data.hasShareCode, true);
});

test('缺少分享码与遗物时使用占位文案，仍可生成卡片', () => {
  const data = buildShareCardData();
  assert.equal(data.score, 0);
  assert.equal(data.wave, 0);
  assert.equal(data.difficultyId, 'standard');
  assert.equal(data.modeText, '标准 / Standard');
  assert.deepEqual(data.relicLines, [CARD_LABELS.noRelics]);
  assert.equal(data.codeText, CARD_LABELS.noCode);
  assert.equal(data.hasShareCode, false);

  const ctx = fakeContext();
  assert.doesNotThrow(() => drawShareCard(ctx, data));
  const texts = ctx.calls.map((call) => call.text);
  assert.ok(texts.includes(CARD_LABELS.noCode), '缺分享码时展示占位文案');
  assert.ok(texts.includes(CARD_LABELS.noRelics), '缺遗物时展示占位文案');
});

test('所有动态文本都落在卡片边界内', () => {
  const ctx = fakeContext();
  const data = buildShareCardData({
    stats: { score: 99999999, clearedWave: 30 },
    res: { victory: false, difficulty: 'roam' },
    mode: 'mutated',
    relics: [{ id: 'warlord', level: 3 }],
    shareCode: `RTD1.${'x'.repeat(600)}`,
  });
  drawShareCard(ctx, data);
  assert.ok(ctx.calls.length > 0, '应绘制文本');
  for (const call of ctx.calls) {
    assert.ok(call.x >= 0, `文本 ${call.text} 左侧出界`);
    assert.ok(call.x + call.width <= CARD_WIDTH, `文本 ${call.text} 右侧超出卡片`);
    assert.ok(call.y >= 0 && call.y <= CARD_HEIGHT, `文本 ${call.text} 纵向出界`);
  }
  const texts = ctx.calls.map((call) => call.text);
  assert.ok(texts.includes(data.scoreText), '卡片应包含分数');
  assert.ok(texts.includes('漫游 / Roam'), '难度应中英双语');
  assert.ok(texts.includes('变异 / Mutated'), '模式应中英双语');
  assert.ok(texts.some((text) => text.startsWith('RTD1.')), '卡片应包含分享码');
});

test('创建离屏画布与 Blob 转换对缺失能力安全返回', async () => {
  assert.equal(createShareCardCanvas({}, null), null);
  const canvas = { width: 0, height: 0, getContext: () => fakeContext() };
  const doc = { createElement: (tag) => (tag === 'canvas' ? canvas : {}) };
  assert.equal(createShareCardCanvas(buildShareCardData(), doc), canvas);
  assert.equal(canvas.width, CARD_WIDTH);
  assert.equal(canvas.height, CARD_HEIGHT);
  assert.equal(await canvasToBlob(null), null);
  assert.equal(await canvasToBlob({}), null);
  assert.equal(shareCardFilename({ wave: 12, score: 3456, shareCode: 'RTD1.abc' }), 'abyss-tower-12w-3456-RTD1abc.png');
  assert.equal(shareCardFilename({}), 'abyss-tower-0w-0.png');
});

test('下载路径：Blob → object URL → a[download]，并释放 URL', () => {
  assert.match(SOURCE, /toBlob\(/, '缺少 PNG Blob 导出');
  assert.match(SOURCE, /'image\/png'/, '固定导出 PNG');
  assert.match(SOURCE, /URL\.createObjectURL/, '缺少 object URL');
  assert.match(SOURCE, /URL\.revokeObjectURL/, '下载后需释放 object URL');
  assert.match(SOURCE, /link\.download\s*=/, '缺少下载文件名');
  assert.match(SOURCE, /createElement\('a'\)/, '通过 <a> 触发下载');
  assert.doesNotMatch(SOURCE, /from\s+['"](?!\.)/, '不得引入第三方/裸模块');
  assert.doesNotMatch(SOURCE, /from\s+['"]\.\/sim\.js/, '卡片模块不得读取战斗模拟器');
  assert.doesNotMatch(SOURCE, /__rtd/, '卡片模块不得读取全局战斗状态');
});

test('结算页接线：保存按钮、分享码读取与卡片生成', () => {
  assert.match(RESULT, /from '\.\.\/share-card\.js'/, '结算页需引入卡片模块');
  assert.match(RESULT, /data-result-card/, '结算页缺少保存卡片按钮');
  assert.match(RESULT, /saveShareCard/, '缺少卡片保存处理');
  assert.match(RESULT, /\[data-share-code\]/, '卡片应复用已生成的分享码');
  assert.match(RESULT, /downloadShareCard\(data\)/, '保存按钮应触发下载');
  assert.match(RESULT, /buildShareCardData\(\{ stats, res, mode, relics, shareCode \}\)/, '卡片数据应来自结算数据');
  assert.doesNotMatch(RESULT, /from\s+['"](?!\.)/, '不得引入第三方/裸模块');
});
