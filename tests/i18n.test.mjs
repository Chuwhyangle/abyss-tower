// 中英双语基础设施：键对称、插值、未知键回退、默认语言解析与持久化。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  tOr,
} from '../public/js/i18n.js';
import zhCN from '../public/js/shared/i18n/zh-CN.js';
import enUS from '../public/js/shared/i18n/en-US.js';
import { SKILL_ORDER } from '../public/js/shared/data/skills.js';
import { ACHIEVEMENTS } from '../public/js/shared/achievements.js';
import { RELICS } from '../public/js/shared/data.js';
import { MAP_MODIFIERS } from '../public/js/shared/mapgen.js';
import { SET_ORDER, renderCodex } from '../public/js/relic-codex-ui.js';
import { renderSeasonPanel } from '../public/js/season-ui.js';

const CJK_RE = /[一-鿿]/;

const GLOSSARY_PATH = new URL('../docs/GLOSSARY.md', import.meta.url);
const REQUIRED_GLOSSARY_TERMS = ['塔', '遗物', '技能', '难度', '星核', '波次'];

function parseGlossary(markdown) {
  const rows = [];
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 3) continue;
    if (cells[0] === '中文' || /^-{3,}$/.test(cells[0])) continue;
    rows.push({
      zh: cells[0],
      en: cells[1],
      aliases:
        cells[2] === '—' || cells[2] === ''
          ? []
          : cells[2]
              .split(',')
              .map((alias) => alias.trim())
              .filter(Boolean),
    });
  }
  return rows;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

