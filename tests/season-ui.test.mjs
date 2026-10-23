// 赛季面板（源码级 + 纯函数）：倒计时格式化、名次文案、无结算占位、入口与接口接线。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { t } from '../public/js/i18n.js';
import {
  formatRemaining,
  previousSeason,
  rankText,
  renderSeasonPanel,
  seasonEndMs,
} from '../public/js/season-ui.js';
import zhCN from '../public/js/shared/i18n/zh-CN.js';
import enUS from '../public/js/shared/i18n/en-US.js';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const SEASON_UI = read('public/js/season-ui.js');
const INDEX_HTML = read('public/index.html');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

test('上赛季键：跨年回退到上一年 12 月，非法输入返回 null', () => {
  assert.equal(previousSeason('2026-10'), '2026-09');
  assert.equal(previousSeason('2026-01'), '2025-12');
  for (const bogus of [null, '', '2026-13', '2026-1', '2026-00', 'abc']) {
    assert.equal(previousSeason(bogus), null, `非法赛季 ${bogus} 应返回 null`);
  }
});

test('赛季结束时刻是下个自然月 1 日零点', () => {
  const end = new Date(seasonEndMs('2026-02'));
  assert.equal(end.getFullYear(), 2026);
  assert.equal(end.getMonth(), 2, '2 月赛季应在 3 月 1 日结束');
  assert.equal(end.getDate(), 1);
  assert.equal(end.getHours(), 0);
  assert.ok(Number.isNaN(seasonEndMs('2026-13')));
  assert.ok(Number.isNaN(seasonEndMs(null)));
});

test('倒计时按天/小时/分钟分档，负数收敛为 0', () => {
  assert.equal(
    formatRemaining(2 * DAY + 3 * HOUR + 5 * MINUTE),
    t('season.remaining.days', { days: 2, hours: 3, minutes: 5 })
  );
  assert.equal(
    formatRemaining(3 * HOUR + 5 * MINUTE),
    t('season.remaining.hours', { hours: 3, minutes: 5 })
  );
  assert.equal(formatRemaining(5 * MINUTE), t('season.remaining.minutes', { minutes: 5 }));
  assert.equal(formatRemaining(-1000), t('season.remaining.minutes', { minutes: 0 }));
  assert.equal(formatRemaining(Number.NaN), t('season.remaining.minutes', { minutes: 0 }));
  assert.match(formatRemaining(2 * DAY + 3 * HOUR + 5 * MINUTE), /2.*3.*5/);
});

test('名次文案：有效名次显示第 N 名，缺失显示未上榜', () => {
  assert.equal(rankText(1), t('season.rankValue', { rank: 1 }));
  assert.equal(rankText('12'), t('season.rankValue', { rank: 12 }));
  for (const empty of [null, undefined, 0, -3, 'abc']) {
    assert.equal(rankText(empty), t('season.unranked'), `名次 ${empty} 应显示未上榜`);
  }
});

test('无结算数据时展示明确占位且不报错', () => {
  const html = renderSeasonPanel({
    season: '2026-10',
    result: null,
    me: { rank: null, best: null, latest: null },
    remainingMs: 3 * DAY,
  });
  assert.ok(html.includes(t('season.noResult')), '缺少无结算占位');
  assert.ok(html.includes(t('season.noResultHint')), '缺少无结算说明');
  assert.ok(html.includes(t('season.progressEmpty')), '缺少本赛季未上榜提示');
  assert.ok(html.includes(t('season.unranked')), '当前赛季应显示未上榜');
  assert.ok(!/undefined|NaN/.test(html), '占位文案不应泄漏 undefined/NaN');
  assert.equal(typeof html, 'string');
});

test('有结算数据时展示上赛季名次、星核与结算时间', () => {
  const settledAt = new Date(2026, 9, 1, 8, 30).getTime();
  const html = renderSeasonPanel({
    season: '2026-10',
    result: { season: '2026-09', rank: 3, cores: 120, settledAt },
    me: { rank: 7, best: { score: 4321 } },
    remainingMs: 5 * HOUR,
  });
  assert.ok(html.includes(t('season.lastResult')), '缺少上赛季结算标题');
  assert.ok(html.includes(t('season.rankValue', { rank: 3 })), '缺少上赛季名次');
  assert.ok(html.includes('120'), '缺少发放星核');
  assert.ok(html.includes('2026-10-01'), '缺少结算时间');
  assert.ok(html.includes(t('season.rankValue', { rank: 7 })), '缺少当前赛季名次');
  assert.ok(html.includes('4,321'), '缺少当前赛季最佳分数');
  assert.ok(!html.includes(t('season.noResult')), '有结算时不应出现空占位');
});

test('大厅入口、容器与脚本已接线，且只消费两条赛季接口', () => {
  assert.match(INDEX_HTML, /id="btn-season"/, '缺少赛季入口按钮');
  assert.match(INDEX_HTML, /data-i18n="title\.season"/, '入口按钮未走 i18n');
  assert.match(INDEX_HTML, /id="season-panel"/, '缺少赛季面板容器');
  assert.match(INDEX_HTML, /src="\/js\/season-ui\.js"/, 'index.html 未引入赛季脚本');

  assert.match(SEASON_UI, /\/api\/leaderboard\?mode=normal&size=1/, '未读取当前赛季榜');
  assert.match(
    SEASON_UI,
    /\/api\/leaderboard\/seasons\/\$\{encodeURIComponent\(previous\)\}\/result/,
    '未读取上赛季结算结果'
  );
  assert.match(SEASON_UI, /from '\.\/i18n\.js'/, '文案未走 i18n');
  assert.match(SEASON_UI, /season\.noResult/, '缺少无结算占位文案键');
});

test('小屏不横向溢出：网格自适应、可换行且允许长文案折行', () => {
  assert.match(SEASON_UI, /flex-wrap:\s*wrap/, '头部缺少换行');
  assert.match(SEASON_UI, /grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(120px,\s*1fr\)\)/, '网格未自适应');
  assert.match(SEASON_UI, /min-width:\s*0/, '网格单元缺少 min-width:0');
  assert.match(SEASON_UI, /overflow-wrap:\s*anywhere/, '长文案未折行');
  assert.match(SEASON_UI, /max-width:\s*100%/, '面板未限制最大宽度');
});

test('不引入第三方依赖：季节脚本只导入相对模块', () => {
  const imports = [...SEASON_UI.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
  assert.ok(imports.length > 0, '缺少模块导入');
  for (const specifier of imports) {
    assert.match(specifier, /^\.\//, `不允许第三方或绝对导入：${specifier}`);
  }
});

test('赛季文案中英双语齐备', () => {
  const keys = Object.keys(zhCN).filter(
    (key) => key.startsWith('season.') || key === 'title.season'
  );
  assert.ok(keys.length > 0, '缺少赛季文案键');
  for (const key of keys) {
    assert.equal(typeof enUS[key], 'string', `en-US 缺少键 ${key}`);
    assert.ok(enUS[key].trim().length > 0, `en-US 的 ${key} 不应为空`);
    assert.ok(zhCN[key].trim().length > 0, `zh-CN 的 ${key} 不应为空`);
  }
});
