// 遗物图鉴：筛选 / 稀有度分组 / 收录推导 / 未知遮罩 / 中英文案 / 大厅接线。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { setLocale, t } from '../public/js/i18n.js';
import { RELICS } from '../public/js/shared/data.js';
import {
  collectDiscovered,
  effectSummary,
  effectValueText,
  filterRelics,
  groupByRarity,
  relicIdsOf,
  renderCodex,
  renderRelicCard,
} from '../public/js/relic-codex-ui.js';
import zhCN from '../public/js/shared/i18n/zh-CN.js';
import enUS from '../public/js/shared/i18n/en-US.js';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const CODEX_UI = read('public/js/relic-codex-ui.js');
const INDEX_HTML = read('public/index.html');
const ALL_IDS = RELICS.map((relic) => relic.id);

test('遗物池：40 件，稀有度分组完整且顺序固定', () => {
  assert.equal(RELICS.length, 40, '遗物应为 40 件');
  const groups = groupByRarity(RELICS);
  assert.deepEqual(
    groups.map((group) => group.rarity),
    ['common', 'rare', 'epic'],
    '稀有度分组顺序应为 common → rare → epic'
  );
  assert.deepEqual(
    groups.map((group) => group.items.length),
    [18, 14, 8],
    '普通 / 稀有 / 史诗数量应分别为 18 / 14 / 8'
  );
  assert.equal(
    groups.reduce((sum, group) => sum + group.items.length, 0),
    40,
    '分组必须覆盖全部遗物'
  );
});

test('筛选：按稀有度、套装、无套装与搜索词过滤', () => {
  const rare = filterRelics(RELICS, { rarity: 'rare' });
  assert.equal(rare.length, 14);
  assert.ok(rare.every((relic) => relic.rarity === 'rare'));

  const hunter = filterRelics(RELICS, { set: 'hunter' });
  assert.equal(hunter.length, 6);
  assert.ok(hunter.every((relic) => relic.set === 'hunter'));

  const noSet = filterRelics(RELICS, { set: 'none' });
  assert.equal(noSet.length, 23);
  assert.ok(noSet.every((relic) => !relic.set));

  const frostCommon = filterRelics(RELICS, { rarity: 'common', set: 'frost' });
  assert.equal(frostCommon.length, 2);
  assert.ok(frostCommon.every((relic) => relic.rarity === 'common' && relic.set === 'frost'));

  assert.equal(filterRelics(RELICS, { query: '不存在的遗物' }).length, 0);
  assert.deepEqual(
    filterRelics(RELICS, { query: '锐利箭簇' }).map((relic) => relic.id),
    ['sharp']
  );
});

test('40 件遗物都能按名称检索（含未收录条目）', () => {
  for (const relic of RELICS) {
    const found = filterRelics(RELICS, { query: relic.name, discovered: [] });
    assert.ok(
      found.some((item) => item.id === relic.id),
      `${relic.name}（${relic.id}）无法被检索到`
    );
  }
});

test('英文 locale 下可按英文名检索', () => {
  setLocale('en-US', { storage: null, silent: true });
  try {
    const found = filterRelics(RELICS, { query: 'Quick Draw', discovered: [] });
    assert.deepEqual(found.map((relic) => relic.id), ['quickdraw']);
  } finally {
    setLocale('zh-CN', { storage: null, silent: true });
  }
});

test('收录推导：合并当前局、历史局、本地快照与本机记录，去重且过滤非法 id', () => {
  const merged = collectDiscovered({
    activeRun: { relics: [{ id: 'sharp', level: 2 }] },
    runs: [
      { relics: ['eagle', { id: 'sharp', level: 1 }] },
      { relics: [{ id: 'not-a-relic', level: 1 }, { id: 'crit', level: 3 }] },
      null,
    ],
    snapshot: { relics: ['bounty', 'eagle'] },
    stored: ['powder', 'sharp'],
    unlocks: ['start_gold', 'warlord'],
  });
  assert.deepEqual(merged, ['bounty', 'crit', 'eagle', 'powder', 'sharp', 'warlord']);
  assert.deepEqual(relicIdsOf({ relics: ['sharp', 'bogus', null] }), ['sharp']);
  assert.deepEqual(relicIdsOf(null), []);
});

test('未收录条目不泄露名称之外的效果与升级数值', () => {
  const { progressText, body } = renderCodex({ relics: RELICS, discovered: [] });
  assert.equal((body.match(/data-known="false"/g) || []).length, 40, '未收录时应遮罩全部 40 件');
  assert.equal((body.match(/data-known="true"/g) || []).length, 0);
  assert.ok(body.includes(t('codex.unknownEffects')), '缺少问号遮罩');
  assert.ok(progressText.includes('0 / 40'), '收录进度应为 0 / 40');

  // 名称保留（可检索），但描述与升级数值不得出现。
  assert.ok(body.includes(RELICS.find((relic) => relic.id === 'sharp').name));
  for (const relic of RELICS) {
    assert.ok(!body.includes(relic.desc), `未收录时泄露了 ${relic.id} 的描述`);
  }
  assert.ok(!body.includes('弩塔伤害 +25%'), '未收录时泄露了效果文案');
  assert.ok(!body.includes(zhCN['codex.effect.dmg'].replace('{tower}', '弩塔').replace('{value}', '25')));
  assert.ok(!/Ⅰ|Ⅱ|Ⅲ/.test(body), '未收录时不应出现升级等级');
  assert.ok(!/undefined|NaN/.test(body), '遮罩内容不应泄漏 undefined/NaN');
});

