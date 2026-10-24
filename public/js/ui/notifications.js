// 大厅通知中心：顶部铃铛展示未读数，面板按游标分页列出通知、展示 90 天归档摘要，
// 并支持一键全部已读。通知内容完全由服务端生成，客户端只负责展示与标记已读。

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

const PAGE_SIZE = 20;
const ARCHIVE_TITLE = '归档摘要 / Archive summary';
const LOAD_MORE = '加载更多 / Load more';
const LOADING = '加载中…';

// 分页状态：面板只有一个，首次加载整体替换，加载更多时累积。
const pageState = { cursor: null, items: [], unread: 0, archive: null };

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

// 赛季成就复用成就通知通道：payload.seasonal 标记决定独立的「赛季成就」样式（纯函数）。
export function isSeasonalAchievement(item) {
  return item?.kind === 'achievement' && item?.payload?.seasonal === true;
}

// 卡片标签：赛季成就与普通成就解锁分开显示，其余类型沿用固定标签（纯函数）。
export function notificationKindLabel(item) {
  if (isSeasonalAchievement(item)) return '赛季成就';
  return KIND_LABELS[item?.kind] || '通知';
}

// 通知正文：按服务端 kind 生成文案，未知 kind 回落到通用提示（纯函数）。
export function describeNotification(item) {
  const payload = item?.payload || {};
  if (isSeasonalAchievement(item)) {
    const season = payload.season ? `（${payload.season} 赛季）` : '';
    return `解锁赛季成就「${payload.title || payload.achievementId || '未知成就'}」${season}`;
  }
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

// 批量已读进度：累计已处理条数 + 服务端返回的剩余未读数（纯函数）。
export function readProgressText(done, remaining) {
  const processed = Math.max(0, Number(done) || 0);
  return `已标记 ${processed} 条，剩余 ${normalizeUnread(remaining)} 条`;
}

// ISO 周键 → 可读标签；非法输入原样返回，展示层不抛错（纯函数）。
export function archiveWeekLabel(week) {
  const match = /^(\d{4})-W(\d{2})$/.exec(String(week || ''));
  if (!match) return String(week || '');
  return `${Number(match[1])} 年第 ${Number(match[2])} 周`;
}

// 归档摘要文案：按周展示总数与未读，最多 12 周（纯函数）。
export function archiveSummaryLines(archive) {
  const weeks = Array.isArray(archive?.weeks) ? archive.weeks : [];
  return weeks.slice(0, 12).map((entry) => {
    const total = Math.max(0, Number(entry?.total) || 0);
    const unread = Math.max(0, Number(entry?.unread) || 0);
    return `${archiveWeekLabel(entry?.week)}：${total} 条${unread ? `（${unread} 条未读）` : ''}`;
  });
}

function notificationCard(item) {
  const unread = item.readAt == null;
  const kind = notificationKindLabel(item);
  const rarity = ['common', 'rare', 'epic'].includes(item?.payload?.rarity)
    ? ` rarity-${item.payload.rarity}`
    : '';
  const seasonal = isSeasonalAchievement(item) ? ' seasonal-notification' : '';
  return `
    <article class="achievement-card notification-card${rarity}${seasonal}${unread ? ' unread' : ''}">
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

function ensureArchiveSection(panel) {
  let section = panel.querySelector('#notifications-archive');
  if (section) return section;
  section = document.createElement('section');
  section.id = 'notifications-archive';
  section.className = 'notifications-archive';
  section.hidden = true;
  const list = panel.querySelector('#notifications-list');
  if (list) panel.insertBefore(section, list);
  else panel.append(section);
  return section;
}

function renderArchive(panel, archive) {
  const section = ensureArchiveSection(panel);
  const lines = archiveSummaryLines(archive);
  if (!lines.length) {
    section.hidden = true;
    section.innerHTML = '';
    return;
  }
  const total = Math.max(0, Number(archive?.totalArchived) || 0);
  section.hidden = false;
  section.innerHTML = `
    <p class="achievement-hint">${escapeHtml(ARCHIVE_TITLE)} · ${total} 条</p>
    <ul class="archive-weeks">${lines
      .map((line) => `<li>${escapeHtml(line)}</li>`)
      .join('')}</ul>`;
}

function ensureMoreButton(panel) {
  let button = panel.querySelector('#btn-notifications-more');
  if (button) return button;
  button = document.createElement('button');
  button.id = 'btn-notifications-more';
  button.className = 'btn small';
  button.type = 'button';
  button.textContent = LOAD_MORE;
  button.hidden = true;
  button.addEventListener('click', () => loadMore(panel));
  const list = panel.querySelector('#notifications-list');
  if (list) list.insertAdjacentElement('afterend', button);
  else panel.append(button);
  return button;
}

function render(panel, data, { append = false } = {}) {
  const list = panel.querySelector('#notifications-list');
  const count = panel.querySelector('#notifications-count');
  const readAll = panel.querySelector('#btn-notifications-read');
  const incoming = Array.isArray(data?.items) ? data.items : [];
  // 首屏整体替换，加载更多则累积；服务端按 (created_at, id) 排序，追加顺序天然连续。
  pageState.items = append ? [...pageState.items, ...incoming] : incoming;
  pageState.cursor = data?.nextCursor || null;
  if (data?.archive) pageState.archive = data.archive;
  pageState.unread = normalizeUnread(data?.unread);
  if (count) count.textContent = unreadSummaryText(pageState.unread);
  if (readAll) readAll.disabled = pageState.unread === 0;
  renderArchive(panel, pageState.archive);
  const more = ensureMoreButton(panel);
  if (more) more.hidden = pageState.cursor == null;
  if (!pageState.items.length) {
    list.innerHTML = renderEmpty('暂无通知');
    return;
  }
  list.innerHTML = pageState.items.map(notificationCard).join('');
}

function updateBadge(unread) {
  const badge = document.getElementById('notifications-badge');
  if (!badge) return;
  const count = normalizeUnread(unread);
  badge.textContent = unreadBadgeText(count);
  badge.hidden = count === 0;
}

async function fetchSummary(cursor = null) {
  const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (cursor) query.set('cursor', cursor);
  const response = await fetch(`/api/notifications?${query.toString()}`, {
    credentials: 'same-origin',
  });
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
  pageState.cursor = null;
  pageState.items = [];
  pageState.archive = null;
  try {
    const data = await fetchSummary();
    if (!data) {
      updateBadge(0);
      renderArchive(panel, null);
      const more = ensureMoreButton(panel);
      if (more) more.hidden = true;
      list.innerHTML = renderEmpty('登录后可查看通知');
      return;
    }
    updateBadge(data.unread);
    render(panel, data);
  } catch (error) {
    list.innerHTML = `<p class="achievement-hint">${escapeHtml(error.message || '加载失败')}</p>`;
  }
}

async function loadMore(panel) {
  if (!pageState.cursor) return;
  const button = panel.querySelector('#btn-notifications-more');
  if (button) {
    button.disabled = true;
    button.textContent = LOADING;
  }
  try {
    const data = await fetchSummary(pageState.cursor);
    if (!data) return;
    updateBadge(data.unread);
    render(panel, data, { append: true });
  } catch (error) {
    const list = panel.querySelector('#notifications-list');
    const note = document.createElement('p');
    note.className = 'achievement-hint';
    note.textContent = error.message || '加载失败';
    list.append(note);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = LOAD_MORE;
    }
  }
}

// 进度条式文案：脚本创建，避免额外改 index.html 的静态标记。
function ensureReadStatus(panel) {
  let status = panel.querySelector('#notifications-read-status');
  if (status) return status;
  status = document.createElement('p');
  status.id = 'notifications-read-status';
  status.className = 'achievement-hint';
  status.setAttribute('role', 'status');
  const readAll = panel.querySelector('#btn-notifications-read');
  if (readAll) readAll.insertAdjacentElement('afterend', status);
  else panel.append(status);
  return status;
}

// 逐批标记已读：每批都回读 remaining 并刷新角标，全部清零后再拉取最新列表。
async function markAllRead(panel) {
  const button = panel.querySelector('#btn-notifications-read');
  const status = ensureReadStatus(panel);
  if (button) button.disabled = true;
  let done = 0;
  let remaining = 0;
  try {
    // 服务端每批最多处理固定条数；批次上限防御客户端与服务端不一致时的死循环。
    for (let round = 0; round < 10_000; round++) {
      const response = await fetch('/api/notifications/read', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ all: false }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || '操作失败');
      done += Math.max(0, Number(data?.updated) || 0);
      remaining = normalizeUnread(data?.remaining ?? data?.unread);
      updateBadge(remaining);
      status.textContent = readProgressText(done, remaining);
      if (remaining === 0) break;
    }
    await load(panel);
    status.textContent = readProgressText(done, remaining);
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
