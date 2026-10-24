// 大厅赛季通行证面板：展示服务端派生的积分轨道，领取由服务端幂等判定。
// 视觉沿用成就面板的既有样式，不新增样式表。
const PANEL_ID = 'season-pass-panel';
const LIST_ID = 'season-pass-list';
const BUTTON_ID = 'btn-season-pass';
const BADGE_ID = 'season-pass-badge';
const CLAIM_ALL_ID = 'season-pass-claim-all';
const CLAIM_ALL_BUTTON_ID = 'season-pass-claim-all-btn';
const CLAIM_ALL_NOTE_ID = 'season-pass-claim-all-note';

// 一键领取后只在新渲染的轨道上播放一次动效；减少动效时直接呈现。
let pendingCelebration = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmt(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function progressBar(item) {
  const target = Math.max(0, Number(item.target) || 0);
  const current = Math.max(0, Math.min(target, Number(item.progress) || 0));
  const pct = target ? Math.round((current / target) * 100) : 0;
  return `
    <div class="achievement-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${current}">
      <span class="achievement-progress-fill" style="width:${pct}%"></span>
    </div>
    <div class="achievement-progress-label">${fmt(current)} / ${fmt(target)}</div>`;
}

function claimButton(item) {
  if (item.claimed) {
    return '<button class="btn small" type="button" disabled>已领取</button>';
  }
  if (!item.complete) {
    return '<button class="btn small" type="button" disabled>未解锁</button>';
  }
  return `<button class="btn small primary" type="button" data-claim="${escapeHtml(item.id)}">领取奖励</button>`;
}

function card(item) {
  const state = item.claimed ? '已领取' : item.complete ? '可领取' : '进行中';
  return `
    <article class="achievement-card rarity-common${item.claimed ? ' unlocked' : ''}" data-milestone="${escapeHtml(item.id)}">
      <h3>
        <span>${escapeHtml(item.name)}</span>
        <span class="achievement-rarity">${escapeHtml(state)}</span>
        <span class="achievement-state">${escapeHtml(item.rewardText || '')}</span>
      </h3>
      <p>${escapeHtml(item.desc)}</p>
      ${progressBar(item)}
      <div class="bounty-actions">${claimButton(item)}</div>
    </article>`;
}

// 来源类型兜底文案：以服务端 label 为准，来源新增时旧前端也不会显示成「对局积分」。
const SOURCE_FALLBACK_LABELS = Object.freeze({
  match: '对局积分',
  bounty: '赛季悬赏',
  achievement: '成就奖励',
  achievementBonus: '成就解锁加成',
});

// 积分来源明细：服务端返回 sources；旧接口只给总分时按对局积分占位，避免明细凭空消失。
function sourceItem(item) {
  const at = Number(item?.updatedAt);
  const when = Number.isFinite(at) && at > 0
    ? ` · ${new Date(at).toLocaleDateString('zh-CN')}`
    : '';
  const source = String(item?.source || 'match');
  const label = escapeHtml(item?.label || SOURCE_FALLBACK_LABELS[source] || '对局积分');
  return `<li data-source="${escapeHtml(source)}"><span>${label}</span><span>${fmt(item?.points)}${escapeHtml(when)}</span></li>`;
}

function sourcesBlock(data) {
  const sources = Array.isArray(data?.sources) && data.sources.length
    ? data.sources
    : [{ source: 'match', label: SOURCE_FALLBACK_LABELS.match, points: data?.points }];
  const total = sources.reduce((sum, item) => sum + (Number(item?.points) || 0), 0);
  const detail = total > 0
    ? `<ul class="season-pass-source-list">${sources.map(sourceItem).join('')}</ul>`
    : '<p class="achievement-hint">暂无积分来源</p>';
  return `
    <article class="achievement-card rarity-common">
      <h3>
        <span>积分来源</span>
        <span class="achievement-rarity">${fmt(total)}</span>
      </h3>
      ${detail}
    </article>`;
}

function prefersReducedMotion() {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
}

// 领取动效只作用于本次新领取的卡片；减少动效或环境不支持时直接呈现已领取状态。
function celebrate(list, ids) {
  if (!ids?.size) return;
  const reduced = prefersReducedMotion() || typeof list.animate !== 'function';
  for (const node of list.querySelectorAll('[data-milestone]')) {
    if (!ids.has(node.dataset.milestone)) continue;
    node.classList.add('unlocked');
    if (reduced) continue;
    node.animate(
      [
        { transform: 'scale(1)', boxShadow: '0 0 0 rgba(255, 210, 120, 0)' },
        { transform: 'scale(1.03)', boxShadow: '0 0 24px rgba(255, 210, 120, 0.55)' },
        { transform: 'scale(1)', boxShadow: '0 0 0 rgba(255, 210, 120, 0)' },
      ],
      { duration: 640, easing: 'ease-out' }
    );
  }
}

// 一键领取工具条动态挂到列表面板：面板容器已在大厅标记里，不新增样式表与模板。
function ensureToolbar(panel) {
  let bar = panel.querySelector(`#${CLAIM_ALL_ID}`);
  if (bar) return bar;
  const list = panel.querySelector(`#${LIST_ID}`);
  if (!list) return null;
  bar = document.createElement('div');
  bar.id = CLAIM_ALL_ID;
  bar.className = 'bounty-actions';
  bar.innerHTML = `
    <button id="${CLAIM_ALL_BUTTON_ID}" class="btn small primary" type="button" disabled>一键领取</button>
    <span id="${CLAIM_ALL_NOTE_ID}" class="achievement-hint" aria-live="polite"></span>`;
  list.parentNode.insertBefore(bar, list);
  bar.querySelector(`#${CLAIM_ALL_BUTTON_ID}`).addEventListener('click', () => claimAll(panel));
  return bar;
}

function updateClaimAll(data) {
  const panel = document.getElementById(PANEL_ID);
  const bar = panel && ensureToolbar(panel);
  if (!bar) return;
  const button = bar.querySelector(`#${CLAIM_ALL_BUTTON_ID}`);
  const note = bar.querySelector(`#${CLAIM_ALL_NOTE_ID}`);
  const count = Math.max(0, Math.floor(Number(data?.claimableCount) || 0));
  if (button) {
    button.disabled = count === 0;
    button.textContent = count > 0 ? `一键领取（${count}）` : '一键领取';
  }
  if (note) note.textContent = count > 0 ? `${count} 个里程碑可领取` : '暂无未领取里程碑';
}

function ensureBadge(button) {
  let badge = button.querySelector(`#${BADGE_ID}`);
  if (badge) return badge;
  // 复用通知角标的定位与配色，入口按钮需要相对定位上下文。
  button.classList.add('notification-bell');
  badge = document.createElement('span');
  badge.id = BADGE_ID;
  badge.className = 'notifications-badge';
  badge.hidden = true;
  badge.textContent = '0';
  button.appendChild(badge);
  return badge;
}

function applyBadge(count) {
  const button = document.getElementById(BUTTON_ID);
  if (!button) return;
  const badge = ensureBadge(button);
  const value = Math.max(0, Math.floor(Number(count) || 0));
  badge.textContent = value > 99 ? '99+' : String(value);
  badge.hidden = value === 0;
  button.setAttribute('aria-label', value > 0 ? `通行证（${value} 个可领取）` : '通行证');
}

function render(panel, data) {
  const list = panel.querySelector(`#${LIST_ID}`);
  const milestones = Array.isArray(data?.milestones) ? data.milestones : [];
  const progress = panel.querySelector('#season-pass-progress');
  if (progress) {
    const endsAt = Number(data?.endsAt);
    const remain = Number.isFinite(endsAt)
      ? ` · 至 ${new Date(endsAt).toLocaleDateString('zh-CN')}`
      : '';
    progress.textContent = `${data?.label || ''} ${fmt(data?.points)} / ${fmt(data?.maxPoints)}${remain}`;
  }
  updateClaimAll(data);
  applyBadge(data?.claimableCount);

  if (!milestones.length) {
    list.innerHTML = `${sourcesBlock(data)}<p class="achievement-hint">暂无里程碑</p>`;
    return;
  }
  list.innerHTML = `${sourcesBlock(data)}${milestones.map(card).join('')}`;
  for (const button of list.querySelectorAll('[data-claim]')) {
    button.addEventListener('click', () => claim(panel, button.dataset.claim));
  }
  celebrate(list, pendingCelebration);
  pendingCelebration = null;
}

async function claim(panel, milestoneId) {
  const list = panel.querySelector(`#${LIST_ID}`);
  try {
    const response = await fetch('/api/season-pass/claim', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: milestoneId }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || '领取失败');
    const cores = document.getElementById('cores');
    const balance = Number(data?.wallet?.cores);
    if (cores && Number.isFinite(balance)) cores.textContent = String(balance);
    await load(panel);
  } catch (error) {
    const note = document.createElement('p');
    note.className = 'achievement-hint';
    note.textContent = error.message || '领取失败';
    list.prepend(note);
  }
}

