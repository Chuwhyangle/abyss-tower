// 大厅悬赏面板：只展示服务端派生的目标与进度，领取由服务端幂等判定。
// 视觉沿用成就面板的既有样式，不新增样式表。
const PERIOD_LABELS = { daily: '每日', weekly: '每周', season: '赛季' };

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
    return '<button class="btn small" type="button" disabled>已领取</button>';
  }
  if (!item.complete) {
    return '<button class="btn small" type="button" disabled>未完成</button>';
  }
  return `<button class="btn small primary" type="button" data-claim="${escapeHtml(item.id)}">领取 ${Number(item.reward) || 0} 星核</button>`;
}

function card(item) {
  const state = item.claimed ? '已领取' : item.complete ? '可领取' : '进行中';
  return `
    <article class="achievement-card rarity-common${item.claimed ? ' unlocked' : ''}">
      <h3>
        <span>${escapeHtml(item.title)}</span>
        <span class="achievement-rarity">${escapeHtml(item.tierLabel || '普通')} · ${escapeHtml(state)}</span>
        <span class="achievement-state">${Number(item.reward) || 0} 星核</span>
      </h3>
      <p>${escapeHtml(item.desc)}</p>
      ${progressBar(item)}
      <div class="bounty-actions">${claimButton(item)}</div>
    </article>`;
}

function refreshButton(period, refresh) {
  if (period?.period !== 'weekly') return '';
  const remaining = Math.max(0, Number(refresh?.remaining) || 0);
  if (!remaining) {
    return '<button class="btn small" type="button" disabled>本周已刷新</button>';
  }
  return `<button class="btn small" type="button" data-refresh="1">刷新本周悬赏（剩 ${remaining} 次）</button>`;
}

function periodSection(period, refresh) {
  const bounties = Array.isArray(period?.bounties) ? period.bounties : [];
  if (!bounties.length) return '';
  const label = PERIOD_LABELS[period.period] || period.label || period.period;
  return `
    <section class="achievement-group" data-period="${escapeHtml(period.period)}">
      <div class="achievement-group-head">
        <h3 class="achievement-group-title">${escapeHtml(label)}悬赏
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
    list.innerHTML = '<p class="achievement-hint">暂无悬赏</p>';
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
    const response = await fetch(`/api/bounties/${encodeURIComponent(bountyId)}/claim`, {
      method: 'POST',
      credentials: 'same-origin',
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || '领取失败');
    const cores = document.getElementById('cores');
    if (cores && Number.isFinite(Number(data?.balance))) cores.textContent = String(data.balance);
    await load(panel);
  } catch (error) {
    const note = document.createElement('p');
    note.className = 'achievement-hint';
    note.textContent = escapeHtml(error.message || '领取失败');
    list.prepend(note);
  }
}

async function refreshBoard(panel) {
  if (!window.confirm('刷新会更换本周悬赏目标，每周仅限一次，确认刷新？')) return;
  const list = panel.querySelector('#bounties-list');
  try {
    const response = await fetch('/api/bounties/refresh', {
      method: 'POST',
      credentials: 'same-origin',
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || '刷新失败');
    await load(panel);
  } catch (error) {
    const note = document.createElement('p');
    note.className = 'achievement-hint';
    note.textContent = escapeHtml(error.message || '刷新失败');
    list.prepend(note);
  }
}

async function load(panel) {
  const list = panel.querySelector('#bounties-list');
  list.innerHTML = '<p class="achievement-hint">加载中…</p>';
  try {
    const response = await fetch('/api/bounties', { credentials: 'same-origin' });
    if (response.status === 401) {
      list.innerHTML = '<p class="achievement-hint">登录后可查看悬赏</p>';
      return;
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || '加载失败');
    render(panel, data);
  } catch (error) {
    list.innerHTML = `<p class="achievement-hint">${escapeHtml(error.message || '加载失败')}</p>`;
  }
}

function install() {
  const button = document.getElementById('btn-bounties');
  const panel = document.getElementById('bounties-panel');
  if (!button || !panel) return;
  const close = panel.querySelector('#btn-bounties-close');

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
