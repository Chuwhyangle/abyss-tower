// 每日挑战历史面板：回看最近 14 天的日期、种子摘要、词缀与本人最佳成绩。
import { MODIFIER_BY_ID } from './shared/mapgen.js';
import { iconSvg } from './render/canvas-shapes.js';
import { t, tData } from './i18n.js';
import { api } from './api.js';
import { escapeHtml } from './ui/kit/dom.js';
import { createPanel } from './ui/kit/panel.js';
import { fmt } from './ui/shared.js';

const PANEL_ID = 'daily-history-panel';
const STYLE_ID = 'daily-history-ui-style';
const TRIGGER_ID = 'btn-daily-history';
const HISTORY_DAYS = 14;

const STYLE = `
  #${PANEL_ID} {
    margin-top: 18px;
    padding: 18px 20px;
    border: 1px solid var(--line, #22333f);
    border-radius: var(--radius, 16px);
    background: rgba(13, 21, 27, 0.94);
    text-align: left;
  }
  #${PANEL_ID}[hidden] { display: none; }
  .dh-head {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }
  .dh-head h2 {
    margin: 0;
    font-size: 18px;
    letter-spacing: 0.04em;
  }
  .dh-head .icon-btn { margin-left: auto; }
  .dh-summary { font-size: 12px; color: var(--muted, #8fa3b2); }
  .dh-list {
    max-height: 336px;
    overflow-y: auto;
    border-top: 1px solid rgba(120, 160, 175, 0.12);
  }
  .dh-row {
    display: grid;
    grid-template-columns: 92px 1fr auto;
    align-items: center;
    gap: 10px;
    padding: 9px 6px;
    border-bottom: 1px solid rgba(120, 160, 175, 0.1);
    font-size: 13px;
  }
  .dh-row.today { background: rgba(255, 211, 107, 0.08); border-radius: 8px; }
  .dh-day { font-family: var(--font-mono, monospace); color: var(--muted, #8fa3b2); }
  .dh-day b { color: var(--gold, #ffd36b); font-weight: 600; }
  .dh-mods { display: flex; flex-wrap: wrap; gap: 5px; min-width: 0; }
  .dh-mod {
    font-size: 10px;
    letter-spacing: 0.06em;
    padding: 2px 7px;
    border: 1px solid currentColor;
    border-radius: 999px;
    opacity: 0.9;
    white-space: nowrap;
  }
  .dh-score { text-align: right; font-family: var(--font-mono, monospace); }
  .dh-score small { display: block; color: var(--muted, #8fa3b2); font-size: 10.5px; }
  .dh-idle { color: var(--muted, #8fa3b2); font-family: var(--font-mono, monospace); }
  .dh-hint { padding: 18px 4px; text-align: center; color: var(--muted, #8fa3b2); font-size: 13px; }
  @media (max-width: 560px) {
    .dh-row { grid-template-columns: minmax(0, 1fr) auto; }
    .dh-mods { grid-column: 1 / -1; }
  }
`;

function buildShell() {
  return `
    <div class="dh-head">
      <h2>${t('dailyHistory.title')}</h2>
      <span id="dh-summary" class="dh-summary"></span>
      <button id="dh-close" class="icon-btn" data-panel-close type="button" title="${t('dailyHistory.closeTitle')}">${iconSvg('close')}</button>
    </div>
    <div id="dh-list" class="dh-list"><p class="dh-hint">${t('dailyHistory.loading')}</p></div>
  `;
}

function modifierChips(ids) {
  const list = Array.isArray(ids) ? ids : [];
  if (!list.length) return '<span class="dh-idle">—</span>';
  return list
    .map((id) => {
      const modifier = MODIFIER_BY_ID[id];
      const name = modifier ? tData('modifier', id, 'name', modifier.name) : id;
      const color = modifier?.color || 'var(--muted, #8fa3b2)';
      return `<span class="dh-mod" style="color:${escapeHtml(color)}">${escapeHtml(name)}</span>`;
    })
    .join('');
}

function renderRows(panel, data) {
  const list = panel.querySelector('#dh-list');
  const summary = panel.querySelector('#dh-summary');
  const history = Array.isArray(data.history) ? data.history : [];
  const played = history.filter((entry) => entry.played).length;
  summary.textContent = t('dailyHistory.summary', {
    days: history.length,
    played,
  });

  if (!history.length) {
    list.innerHTML = `<p class="dh-hint">${t('dailyHistory.empty')}</p>`;
    return;
  }

  list.innerHTML = history
    .map((entry) => {
      const isToday = entry.day === data.today;
      const score = entry.played
        ? `<span class="dh-score">${fmt(entry.bestScore)}<small>${t(
            'dailyHistory.bestScore',
            { attempts: entry.attempts }
          )}</small></span>`
        : `<span class="dh-idle">${t('dailyHistory.idle')}</span>`;
      return `
        <div class="dh-row ${isToday ? 'today' : ''}">
          <span class="dh-day"><b>${escapeHtml(entry.day)}</b>${isToday ? t('dailyHistory.today') : ''}</span>
          <span class="dh-mods">${modifierChips(entry.modifiers)}</span>
          ${score}
        </div>`;
    })
    .join('');
}

function showLoading(panel) {
  panel.querySelector('#dh-list').innerHTML = `<p class="dh-hint">${t('dailyHistory.loading')}</p>`;
}

function showFailure(panel, error) {
  const list = panel.querySelector('#dh-list');
  if (!list) return;
  if (error?.status === 401) {
    const summary = panel.querySelector('#dh-summary');
    if (summary) summary.textContent = '';
    list.innerHTML = `<p class="dh-hint">${t('dailyHistory.login')}</p>`;
    return;
  }
  list.innerHTML = `<p class="dh-hint">${escapeHtml(
    error?.message || t('dailyHistory.error')
  )}</p>`;
}

function loadHistory() {
  return api.request(`/api/daily/history?days=${HISTORY_DAYS}`);
}

function install() {
  const panel = document.getElementById(PANEL_ID);
  const trigger = document.getElementById(TRIGGER_ID);
  if (!panel || !trigger) return;
  createPanel({
    id: PANEL_ID,
    trigger,
    style: STYLE,
    styleId: STYLE_ID,
    html: buildShell(),
    load: loadHistory,
    render: (node, data) => renderRows(node, data),
    loading: showLoading,
    failed: showFailure,
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', install, { once: true });
} else {
  install();
}
