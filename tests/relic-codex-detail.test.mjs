// 遗物图鉴详情：回合型触发周期、套装进度（2/4）、等级对比与未知遮罩。
// 数值与周期都从共享数据/效果注册表查询，图鉴本身不复制第二份。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { setLocale, t } from '../public/js/i18n.js';
import {
  EFFECT_REGISTRY,
  RELIC_SET_BONUSES,
  effectPeriodicInfo,
  relicSetMaxPieces,
} from '../public/js/shared/effects.js';
import {
  RELICS,
  RELIC_BY_ID,
  RELIC_LEVEL_LABELS,
  RELIC_MAX_LEVEL,
  relicModsAtLevel,
} from '../public/js/shared/data.js';
import {
  effectSummary,
  levelComparison,
  periodicText,
  relicPeriodInfo,
  renderCodex,
  renderRelicCard,
  setProgress,
} from '../public/js/relic-codex-ui.js';
import zhCN from '../public/js/shared/i18n/zh-CN.js';
import enUS from '../public/js/shared/i18n/en-US.js';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const CODEX_UI = read('public/js/relic-codex-ui.js');
const EFFECTS = read('public/js/shared/effects.js');
const ALL_IDS = RELICS.map((relic) => relic.id);
const HUNTER_IDS = RELICS.filter((relic) => relic.set === 'hunter').map((relic) => relic.id);

test('回合型周期由效果注册表声明，图鉴只读查询', () => {
  assert.deepEqual(effectPeriodicInfo('waveGold2'), { period: 2, timing: 'waveEnd' });
  assert.deepEqual(effectPeriodicInfo('waveHeal5'), { period: 5, timing: 'waveEnd' });
  assert.equal(effectPeriodicInfo('dmg'), null);

  assert.deepEqual(relicPeriodInfo('harvestsickle'), [
    { key: 'waveGold2', value: 6, period: 2, timing: 'waveEnd' },
  ]);
  assert.deepEqual(relicPeriodInfo('metronome'), [
    { key: 'waveHeal4', value: 2, period: 4, timing: 'waveEnd' },
  ]);
  assert.deepEqual(relicPeriodInfo('sharp'), [], '非回合型遗物不应返回周期');
});

test('回合型卡片展示触发周期，非回合型不展示', () => {
  assert.equal(periodicText('harvestsickle'), t('codex.period', { period: 2 }));
  assert.equal(periodicText('sharp'), '');

  const periodic = renderRelicCard(RELIC_BY_ID.harvestsickle, true);
  assert.ok(periodic.includes('class="codex-period"'), '缺少周期行');
  assert.ok(periodic.includes(t('codex.period', { period: 2 })), '缺少周期文案');

  const plain = renderRelicCard(RELIC_BY_ID.sharp, true);
  assert.ok(!plain.includes('class="codex-period"'), '非回合型不应出现周期行');
});

test('套装进度只统计已收录的不同遗物，分母来自共享档位', () => {
  assert.equal(relicSetMaxPieces('hunter'), 4, '猎手同盟最高档位应为 4');
  for (const setId of Object.keys(RELIC_SET_BONUSES)) {
    assert.deepEqual(
      [2, 4].filter((pieces) => pieces <= relicSetMaxPieces(setId)),
      [2, 4],
      `${setId} 的 2/4 件阈值缺失`
    );
  }

  const two = setProgress('hunter', HUNTER_IDS.slice(0, 2));
  assert.equal(two.owned, 2);
  assert.equal(two.pieces, 2);
  assert.equal(two.total, 4);
  assert.deepEqual(two.activeTiers.map((tier) => tier.pieces), [2]);
  assert.ok(two.text.includes('2 / 4'), '缺少 2 / 4 进度文案');

  const capped = setProgress('hunter', HUNTER_IDS);
  assert.equal(capped.owned, HUNTER_IDS.length, '持有件数按实际不同遗物统计');
  assert.equal(capped.pieces, 4, '展示进度封顶到最高档位');
  assert.deepEqual(capped.activeTiers.map((tier) => tier.pieces), [2, 4]);
  assert.ok(capped.text.includes('4 / 4'));

  const mixed = setProgress('hunter', ['sharp', 'sharp', 'powder', 'not-a-relic']);
  assert.equal(mixed.owned, 1, '重复遗物与非本套装遗物不计数');
  assert.equal(setProgress(null, []), null);
  assert.equal(setProgress('unknown-set', []), null);
});

test('已收录卡片展示套装进度，未收录卡片不展示', () => {
  const sharp = RELIC_BY_ID.sharp;
  const known = renderRelicCard(sharp, true, { discovered: ['sharp', 'eagle'] });
  assert.ok(known.includes('class="codex-set-progress"'));
  assert.ok(known.includes('2 / 4'));

  const unknown = renderRelicCard(sharp, false, { discovered: ['sharp', 'eagle'] });
  assert.ok(!unknown.includes('class="codex-set-progress"'));
  assert.ok(!unknown.includes('2 / 4'));
});