test('术语表覆盖核心术语，英文文案零禁用别名', () => {
  const terms = parseGlossary(readFileSync(GLOSSARY_PATH, 'utf8'));
  assert.ok(terms.length > 0, '术语表未解析出任何条目');
  const zhTerms = terms.map((row) => row.zh);
  for (const required of REQUIRED_GLOSSARY_TERMS) {
    assert.ok(zhTerms.includes(required), `术语表缺少「${required}」`);
  }

  const entries = Object.entries(enUS);
  const hits = [];
  for (const term of terms) {
    assert.ok(term.en.length > 0, `术语「${term.zh}」缺少英文正式用词`);
    for (const alias of term.aliases) {
      const pattern = new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'i');
      for (const [key, value] of entries) {
        if (pattern.test(value)) hits.push(`${alias} ← ${key}: "${value}"`);
      }
    }
  }
  assert.deepEqual(hits, [], `英文文案出现禁用别名:\n${hits.join('\n')}`);
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

test('技能与成就的数据文案中英齐全', () => {
  const missing = [];
  const requireKey = (key) => {
    for (const locale of LOCALES) {
      if (!DICTIONARIES[locale][key]) missing.push(`${locale}:${key}`);
    }
  };

  for (const id of SKILL_ORDER) {
    for (const field of ['name', 'desc', 'summary']) requireKey(`skill.${id}.${field}`);
  }
  for (const role of ['control', 'burst', 'ultimate']) requireKey(`skill.role.${role}`);
  for (const unlock of ['default', 'win_roam', 'win_standard']) requireKey(`skill.unlock.${unlock}`);
  for (const field of ['carry', 'carryDaily', 'carryLabel', 'locked', 'maxed', 'upgrade']) {
    requireKey(`skill.ui.${field}`);
  }

  for (const item of ACHIEVEMENTS) {
    for (const field of ['title', 'desc', 'condition']) requireKey(`achievement.${item.id}.${field}`);
  }
  for (const group of ['clear', 'build', 'challenge', 'collect']) {
    requireKey(`achievement.group.${group}.name`);
  }
  for (const rarity of ['common', 'rare', 'epic']) requireKey(`achievement.rarity.${rarity}.name`);

  assert.deepEqual(missing, [], `缺少键: ${missing.join(', ')}`);
});

test('技能/成就文案随语言切换，缺键回退原值', () => {
  setLocale('zh-CN', { silent: true });
  assert.equal(tOr('skill.aurora.name', '原值'), '霜月·极光');
  assert.equal(tOr('achievement.first_run.title', '原值'), '首次远征');
  assert.equal(
    tOr('skill.aurora.summary', '', { freeze: '0.7', slow: 25, cd: 55 }),
    '冻结 0.7s · 减速 25% · 冷却 55s'
  );

  setLocale('en-US', { silent: true });
  assert.equal(tOr('skill.aurora.name', '原值'), 'Frostmoon · Aurora');
  assert.equal(
    tOr('skill.aurora.desc', '原值'),
    'An aurora curtain sweeps the battlefield, freezing and slowing all enemies.'
  );
  assert.equal(tOr('achievement.first_run.title', '原值'), 'First Expedition');
  assert.equal(tOr('achievement.first_run.condition', '原值'), 'Complete 1 expedition');
  assert.equal(tOr('achievement.rarity.epic.name', '原值'), 'Epic');

  // 数据表新增了未翻译的条目时，界面回退数据表原值，而不是显示 key。
  assert.equal(tOr('skill.not-a-skill.name', '数据原名'), '数据原名');
  assert.equal(tOr('achievement.not-a-real-achievement.title', 'Data title'), 'Data title');
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

test('本周挑战/图鉴/赛季/诊断关键键中英齐全', () => {
  const missing = [];
  const requireKey = (key) => {
    for (const locale of LOCALES) {
      if (!DICTIONARIES[locale][key]) missing.push(`${locale}:${key}`);
    }
  };

  for (const key of [
    'title.weekly',
    'difficulty.weeklyTitle',
    'difficulty.weeklyNote',
    'difficulty.weeklyAffixes',
    'difficulty.eyebrowWeekly',
  ]) {
    requireKey(key);
  }

  for (const key of [
    'codex.title',
    'codex.subtitle',
    'codex.progress',
    'codex.empty',
    'codex.loading',
    'codex.login',
    'codex.error',
    'codex.unknownEffects',
    'codex.effectJoiner',
    'codex.filterRarity',
    'codex.filterSet',
    'codex.all',
    'codex.noSet',
    'codex.search',
    'codex.searchPlaceholder',
    'codex.close',
  ]) {
    requireKey(key);
  }
  for (const rarity of ['common', 'rare', 'epic']) requireKey(`codex.rarity.${rarity}`);
  for (const set of SET_ORDER) requireKey(`codex.set.${set}`);

  for (const key of [
    'season.title',
    'season.current',
    'season.lastResult',
    'season.rankLabel',
    'season.bestLabel',
    'season.remainingLabel',
    'season.coresLabel',
    'season.settledAtLabel',
    'season.rankValue',
    'season.unranked',
    'season.scoreValue',
    'season.noResult',
    'season.noResultHint',
    'season.progressEmpty',
    'season.loading',
    'season.login',
    'season.error',
    'season.close',
  ]) {
    requireKey(key);
  }
  for (const unit of ['days', 'hours', 'minutes']) requireKey(`season.remaining.${unit}`);

  for (const key of [
    'diagnostics.retry',
    'diagnostics.close',
    'diagnostics.closeAria',
    'diagnostics.uncaught',
    'diagnostics.fallback',
    'diagnostics.offline',
  ]) {
    requireKey(key);
  }

  assert.deepEqual(missing, [], `缺少键: ${missing.join(', ')}`);
});

test('新模块引用的 t()/tOr() 键在中英字典中都存在', () => {
  const files = [
    'public/js/relic-codex-ui.js',
    'public/js/season-ui.js',
    'public/js/app/boot-errors.js',
  ];
  const missing = [];
  for (const file of files) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const match of source.matchAll(/(?<![\w.])t(?:Or)?\(\s*'([^']+)'/g)) {
      for (const locale of LOCALES) {
        if (!DICTIONARIES[locale][match[1]]) missing.push(`${file} ${locale}:${match[1]}`);
      }
    }
  }
  assert.deepEqual(missing, [], `缺少键: ${missing.join(', ')}`);
});

test('词缀与图鉴数据在中英两种语言下都有译名', () => {
  const missing = [];

  for (const modifier of MAP_MODIFIERS) {
    for (const field of ['name', 'desc']) {
      const key = `data.modifier.${modifier.id}.${field}`;
      for (const locale of LOCALES) {
        if (!DICTIONARIES[locale][key]) missing.push(`${locale}:${key}`);
      }
    }
    assert.ok(
      !CJK_RE.test(enUS[`data.modifier.${modifier.id}.name`] || ''),
      `词缀 ${modifier.id} 的英文名仍是中文`
    );
    assert.ok(
      !CJK_RE.test(enUS[`data.modifier.${modifier.id}.desc`] || ''),
      `词缀 ${modifier.id} 的英文描述仍是中文`
    );
    assert.notEqual(
      enUS[`data.modifier.${modifier.id}.desc`],
      zhCN[`data.modifier.${modifier.id}.desc`],
      `词缀 ${modifier.id} 的英文描述未翻译`
    );
  }

  for (const relic of RELICS) {
    for (const field of ['name', 'desc']) {
      const key = `codex.relic.${relic.id}.${field}`;
      for (const locale of LOCALES) {
        if (!DICTIONARIES[locale][key]) missing.push(`${locale}:${key}`);
      }
      assert.ok(
        !CJK_RE.test(enUS[key] || ''),
        `遗物 ${relic.id}.${field} 的英文文案仍是中文`
      );
    }
  }

  assert.deepEqual(missing, [], `缺少键: ${missing.join(', ')}`);
});

test('本周挑战/图鉴/赛季文案随语言切换', () => {
  const relic = RELICS[0];
  const modifier = MAP_MODIFIERS[0];

  setLocale('zh-CN', { silent: true });
  const zhWeekly = `${t('difficulty.weeklyTitle')}|${tData('modifier', modifier.id, 'name', modifier.name)}`;
  const zhCodex = renderCodex({ relics: [relic], discovered: [relic.id] }).body;
  const zhSeason = renderSeasonPanel({
    season: '2026-09',
    result: null,
    me: { rank: 3, best: { score: 1000 } },
    remainingMs: 3 * 86400000,
  });

  setLocale('en-US', { silent: true });
  const enWeekly = `${t('difficulty.weeklyTitle')}|${tData('modifier', modifier.id, 'name', modifier.name)}`;
  const enCodex = renderCodex({ relics: [relic], discovered: [relic.id] }).body;
  const enSeason = renderSeasonPanel({
    season: '2026-09',
    result: null,
    me: { rank: 3, best: { score: 1000 } },
    remainingMs: 3 * 86400000,
  });

  assert.notEqual(zhWeekly, enWeekly, '本周挑战标题/词缀未随语言切换');
  assert.ok(
    zhCodex.includes(zhCN[`codex.relic.${relic.id}.name`]),
    '图鉴中文名未渲染'
  );
  assert.ok(enCodex.includes(enUS[`codex.relic.${relic.id}.name`]), '图鉴英文名未渲染');
  assert.notEqual(zhCodex, enCodex, '图鉴文案未随语言切换');
  assert.ok(zhSeason.includes('第 3 名'), '赛季中文名次未渲染');
  assert.ok(enSeason.includes('Rank #3'), '赛季英文名次未渲染');

  setLocale('zh-CN', { silent: true });
});

test('新增模块源码无硬编码中文文案', () => {
  const files = [
    'public/js/relic-codex-ui.js',
    'public/js/season-ui.js',
    'public/js/app/boot-errors.js',
  ];
  for (const file of files) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      // 开发者控制台日志不是玩家可见文案，沿用仓库既有中文日志习惯。
      .filter((line) => !/console\.(log|warn|error|info|debug)\(/.test(line))
      .join('\n');
    const hit = source.split('\n').find((line) => CJK_RE.test(line));
    assert.equal(hit, undefined, `${file} 仍有硬编码中文: ${hit}`);
  }
});
