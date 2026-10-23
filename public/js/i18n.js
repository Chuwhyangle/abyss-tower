// 轻量 i18n：集中文案表、语言切换、默认跟随浏览器、localStorage 持久化。
// 无构建步骤、无第三方依赖；Node 下也可导入（测试只用到纯函数）。
import zhCN from './shared/i18n/zh-CN.js';
import enUS from './shared/i18n/en-US.js';

export const LOCALES = ['zh-CN', 'en-US'];
export const DEFAULT_LOCALE = 'zh-CN';
export const STORAGE_KEY = 'abyss-tower.locale.v1';
export const DICTIONARIES = { 'zh-CN': zhCN, 'en-US': enUS };

let currentLocale = DEFAULT_LOCALE;
const interpolatePattern = /\{(\w+)\}/g;

// 浏览器标签 -> 受支持语言；未匹配返回 null。
export function normalizeLocale(tag) {
  if (!tag) return null;
  const value = String(tag).trim().toLowerCase();
  if (!value) return null;
  if (value === 'zh' || value.startsWith('zh-')) return 'zh-CN';
  if (value === 'en' || value.startsWith('en-')) return 'en-US';
  return null;
}

// 按浏览器语言优先级列表取第一个受支持语言，否则回退默认。
export function detectLocale(source) {
  const tags = Array.isArray(source) ? source : [source];
  for (const tag of tags) {
    const locale = normalizeLocale(tag);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}

export function getLocale() {
  return currentLocale;
}

function dictionaryFor(locale) {
  return DICTIONARIES[locale] || DICTIONARIES[DEFAULT_LOCALE];
}

export function hasKey(key, locale = currentLocale) {
  return Object.prototype.hasOwnProperty.call(dictionaryFor(locale), key);
}

function interpolate(template, params) {
  return String(template).replace(interpolatePattern, (match, name) =>
    params && Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  );
}

// 取文案；未知键原样返回键名，避免界面因缺键崩溃。
export function t(key, params = {}) {
  const primary = dictionaryFor(currentLocale)[key];
  const template = primary != null ? primary : DICTIONARIES[DEFAULT_LOCALE][key];
  return template == null ? key : interpolate(template, params);
}

// 数据表里的专有名词（难度/塔/敌人等）按 id 取译名，缺译名回退数据自带名称。
export function tData(group, id, field, fallback) {
  const key = `data.${group}.${id}.${field}`;
  const primary = dictionaryFor(currentLocale)[key];
  const template = primary != null ? primary : DICTIONARIES[DEFAULT_LOCALE][key];
  return template == null ? fallback : interpolate(template, {});
}

function storageOf(explicit) {
  if (explicit !== undefined) return explicit;
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function readStoredLocale(storage) {
  try {
    return storage?.getItem?.(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeStoredLocale(storage, locale) {
  try {
    storage?.setItem?.(STORAGE_KEY, locale);
  } catch {
    /* 存储不可用/配额满：本次仍使用内存语言 */
  }
}

function browserLanguages() {
  const nav = globalThis.navigator;
  if (!nav) return [];
  if (Array.isArray(nav.languages) && nav.languages.length) return nav.languages;
  return nav.language ? [nav.language] : [];
}

// 把 data-i18n* 标注的静态文案同步到 DOM；在 Node 下是空操作。
export function applyTranslations(root) {
  if (typeof document === 'undefined') return;
  const scope = root || document;
  const doc = document;
  if (doc.documentElement) doc.documentElement.lang = currentLocale;
  doc.title = t('app.title');
  if (typeof scope.querySelectorAll !== 'function') return;
  scope.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  scope.querySelectorAll('[data-i18n-title]').forEach((node) => {
    node.title = t(node.dataset.i18nTitle);
  });
  scope.querySelectorAll('[data-i18n-aria]').forEach((node) => {
    node.setAttribute('aria-label', t(node.dataset.i18nAria));
  });
}

// 切换语言：归一化、持久化、刷新静态文案，并通知动态界面重渲染。
export function setLocale(locale, { storage, silent = false } = {}) {
  currentLocale = normalizeLocale(locale) || DEFAULT_LOCALE;
  writeStoredLocale(storageOf(storage), currentLocale);
  applyTranslations();
  if (!silent && typeof document !== 'undefined' && typeof CustomEvent !== 'undefined') {
    document.dispatchEvent(new CustomEvent('i18n:change', { detail: { locale: currentLocale } }));
  }
  return currentLocale;
}

// 启动：已保存的选择优先，否则跟随浏览器语言。
export function initI18n({ storage, languages } = {}) {
  const saved = normalizeLocale(readStoredLocale(storageOf(storage)));
  currentLocale = saved || detectLocale(languages ?? browserLanguages());
  applyTranslations();
  return currentLocale;
}

let autoBooted = false;
function autoBoot() {
  if (autoBooted) return;
  autoBooted = true;
  initI18n();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoBoot, { once: true });
  } else {
    autoBoot();
  }
}
