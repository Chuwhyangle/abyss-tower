// 大厅通知中心：顶部铃铛展示未读数，面板列出最近通知并支持一键全部已读。
// 通知内容完全由服务端生成，客户端只负责展示与标记已读。

const KIND_LABELS = {
  achievement: '成就解锁',
  bounty: '悬赏奖励',
  season: '赛季奖励',
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTime(ts) {
  const value = Number(ts);
  if (!Number.isFinite(value) || value <= 0) return '';
  try {
    return new Date(value).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function describe(item) {
  const payload = item?.payload || {};
  if (item.kind === 'achievement') {
    return `解锁成就「${payload.title || payload.achievementId || '未知成就'}」`;
  }
  if (item.kind === 'bounty') {
    const reward = Number(payload.reward) || 0;
    return `悬赏「${payload.title || payload.bountyId || '未知目标'}」完成，获得 ${reward} 星核`;
  }
  if (item.kind === 'season') {
    const rank = Number(payload.rank) || 0;
    const cores = Number(payload.cores) || 0;
    return `赛季 ${payload.season || ''} 结算：第 ${rank} 名，获得 ${cores} 星核`;
  }
  return '收到一条新通知';
}

function notificationCard(item) {
  const unread = item.readAt == null;
  const kind = KIND_LABELS[item.kind] || '通知';
  return `
    <article class="achievement-card notification-card${unread ? ' unread' : ''}">
      <h3>
        <span>${escapeHtml(kind)}</span>
        <span class="achievement-rarity">${escapeHtml(formatTime(item.createdAt))}</span>
        <span class="achievement-state">${unread ? '未读' : '已读'}</span>
      </h3>
      <p>${escapeHtml(describe(item))}</p>
    </article>`;
}

function renderEmpty(message) {
  return `
    <div class="panel-empty" role="status">
      <p class="panel-empty-title">${escapeHtml(message)}</p>
    </div>`;
}

function render(panel, data) {
  const list = panel.querySelector('#notifications-list');
  const count = panel.querySelector('#notifications-count');
  const readAll = panel.querySelector('#btn-notifications-read');
  const items = Array.isArray(data?.items) ? data.items : [];
  const unread = Math.max(0, Number(data?.unread) || 0);
  if (count) count.textContent = unread ? `${unread} 条未读` : '全部已读';
  if (readAll) readAll.disabled = unread === 0;
  if (!items.length) {
    list.innerHTML = renderEmpty('暂无通知');
    return;
  }
  list.innerHTML = items.map(notificationCard).join('');
}

function updateBadge(unread) {
  const badge = document.getElementById('notifications-badge');
  if (!badge) return;
  const count = Math.max(0, Number(unread) || 0);
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.hidden = count === 0;
}

async function fetchSummary() {
  const response = await fetch('/api/notifications', { credentials: 'same-origin' });
  if (response.status === 401) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || '加载失败');
  return data;
}

async function refreshBadge() {
  try {
    const data = await fetchSummary();
    updateBadge(data?.unread ?? 0);
  } catch {
    // 未读数只是提示，网络失败时保持原状，不影响大厅其它功能。
  }
}

async function load(panel) {
  const list = panel.querySelector('#notifications-list');
  list.innerHTML = '<p class="achievement-hint">加载中…</p>';
  try {
    const data = await fetchSummary();
    if (!data) {
      updateBadge(0);
      list.innerHTML = renderEmpty('登录后可查看通知');
      return;
    }
    updateBadge(data.unread);
    render(panel, data);
  } catch (error) {
    list.innerHTML = `<p class="achievement-hint">${escapeHtml(error.message || '加载失败')}</p>`;
  }
}

async function markAllRead(panel) {
  const button = panel.querySelector('#btn-notifications-read');
  if (button) button.disabled = true;
  try {
    const response = await fetch('/api/notifications/read', {
      method: 'POST',
      credentials: 'same-origin',
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || '操作失败');
    updateBadge(0);
    await load(panel);
  } catch (error) {
    const list = panel.querySelector('#notifications-list');
    const note = document.createElement('p');
    note.className = 'achievement-hint';
    note.textContent = error.message || '操作失败';
    list.prepend(note);
    if (button) button.disabled = false;
  }
}

function install() {
  const button = document.getElementById('btn-notifications');
  const panel = document.getElementById('notifications-panel');
  if (!button || !panel) return;
  const close = panel.querySelector('#btn-notifications-close');
  const readAll = panel.querySelector('#btn-notifications-read');

  const setOpen = (open) => {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) load(panel);
  };

  button.addEventListener('click', () => setOpen(panel.hidden));
  close?.addEventListener('click', () => setOpen(false));
  readAll?.addEventListener('click', () => markAllRead(panel));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshBadge();
  });

  refreshBadge();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', install, { once: true });
} else {
  install();
}
