// 大厅生涯面板：只展示服务端聚合结果，客户端不做任何统计计算。
import { t } from './i18n.js';

const STYLE_ID = 'stats-ui-style';

const STYLE = `
  .career-panel {
    margin-top: 18px;
    padding: 18px 20px;
    border: 1px solid var(--line, #22333f);
    border-radius: var(--radius, 16px);
    background: rgba(13, 21, 27, 0.92);
    text-align: left;
  }
  .career-head {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }
  .career-head h2 {
    margin: 0;
    font-size: 18px;
    letter-spacing: 0.04em;
  }
  .career-head .icon-btn {
    margin-left: auto;
  }
  .career-totals {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 8px;
    margin-bottom: 14px;
  }
  .career-cell {
    padding: 8px 10px;
    border: 1px solid var(--line, #22333f);
    border-radius: 10px;
    background: rgba(17, 29, 37, 0.65);
  }
  .career-cell span {
    display: block;
    font-size: 12px;
    color: var(--muted, #8fa3b2);
  }
  .career-cell b {
    font-family: var(--font-mono, monospace);
    font-size: 18px;
  }
  .career-subtitle {
    margin: 12px 0 8px;
    font-size: 13px;
    letter-spacing: 0.08em;
    color: var(--muted, #8fa3b2);
  }
  .career-diffs {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 10px;
  }
  .career-diff {
    padding: 10px 12px;
    border: 1px solid var(--line, #22333f);
    border-radius: 10px;
    background: rgba(17, 29, 37, 0.65);
  }
  .career-diff.empty {
    opacity: 0.62;
  }
  .career-diff h3 {
    margin: 0 0 6px;
    font-size: 14px;
  }
  .career-diff dl {
    margin: 0;
    display: grid;
    grid-template-columns: auto auto;
    justify-content: space-between;
    gap: 4px 12px;
    font-size: 12px;
    color: var(--muted, #8fa3b2);
  }
  .career-diff dd {
    margin: 0;
    text-align: right;
    color: var(--text, #e6f0f6);
    font-family: var(--font-mono, monospace);
  }
  .career-recent {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 32vh;
    overflow-y: auto;
  }
  .career-run {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border: 1px solid var(--line, #22333f);
    border-radius: 10px;
    background: rgba(17, 29, 37, 0.65);
    font-size: 13px;
  }
  .career-run .tag {
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 999px;
    border: 1px solid var(--line, #22333f);
    color: var(--muted, #8fa3b2);
  }
  .career-run.win .tag {
    color: var(--green, #6fe0a8);
    border-color: rgba(111, 224, 168, 0.5);
  }
  .career-run small {
    color: var(--muted, #8fa3b2);
    font-family: var(--font-mono, monospace);
  }
  .career-hint {
    padding: 12px 0;
    color: var(--muted, #8fa3b2);
    font-size: 13px;
  }
`;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.appendChild(style);
}

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

function formatDate(timestamp) {
  if (!timestamp) return '—';
  const date = new Date(Number(timestamp));
  if (Number.isNaN(date.getTime())) return '—';
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function renderTotals(totals) {
  return `
    <div class="career-totals">
      <div class="career-cell"><span>${t('career.runs')}</span><b>${totals.runs}</b></div>
      <div class="career-cell"><span>${t('career.wins')}</span><b>${totals.wins}</b></div>
      <div class="career-cell"><span>${t('career.winRate')}</span><b>${percent(totals.winRate)}</b></div>
      <div class="career-cell"><span>${t('career.bestWave')}</span><b>${totals.bestWave}</b></div>
      <div class="career-cell"><span>${t('career.avgWave')}</span><b>${totals.avgWave}</b></div>
      <div class="career-cell"><span>${t('career.bestScore')}</span><b>${totals.bestScore}</b></div>
      <div class="career-cell"><span>${t('career.kills')}</span><b>${totals.kills}</b></div>
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
          <h3>${escapeHtml(item.name)}</h3>
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
  if (!items.length) {
    return `<p class="career-subtitle">${t('career.recent')}</p><p class="career-hint">${t('career.empty')}</p>`;
  }
  return `
    <p class="career-subtitle">${t('career.recent')}</p>
    <div class="career-recent">
      ${items
        .map(
          (item) => `
        <div class="career-run${item.victory ? ' win' : ''}">
          <span class="tag">${t(item.victory ? 'career.win' : 'career.loss')}</span>
          <span>${t('career.runLine', {
            difficulty: escapeHtml(item.difficultyName),
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
  if (!totals.runs) {
    body.innerHTML = `${renderTotals(totals)}${renderDifficulties(data?.byDifficulty || [])}${renderRecent([])}`;
    return;
  }
  body.innerHTML = `${renderTotals(totals)}${renderDifficulties(data.byDifficulty || [])}${renderRecent(data.recent || [])}`;
}

async function load(panel) {
  const body = panel.querySelector('#stats-body');
  body.innerHTML = `<p class="career-hint">${t('career.loading')}</p>`;
  try {
    const response = await fetch('/api/stats', { credentials: 'same-origin' });
    if (response.status === 401) {
      body.innerHTML = `<p class="career-hint">${t('career.login')}</p>`;
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
  ensureStyle();
  const close = panel.querySelector('#btn-stats-close');

  const setOpen = (open) => {
    panel.hidden = !open;
    if (open) load(panel);
  };

  button.addEventListener('click', () => setOpen(panel.hidden));
  close?.addEventListener('click', () => setOpen(false));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', install, { once: true });
} else {
  install();
}
