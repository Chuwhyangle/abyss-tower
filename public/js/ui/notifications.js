// 大厅通知中心：顶部铃铛展示未读数，面板按游标分页列出通知、展示 90 天归档摘要，
// 并支持一键全部已读。通知内容完全由服务端生成，客户端只负责展示与标记已读。
import { api } from '../api.js';
import { escapeHtml } from './kit/dom.js';
import { createPanel } from './kit/panel.js';
import { t } from '../i18n.js';
import { registerPanel } from './registry.js';

// 通知类型标签的词典键；未知 kind 回退到通用提示（见 notificationKindLabel）。
// 词典键对照：notify.kind.announcement: '系统公告'；偏好 key: 'announcements' 与 kind='announcement' 一一对应。
const KIND_KEYS = Object.freeze({
  achievement: 'notify.kind.achievement',
  bounty: 'notify.kind.bounty',
  season: 'notify.kind.season',
  announcement: 'notify.kind.announcement',
});

// 通知偏好开关：键名与服务端偏好字段一一对应，关闭后服务端不再写入新的未读。
// 标签文案在 render 时按当前语言取 notify.pref.<key>，单语字符串随语言切换。
const PREFS = Object.freeze(['achievement', 'bounty', 'season', 'announcements']);

// 面板内文案的词典键对照（中文 / English 双语文案已迁入词典）：
// 通知偏好 / Notification preferences = notify.prefsTitle；成就通知 / Achievements = notify.pref.achievement；
// 加载更多 / Load more = notify.loadMore；归档摘要 / Archive summary = notify.archiveTitle。
const PAGE_SIZE = 20;

const STYLE_ID = 'notifications-season-reward-style';
const STYLE = `
  .notification-card.season-reward-notification {
    border-left: 3px solid var(--gold, #ffd36b);
  }
  .notification-card.important-announcement {
    border-left: 3px solid var(--danger, #ff6b6b);
    background: color-mix(in srgb, var(--danger, #ff6b6b) 8%, transparent);
  }
  .notification-card.important-announcement .achievement-state {
    color: var(--danger, #ff6b6b);
    font-weight: 600;
  }
  .notification-card .notification-jump {
    margin-top: var(--space-2, 8px);
  }
`;

// 分页状态：面板只有一个，首次加载整体替换，加载更多时累积。
const pageState = { cursor: null, items: [], unread: 0, archive: null };

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

// 赛季奖励通知由结算写入 kind='season'，卡片使用独立样式并可跳转赛季面板（纯函数）。
export function isSeasonReward(item) {
  return item?.kind === 'season';
}

// 重要公告由服务端在 payload.important 打标，客户端据此加醒目样式（纯函数）。
// 卡片标签「重要公告」取 notify.kind.important。
export function isImportantAnnouncement(item) {
  return item?.kind === 'announcement' && item?.payload?.important === true;
}

// 通知的跳转目标：赛季奖励 → 赛季面板，其余类型不跳转（纯函数）。
export function notificationJumpTarget(item) {
  return isSeasonReward(item) ? 'season' : null;
}

// 卡片标签：赛季成就与普通成就解锁分开显示，其余类型沿用固定标签（纯函数）。
export function notificationKindLabel(item) {
  if (isSeasonalAchievement(item)) return t('notify.kind.seasonal');
  if (isImportantAnnouncement(item)) return t('notify.kind.important');
  return KIND_KEYS[item?.kind] ? t(KIND_KEYS[item?.kind]) : t('notify.kind.fallback');
}

// 通知正文：按服务端 kind 生成文案，未知 kind 回落到通用提示（纯函数）。
export function describeNotification(item) {
  const payload = item?.payload || {};
  if (isSeasonalAchievement(item)) {
    const season = payload.season
      ? t('notify.desc.seasonSuffix', { season: payload.season })
      : '';
    return t('notify.desc.seasonal', {
      title: payload.title || payload.achievementId || t('notify.unknownAchievement'),
      season,
    });
  }
  if (item?.kind === 'achievement') {
    return t('notify.desc.achievement', {
      title: payload.title || payload.achievementId || t('notify.unknownAchievement'),
    });
  }
  if (item?.kind === 'bounty') {
    const reward = Number(payload.reward) || 0;
    return t('notify.desc.bounty', {
      title: payload.title || payload.bountyId || t('notify.unknownTarget'),
      reward,
    });
  }
  if (item?.kind === 'season') {
    const rank = Number(payload.rank) || 0;
    const cores = Number(payload.cores) || 0;
    return t('notify.desc.season', { season: payload.season || '', rank, cores });
  }
  if (item?.kind === 'announcement') {
    return payload.message || payload.title || t('notify.desc.announcementFallback');
  }
  return t('notify.desc.fallback');
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
  return count ? t('notify.unreadCount', { count }) : t('notify.allRead');
}

// 批量已读进度：累计已处理条数 + 服务端返回的剩余未读数（纯函数）。
export function readProgressText(done, remaining) {
  const processed = Math.max(0, Number(done) || 0);
  return t('notify.readProgress', { done: processed, remaining: normalizeUnread(remaining) });
}

// ISO 周键 → 可读标签；非法输入原样返回，展示层不抛错（纯函数）。
export function archiveWeekLabel(week) {
  const match = /^(\d{4})-W(\d{2})$/.exec(String(week || ''));
  if (!match) return String(week || '');
  return t('notify.weekLabel', { year: Number(match[1]), week: Number(match[2]) });
}

