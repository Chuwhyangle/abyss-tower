// 大厅赛季通行证面板：展示服务端派生的积分轨道，领取由服务端幂等判定。
// 视觉沿用成就面板的既有样式，不新增样式表。
import { api } from '../api.js';
import { escapeHtml } from './kit/dom.js';
import { createPanel } from './kit/panel.js';
import { getLocale, t, tData } from '../i18n.js';
import { registerPanel } from './registry.js';

const PANEL_ID = 'season-pass-panel';
const LIST_ID = 'season-pass-list';
const BUTTON_ID = 'btn-season-pass';
const BADGE_ID = 'season-pass-badge';
const CLAIM_ALL_ID = 'season-pass-claim-all';
const CLAIM_ALL_BUTTON_ID = 'season-pass-claim-all-btn';
const CLAIM_ALL_NOTE_ID = 'season-pass-claim-all-note';
const HISTORY_ID = 'season-pass-history';

// 一键领取后只在新渲染的轨道上播放一次动效；减少动效时直接呈现。
let pendingCelebration = null;
// null 表示当前赛季；选中历史赛季时只读展示终态。
let activeSeason = null;

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

// 已结束赛季锁定轨道：达标的显示「已错过」，未达标的显示「未达成」，都不再提供领取按钮。
// 终态文案取词典：seasonPass.missed = 已错过，seasonPass.incomplete = 未达成，seasonPass.closedNote = 赛季已结束，历史赛季只读。
function claimButton(item, closed = false) {
  if (item.claimed) {
    return `<button class="btn small" type="button" disabled>${escapeHtml(t('seasonPass.claimed'))}</button>`;
  }
  if (closed) {
    return `<button class="btn small" type="button" disabled>${escapeHtml(
      t(item.complete ? 'seasonPass.missed' : 'seasonPass.incomplete')
    )}</button>`;
  }
  if (!item.complete) {
    return `<button class="btn small" type="button" disabled>${escapeHtml(t('seasonPass.locked'))}</button>`;
  }
  return `<button class="btn small primary" type="button" data-claim="${escapeHtml(item.id)}">${escapeHtml(t('seasonPass.claim'))}</button>`;
}

// 赛季标签：服务端 label 是中文串，客户端按 season 键（YYYY-MM）自己拼，随语言切换。
function seasonValue(season) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(season || ''));
  if (!match) return String(season || '');
  return t('seasonPass.seasonValue', { year: match[1], month: String(Number(match[2])) });
}

// 奖励文案：由结构化 reward 拼装，称号名走 data.cosmeticTitle 词典。
function rewardText(item) {
  const reward = item?.reward || {};
  const parts = [];
  if (reward.cores) parts.push(t('seasonPass.rewardCores', { n: fmt(reward.cores) }));
  if (reward.shards) parts.push(t('seasonPass.rewardShards', { n: fmt(reward.shards) }));
  if (reward.title) {
    parts.push(
      t('seasonPass.rewardTitle', {
        name: tData('cosmeticTitle', reward.title, 'name', reward.title),
      })
    );
  }
  return parts.join(' + ');
}

function card(item, closed = false) {
  const state = item.claimed
    ? t('seasonPass.claimed')
    : item.complete
      ? closed ? t('seasonPass.missed') : t('seasonPass.claimable')
      : closed ? t('seasonPass.incomplete') : t('seasonPass.inProgress');
  // 里程碑名称/描述与积分阈值都来自词典；数据表中文只是 tData 的不可达回退。
  const name = tData('seasonPass', item.id, 'name', item.name);
  const desc = tData('seasonPass', item.id, 'desc', item.desc, { points: fmt(item.target) });
  return `
    <article class="achievement-card rarity-common${item.claimed ? ' unlocked' : ''}" data-milestone="${escapeHtml(item.id)}">
      <h3>
        <span>${escapeHtml(name)}</span>
        <span class="achievement-rarity">${escapeHtml(state)}</span>
        <span class="achievement-state">${escapeHtml(rewardText(item))}</span>
      </h3>
      <p>${escapeHtml(desc)}</p>
      ${progressBar(item)}
      <div class="bounty-actions">${claimButton(item, closed)}</div>
    </article>`;
}

