// 大厅悬赏面板：只展示服务端派生的目标与进度，领取由服务端幂等判定。
// 视觉沿用成就面板的既有样式，不新增样式表。
import { api } from './api.js';
import { t, tData } from './i18n.js';
import { iconSvg } from './render/canvas-shapes.js';
import { ui } from './ui.js';
import { escapeHtml } from './ui/kit/dom.js';

// 池子条目的 id 形如 `<模板键>` 或 `<模板键>:<档位>`；词典按模板键收录。
function templateKey(item) {
  return String(item?.key || item?.id || '').split(':')[0];
}

function progressBar(item) {
  const target = Math.max(0, Number(item.target) || 0);
  const current = Math.max(0, Math.min(target, Number(item.progress) || 0));
  const pct = target ? Math.round((current / target) * 100) : 0;
  return `
    <div class="achievement-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${current}">
      <span class="achievement-progress-fill" style="width:${pct}%"></span>
    </div>
    <div class="achievement-progress-label">${current} / ${target}</div>`;
}

function claimButton(item) {
  if (item.claimed) {
    return `<button class="btn small" type="button" disabled>${t('bounty.claimed')}</button>`;
  }
  if (!item.complete) {
    return `<button class="btn small" type="button" disabled>${t('bounty.incomplete')}</button>`;
  }
  return `<button class="btn small primary" type="button" data-claim="${escapeHtml(item.id)}">${t(
    'bounty.claimReward',
    { reward: Number(item.reward) || 0 }
  )}</button>`;
}

function card(item) {
  const state = item.claimed
    ? t('bounty.claimed')
    : item.complete
      ? t('bounty.claimable')
      : t('bounty.inProgress');
  const key = templateKey(item);
  const title = tData('bounty', key, 'title', item.title);
  const desc = tData('bounty', key, 'desc', item.desc, { target: item.target });
  const tierLabel = tData('bountyTier', item.tier, 'name', item.tierLabel || '普通');
  return `
    <article class="achievement-card rarity-common${item.claimed ? ' unlocked' : ''}">
      <h3>
        <span>${escapeHtml(title)}</span>
        <span class="achievement-rarity">${escapeHtml(tierLabel)} · ${escapeHtml(state)}</span>
        <span class="achievement-state">${t('bounty.rewardCores', {
          reward: Number(item.reward) || 0,
        })}</span>
      </h3>
      <p>${escapeHtml(desc)}</p>
      ${progressBar(item)}
      <div class="bounty-actions">${claimButton(item)}</div>
    </article>`;
}

function refreshButton(period, refresh) {
  if (period?.period !== 'weekly') return '';
  const remaining = Math.max(0, Number(refresh?.remaining) || 0);
  if (!remaining) {
    return `<button class="btn small" type="button" disabled>${t('bounty.refreshedThisWeek')}</button>`;
  }
  return `<button class="btn small" type="button" data-refresh="1">${t('bounty.refreshWeekly', {
    remaining,
  })}</button>`;
}

function periodSection(period, refresh) {
  const bounties = Array.isArray(period?.bounties) ? period.bounties : [];
  if (!bounties.length) return '';
  const label = tData('bountyPeriod', period.period, 'name', period.label || period.period);
  return `
    <section class="achievement-group" data-period="${escapeHtml(period.period)}">
      <div class="achievement-group-head">
        <h3 class="achievement-group-title">${escapeHtml(label)}
          <span class="achievement-group-count">${Number(period.claimedCount) || 0} / ${bounties.length}</span>
        </h3>
        ${refreshButton(period, refresh)}
      </div>
      <div class="achievement-group-grid">${bounties.map(card).join('')}</div>
    </section>`;
}

function render(panel, data) {
  const list = panel.querySelector('#bounties-list');
  const periods = Array.isArray(data?.periods) ? data.periods : [];
  if (!periods.length) {
    list.innerHTML = `<p class="achievement-hint">${t('bounty.empty')}</p>`;
    return;
  }
  list.innerHTML = periods.map((period) => periodSection(period, data?.refresh)).join('');
  for (const button of list.querySelectorAll('[data-claim]')) {
    button.addEventListener('click', () => claim(panel, button.dataset.claim));
  }
  for (const button of list.querySelectorAll('[data-refresh]')) {
    button.addEventListener('click', () => refreshBoard(panel));
  }
}

async function claim(panel, bountyId) {
  const list = panel.querySelector('#bounties-list');
  try {
    const data = await api.request(`/api/bounties/${encodeURIComponent(bountyId)}/claim`, {
      method: 'POST',
    });
    const cores = document.getElementById('cores');
    if (cores && Number.isFinite(Number(data?.balance))) cores.textContent = String(data.balance);
    await reloadPanel(panel);
  } catch (error) {
    const note = document.createElement('p');
    note.className = 'achievement-hint';
    note.textContent = error?.message || t('bounty.claimFailed');
    list.prepend(note);
  }
}

async function refreshBoard(panel) {
  if (!window.confirm(t('bounty.refreshConfirm'))) return;
  const list = panel.querySelector('#bounties-list');
  try {
    await api.request('/api/bounties/refresh', { method: 'POST' });
    await reloadPanel(panel);
  } catch (error) {
    const note = document.createElement('p');
    note.className = 'achievement-hint';
    note.textContent = error?.message || t('bounty.refreshFailed');
    list.prepend(note);
  }
}

function loadBounties() {
  return api.request('/api/bounties');
}

function showLoading(panel) {
  panel.querySelector('#bounties-list').innerHTML =
    `<p class="achievement-hint">${t('bounty.loading')}</p>`;
}

function showFailure(panel, error) {
  const list = panel.querySelector('#bounties-list');
  if (!list) return;
  if (error?.status === 401) {
    list.innerHTML = `<p class="achievement-hint">${t('bounty.login')}</p>`;
    return;
  }
  list.innerHTML = `<p class="achievement-hint">${escapeHtml(
    error?.message || t('bounty.loadFailed')
  )}</p>`;
}

async function reloadPanel(panel) {
  try {
    const data = await loadBounties();
    render(panel, data);
  } catch (error) {
    showFailure(panel, error);
  }
}

function shell() {
  const closeLabel = t('shell.closeBounties');
  return `
    <div class="achievements-panel bounties-panel">
      <div class="achievements-head">
        <h2>${escapeHtml(t('shell.bountiesTitle'))}</h2>
        <button id="btn-bounties-close" class="icon-btn" type="button" title="${escapeHtml(closeLabel)}" aria-label="${escapeHtml(closeLabel)}">${iconSvg('close')}</button>
      </div>
      <div id="bounties-list" class="achievements-list"></div>
    </div>`;
}

async function populateBounties(modal) {
  modal.innerHTML = shell();
  modal.querySelector('#btn-bounties-close').addEventListener('click', () => ui.closeModal());
  showLoading(modal);
  try {
    const data = await loadBounties();
    render(modal, data);
  } catch (error) {
    showFailure(modal, error);
  }
}

function install() {
  const button = document.getElementById('btn-bounties');
  if (!button) return;

  button.addEventListener('click', () => {
    populateBounties(
      ui.openModal('', {
        className: 'bounties-modal panel-modal',
        closable: true,
      })
    );
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', install, { once: true });
} else {
  install();
}
