// 大厅成就面板：只读取服务端判定的结果，不在客户端做任何解锁判断。
// 视觉样式统一放在 public/styles.css，使用 V21-007 的设计令牌。
import { t, tOr } from './i18n.js';
import { iconSvg } from './render/canvas-shapes.js';

function progressBar(item) {
  const progress = item.progress;
  if (!progress || !progress.target) return '';
  const current = Math.max(0, Math.min(progress.target, Number(progress.current) || 0));
  const pct = Math.round((current / progress.target) * 100);
  return `
    <div class="achievement-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="${progress.target}" aria-valuenow="${current}">
      <span class="achievement-progress-fill" style="width:${pct}%"></span>
    </div>
    <div class="achievement-progress-label">${current} / ${progress.target}</div>`;
}

function card(item) {
  const masked = item.hidden && !item.unlocked;
  const rarity = ['common', 'rare', 'epic'].includes(item.rarity) ? item.rarity : 'common';
  const rarityName = tOr(`achievement.rarity.${rarity}.name`, item.rarityName || rarity);
  const title = tOr(`achievement.${item.id}.title`, item.title);
  const desc = tOr(`achievement.${item.id}.desc`, item.desc);
  const condition = tOr(`achievement.${item.id}.condition`, item.condition);
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
          <span class="achievement-rarity">${escapeHtml(rarityName)}</span>
          <span class="achievement-state">${t('achievements.locked')}</span>
        </h3>
        <p>${t('achievements.hiddenHint')}</p>
      </article>`;
  }
  return `
    <article class="${classes}">
      <h3>
        <span>${escapeHtml(title)}</span>
        <span class="achievement-rarity">${escapeHtml(rarityName)}</span>
        <span class="achievement-state">${t(item.unlocked ? 'achievements.unlocked' : 'achievements.locked')}</span>
      </h3>
      <p>${escapeHtml(desc)}</p>
      <p>${t('achievements.condition', { text: escapeHtml(condition) })}</p>
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
      const groupName = tOr(`achievement.group.${group.id}.name`, group.name);
      const unlocked = groupItems.filter((item) => item.unlocked).length;
      const total = groupItems.length;
      const pct = total ? Math.round((unlocked / total) * 100) : 0;
      return `
        <section class="achievement-group" data-group="${escapeHtml(group.id)}">
          <div class="achievement-group-head">
            <h3 class="achievement-group-title">${escapeHtml(groupName)}<span class="achievement-group-count">${unlocked} / ${total}</span></h3>
            <div class="achievement-group-meter" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${unlocked}">
              <span style="width:${pct}%"></span>
            </div>
          </div>
          <div class="achievement-group-grid">${groupItems.map(card).join('')}</div>
        </section>`;
    })
    .join('');
}

// 赛季区块与普通分组共用卡片/进度条结构，只是标题由服务端赛季 id 派生。
function seasonSection(title, items, { history = false } = {}) {
  if (!items.length) return '';
  const unlocked = items.filter((item) => item.unlocked).length;
  const total = items.length;
  const pct = total ? Math.round((unlocked / total) * 100) : 0;
  return `
    <section class="achievement-group${history ? ' achievement-group-history' : ''}" data-group="${history ? 'season-history' : 'season'}">
      <div class="achievement-group-head">
        <h3 class="achievement-group-title">${escapeHtml(title)}<span class="achievement-group-count">${unlocked} / ${total}</span></h3>
        <div class="achievement-group-meter" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${unlocked}">
          <span style="width:${pct}%"></span>
        </div>
      </div>
      <div class="achievement-group-grid">${items.map(card).join('')}</div>
    </section>`;
}

function seasonalSections(data) {
  const seasonal = data?.seasonal;
  const current = Array.isArray(seasonal?.achievements) ? seasonal.achievements : [];
  const history = Array.isArray(data?.seasonalHistory) ? data.seasonalHistory : [];
  const currentBlock = seasonSection(
    tOr('achievements.seasonCurrent', '本赛季 · {season}', { season: seasonal?.season || '' }),
    current
  );
  const historyBlock = history
    .map((entry) =>
      seasonSection(
        tOr('achievements.seasonHistory', '荣誉赛季 · {season}', { season: entry.season }),
        Array.isArray(entry.achievements) ? entry.achievements : [],
        { history: true }
      )
    )
    .join('');
  return currentBlock + historyBlock;
}

function emptyState(message) {
  return `
    <div class="panel-empty" role="status">
      <span class="panel-empty-glyph" aria-hidden="true">${iconSvg('empty')}</span>
      <p class="panel-empty-title">${escapeHtml(message)}</p>
    </div>`;
}

function render(panel, data) {
  const list = panel.querySelector('#achievements-list');
  const progress = panel.querySelector('#achievements-progress');
  const items = Array.isArray(data?.achievements) ? data.achievements : [];
  const unlockedCount = items.filter((item) => item.unlocked).length;
  progress.textContent = `${unlockedCount} / ${items.length}`;
  if (!items.length) {
    list.innerHTML = emptyState(t('achievements.empty'));
    return;
  }

  const banner =
    unlockedCount === items.length
      ? `<div class="achievement-complete-banner">${t('achievements.completeBanner')}</div>`
      : '';
  list.innerHTML = banner + seasonalSections(data) + groupSections(data, items);
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
      list.innerHTML = emptyState(t('achievements.login'));
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
  const close = panel.querySelector('#btn-achievements-close');

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
