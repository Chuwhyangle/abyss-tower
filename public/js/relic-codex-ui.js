// 遗物图鉴：只读共享遗物数据与既有账号接口，客户端不改任何数值与接口。
// “已收录”由最近结算的对局、当前进行中的对局与本机记录合并得出；未收录的条目不渲染效果数值。
import { t, tData, tOr } from './i18n.js';
import {
  RARITY,
  RELICS,
  RELIC_BY_ID,
  RELIC_LEVEL_LABELS,
  TOWERS,
  relicModsAtLevel,
} from './shared/data.js';
import { RELIC_SET_BONUSES } from './shared/effects.js';
import { iconSvg } from './render/canvas-shapes.js';

const PANEL_ID = 'relic-codex-panel';
const LIST_ID = 'relic-codex-list';
const HISTORY_LIMIT = 10;
const STORAGE_KEY = 'abyss-tower.relic-codex.v1';
const SNAPSHOT_KEY = 'abyss-tower.snapshot.v2';

export const RARITY_ORDER = ['common', 'rare', 'epic'];
export const SET_ORDER = Object.keys(RELIC_SET_BONUSES);

// 效果键的展示单位：百分比 / 整数 / 绝对值带符号 / 小数。与 effects.js 的字段一一对应。
const EFFECT_FORMATS = {
  dmg: 'pct',
  dmgAll: 'pct',
  fireRate: 'pct',
  range: 'number',
  splash: 'pct',
  slow: 'pct',
  slowDur: 'pct',
  chain: 'int',
  dot: 'pct',
  goldMul: 'pct',
  killGold: 'int',
  interest: 'pct',
  crit: 'pct',
  armorPierce: 'pct',
  costMul: 'signedPct',
  frostDmgBonus: 'pct',
  lowHpDmg: 'pct',
  projSpeed: 'pct',
  bossDmg: 'pct',
  baseHp: 'int',
};

const STYLE = `
  #relic-codex-panel {
    margin-top: 18px;
    padding: 18px 20px;
    border: 1px solid var(--line, #22333f);
    border-radius: var(--radius, 16px);
    background: rgba(13, 21, 27, 0.94);
    text-align: left;
    max-width: 100%;
    box-sizing: border-box;
    overflow-wrap: anywhere;
  }
  #relic-codex-panel[hidden] { display: none; }
  .codex-head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 8px;
  }
  .codex-head h2 { margin: 0; font-size: 18px; letter-spacing: 0.04em; }
  .codex-progress {
    font-size: 12px;
    color: var(--muted, #8fa3b2);
    font-family: var(--font-mono, monospace);
  }
  .codex-head .icon-btn { margin-left: auto; }
  .codex-subtitle,
  .codex-hint,
  .codex-empty { margin: 0 0 12px; font-size: 12.5px; color: var(--muted, #8fa3b2); }
  .codex-filters {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 14px;
    margin-bottom: 14px;
  }
  .codex-filters label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    font-size: 11px;
    letter-spacing: 0.06em;
    color: var(--muted, #8fa3b2);
  }
  .codex-filters select,
  .codex-filters input {
    min-width: 120px;
    max-width: 100%;
    padding: 6px 8px;
    border: 1px solid rgba(120, 160, 175, 0.24);
    border-radius: 8px;
    background: rgba(8, 13, 16, 0.7);
    color: inherit;
    font: inherit;
  }
  .codex-group + .codex-group { margin-top: 16px; }
  .codex-group-title {
    margin: 0 0 8px;
    font-size: 13px;
    letter-spacing: 0.06em;
    color: var(--muted, #8fa3b2);
  }
  .codex-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 10px;
  }
  .codex-card {
    min-width: 0;
    padding: 12px 14px;
    border: 1px solid rgba(120, 160, 175, 0.16);
    border-radius: 12px;
    background: rgba(9, 15, 19, 0.6);
  }
  .codex-card header {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 6px;
  }
  .codex-card h3 { margin: 0; font-size: 14px; }
  .codex-rarity,
  .codex-set {
    padding: 1px 6px;
    border-radius: 6px;
    border: 1px solid currentColor;
    font-size: 10.5px;
    letter-spacing: 0.04em;
    opacity: 0.85;
  }
  .codex-card.rarity-common .codex-rarity { color: #9fb0c3; }
  .codex-card.rarity-rare .codex-rarity { color: #5bc8ff; }
  .codex-card.rarity-epic .codex-rarity { color: #c88bff; }
  .codex-set { color: var(--muted, #8fa3b2); }
  .codex-desc { margin: 0 0 8px; font-size: 12.5px; }
  .codex-levels { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
  .codex-levels li { display: flex; gap: 8px; font-size: 12px; }
  .codex-level {
    flex: 0 0 auto;
    color: var(--gold, #ffd36b);
    font-family: var(--font-mono, monospace);
  }
  .codex-card[data-known='false'] .codex-desc { opacity: 0.55; letter-spacing: 0.2em; }
  .codex-card[data-known='false'] .codex-levels { display: none; }
`;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]);
}

