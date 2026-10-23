// 中英双语基础设施：键对称、插值、未知键回退、默认语言解析与持久化。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LOCALE,
  DICTIONARIES,
  LOCALES,
  STORAGE_KEY,
  detectLocale,
  getLocale,
  initI18n,
  normalizeLocale,
  setLocale,
  t,
  tData,
} from '../public/js/i18n.js';
import zhCN from '../public/js/shared/i18n/zh-CN.js';
import enUS from '../public/js/shared/i18n/en-US.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    dump: () => Object.fromEntries(data),
  };
}

test('两种语言键集合一致且无空文案', () => {
  const zhKeys = Object.keys(zhCN).sort();
  const enKeys = Object.keys(enUS).sort();
  const missingInEn = zhKeys.filter((key) => !(key in enUS));
  const missingInZh = enKeys.filter((key) => !(key in zhCN));
  assert.equal(missingInEn.length, 0, `en-US 缺少键: ${missingInEn.join(', ')}`);
  assert.equal(missingInZh.length, 0, `zh-CN 缺少键: ${missingInZh.join(', ')}`);
  assert.deepEqual(enKeys, zhKeys);

  for (const locale of LOCALES) {
    const dict = DICTIONARIES[locale];
    for (const [key, value] of Object.entries(dict)) {
      assert.equal(typeof value, 'string', `${locale} 的键 ${key} 必须是字符串`);
      assert.ok(value.trim().length > 0, `${locale} 的键 ${key} 不能为空`);
    }
  }
});

test('参数插值随语言切换', () => {
  setLocale('zh-CN', { silent: true });
  assert.equal(getLocale(), 'zh-CN');
  assert.equal(t('title.daily.left', { n: 3 }), '剩 3 次');
  assert.equal(t('hud.startWave', { wave: 4 }), '开始第 4 波');
  assert.equal(
    t('shop.baseStats', { dmg: 12, range: 3 }),
    '基础伤害 12 · 射程 3'
  );

  setLocale('en-US', { silent: true });
  assert.equal(getLocale(), 'en-US');
  assert.equal(t('title.daily.left', { n: 3 }), '3 left');
  assert.equal(t('hud.startWave', { wave: 4 }), 'Start Wave 4');
  assert.equal(
    t('shop.baseStats', { dmg: 12, range: 3 }),
    'Base damage 12 · Range 3'
  );
  setLocale('zh-CN', { silent: true });
});

test('未知键回退到 key 本身，缺失参数保留占位符', () => {
  setLocale('en-US', { silent: true });
  assert.equal(t('not.a.real.key'), 'not.a.real.key');
  assert.equal(t('title.daily.left'), '{n} left');
  assert.equal(tData('tower', 'not-a-tower', 'name', 'Fallback'), 'Fallback');
  assert.equal(tData('tower', 'arrow', 'name', '弩塔'), 'Bolt Tower');
  assert.equal(tData('difficulty', 'standard', 'name', '远征'), 'Expedition');
  setLocale('zh-CN', { silent: true });
});

test('默认语言解析符合浏览器设置', () => {
  assert.equal(normalizeLocale('en-GB'), 'en-US');
  assert.equal(normalizeLocale('zh-Hant-TW'), 'zh-CN');
  assert.equal(normalizeLocale('fr-FR'), null);
  assert.equal(normalizeLocale(''), null);

  assert.equal(detectLocale(['fr-FR', 'en-US', 'zh-CN']), 'en-US');
  assert.equal(detectLocale('en'), 'en-US');
  assert.equal(detectLocale(['zh-tw']), 'zh-CN');
  assert.equal(detectLocale(['ja-JP']), DEFAULT_LOCALE);
  assert.equal(detectLocale([]), DEFAULT_LOCALE);
  assert.equal(detectLocale(undefined), DEFAULT_LOCALE);
});

test('语言选择持久化并优先于浏览器默认', () => {
  const storage = memoryStorage();

  assert.equal(initI18n({ storage, languages: ['en-US'] }), 'en-US');
  assert.equal(storage.getItem(STORAGE_KEY), null);

  assert.equal(setLocale('zh-CN', { storage, silent: true }), 'zh-CN');
  assert.equal(storage.getItem(STORAGE_KEY), 'zh-CN');
  assert.equal(initI18n({ storage, languages: ['en-US'] }), 'zh-CN');

  // 存储中的非法值不生效，回退浏览器语言。
  storage.setItem(STORAGE_KEY, 'klingon');
  assert.equal(initI18n({ storage, languages: ['en-US'] }), 'en-US');

  // 显式切换非法语言回退默认。
  assert.equal(setLocale('xx-XX', { storage, silent: true }), DEFAULT_LOCALE);

  // 存储不可写时不影响本次切换。
  const broken = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('quota');
    },
  };
  assert.equal(setLocale('en-US', { storage: broken, silent: true }), 'en-US');
  setLocale('zh-CN', { silent: true });
});
