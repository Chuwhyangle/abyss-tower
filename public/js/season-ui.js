// 赛季面板：展示上赛季结算结果（名次 / 发放星核）与当前赛季个人进度、剩余时间。
// 数据全部来自排行榜接口聚合结果，客户端不做排名计算；无结算时展示明确占位。
import { t } from './i18n.js';

const PANEL_ID = 'season-panel';
const BODY_ID = 'season-body';
const SEASON_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const STYLE = `
  #season-panel {
    margin-top: 18px;
    padding: 18px 20px;
    border: 1px solid var(--line, #22333f);
    border-radius: var(--radius, 16px);
    background: rgba(13, 21, 27, 0.94);
    text-align: left;
    max-width: 100%;
    box-sizing: border-box;
    overflow-wrap: anywhere;
  }
  #season-panel[hidden] { display: none; }
  .season-head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 12px;
  }
  .season-head h2 {
    margin: 0;
    font-size: 18px;
    letter-spacing: 0.04em;
  }
  .season-head .season-tag {
    font-size: 12px;
    color: var(--muted, #8fa3b2);
    font-family: var(--font-mono, monospace);
  }
  .season-head .icon-btn { margin-left: auto; }
  .season-block + .season-block {
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid rgba(120, 160, 175, 0.12);
  }
  .season-block h3 {
    margin: 0 0 10px;
    font-size: 13px;
    letter-spacing: 0.06em;
    color: var(--muted, #8fa3b2);
  }
  .season-cells {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 8px;
  }
  .season-cell {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    padding: 10px 12px;
    border: 1px solid rgba(120, 160, 175, 0.16);
    border-radius: 10px;
    overflow-wrap: anywhere;
  }
  .season-cell span {
    font-size: 11px;
    letter-spacing: 0.06em;
    color: var(--muted, #8fa3b2);
  }
  .season-cell b {
    font-size: 16px;
    font-family: var(--font-mono, monospace);
    color: var(--gold, #ffd36b);
  }
  .season-hint {
    margin: 10px 0 0;
    font-size: 12px;
    color: var(--muted, #8fa3b2);
    overflow-wrap: anywhere;
  }
  .season-empty {
    padding: 16px 4px;
    text-align: center;
    overflow-wrap: anywhere;
  }
  .season-empty p {
    margin: 0 0 6px;
    color: var(--muted, #8fa3b2);
    font-size: 13px;
  }
  .season-empty small {
    color: var(--muted, #8fa3b2);
    font-size: 11.5px;
    opacity: 0.8;
  }
`;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]);
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function validSeason(season) {
  return typeof season === 'string' && SEASON_KEY_RE.test(season);
}

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US');
}

// 上一个月对应的赛季键；非法输入返回 null，避免面板因脏数据崩溃。
export function previousSeason(season) {
  if (!validSeason(season)) return null;
  const [year, month] = season.split('-').map(Number);
  return month === 1 ? `${year - 1}-12` : `${year}-${pad2(month - 1)}`;
}

// 赛季结束时刻（下个自然月 1 日零点，服务器本地时区）；非法输入返回 NaN。
export function seasonEndMs(season) {
  if (!validSeason(season)) return Number.NaN;
  const [year, month] = season.split('-').map(Number);
  return new Date(year, month, 1).getTime();
}

// 倒计时文案：按天 / 小时 / 分钟三档收敛，负数按 0 处理。
export function formatRemaining(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return t('season.remaining.days', { days, hours, minutes });
  if (hours > 0) return t('season.remaining.hours', { hours, minutes });
  return t('season.remaining.minutes', { minutes });
}

// 名次文案：有效名次显示「第 N 名」，否则「未上榜」。
export function rankText(rank) {
  const value = Math.floor(Number(rank));
  if (!Number.isFinite(value) || value <= 0) return t('season.unranked');
  return t('season.rankValue', { rank: value });
}