function storageOf() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

// ---------- 已收录推导（纯函数） ----------

// 接受遗物 id 数组、{id}/字符串混合数组，或带 relics 字段的存档/对局对象。
export function relicIdsOf(value) {
  let list = [];
  if (Array.isArray(value)) list = value;
  else if (value && Array.isArray(value.relics)) list = value.relics;
  const ids = [];
  for (const item of list) {
    const id = typeof item === 'string' ? item : item?.id;
    if (typeof id === 'string' && RELIC_BY_ID[id]) ids.push(id);
  }
  return ids;
}

export function collectDiscovered({
  activeRun = null,
  runs = [],
  snapshot = null,
  stored = [],
  unlocks = [],
} = {}) {
  const ids = new Set();
  const add = (value) => {
    for (const id of relicIdsOf(value)) ids.add(id);
  };
  add(stored);
  // profile.unlocks 目前只有永久成长项；若服务端将来把遗物 id 记入这里也能直接生效。
  add(unlocks);
  add(snapshot?.relics);
  add(activeRun);
  for (const run of runs || []) add(run);
  return [...ids].sort();
}

// ---------- 渲染（纯函数） ----------

export function effectValueText(key, value) {
  const kind = EFFECT_FORMATS[key] || 'number';
  const num = Number(value) || 0;
  if (kind === 'pct') return { value: String(Math.round(num * 100)) };
  if (kind === 'int') return { value: String(Math.round(num)) };
  if (kind === 'signedPct') {
    const pct = Math.round(num * 100);
    return { sign: pct < 0 ? '-' : '+', value: String(Math.abs(pct)) };
  }
  return { value: String(Math.round(num * 100) / 100) };
}

export function effectLine(key, value, towerType = null) {
  const params = effectValueText(key, value);
  if (key === 'dmg' && towerType) {
    params.tower = tData('tower', towerType, 'name', TOWERS[towerType]?.name || towerType);
  }
  return tOr(`codex.effect.${key}`, `${key} ${params.value}`, params);
}

// 某件遗物在指定等级的全部效果文案；顺序与 RELICS 里的 mods 声明顺序一致。
export function effectSummary(relicOrId, level = 1) {
  const mods = relicModsAtLevel(relicOrId, level);
  const parts = [];
  for (const [key, value] of Object.entries(mods)) {
    if (key === 'dmg') {
      for (const [type, amount] of Object.entries(value)) {
        if (amount) parts.push(effectLine('dmg', amount, type));
      }
    } else if (typeof value === 'number' && value !== 0) {
      parts.push(effectLine(key, value));
    }
  }
  return parts.join(t('codex.effectJoiner'));
}

function rarityName(rarity) {
  return tOr(`codex.rarity.${rarity}`, RARITY[rarity]?.name || rarity);
}

function setName(setId) {
  return tOr(`codex.set.${setId}`, RELIC_SET_BONUSES[setId]?.name || setId);
}

export function filterRelics(relics, { rarity = 'all', set = 'all', query = '', discovered = [] } = {}) {
  const known = discovered instanceof Set ? discovered : new Set(discovered || []);
  const needle = String(query ?? '').trim().toLowerCase();
  return (relics || []).filter((relic) => {
    if (!relic) return false;
    if (rarity !== 'all' && relic.rarity !== rarity) return false;
    if (set === 'none') {
      if (relic.set) return false;
    } else if (set !== 'all' && relic.set !== set) {
      return false;
    }
    if (!needle) return true;
    const haystack = [
      relic.name,
      tOr(`codex.relic.${relic.id}.name`, relic.name),
      rarityName(relic.rarity),
      relic.set ? setName(relic.set) : t('codex.noSet'),
    ];
    // 未收录的条目只按可见信息检索，避免用搜索探测隐藏的效果描述。
    if (known.has(relic.id)) {
      haystack.push(relic.desc, tOr(`codex.relic.${relic.id}.desc`, relic.desc));
    }
    return haystack.filter(Boolean).join(' ').toLowerCase().includes(needle);
  });
}