// 来源类型兜底文案：以服务端 label 为准，来源新增时旧前端也不会落到错误文案。
// 四个来源 id 与 data.seasonPassSource.<id>.name 一一对应（match / bounty / achievement / achievementBonus）。
function sourceLabel(source) {
  switch (source) {
    case 'bounty':
      return tData('seasonPassSource', 'bounty', 'name', '赛季悬赏');
    case 'achievement':
      return tData('seasonPassSource', 'achievement', 'name', '成就奖励');
    case 'achievementBonus':
      return tData('seasonPassSource', 'achievementBonus', 'name', '成就解锁加成');
    case 'match':
    default:
      return tData('seasonPassSource', 'match', 'name', '对局积分');
  }
}

// 积分来源明细：服务端返回 sources；旧接口只给总分时按对局积分占位，避免明细凭空消失。
function sourceItem(item) {
  const at = Number(item?.updatedAt);
  const when = Number.isFinite(at) && at > 0
    ? ` · ${new Date(at).toLocaleDateString('zh-CN')}`
    : '';
  const source = String(item?.source || 'match');
  const label = escapeHtml(item?.label || sourceLabel(source));
  return `<li data-source="${escapeHtml(source)}"><span>${label}</span><span>${fmt(item?.points)}${escapeHtml(when)}</span></li>`;
}

// 无来源占位：seasonPass.noSources = 暂无积分来源。
function sourcesBlock(data) {
  const sources = Array.isArray(data?.sources) && data.sources.length
    ? data.sources
    : [{ source: 'match', label: sourceLabel('match'), points: data?.points }];
  const total = sources.reduce((sum, item) => sum + (Number(item?.points) || 0), 0);
  const detail = total > 0
    ? `<ul class="season-pass-source-list">${sources.map(sourceItem).join('')}</ul>`
    : `<p class="achievement-hint">${escapeHtml(t('seasonPass.noSources'))}</p>`;
  return `
    <article class="achievement-card rarity-common">
      <h3>
        <span>${escapeHtml(t('seasonPass.sourcesTitle'))}</span>
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
    <button id="${CLAIM_ALL_BUTTON_ID}" class="btn small primary" type="button" disabled>${escapeHtml(t('seasonPass.claimAll'))}</button>
    <span id="${CLAIM_ALL_NOTE_ID}" class="achievement-hint" aria-live="polite"></span>`;
  list.parentNode.insertBefore(bar, list);
  bar.querySelector(`#${CLAIM_ALL_BUTTON_ID}`).addEventListener('click', () => claimAll(panel));
  return bar;
}

function updateClaimAll(data, closed = false) {
  const panel = document.getElementById(PANEL_ID);
  const bar = panel && ensureToolbar(panel);
  if (!bar) return;
  const button = bar.querySelector(`#${CLAIM_ALL_BUTTON_ID}`);
  const note = bar.querySelector(`#${CLAIM_ALL_NOTE_ID}`);
  const count = Math.max(0, Math.floor(Number(data?.claimableCount) || 0));
  if (button) {
    button.disabled = count === 0 || closed;
    button.textContent = !closed && count > 0
      ? t('seasonPass.claimAllCount', { count })
      : t('seasonPass.claimAll');
  }
  if (note) {
    note.textContent = closed
      ? t('seasonPass.closedNote')
      : count > 0
        ? t('seasonPass.claimableNote', { count })
        : t('seasonPass.noClaimable');
  }
}

// 历史赛季切换：下拉只列出当前赛季与已归档赛季，选中后按历史赛季只读加载。
function ensureHistory(panel) {
  let select = panel.querySelector(`#${HISTORY_ID}`);
  if (select) return select;
  const list = panel.querySelector(`#${LIST_ID}`);
  if (!list) return null;
  const bar = document.createElement('div');
  bar.className = 'bounty-actions';
  bar.innerHTML = `
    <label class="achievement-hint" for="${HISTORY_ID}">${escapeHtml(t('seasonPass.seasonLabel'))}</label>
    <select id="${HISTORY_ID}" aria-label="${escapeHtml(t('seasonPass.switchSeason'))}"></select>`;
  list.parentNode.insertBefore(bar, list);
  select = bar.querySelector(`#${HISTORY_ID}`);
  select.addEventListener('change', () => {
    activeSeason = select.value || null;
    load(panel);
  });
  return select;
}

function updateHistory(panel, data) {
  const select = ensureHistory(panel);
  if (!select) return;
  const current = String(data?.currentSeason || data?.season || '');
  const seasons = Array.isArray(data?.history) ? data.history.map(String) : [];
  const currentLabel = current
    ? t('seasonPass.currentSeasonNamed', { season: escapeHtml(current) })
    : t('seasonPass.currentSeason');
  select.innerHTML = [
    `<option value="">${currentLabel}</option>`,
    ...seasons.map((season) => `<option value="${escapeHtml(season)}">${escapeHtml(season)}</option>`),
  ].join('');
  select.value = activeSeason && seasons.includes(activeSeason) ? activeSeason : '';
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
  button.setAttribute(
    'aria-label',
    value > 0
      ? t('seasonPass.badgeAria', { count: value })
      : t('seasonPass.badgeAriaPlain')
  );
}

