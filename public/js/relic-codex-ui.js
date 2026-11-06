// 遗物图鉴：只读共享遗物数据与既有账号接口，客户端不改任何数值与接口。
// “已收录”由最近结算的对局、当前进行中的对局与本机记录合并得出；未收录的条目不渲染效果数值。
// 数据表与已收录推导在 relic-codex-data.js，卡片/列表渲染在 relic-codex-draw.js。
import { t } from './i18n.js';
import { RELICS } from './shared/data.js';
import { collectDiscovered, RARITY_ORDER, SET_ORDER } from './relic-codex-data.js';
import { rarityName, renderCodex, setName } from './relic-codex-draw.js';
import { iconSvg } from './render/canvas-shapes.js';
import { api } from './api.js';
import { escapeHtml } from './ui/kit/dom.js';
import { ui } from './ui.js';

const LIST_ID = 'relic-codex-list';
const HISTORY_LIMIT = 10;
const STORAGE_KEY = 'abyss-tower.relic-codex.v1';
const SNAPSHOT_KEY = 'abyss-tower.snapshot.v2';

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
  .codex-period,
  .codex-set-progress {
    margin: 0 0 6px;
    font-size: 11.5px;
    color: var(--muted, #8fa3b2);
  }
  .codex-period { color: var(--gold, #ffd36b); }
  .codex-levels { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
  .codex-levels li { display: flex; gap: 8px; font-size: 12px; }
  .codex-levels li[data-current='true'] { color: var(--gold, #ffd36b); font-weight: 600; }
  .codex-level {
    flex: 0 0 auto;
    color: var(--gold, #ffd36b);
    font-family: var(--font-mono, monospace);
  }
  .codex-card[data-known='false'] .codex-desc { opacity: 0.55; letter-spacing: 0.2em; }
  .codex-card[data-known='false'] .codex-levels { display: none; }
`;


function storageOf() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
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
  try {
    return await api.request(url);
  } catch (error) {
    if (error?.status === 401) {
      const authError = new Error(t('codex.login'));
      authError.code = 'unauthenticated';
      throw authError;
    }
    throw error;
  }
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
let open = false;
let state = null;

function openCodex() {
  state = state || createCodexState();
  open = true;
  const modal = ui.openModal('', {
    className: 'codex-modal panel-modal',
    closable: true,
    onClose: () => {
      open = false;
    },
  });
  build(modal, state, () => ui.closeModal());
  load(modal, state);
}

export function install() {
  if (installed) return;
  const trigger = document.getElementById('btn-relic-codex');
  if (!trigger) return;
  installed = true;
  ensureStyle();

  trigger.addEventListener('click', openCodex);
  document.addEventListener('i18n:change', () => {
    if (!open) return;
    const modal = document.querySelector('.codex-modal');
    if (!modal) return;
    build(modal, state, () => ui.closeModal());
    load(modal, state);
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
}