export function groupByRarity(relics) {
  return RARITY_ORDER.map((rarity) => ({
    rarity,
    name: rarityName(rarity),
    items: (relics || []).filter((relic) => relic.rarity === rarity),
  })).filter((group) => group.items.length > 0);
}

export function renderRelicCard(relic, known) {
  const rarity = RARITY[relic.rarity] ? relic.rarity : 'common';
  const name = tOr(`codex.relic.${relic.id}.name`, relic.name);
  const setTag = relic.set
    ? `<span class="codex-set">${escapeHtml(setName(relic.set))}</span>`
    : '';
  const head = `
    <header>
      <h3>${escapeHtml(name)}</h3>
      <span class="codex-rarity">${escapeHtml(rarityName(rarity))}</span>
      ${setTag}
    </header>`;
  if (!known) {
    return `
      <article class="codex-card rarity-${rarity}" data-relic-id="${escapeHtml(relic.id)}" data-known="false">
        ${head}
        <p class="codex-desc">${escapeHtml(t('codex.unknownEffects'))}</p>
      </article>`;
  }
  const desc = tOr(`codex.relic.${relic.id}.desc`, relic.desc);
  const levels = [1, 2, 3]
    .map(
      (level) => `
        <li>
          <span class="codex-level">${escapeHtml(RELIC_LEVEL_LABELS[level - 1])}</span>
          <span>${escapeHtml(effectSummary(relic.id, level))}</span>
        </li>`
    )
    .join('');
  return `
    <article class="codex-card rarity-${rarity}" data-relic-id="${escapeHtml(relic.id)}" data-known="true">
      ${head}
      <p class="codex-desc">${escapeHtml(desc)}</p>
      <ul class="codex-levels">${levels}</ul>
    </article>`;
}

// 图鉴主体：筛选 + 按稀有度分组 + 未知条目遮罩。
export function renderCodex({ relics = RELICS, discovered = [], filters = {} } = {}) {
  const known = discovered instanceof Set ? discovered : new Set(discovered || []);
  const list = filterRelics(relics, { ...filters, discovered: known });
  const knownCount = (relics || []).filter((relic) => known.has(relic.id)).length;
  const progressText = t('codex.progress', { known: knownCount, total: (relics || []).length });
  const body = list.length
    ? groupByRarity(list)
        .map(
          (group) => `
            <section class="codex-group" data-rarity="${group.rarity}">
              <h3 class="codex-group-title">${escapeHtml(group.name)} · ${group.items.length}</h3>
              <div class="codex-grid">
                ${group.items.map((relic) => renderRelicCard(relic, known.has(relic.id))).join('')}
              </div>
            </section>`
        )
        .join('')
    : `<p class="codex-empty">${escapeHtml(t('codex.empty'))}</p>`;
  return { progressText, body };
}

// ---------- 浏览器接线 ----------

function readStoredIds(storage = storageOf()) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    return relicIdsOf(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

function persistDiscovered(ids, storage = storageOf()) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* 存储不可用时本次仍展示推导结果 */
  }
}

