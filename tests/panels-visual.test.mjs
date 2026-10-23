// 成就 / 生涯面板视觉与信息层级（源码级）：分组、稀有度、进度、空状态结构存在，
// 样式统一在 styles.css 且只消费设计令牌；小屏布局不得横向溢出。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ACHIEVEMENT_GROUPS } from '../public/js/shared/achievements.js';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const ACHIEVEMENTS_UI = read('public/js/achievements-ui.js');
const STATS_UI = read('public/js/stats-ui.js');
const STYLES = read('public/styles.css');
const INDEX_HTML = read('public/index.html');

function panelStyles() {
  const begin = STYLES.indexOf('/* PANEL-TOKENS-BEGIN */');
  const end = STYLES.indexOf('/* PANEL-TOKENS-END */');
  assert.ok(begin >= 0 && end > begin, 'styles.css 缺少面板样式区块标记');
  return STYLES.slice(begin, end);
}

test('成就面板按通关/构筑/挑战/收集分组渲染', () => {
  assert.match(ACHIEVEMENTS_UI, /function groupSections\(/, '缺少分组渲染函数');
  assert.match(ACHIEVEMENTS_UI, /class="achievement-group"/, '缺少分组容器');
  assert.match(ACHIEVEMENTS_UI, /data-group="\$\{escapeHtml\(group\.id\)\}"/, '分组未标记 id');
  for (const group of ACHIEVEMENT_GROUPS) {
    assert.ok(group.id && group.name, `成就分组 ${group.id} 定义不完整`);
  }
  const ids = ACHIEVEMENT_GROUPS.map((group) => group.id);
  assert.deepEqual(ids, ['clear', 'build', 'challenge', 'collect'], '成就分组顺序/集合不是通关-构筑-挑战-收集');
});

test('成就卡片具备稀有度配色、进度条与隐藏遮罩', () => {
  assert.match(ACHIEVEMENTS_UI, /`rarity-\$\{rarity\}`/, '卡片未挂稀有度类名');
  assert.match(ACHIEVEMENTS_UI, /achievement-progress-track/, '缺少单条成就进度条');
  assert.match(ACHIEVEMENTS_UI, /achievement-progress-fill/, '缺少进度填充');
  assert.match(ACHIEVEMENTS_UI, /hidden-card/, '隐藏成就缺少遮罩样式钩子');
  assert.match(ACHIEVEMENTS_UI, /achievements\.hiddenHint/, '隐藏成就缺少遮罩提示');

  const css = panelStyles();
  assert.match(css, /\.achievement-card\.rarity-rare\s*\{[^}]*--rarity-color:\s*var\(--cyan\)/s, '稀有度配色未使用令牌');
  assert.match(css, /\.achievement-card\.rarity-epic\s*\{[^}]*--rarity-color:\s*var\(--purple\)/s, '史诗配色未使用令牌');
  assert.match(css, /\.achievement-card\.hidden-card\s*\{[^}]*repeating-linear-gradient/s, '隐藏遮罩缺少纹理');
});

test('成就分组带组内进度与总进度展示', () => {
  assert.match(ACHIEVEMENTS_UI, /achievement-group-meter/, '缺少分组进度条');
  assert.match(ACHIEVEMENTS_UI, /role="progressbar"/, '进度条缺少可访问性角色');
  assert.match(ACHIEVEMENTS_UI, /achievement-group-count/, '缺少分组计数');
  assert.match(ACHIEVEMENTS_UI, /achievement-complete-banner/, '缺少全解锁横幅');
});

test('空数据与未登录都有明确占位而不是空白', () => {
  assert.match(ACHIEVEMENTS_UI, /function emptyState\(/, '成就面板缺少空状态构造器');
  assert.match(ACHIEVEMENTS_UI, /achievements\.empty/, '成就空状态未使用文案');
  assert.match(ACHIEVEMENTS_UI, /achievements\.login/, '未登录状态未使用文案');
  assert.match(ACHIEVEMENTS_UI, /panel-empty-title/, '空状态缺少标题结构');

  assert.match(STATS_UI, /function emptyState\(/, '生涯面板缺少空状态构造器');
  assert.match(STATS_UI, /career\.empty/, '生涯空状态未使用文案');
  assert.match(STATS_UI, /career\.login/, '未登录状态未使用文案');
  assert.match(STATS_UI, /panel-empty-title/, '空状态缺少标题结构');
});

test('生涯面板提供关键指标卡片与通关率可视化', () => {
  assert.match(STATS_UI, /career-totals/, '缺少指标卡片容器');
  assert.match(STATS_UI, /career-cell primary/, '缺少主指标卡片');
  assert.match(STATS_UI, /career-meter/, '缺少通关率进度条');
  for (const key of ['career.runs', 'career.winRate', 'career.bestWave', 'career.bestScore']) {
    assert.ok(STATS_UI.includes(key), `关键指标缺失：${key}`);
  }
  assert.match(STATS_UI, /career-diff-meter/, '难度卡片缺少通关率可视化');
});

test('最近对局最多十局且可滚动', () => {
  assert.match(STATS_UI, /const RECENT_LIMIT = 10;/, '最近对局上限不是 10');
  assert.match(STATS_UI, /items\.slice\(0, RECENT_LIMIT\)/, '最近对局未按上限截断');
  assert.match(STATS_UI, /class="career-recent"/, '缺少最近对局列表容器');
  assert.match(panelStyles(), /\.career-recent\s*\{[^}]*overflow-y:\s*auto/s, '最近对局列表不可滚动');
  assert.match(panelStyles(), /\.achievements-list\s*\{[^}]*overflow-y:\s*auto/s, '成就列表不可滚动');
});

test('面板样式集中在 styles.css，并统一使用设计令牌', () => {
  assert.doesNotMatch(ACHIEVEMENTS_UI, /createElement\('style'\)/, '成就面板仍在内联注入样式');
  assert.doesNotMatch(STATS_UI, /createElement\('style'\)/, '生涯面板仍在内联注入样式');
  assert.match(INDEX_HTML, /id="achievements-panel" class="achievements-panel"/, 'index.html 缺少成就面板');
  assert.match(INDEX_HTML, /id="stats-panel" class="career-panel"/, 'index.html 缺少生涯面板');

  const css = panelStyles();
  for (const selector of ['.achievements-panel', '.achievement-group-grid', '.achievement-progress-track', '.career-totals', '.career-recent', '.panel-empty']) {
    assert.ok(css.includes(selector), `styles.css 缺少面板选择器：${selector}`);
  }
  assert.match(css, /var\(--space-\d\)/, '面板间距未使用 spacing 令牌');
  assert.match(css, /var\(--radius-/, '面板圆角未使用 radius 令牌');
  assert.match(css, /var\(--surface-/, '面板底色未使用 surface 令牌');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, '面板样式硬编码了十六进制颜色');
});

test('小屏布局不会横向溢出', () => {
  const css = panelStyles();
  assert.match(css, /@media \(max-width: 560px\)/, '缺少小屏断点');
  assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\)/, '小屏网格未限制最小宽度');
  assert.match(css, /overflow-wrap:\s*anywhere/, '长文本未允许换行');
  assert.match(css, /min-width:\s*0/, '网格/卡片未解除最小内容宽度');
});