test('未收录遗物不泄露周期、套装进度与等级数值', () => {
  for (const id of ['harvestsickle', 'sharp', 'warlord']) {
    const relic = RELIC_BY_ID[id];
    const html = renderRelicCard(relic, false, { discovered: ALL_IDS });
    assert.ok(html.includes('data-known="false"'), `${id} 未遮罩`);
    assert.ok(html.includes(t('codex.unknownEffects')), `${id} 缺少问号遮罩`);
    assert.ok(!html.includes('class="codex-period"'), `${id} 泄露周期`);
    assert.ok(!html.includes('class="codex-set-progress"'), `${id} 泄露套装进度`);
    assert.ok(!html.includes('class="codex-levels"'), `${id} 泄露等级列表`);
    assert.ok(!html.includes(relic.desc), `${id} 泄露描述`);
    assert.ok(!/Ⅰ|Ⅱ|Ⅲ/.test(html), `${id} 泄露等级标签`);
    assert.ok(!/undefined|NaN/.test(html), `${id} 出现 undefined/NaN`);
  }

  const { body } = renderCodex({ relics: RELICS, discovered: [] });
  assert.ok(!body.includes('class="codex-period"'));
  assert.ok(!body.includes('class="codex-set-progress"'));
});

test('等级对比：Ⅰ→Ⅲ 的数值来自共享等级因子且逐级变化', () => {
  const rows = levelComparison('sharp');
  assert.equal(rows.length, RELIC_MAX_LEVEL);
  assert.deepEqual(rows.map((row) => row.label), RELIC_LEVEL_LABELS);
  assert.equal(rows.filter((row) => row.current).length, 1);

  assert.equal(rows[0].summary, effectSummary('sharp', 1));
  assert.equal(rows[2].summary, effectSummary('sharp', 3));
  assert.notEqual(rows[0].summary, rows[2].summary, '升级后数值必须变化');

  const level3 = relicModsAtLevel('sharp', 3);
  assert.ok(
    rows[2].summary.includes(String(Math.round(level3.dmg.arrow * 100))),
    'Ⅲ 级文案应使用共享等级因子算出的数值'
  );

  const card = renderRelicCard(RELIC_BY_ID.sharp, true);
  assert.ok(card.includes('data-level="1"'));
  assert.ok(card.includes('data-level="2"'));
  assert.ok(card.includes('data-level="3"'));
  assert.ok(card.includes('data-current="true"'));
  assert.ok(card.includes(t('codex.levelCompare')), '缺少等级对比标签');
});

test('renderCodex 把收录集合传给卡片，套装进度随收录变化', () => {
  const partial = renderCodex({ relics: RELICS, discovered: ['sharp', 'eagle'] }).body;
  assert.ok(partial.includes('2 / 4'));

  const complete = renderCodex({ relics: RELICS, discovered: ALL_IDS }).body;
  assert.ok(complete.includes('4 / 4'));
});

test('新增详情文案中英双语齐备', () => {
  for (const key of ['codex.period', 'codex.setProgress', 'codex.levelCompare']) {
    assert.equal(typeof zhCN[key], 'string', `zh-CN 缺少 ${key}`);
    assert.equal(typeof enUS[key], 'string', `en-US 缺少 ${key}`);
    assert.ok(zhCN[key].trim().length > 0, `zh-CN 的 ${key} 不应为空`);
    assert.ok(enUS[key].trim().length > 0, `en-US 的 ${key} 不应为空`);
    assert.notEqual(zhCN[key], enUS[key], `${key} 的中英文案不应相同`);
  }

  setLocale('en-US', { storage: null, silent: true });
  try {
    assert.equal(periodicText('harvestsickle'), 'Triggers every 2 waves (at wave end)');
    assert.ok(setProgress('hunter', ['sharp', 'eagle']).text.startsWith('Set progress:'));
  } finally {
    setLocale('zh-CN', { storage: null, silent: true });
  }
});

test('图鉴只读：注册表周期与套装档位未被改写', () => {
  assert.deepEqual(EFFECT_REGISTRY.waveGold2.periodic, { period: 2, timing: 'waveEnd' });
  assert.deepEqual(EFFECT_REGISTRY.waveHeal4.periodic, { period: 4, timing: 'waveEnd' });
  for (const set of Object.values(RELIC_SET_BONUSES)) {
    assert.deepEqual(set.tiers.map((tier) => tier.pieces), [2, 4]);
  }
  assert.ok(!/EFFECT_REGISTRY\.[a-zA-Z0-9_]+\s*=/.test(CODEX_UI), '图鉴不得改写效果注册表');
});

test('不引入第三方库：图鉴与效果模块只导入相对模块', () => {
  for (const [name, source] of [['relic-codex-ui', CODEX_UI], ['effects', EFFECTS]]) {
    const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
    for (const specifier of imports) {
      assert.match(specifier, /^\.\//, `${name} 出现第三方或绝对导入：${specifier}`);
    }
  }
});