function readSnapshot(storage = storageOf()) {
  try {
    const raw = storage?.getItem(SNAPSHOT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { credentials: 'same-origin' });
  const data = await response.json().catch(() => null);
  if (response.status === 401) {
    const error = new Error(t('codex.login'));
    error.code = 'unauthenticated';
    throw error;
  }
  if (!response.ok) throw new Error(data?.error || t('codex.error'));
  return data;
}

// 只读既有接口：最近 10 局结算 + 当前对局；任何单局读取失败都不影响整体图鉴。
async function loadSources() {
  const profile = await fetchJson('/api/profile');
  const stats = await fetchJson('/api/stats');
  const active = await fetchJson('/api/runs/active').catch(() => null);
  const recent = Array.isArray(stats?.recent) ? stats.recent.slice(0, HISTORY_LIMIT) : [];
  const runs = await Promise.all(
    recent.map((run) =>
      fetchJson(`/api/runs/${encodeURIComponent(run.id)}`)
        .then((data) => data?.run || null)
        .catch(() => null)
    )
  );
  return {
    unlocks: Array.isArray(profile?.profile?.unlocks) ? profile.profile.unlocks : [],
    activeRun: active?.run || null,
    runs: runs.filter(Boolean),
  };
}

function ensureStyle() {
  if (document.getElementById('relic-codex-style')) return;
  const style = document.createElement('style');
  style.id = 'relic-codex-style';
  style.textContent = STYLE;
  document.head.appendChild(style);
}

function optionList(options, selected) {
  return options
    .map(
      ({ value, label }) =>
        `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`
    )
    .join('');
}

function renderShell(panel, state) {
  const rarityOptions = [
    { value: 'all', label: t('codex.all') },
    ...RARITY_ORDER.map((id) => ({ value: id, label: rarityName(id) })),
  ];
  const setOptions = [
    { value: 'all', label: t('codex.all') },
    { value: 'none', label: t('codex.noSet') },
    ...SET_ORDER.map((id) => ({ value: id, label: setName(id) })),
  ];
  panel.innerHTML = `
    <div class="codex-head">
      <h2>${escapeHtml(t('codex.title'))}</h2>
      <span id="codex-progress" class="codex-progress" role="status">${escapeHtml(
        t('codex.progress', { known: state.discovered.size, total: RELICS.length })
      )}</span>
      <button id="btn-relic-codex-close" class="icon-btn" type="button" title="${escapeHtml(
        t('codex.close')
      )}" aria-label="${escapeHtml(t('codex.close'))}">${iconSvg('close')}</button>
    </div>
    <p class="codex-subtitle">${escapeHtml(t('codex.subtitle'))}</p>
    <div class="codex-filters">
      <label>${escapeHtml(t('codex.filterRarity'))}
        <select id="codex-rarity">${optionList(rarityOptions, state.filters.rarity)}</select>
      </label>
      <label>${escapeHtml(t('codex.filterSet'))}
        <select id="codex-set">${optionList(setOptions, state.filters.set)}</select>
      </label>
      <label>${escapeHtml(t('codex.search'))}
        <input id="codex-search" type="search" value="${escapeHtml(
          state.filters.query
        )}" placeholder="${escapeHtml(t('codex.searchPlaceholder'))}" />
      </label>
    </div>
    <div id="${LIST_ID}" class="codex-list"></div>`;
}

function renderList(panel, state) {
  const list = panel.querySelector(`#${LIST_ID}`);
  if (!list) return;
  const { progressText, body } = renderCodex({
    relics: RELICS,
    discovered: state.discovered,
    filters: state.filters,
  });
  const progressNode = panel.querySelector('#codex-progress');
  if (progressNode) progressNode.textContent = progressText;
  list.innerHTML = body;
}

function bindControls(panel, state) {
  panel.querySelector('#codex-rarity')?.addEventListener('change', (event) => {
    state.filters.rarity = event.target.value;
    renderList(panel, state);
  });
  panel.querySelector('#codex-set')?.addEventListener('change', (event) => {
    state.filters.set = event.target.value;
    renderList(panel, state);
  });
  panel.querySelector('#codex-search')?.addEventListener('input', (event) => {
    state.filters.query = event.target.value;
    renderList(panel, state);
  });
}

function build(panel, state, onClose) {
  renderShell(panel, state);
  bindControls(panel, state);
  renderList(panel, state);
  panel.querySelector('#btn-relic-codex-close')?.addEventListener('click', onClose);
}

export function createCodexState() {
  return {
    discovered: new Set(),
    filters: { rarity: 'all', set: 'all', query: '' },
  };
}

async function load(panel, state) {
  const list = panel.querySelector(`#${LIST_ID}`);
  if (list) list.innerHTML = `<p class="codex-hint">${escapeHtml(t('codex.loading'))}</p>`;
  try {
    const sources = await loadSources();
    const ids = collectDiscovered({
      ...sources,
      snapshot: readSnapshot(),
      stored: readStoredIds(),
    });
    state.discovered = new Set(ids);
    persistDiscovered(ids);
    renderList(panel, state);
  } catch (error) {
    if (error?.code === 'unauthenticated') {
      state.discovered = new Set();
      renderList(panel, state);
      const hint = document.createElement('p');
      hint.className = 'codex-hint';
      hint.textContent = t('codex.login');
      panel.querySelector(`#${LIST_ID}`)?.prepend(hint);
      return;
    }
    if (list) {
      list.innerHTML = `<p class="codex-hint">${escapeHtml(error?.message || t('codex.error'))}</p>`;
    }
  }
}

let installed = false;

export function install() {
  if (installed) return;
  const panel = document.getElementById(PANEL_ID);
  const trigger = document.getElementById('btn-relic-codex');
  if (!panel || !trigger) return;
  installed = true;
  ensureStyle();

  const state = createCodexState();
  const setOpen = (open) => {
    panel.hidden = !open;
    if (open) load(panel, state);
  };
  const close = () => setOpen(false);

  build(panel, state, close);
  trigger.addEventListener('click', () => setOpen(panel.hidden));
  document.addEventListener('i18n:change', () => {
    if (panel.hidden) return;
    build(panel, state, close);
    load(panel, state);
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
}