test('已收录条目展示描述、三级升级数值与套装标签', () => {
  const { progressText, body } = renderCodex({ relics: RELICS, discovered: ALL_IDS });
  assert.equal((body.match(/data-known="true"/g) || []).length, 40, '全部收录时应展示 40 件');
  assert.ok(progressText.includes('40 / 40'));

  const sharp = RELICS.find((relic) => relic.id === 'sharp');
  assert.ok(body.includes(sharp.desc), '缺少遗物描述');
  assert.ok(body.includes(t('codex.set.hunter')), '缺少套装标签');
  assert.ok(body.includes(zhCN['codex.relic.sharp.name']), '缺少中英文案表中的名称');
  assert.ok(body.includes('Ⅰ') && body.includes('Ⅱ') && body.includes('Ⅲ'), '缺少三级升级标签');

  const level1 = effectSummary('sharp', 1);
  const level3 = effectSummary('sharp', 3);
  assert.equal(level1, '弩塔伤害 +25%');
  assert.equal(level3, '弩塔伤害 +55%', 'Ⅲ 级应为 25% × 2.2 后取整');
  assert.notEqual(level1, level3, '升级数值必须随等级变化');
});

test('效果数值格式：百分比 / 整数 / 带符号百分比 / 小数', () => {
  assert.deepEqual(effectValueText('dmg', 0.25), { value: '25' });
  assert.deepEqual(effectValueText('chain', 1.6), { value: '2' });
  assert.deepEqual(effectValueText('costMul', -0.08), { sign: '-', value: '8' });
  assert.deepEqual(effectValueText('range', 0.6), { value: '0.6' });
  assert.equal(effectSummary('thrifty', 1), '建造/升级费用 -8%');
});

test('卡片转义用户不可控文本，避免 HTML 注入', () => {
  const html = renderRelicCard(
    { id: 'fake', name: '<b>X</b>', rarity: 'common', desc: '<i>d</i>', mods: {} },
    true
  );
  assert.ok(!html.includes('<b>X</b>'));
  assert.ok(!html.includes('<i>d</i>'));
  assert.ok(html.includes('&lt;b&gt;X&lt;/b&gt;'));
});

test('中英双语文案齐备：每件遗物、每种效果、每个界面键', () => {
  for (const relic of RELICS) {
    for (const field of ['name', 'desc']) {
      const key = `codex.relic.${relic.id}.${field}`;
      assert.equal(typeof zhCN[key], 'string', `zh-CN 缺少 ${key}`);
      assert.equal(typeof enUS[key], 'string', `en-US 缺少 ${key}`);
      assert.ok(zhCN[key].trim().length > 0, `${key} 的中文不应为空`);
      assert.ok(enUS[key].trim().length > 0, `${key} 的英文不应为空`);
    }
  }

  const effectKeys = new Set();
  for (const relic of RELICS) {
    for (const key of Object.keys(relic.mods || {})) {
      effectKeys.add(key === 'dmg' ? 'dmg' : key);
    }
  }
  for (const key of effectKeys) {
    assert.equal(typeof zhCN[`codex.effect.${key}`], 'string', `zh-CN 缺少效果模板 ${key}`);
    assert.equal(typeof enUS[`codex.effect.${key}`], 'string', `en-US 缺少效果模板 ${key}`);
  }

  const codexKeys = Object.keys(zhCN).filter(
    (key) => key.startsWith('codex.') || key === 'title.relicCodex'
  );
  assert.ok(codexKeys.length > 0);
  for (const key of codexKeys) {
    assert.equal(typeof enUS[key], 'string', `en-US 缺少键 ${key}`);
    assert.ok(enUS[key].trim().length > 0, `en-US 的 ${key} 不应为空`);
  }
  for (const key of Object.keys(enUS)) {
    if (!key.startsWith('codex.') && key !== 'title.relicCodex') continue;
    assert.equal(typeof zhCN[key], 'string', `zh-CN 缺少键 ${key}`);
  }
});

test('大厅入口、容器与脚本已接线', () => {
  assert.match(INDEX_HTML, /id="btn-relic-codex"/, '缺少图鉴入口按钮');
  assert.match(INDEX_HTML, /data-i18n="title\.relicCodex"/, '入口按钮未走 i18n');
  assert.match(INDEX_HTML, /id="relic-codex-panel"/, '缺少图鉴面板容器');
  assert.match(INDEX_HTML, /src="\/js\/relic-codex-ui\.js"/, 'index.html 未引入图鉴脚本');
  assert.match(CODEX_UI, /id="btn-relic-codex-close"/, '缺少关闭按钮');
  assert.match(CODEX_UI, /\/api\/profile/, '未读取玩家档案');
  assert.match(CODEX_UI, /\/api\/stats/, '未读取最近对局');
  assert.match(CODEX_UI, /\/api\/runs\/active/, '未读取进行中的对局');
  assert.match(CODEX_UI, /\/api\/runs\/\$\{encodeURIComponent\(run\.id\)\}/, '未读取历史对局详情');
  assert.match(CODEX_UI, /from '\.\/i18n\.js'/, '文案未走 i18n');
});

test('不引入第三方依赖：图鉴脚本只导入相对模块', () => {
  const imports = [...CODEX_UI.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
  assert.ok(imports.length > 0, '缺少模块导入');
  for (const specifier of imports) {
    assert.match(specifier, /^\.\//, `不允许第三方或绝对导入：${specifier}`);
  }
  assert.ok(!/https?:\/\//.test(CODEX_UI), '不得从网络加载资源');
});
