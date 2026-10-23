// 大厅生涯面板：只展示服务端聚合结果，客户端不做任何统计计算。
// 视觉样式统一放在 public/styles.css，使用 V21-007 的设计令牌。
import { t, tData } from './i18n.js';
import { iconSvg } from './render/canvas-shapes.js';

const RECENT_LIMIT = 10;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function percent(rate) {
  return `${Math.round((Number(rate) || 0) * 100)}%`;
}

function pctValue(rate) {
  return Math.max(0, Math.min(100, Math.round((Number(rate) || 0) * 100)));
}

function formatDate(timestamp) {
  if (!timestamp) return '—';
  const date = new Date(Number(timestamp));
  if (Number.isNaN(date.getTime())) return '—';
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function emptyState(message) {
  return `
    <div class="panel-empty" role="status">
      <span class="panel-empty-glyph" aria-hidden="true">${iconSvg('empty')}</span>
      <p class="panel-empty-title">${escapeHtml(message)}</p>
    </div>`;
}

function statCell(label, value) {
  return `
    <div class="career-cell">
      <span>${label}</span>
      <b>${value}</b>
    </div>`;
}

function meterCell(label, value, rate) {
  const pct = pctValue(rate);
  return `
    <div class="career-cell primary">
      <span>${label}</span>
      <b>${value}</b>
      <div class="career-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}">
        <span style="width:${pct}%"></span>
      </div>
    </div>`;
}

function renderTotals(totals) {
  return `
    <div class="career-totals">
      ${statCell(t('career.runs'), totals.runs)}
      ${meterCell(t('career.winRate'), percent(totals.winRate), totals.winRate)}
      ${statCell(t('career.bestWave'), totals.bestWave)}
      ${statCell(t('career.bestScore'), totals.bestScore)}
      ${statCell(t('career.wins'), totals.wins)}
      ${statCell(t('career.avgWave'), totals.avgWave)}
      ${statCell(t('career.kills'), totals.kills)}
    </div>`;
}

function renderDifficulties(items) {
  return `
    <p class="career-subtitle">${t('career.difficultyDist')}</p>
    <div class="career-diffs">
      ${items
        .map(
          (item) => `
        <article class="career-diff${item.runs ? '' : ' empty'}">
          <h3>${escapeHtml(tData('difficulty', item.id, 'name', item.name))}</h3>
          <div class="career-diff-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pctValue(item.winRate)}">
            <span style="width:${pctValue(item.winRate)}%"></span>
          </div>
          <dl>
            <dt>${t('career.runsLabel')}</dt><dd>${item.runs}</dd>
            <dt>${t('career.winsLabel')}</dt><dd>${item.wins} / ${item.runs}</dd>
            <dt>${t('career.winRateLabel')}</dt><dd>${percent(item.winRate)}</dd>
            <dt>${t('career.bestWaveLabel')}</dt><dd>${item.bestWave}</dd>
          </dl>
        </article>`
        )
        .join('')}
    </div>`;
}

function renderRecent(items) {
  const recent = items.slice(0, RECENT_LIMIT);
  const heading = `<p class="career-subtitle">${t('career.recent')}<span class="career-count">${recent.length}</span></p>`;
  if (!recent.length) {
    return `${heading}${emptyState(t('career.empty'))}`;
  }
  return `
    ${heading}
    <div class="career-recent">
      ${recent
        .map(
          (item) => `
        <div class="career-run${item.victory ? ' win' : ''}">
          <span class="tag">${t(item.victory ? 'career.win' : 'career.loss')}</span>
          <span class="career-run-line">${t('career.runLine', {
            difficulty: escapeHtml(tData('difficulty', item.difficulty, 'name', item.difficultyName)),
            mode: t(item.mode === 'daily' ? 'career.daily' : 'career.standard'),
            wave: item.waveReached,
          })}</span>
          <small>${t('career.scoreLine', { score: item.score, date: formatDate(item.finishedAt) })}</small>
        </div>`
        )
        .join('')}
    </div>`;
}

function render(body, data) {
  const totals = data?.totals || {};
  const byDifficulty = data?.byDifficulty || [];
  const recent = data?.recent || [];
  body.innerHTML = `${renderTotals(totals)}${renderDifficulties(byDifficulty)}${renderRecent(recent)}`;
}

async function load(panel) {
  const body = panel.querySelector('#stats-body');
  body.innerHTML = `<p class="career-hint">${t('career.loading')}</p>`;
  try {
    const response = await fetch('/api/stats', { credentials: 'same-origin' });
    if (response.status === 401) {
      body.innerHTML = emptyState(t('career.login'));
      return;
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || t('career.error'));
    render(body, data);
  } catch (error) {
    body.innerHTML = `<p class="career-hint">${escapeHtml(error.message || t('career.error'))}</p>`;
  }
}

function install() {
  const button = document.getElementById('btn-stats');
  const panel = document.getElementById('stats-panel');
  if (!button || !panel) return;
  const close = panel.querySelector('#btn-stats-close');

  const setOpen = (open) => {
    panel.hidden = !open;
    if (open) load(panel);
  };

  button.addEventListener('click', () => setOpen(panel.hidden));
  close?.addEventListener('click', () => setOpen(false));
  document.addEventListener('i18n:change', () => {
    if (!panel.hidden) load(panel);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', install, { once: true });
} else {
  install();
}