// 归档摘要文案：按周展示总数与未读，最多 12 周（纯函数）。
export function archiveSummaryLines(archive) {
  const weeks = Array.isArray(archive?.weeks) ? archive.weeks : [];
  return weeks.slice(0, 12).map((entry) => {
    const total = Math.max(0, Number(entry?.total) || 0);
    const unread = Math.max(0, Number(entry?.unread) || 0);
    const unreadText = unread ? t('notify.archiveUnread', { unread }) : '';
    return t('notify.archiveLine', {
      week: archiveWeekLabel(entry?.week),
      total,
      unread: unreadText,
    });
  });
}

function notificationCard(item) {
  const unread = item.readAt == null;
  const kind = notificationKindLabel(item);
  const rarity = ['common', 'rare', 'epic'].includes(item?.payload?.rarity)
    ? ` rarity-${item.payload.rarity}`
    : '';
  const seasonal = isSeasonalAchievement(item) ? ' seasonal-notification' : '';
  const seasonReward = isSeasonReward(item) ? ' season-reward-notification' : '';
  const importantAnnouncement = isImportantAnnouncement(item) ? ' important-announcement' : '';
  const jump = notificationJumpTarget(item);
  const action = jump
    ? `<button class="btn small notification-jump" type="button" data-notification-jump="${escapeHtml(jump)}">${escapeHtml(t('notify.jumpSeason'))}</button>`
    : '';
  return `
    <article class="achievement-card notification-card${rarity}${seasonal}${seasonReward}${importantAnnouncement}${unread ? ' unread' : ''}">
      <h3>
        <span>${escapeHtml(kind)}</span>
        <span class="achievement-rarity">${escapeHtml(formatTime(item.createdAt))}</span>
        <span class="achievement-state">${unread ? t('notify.unread') : t('notify.read')}</span>
      </h3>
      <p>${escapeHtml(describeNotification(item))}</p>
      ${action}
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
    <p class="achievement-hint">${escapeHtml(
      t('notify.archiveTotal', { title: t('notify.archiveTitle'), total })
    )}</p>
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
  button.textContent = t('notify.loadMore');
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
    list.innerHTML = renderEmpty(t('notify.empty'));
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
  try {
    return await api.request(`/api/notifications?${query.toString()}`);
  } catch (error) {
    if (error?.status === 401) return null;
    throw error;
  }
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
  list.innerHTML = `<p class="achievement-hint">${escapeHtml(t('notify.loading'))}</p>`;
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
      list.innerHTML = renderEmpty(t('notify.loginRequired'));
      return;
    }
    updateBadge(data.unread);
    render(panel, data);
  } catch (error) {
    list.innerHTML = `<p class="achievement-hint">${escapeHtml(error.message || t('notify.loadFailed'))}</p>`;
  }
}

async function loadMore(panel) {
  if (!pageState.cursor) return;
  const button = panel.querySelector('#btn-notifications-more');
  if (button) {
    button.disabled = true;
    button.textContent = t('notify.loading');
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
    note.textContent = error.message || t('notify.loadFailed');
    list.append(note);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = t('notify.loadMore');
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
      const data = await api.request('/api/notifications/read', {
        method: 'POST',
        body: { all: false },
      });
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
    note.textContent = error.message || t('notify.actionFailed');
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
    <p class="achievement-hint">${escapeHtml(t('notify.prefsTitle'))}</p>
    <p class="achievement-hint">${escapeHtml(t('notify.prefsHint'))}</p>
    <div class="settings-grid" style="grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); margin-top: 0;">
      ${PREFS.map(
        (pref) => `
        <label class="setting-check">
          <input type="checkbox" data-notification-pref="${pref}" checked />
          <span>${escapeHtml(t(`notify.pref.${pref}`))}</span>
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
    const data = await api.request('/api/notifications/prefs');
    applyPrefs(section, data?.prefs);
    setPrefsStatus(section, '');
  } catch (error) {
    if (error?.status === 401) return;
    setPrefsStatus(section, `${t('notify.prefsError')}: ${error.message || ''}`);
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
    const data = await api.request('/api/notifications/prefs', {
      method: 'PUT',
      body: { prefs },
    });
    applyPrefs(section, data?.prefs);
    setPrefsStatus(section, t('notify.prefsSaved'));
  } catch (error) {
    setPrefsStatus(section, `${t('notify.prefsError')}: ${error.message || ''}`);
    // 保存失败时回读服务端状态，避免开关显示与真实偏好不一致。
    await loadPrefs(section);
  } finally {
    toggles.forEach((input) => {
      input.disabled = false;
    });
  }
}

function openSeasonPanel() {
  if (document.getElementById('season-panel')?.hidden === false) return;
  document.getElementById('btn-season')?.click();
}

function install() {
  const button = document.getElementById('btn-notifications');
  const panel = document.getElementById('notifications-panel');
  if (!button || !panel) return;
  const readAll = panel.querySelector('#btn-notifications-read');
  const prefs = ensurePrefsSection(panel);
  const controller = createPanel({
    id: 'notifications-panel',
    trigger: button,
    closeSelector: '#btn-notifications-close',
    style: STYLE,
    styleId: STYLE_ID,
    onOpen: (node) => {
      load(node);
      loadPrefs(prefs);
    },
  });
  // 事件委托挂在列表容器上：分页重渲染后跳转按钮无需重新绑定。
  panel.querySelector('#notifications-list')?.addEventListener('click', (event) => {
    const jump = event.target?.closest?.('[data-notification-jump]');
    if (!jump) return;
    if (jump.dataset.notificationJump !== 'season') return;
    controller.close();
    openSeasonPanel();
  });

  readAll?.addEventListener('click', () => markAllRead(panel));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshBadge();
  });

  refreshBadge();
}

// 浏览器环境才由面板注册表挂载；Node 测试可直接导入上面的纯函数。
registerPanel('notifications', install);
