// 大厅成就面板：只读取服务端判定的结果，不在客户端做任何解锁判断。
import { t } from './i18n.js';

const STYLE_ID = 'achievements-ui-style';

const STYLE = `
  .achievements-panel {
    margin-top: 18px;
    padding: 18px 20px;
    border: 1px solid var(--line, #22333f);
    border-radius: var(--radius, 16px);
    background: rgba(13, 21, 27, 0.92);
    text-align: left;
  }
  .achievements-head {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }
  .achievements-head h2 {
    margin: 0;
    font-size: 18px;
    letter-spacing: 0.04em;
  }
  .achievements-progress {
    margin-left: auto;
    color: var(--muted, #8fa3b2);
    font-family: var(--font-mono, monospace);
    font-size: 13px;
  }
  .achievements-list {
    max-height: 46vh;
    overflow-y: auto;
  }
  .achievement-group + .achievement-group {
    margin-top: 14px;
  }
  .achievement-group-title {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 0 0 8px;
    font-size: 13px;
    letter-spacing: 0.08em;
    color: var(--muted, #8fa3b2);
  }
  .achievement-group-title span {
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    opacity: 0.8;
  }
  .achievement-group-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 10px;
  }
  .achievement-card {
    --rarity-color: #9fb0c3;
    padding: 10px 12px;
    border: 1px solid var(--line, #22333f);
    border-left: 3px solid var(--rarity-color);
    border-radius: 10px;
    background: rgba(17, 29, 37, 0.65);
    opacity: 0.62;
  }
  .achievement-card.rarity-rare { --rarity-color: #5bc8ff; }
  .achievement-card.rarity-epic { --rarity-color: #c88bff; }
  .achievement-card.unlocked {
    opacity: 1;
    border-color: rgba(111, 224, 168, 0.55);
    border-left-color: var(--rarity-color);
    box-shadow: inset 0 0 0 1px rgba(111, 224, 168, 0.12);
  }
  .achievement-card.hidden-card {
    border-left-style: dashed;
    background: repeating-linear-gradient(
      135deg,
      rgba(17, 29, 37, 0.75),
      rgba(17, 29, 37, 0.75) 8px,
      rgba(25, 39, 49, 0.75) 8px,
      rgba(25, 39, 49, 0.75) 16px
    );
  }
  .achievement-card h3 {
    margin: 0 0 4px;
    font-size: 14px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .achievement-rarity {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 999px;
    border: 1px solid var(--rarity-color);
    color: var(--rarity-color);
  }
  .achievement-state {
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 999px;
    border: 1px solid var(--line, #22333f);
    color: var(--muted, #8fa3b2);
    margin-left: auto;
  }
  .achievement-card.unlocked .achievement-state {
    color: var(--green, #6fe0a8);
    border-color: rgba(111, 224, 168, 0.5);
  }
  .achievement-card p {
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--muted, #8fa3b2);
  }
  .achievement-progress-track {
    height: 5px;
    margin: 8px 0 3px;
    border-radius: 999px;
    background: rgba(143, 163, 178, 0.18);
    overflow: hidden;
  }
  .achievement-progress-fill {
    display: block;
    height: 100%;
    border-radius: 999px;
    background: var(--rarity-color);
  }
  .achievement-progress-label {
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    color: var(--muted, #8fa3b2);
  }
  .achievement-hint {
    padding: 12px 0;
    color: var(--muted, #8fa3b2);
    font-size: 13px;
  }
  .achievement-complete-banner {
    margin-bottom: 10px;
    padding: 8px 12px;
    border: 1px solid rgba(111, 224, 168, 0.45);
    border-radius: 10px;
    color: var(--green, #6fe0a8);
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

function progressBar(item) {
  const progress = item.progress;
  if (!progress || !progress.target) return '';
  const current = Math.max(0, Math.min(progress.target, Number(progress.current) || 0));
  const pct = Math.round((current / progress.target) * 100);
  return `
    <div class="achievement-progress-track"><span class="achievement-progress-fill" style="width:${pct}%"></span></div>
    <div class="achievement-progress-label">${current} / ${progress.target}</div>`;
}

function card(item) {
  const masked = item.hidden && !item.unlocked;
  const rarity = ['common', 'rare', 'epic'].includes(item.rarity) ? item.rarity : 'common';
  const classes = [
    'achievement-card',
    `rarity-${rarity}`,
    item.unlocked ? 'unlocked' : '',
    masked ? 'hidden-card' : '',
  ]
    .filter(Boolean)
    .join(' ');
  if (masked) {
    return `
      <article class="${classes}">
        <h3>
          <span>${t('achievements.hidden')}</span>
          <span class="achievement-rarity">${escapeHtml(item.rarityName || rarity)}</span>
          <span class="achievement-state">${t('achievements.locked')}</span>
        </h3>
        <p>${t('achievements.hiddenHint')}</p>
      </article>`;
  }
  return `
    <article class="${classes}">
      <h3>
        <span>${escapeHtml(item.title)}</span>
        <span class="achievement-rarity">${escapeHtml(item.rarityName || rarity)}</span>
        <span class="achievement-state">${t(item.unlocked ? 'achievements.unlocked' : 'achievements.locked')}</span>
      </h3>
      <p>${escapeHtml(item.desc)}</p>
      <p>${t('achievements.condition', { text: escapeHtml(item.condition) })}</p>
      ${progressBar(item)}
    </article>`;
}

function groupSections(data, items) {
  const groups = Array.isArray(data?.groups) && data.groups.length
    ? data.groups
    : [{ id: 'all', name: t('achievements.all'), total: items.length, unlocked: items.filter((i) => i.unlocked).length }];
  return groups
    .map((group) => {
      const groupItems = items.filter((item) => (group.id === 'all' ? true : item.group === group.id));
      if (!groupItems.length) return '';
      return `
        <section class="achievement-group">
          <h3 class="achievement-group-title">${escapeHtml(group.name)}<span>${group.unlocked} / ${group.total}</span></h3>
          <div class="achievement-group-grid">${groupItems.map(card).join('')}</div>
        </section>`;
    })
    .join('');
}

function render(panel, data) {
  const list = panel.querySelector('#achievements-list');
  const progress = panel.querySelector('#achievements-progress');
  const items = Array.isArray(data?.achievements) ? data.achievements : [];
  const unlockedCount = items.filter((item) => item.unlocked).length;
  progress.textContent = `${unlockedCount} / ${items.length}`;
  if (!items.length) {
    list.innerHTML = `<p class="achievement-hint">${t('achievements.empty')}</p>`;
    return;
  }

  const banner =
    unlockedCount === items.length
      ? `<div class="achievement-complete-banner">${t('achievements.completeBanner')}</div>`
      : '';
  list.innerHTML = banner + groupSections(data, items);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function load(panel) {
  const list = panel.querySelector('#achievements-list');
  list.innerHTML = `<p class="achievement-hint">${t('achievements.loading')}</p>`;
  try {
    const response = await fetch('/api/achievements', { credentials: 'same-origin' });
    if (response.status === 401) {
      list.innerHTML = `<p class="achievement-hint">${t('achievements.login')}</p>`;
      return;
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || t('achievements.error'));
    render(panel, data);
  } catch (error) {
    list.innerHTML = `<p class="achievement-hint">${escapeHtml(error.message || t('achievements.error'))}</p>`;
  }
}

function install() {
  const button = document.getElementById('btn-achievements');
  const panel = document.getElementById('achievements-panel');
  if (!button || !panel) return;
  ensureStyle();
  const close = panel.querySelector('#btn-achievements-close');

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