export function formatSettledAt(timestamp) {
  const date = new Date(Number(timestamp));
  if (!Number.isFinite(timestamp) || Number.isNaN(date.getTime())) return '—';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function cell(label, value) {
  return `
    <div class="season-cell">
      <span>${escapeHtml(label)}</span>
      <b>${escapeHtml(value)}</b>
    </div>`;
}

function lastResultBlock(result) {
  const settled = Number(result?.rank) > 0;
  const heading = `<h3>${escapeHtml(t('season.lastResult'))}</h3>`;
  if (!settled) {
    return `
      <div class="season-block season-last">
        ${heading}
        <div class="season-empty" role="status">
          <p>${escapeHtml(t('season.noResult'))}</p>
          <small>${escapeHtml(t('season.noResultHint'))}</small>
        </div>
      </div>`;
  }
  return `
    <div class="season-block season-last">
      ${heading}
      <div class="season-cells">
        ${cell(t('season.rankLabel'), rankText(result.rank))}
        ${cell(t('season.coresLabel'), `◈ ${fmt(result.cores)}`)}
        ${cell(t('season.settledAtLabel'), formatSettledAt(result.settledAt))}
      </div>
    </div>`;
}

// 纯函数：给定接口数据返回面板 HTML；Node 下可直接调用，便于源码级测试。
export function renderSeasonPanel({ season, result, me, remainingMs } = {}) {
  const seasonLabel = validSeason(season) ? season : '—';
  const rank = me?.rank;
  const best = me?.best?.score;
  const current = `
    <div class="season-block season-current">
      <h3>${escapeHtml(t('season.current'))} · ${escapeHtml(seasonLabel)}</h3>
      <div class="season-cells">
        ${cell(t('season.rankLabel'), rankText(rank))}
        ${cell(t('season.bestLabel'), best == null ? '—' : t('season.scoreValue', { score: fmt(best) }))}
        ${cell(t('season.remainingLabel'), formatRemaining(remainingMs))}
      </div>
      ${Number(rank) > 0 ? '' : `<p class="season-hint">${escapeHtml(t('season.progressEmpty'))}</p>`}
    </div>`;
  return `${lastResultBlock(result)}${current}`;
}

function ensureStyle() {
  if (document.getElementById('season-ui-style')) return;
  const style = document.createElement('style');
  style.id = 'season-ui-style';
  style.textContent = STYLE;
  document.head.appendChild(style);
}

function renderShell(panel) {
  panel.innerHTML = `
    <div class="season-head">
      <h2>${escapeHtml(t('season.title'))}</h2>
      <span class="season-tag">${escapeHtml(t('season.current'))}</span>
      <button id="btn-season-close" class="icon-btn" type="button" title="${escapeHtml(
        t('season.close')
      )}" aria-label="${escapeHtml(t('season.close'))}">✕</button>
    </div>
    <div id="${BODY_ID}"></div>
  `;
}

async function fetchJson(url) {
  const response = await fetch(url, { credentials: 'same-origin' });
  const data = await response.json().catch(() => null);
  if (response.status === 401) {
    const error = new Error(t('season.login'));
    error.code = 'unauthenticated';
    throw error;
  }
  if (!response.ok) throw new Error(data?.error || t('season.error'));
  return data;
}

async function load(panel) {
  const body = panel.querySelector(`#${BODY_ID}`);
  body.innerHTML = `<p class="season-hint">${escapeHtml(t('season.loading'))}</p>`;
  try {
    const board = await fetchJson('/api/leaderboard?mode=normal&size=1');
    const season = board?.season;
    const previous = previousSeason(season);
    let result = null;
    if (previous) {
      const payload = await fetchJson(
        `/api/leaderboard/seasons/${encodeURIComponent(previous)}/result`
      );
      result = payload?.result || null;
    }
    body.innerHTML = renderSeasonPanel({
      season,
      result,
      me: board?.me || null,
      remainingMs: seasonEndMs(season) - Date.now(),
    });
  } catch (error) {
    body.innerHTML = `
      <div class="season-empty" role="status">
        <p>${escapeHtml(error.message || t('season.error'))}</p>
      </div>`;
  }
}

function install() {
  const panel = document.getElementById(PANEL_ID);
  const trigger = document.getElementById('btn-season');
  if (!panel || !trigger) return;
  ensureStyle();
  renderShell(panel);

  const setOpen = (open) => {
    panel.hidden = !open;
    if (open) load(panel);
  };

  trigger.addEventListener('click', () => setOpen(panel.hidden));
  panel.querySelector('#btn-season-close')?.addEventListener('click', () => setOpen(false));
  document.addEventListener('i18n:change', () => {
    if (!panel.hidden) load(panel);
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
}
