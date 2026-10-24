// 大厅通知中心：顶部铃铛展示未读数，面板列出最近通知并支持一键全部已读。
// 通知内容完全由服务端生成，客户端只负责展示与标记已读。

const KIND_LABELS = {
  achievement: '成就解锁',
  bounty: '悬赏奖励',
  season: '赛季奖励',
};

// 通知偏好开关：中英双语标签，关闭后服务端不再写入新的未读。
const PREFS = [
  { key: 'achievement', zh: '成就通知', en: 'Achievements' },
  { key: 'bounty', zh: '悬赏通知', en: 'Bounties' },
  { key: 'season', zh: '赛季通知', en: 'Season' },
];
const PREFS_TITLE = '通知偏好 / Notification preferences';
const PREFS_HINT = '关闭后不再产生新的未读，历史通知仍然保留。 / Turning a type off stops new unread items; history is kept.';
const PREFS_SAVED = '已保存 / Saved';
const PREFS_ERROR = '保存失败 / Save failed';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 通知时间格式化：非法或缺失时间戳返回空串，由卡片留空（纯函数）。
export function formatTime(ts) {
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

// 通知正文：按服务端 kind 生成文案，未知 kind 回落到通用提示（纯函数）。
export function describeNotification(item) {
  const payload = item?.payload || {};
  if (item?.kind === 'achievement') {
    return `解锁成就「${payload.title || payload.achievementId || '未知成就'}」`;
  }
  if (item?.kind === 'bounty') {
    const reward = Number(payload.reward) || 0;
    return `悬赏「${payload.title || payload.bountyId || '未知目标'}」完成，获得 ${reward} 星核`;
  }
  if (item?.kind === 'season') {
    const rank = Number(payload.rank) || 0;
    const cores = Number(payload.cores) || 0;
    return `赛季 ${payload.season || ''} 结算：第 ${rank} 名，获得 ${cores} 星核`;
  }
  return '收到一条新通知';
}

// 未读数归一化：负数、非法值与缺失一律按 0 处理（纯函数）。
export function normalizeUnread(value) {
  return Math.max(0, Number(value) || 0);
}

// 铃铛徽标文案：超过 99 显示 99+，其余显示原数（纯函数）。
export function unreadBadgeText(value) {
  const count = normalizeUnread(value);
  return count > 99 ? '99+' : String(count);
}

// 面板未读摘要：0 显示「全部已读」，其余显示「N 条未读」（纯函数）。
export function unreadSummaryText(value) {
  const count = normalizeUnread(value);
  return count ? `${count} 条未读` : '全部已读';
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
      <p>${escapeHtml(describeNotification(item))}</p>
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
  const unread = normalizeUnread(data?.unread);
  if (count) count.textContent = unreadSummaryText(unread);
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
  const count = normalizeUnread(unread);
  badge.textContent = unreadBadgeText(count);
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

// 偏好区由脚本创建，避免依赖 index.html 的静态标记；响应式网格同时适配大小屏。
function ensurePrefsSection(panel) {
  let section = panel.querySelector('#notifications-prefs');
  if (section) return section;
  section = document.createElement('section');
  section.id = 'notifications-prefs';
  section.className = 'notifications-prefs';
  section.innerHTML = `
    <p class="achievement-hint">${escapeHtml(PREFS_TITLE)}</p>
    <p class="achievement-hint">${escapeHtml(PREFS_HINT)}</p>
    <div class="settings-grid" style="grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); margin-top: 0;">
      ${PREFS.map(
        (pref) => `
        <label class="setting-check">
          <input type="checkbox" data-notification-pref="${pref.key}" checked />
          <span>${escapeHtml(pref.zh)} / ${escapeHtml(pref.en)}</span>
        </label>`
      ).join('')}
    </div>
    <p class="achievement-hint" id="notifications-prefs-status" role="status"></p>`;
  section.addEventListener('change', (event) => {
    if (event.target?.dataset?.notificationPref) savePrefs(section);
  });
  const list = panel.querySelector('#notifications-list');
  if (list) panel.insertBefore(section, list);
  else panel.append(section);
  return section;
}

function applyPrefs(section, prefs) {
  section.querySelectorAll('[data-notification-pref]').forEach((input) => {
    input.checked = prefs?.[input.dataset.notificationPref] !== false;
  });
}

function setPrefsStatus(section, text) {
  const status = section.querySelector('#notifications-prefs-status');
  if (status) status.textContent = text;
}

async function loadPrefs(section) {
  try {
    const response = await fetch('/api/notifications/prefs', { credentials: 'same-origin' });
    if (response.status === 401) return;
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || '加载失败');
    applyPrefs(section, data?.prefs);
    setPrefsStatus(section, '');
  } catch (error) {
    setPrefsStatus(section, `${PREFS_ERROR}: ${error.message || ''}`);
  }
}

async function savePrefs(section) {
  const toggles = [...section.querySelectorAll('[data-notification-pref]')];
  const prefs = Object.fromEntries(
    toggles.map((input) => [input.dataset.notificationPref, input.checked])
  );
  toggles.forEach((input) => {
    input.disabled = true;
  });
  try {
    const response = await fetch('/api/notifications/prefs', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prefs }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || '保存失败');
    applyPrefs(section, data?.prefs);
    setPrefsStatus(section, PREFS_SAVED);
  } catch (error) {
    setPrefsStatus(section, `${PREFS_ERROR}: ${error.message || ''}`);
    // 保存失败时回读服务端状态，避免开关显示与真实偏好不一致。
    await loadPrefs(section);
  } finally {
    toggles.forEach((input) => {
      input.disabled = false;
    });
  }
}

function install() {
  const button = document.getElementById('btn-notifications');
  const panel = document.getElementById('notifications-panel');
  if (!button || !panel) return;
  const close = panel.querySelector('#btn-notifications-close');
  const readAll = panel.querySelector('#btn-notifications-read');
  const prefs = ensurePrefsSection(panel);

  const setOpen = (open) => {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) {
      load(panel);
      loadPrefs(prefs);
    }
  };

  button.addEventListener('click', () => setOpen(panel.hidden));
  close?.addEventListener('click', () => setOpen(false));
  readAll?.addEventListener('click', () => markAllRead(panel));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshBadge();
  });

  refreshBadge();
}

// 浏览器环境才自动安装；Node 测试可直接导入上面的纯函数。
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
}