// 一键领取：请求发出前先禁用按钮，避免连点重复提交；服务端仍在事务内幂等兜底。
async function claimAll(panel) {
  const bar = ensureToolbar(panel);
  const button = bar?.querySelector(`#${CLAIM_ALL_BUTTON_ID}`);
  const note = bar?.querySelector(`#${CLAIM_ALL_NOTE_ID}`);
  if (!button || button.disabled) return;

  button.disabled = true;
  try {
    const response = await fetch('/api/season-pass/claim-all', {
      method: 'POST',
      credentials: 'same-origin',
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || '领取失败');
    const cores = document.getElementById('cores');
    const balance = Number(data?.wallet?.cores);
    if (cores && Number.isFinite(balance)) cores.textContent = String(balance);
    const awarded = Array.isArray(data?.awarded) ? data.awarded : [];
    pendingCelebration = new Set(awarded.map((item) => item?.id).filter(Boolean));
    await load(panel);
  } catch (error) {
    pendingCelebration = null;
    if (button) button.disabled = false;
    if (note) note.textContent = error.message || '领取失败';
  }
}

async function load(panel) {
  const list = panel.querySelector(`#${LIST_ID}`);
  list.innerHTML = '<p class="achievement-hint">加载中…</p>';
  try {
    const response = await fetch('/api/season-pass', { credentials: 'same-origin' });
    if (response.status === 401) {
      list.innerHTML = '<p class="achievement-hint">登录后可查看赛季通行证</p>';
      return;
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || '加载失败');
    render(panel, data);
  } catch (error) {
    list.innerHTML = `<p class="achievement-hint">${escapeHtml(error.message || '加载失败')}</p>`;
  }
}

// 角标在进入大厅时就刷新，未打开面板也能看到可领取数量；失败不阻塞大厅。
async function refreshBadge() {
  try {
    const response = await fetch('/api/season-pass', { credentials: 'same-origin' });
    if (!response.ok) return;
    const data = await response.json();
    applyBadge(data?.claimableCount);
    updateClaimAll(data);
  } catch {
    /* 角标刷新失败不提示 */
  }
}

function install() {
  const button = document.getElementById(BUTTON_ID);
  const panel = document.getElementById(PANEL_ID);
  if (!button || !panel) return;
  const close = panel.querySelector('#btn-season-pass-close');
  ensureBadge(button);
  ensureToolbar(panel);

  const setOpen = (open) => {
    panel.hidden = !open;
    if (open) load(panel);
  };

  button.addEventListener('click', () => setOpen(panel.hidden));
  close?.addEventListener('click', () => setOpen(false));

  refreshBadge();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', install, { once: true });
} else {
  install();
}
