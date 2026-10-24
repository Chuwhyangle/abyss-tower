// 大厅赛季通行证面板：展示服务端派生的积分轨道，领取由服务端幂等判定。
// 视觉沿用成就面板的既有样式，不新增样式表。
const PANEL_ID = 'season-pass-panel';
const LIST_ID = 'season-pass-list';
const BUTTON_ID = 'btn-season-pass';

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
    <article class="achievement-card rarity-common${item.claimed ? ' unlocked' : ''}">
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

// 积分来源明细：服务端返回 sources；旧接口只给总分时按对局积分占位，避免明细凭空消失。
function sourceItem(item) {
  const at = Number(item?.updatedAt);
  const when = Number.isFinite(at) && at > 0
    ? ` · ${new Date(at).toLocaleDateString('zh-CN')}`
    : '';
  return `<li><span>${escapeHtml(item?.label || '对局积分')}</span><span>${fmt(item?.points)}${escapeHtml(when)}</span></li>`;
}

function sourcesBlock(data) {
  const sources = Array.isArray(data?.sources) && data.sources.length
    ? data.sources
    : [{ source: 'match', label: '对局积分', points: data?.points }];
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
  if (!milestones.length) {
    list.innerHTML = `${sourcesBlock(data)}<p class="achievement-hint">暂无里程碑</p>`;
    return;
  }
  list.innerHTML = `${sourcesBlock(data)}${milestones.map(card).join('')}`;
  for (const button of list.querySelectorAll('[data-claim]')) {
    button.addEventListener('click', () => claim(panel, button.dataset.claim));
  }
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

function install() {
  const button = document.getElementById(BUTTON_ID);
  const panel = document.getElementById(PANEL_ID);
  if (!button || !panel) return;
  const close = panel.querySelector('#btn-season-pass-close');

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