function render(panel, data) {
  const list = panel.querySelector(`#${LIST_ID}`);
  const milestones = Array.isArray(data?.milestones) ? data.milestones : [];
  const closed = data?.closed === true || data?.readOnly === true;
  const progress = panel.querySelector('#season-pass-progress');
  if (progress) {
    const seasonLabel = seasonValue(data?.season);
    const finals = t('seasonPass.progressFinal', {
      label: seasonLabel,
      points: fmt(data?.points),
      max: fmt(data?.maxPoints),
    });
    const endsAt = Number(data?.endsAt);
    const remain = Number.isFinite(endsAt)
      ? t('seasonPass.progressUntil', {
          date: new Date(endsAt).toLocaleDateString(getLocale() === 'en-US' ? 'en-US' : 'zh-CN'),
        })
      : '';
    progress.textContent = closed
      ? finals
      : `${seasonLabel} ${fmt(data?.points)} / ${fmt(data?.maxPoints)}${remain}`;
  }
  updateHistory(panel, data);
  updateClaimAll(data, closed);
  applyBadge(closed ? 0 : data?.claimableCount);

  if (!milestones.length) {
    list.innerHTML = `${sourcesBlock(data)}<p class="achievement-hint">${escapeHtml(
      t('seasonPass.noMilestones')
    )}</p>`;
    return;
  }
  list.innerHTML = `${sourcesBlock(data)}${milestones.map((item) => card(item, closed)).join('')}`;
  for (const button of list.querySelectorAll('[data-claim]')) {
    button.addEventListener('click', () => claim(panel, button.dataset.claim));
  }
  celebrate(list, pendingCelebration);
  pendingCelebration = null;
}

async function claim(panel, milestoneId) {
  const list = panel.querySelector(`#${LIST_ID}`);
  try {
    const data = await api.request('/api/season-pass/claim', {
      method: 'POST',
      body: { id: milestoneId },
    });
    const cores = document.getElementById('cores');
    const balance = Number(data?.wallet?.cores);
    if (cores && Number.isFinite(balance)) cores.textContent = String(balance);
    await load(panel);
  } catch (error) {
    const note = document.createElement('p');
    note.className = 'achievement-hint';
    note.textContent = error.message || t('seasonPass.claimFailed');
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
    const data = await api.request('/api/season-pass/claim-all', { method: 'POST' });
    const cores = document.getElementById('cores');
    const balance = Number(data?.wallet?.cores);
    if (cores && Number.isFinite(balance)) cores.textContent = String(balance);
    const awarded = Array.isArray(data?.awarded) ? data.awarded : [];
    pendingCelebration = new Set(awarded.map((item) => item?.id).filter(Boolean));
    await load(panel);
  } catch (error) {
    pendingCelebration = null;
    if (button) button.disabled = false;
    if (note) note.textContent = error.message || t('seasonPass.claimFailed');
  }
}

async function load(panel) {
  const list = panel.querySelector(`#${LIST_ID}`);
  list.innerHTML = `<p class="achievement-hint">${escapeHtml(t('seasonPass.loading'))}</p>`;
  const season = activeSeason;
  const url = season
    ? `/api/season-pass?season=${encodeURIComponent(season)}`
    : '/api/season-pass';
  try {
    const data = await api.request(url);
    render(panel, data);
  } catch (error) {
    if (error?.status === 401) {
      list.innerHTML = `<p class="achievement-hint">${escapeHtml(t('seasonPass.loginRequired'))}</p>`;
      return;
    }
    list.innerHTML = `<p class="achievement-hint">${escapeHtml(error?.message || t('seasonPass.loadFailed'))}</p>`;
  }
}

// 角标在进入大厅时就刷新，未打开面板也能看到可领取数量；失败不阻塞大厅。
async function refreshBadge() {
  try {
    const data = await api.request('/api/season-pass');
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
  ensureBadge(button);
  ensureToolbar(panel);

  createPanel({
    id: PANEL_ID,
    trigger: button,
    closeSelector: '#btn-season-pass-close',
    onOpen: (node) => {
      activeSeason = null;
      load(node);
    },
  });

  refreshBadge();
}

registerPanel('season-pass', install);
