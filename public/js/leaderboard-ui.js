// 排行榜面板：服务端分页 / 难度筛选 / 个人排名，只消费接口聚合结果。
import { DIFFICULTIES, DIFFICULTY_ORDER } from './shared/data.js';
import { iconSvg } from './render/canvas-shapes.js';
import { api } from './api.js';
import { escapeHtml } from './ui/kit/dom.js';
import { createPanel } from './ui/kit/panel.js';
import { fmt } from './ui/shared.js';
import { t, tData } from './i18n.js';
import { registerPanel } from './ui/registry.js';

const PANEL_ID = 'leaderboard-panel';
const STYLE_ID = 'leaderboard-ui-style';
const PAGE_SIZE = 10;

const STATE = {
  mode: 'normal',
  difficulty: '',
  // cursors[0] 恒为首页（null）；index 指向当前页，翻页只前进/回退游标。
  cursors: [null],
  index: 0,
  totalPages: 1,
  day: '',
  loading: false,
  nextCursor: null,
};

function resetPaging() {
  STATE.cursors = [null];
  STATE.index = 0;
  STATE.nextCursor = null;
}

const STYLE = `
  #leaderboard-panel {
    margin-top: 18px;
    padding: 18px 20px;
    border: 1px solid var(--line, #22333f);
    border-radius: var(--radius, 16px);
    background: rgba(13, 21, 27, 0.94);
    text-align: left;
  }
  #leaderboard-panel[hidden] { display: none; }
  .lb-head {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }
  .lb-head h2 {
    margin: 0;
    font-size: 18px;
    letter-spacing: 0.04em;
  }
  .lb-head .icon-btn { margin-left: auto; }
  .lb-summary {
    font-size: 12px;
    color: var(--muted, #8fa3b2);
  }
  .lb-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: space-between;
    margin-bottom: 10px;
  }
  .lb-tabs, .lb-diffs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .lb-checks {
    border: 1px solid var(--line, #22333f);
    background: transparent;
    color: var(--muted, #8fa3b2);
    padding: 6px 11px;
    border-radius: 9px;
    font-size: 12px;
    cursor: pointer;
  }
  .lb-checks.active {
    border-color: rgba(255, 211, 107, 0.5);
    background: rgba(255, 211, 107, 0.08);
    color: var(--gold, #ffd36b);
  }
  .lb-list { border-top: 1px solid rgba(120, 160, 175, 0.12); }
  .lb-row {
    display: grid;
    grid-template-columns: 38px 1fr 118px 104px;
    align-items: center;
    gap: 10px;
    padding: 9px 6px;
    border-bottom: 1px solid rgba(120, 160, 175, 0.1);
    font-size: 13px;
  }
  .lb-row.me {
    background: rgba(255, 211, 107, 0.08);
    border-radius: 8px;
    box-shadow: inset 2px 0 0 var(--gold, #ffd36b);
  }
  .lb-rank { font-family: var(--font-mono, monospace); color: var(--muted, #8fa3b2); }
  .lb-rank.top { color: var(--gold, #ffd36b); font-weight: 700; }
  .lb-name {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lb-name .win-mark { color: var(--gold, #ffd36b); font-style: normal; font-size: 12px; }
  .lb-name .me-mark {
    font-style: normal;
    font-size: 10px;
    color: var(--gold, #ffd36b);
    border: 1px solid currentColor;
    border-radius: 999px;
    padding: 1px 6px;
  }
  .lb-name .lb-suspect {
    font-style: normal;
    font-size: 10px;
    color: #ffb36b;
    border: 1px solid currentColor;
    border-radius: 999px;
    padding: 1px 6px;
    cursor: help;
  }
  .lb-suspect-note {
    margin: 8px 4px 0;
    font-size: 12px;
    color: var(--muted, #8fa3b2);
  }
  .lb-diff {
    font-size: 10px;
    letter-spacing: 0.08em;
    padding: 2px 6px;
    border: 1px solid currentColor;
    border-radius: 999px;
    opacity: 0.85;
  }
  .lb-wave { color: var(--muted, #8fa3b2); font-size: 11.5px; }
  .lb-score { text-align: right; font-family: var(--font-mono, monospace); }
  .lb-empty, .lb-hint {
    padding: 18px 4px;
    text-align: center;
    color: var(--muted, #8fa3b2);
    font-size: 13px;
  }
  .lb-foot {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    margin-top: 12px;
  }
  .lb-page { font-size: 12px; color: var(--muted, #8fa3b2); }
`;

// 无尽榜以波次为主、用时为辅展示；用时统一成 m:ss，避免每行长度跳动。
function fmtDuration(ms) {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function difficultyName(id) {
  // 难度名来自数据表：按 id 走词典，英文界面不得落到数据自带中文。
  return tData('difficulty', id, 'name', DIFFICULTIES[id]?.name || id || t('data.difficulty.standard.name'));
}

function difficultyColor(id) {
  return DIFFICULTIES[id]?.color || DIFFICULTIES.standard.color;
}

function buildShell() {
  const difficultyButtons = [
    `<button class="lb-checks active" data-difficulty="">${t('leaderboard.all')}</button>`,
    ...DIFFICULTY_ORDER.map(
      (id) => `<button class="lb-checks" data-difficulty="${id}">${difficultyName(id)}</button>`
    ),
  ].join('');

  return `
    <div class="lb-head">
      <h2>${t('board.title')}</h2>
      <span id="lb-summary" class="lb-summary"></span>
      <button id="lb-close" class="icon-btn" data-panel-close type="button" title="${t('leaderboard.closeTitle')}">${iconSvg('close')}</button>
    </div>
    <div class="lb-controls">
      <div class="lb-tabs">
        <button class="lb-checks active" data-mode="normal">${t('leaderboard.modeNormal')}</button>
        <button class="lb-checks" data-mode="endless">${t('title.endless')}</button>
        <button class="lb-checks" data-mode="daily">${t('title.daily')}</button>
        <button class="lb-checks" data-mode="weekly">${t('title.weekly')}</button>
      </div>
      <div class="lb-diffs">${difficultyButtons}</div>
    </div>
    <div id="lb-list" class="lb-list"><p class="lb-hint">${t('leaderboard.loading')}</p></div>
    <p id="lb-suspect-note" class="lb-suspect-note" hidden>
      ${t('leaderboard.suspectNote')}
    </p>
    <div class="lb-foot">
      <button id="lb-prev" class="btn small ghost" type="button" disabled>${t('leaderboard.prevPage')}</button>
      <span id="lb-page" class="lb-page"></span>
      <button id="lb-next" class="btn small ghost" type="button" disabled>${t('leaderboard.nextPage')}</button>
    </div>
  `;
}

// 面板骨架只负责开关与加载；这里的控件接线通过 onMount 一次性完成。
function bindControls(panel, controller) {
  panel.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      if (STATE.mode === button.dataset.mode) return;
      STATE.mode = button.dataset.mode;
      resetPaging();
      markActive(panel);
      controller.reload();
    });
  });
  panel.querySelectorAll('[data-difficulty]').forEach((button) => {
    button.addEventListener('click', () => {
      if (STATE.difficulty === button.dataset.difficulty) return;
      STATE.difficulty = button.dataset.difficulty;
      resetPaging();
      markActive(panel);
      controller.reload();
    });
  });
  panel.querySelector('#lb-prev').addEventListener('click', () => {
    if (STATE.loading || STATE.index <= 0) return;
    STATE.index -= 1;
    controller.reload();
  });
  panel.querySelector('#lb-next').addEventListener('click', () => {
    if (STATE.loading || !STATE.nextCursor) return;
    // 只保留已走过的游标，首页到末页之间可自由回退。
    STATE.cursors = STATE.cursors.slice(0, STATE.index + 1);
    STATE.cursors.push(STATE.nextCursor);
    STATE.index += 1;
    controller.reload();
  });
}

function markActive(panel) {
  panel.querySelectorAll('[data-mode]').forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === STATE.mode);
  });
  panel.querySelectorAll('[data-difficulty]').forEach((button) => {
    button.classList.toggle('active', button.dataset.difficulty === STATE.difficulty);
  });
}

function renderRows(panel, data) {
  const list = panel.querySelector('#lb-list');
  const summary = panel.querySelector('#lb-summary');
  const entries = Array.isArray(data.entries) ? data.entries : [];
  const me = data.me || { rank: null, best: null };
  STATE.totalPages = Math.max(1, Number(data.totalPages) || 1);
  STATE.day = data.day || '';

  if (me.rank && me.best) {
    const best = me.best;
    const recent = me.latest || best;
    summary.textContent =
      STATE.mode === 'endless'
        ? t('leaderboard.meEndless', {
            rank: me.rank,
            best: Number(best.wave) || 0,
            recent: Number(recent.wave) || 0,
          })
        : t('leaderboard.meNormal', {
            rank: me.rank,
            best: fmt(best.score),
            recent: fmt(recent.score),
          });
  } else {
    summary.textContent = t('leaderboard.noScore');
  }

  const note = panel.querySelector('#lb-suspect-note');
  if (note) note.hidden = !entries.some((entry) => entry.suspect);

  if (!entries.length) {
    list.innerHTML = `<p class="lb-empty">${escapeHtml(t('leaderboard.empty'))}</p>`;
  } else {
    list.innerHTML = entries
      .map((entry) => {
        const rank = Number(entry.rank) || 0;
        // 徽标只对服务端标记为可疑的成绩显示，说明放在 title 里供悬停查看。
        const suspectBadge = entry.suspect
          ? `<em class="lb-suspect" title="${escapeHtml(
              entry.suspectReason || t('leaderboard.suspectTitle')
            )}">${t('leaderboard.suspectBadge')}</em>`
          : '';
        return `
          <div class="lb-row ${entry.isMe ? 'me' : ''}">
            <span class="lb-rank ${rank > 0 && rank <= 3 ? 'top' : ''}">${rank || '—'}</span>
            <span class="lb-name">
              ${escapeHtml(entry.name)}
              ${entry.title ? `<span class="player-title-badge">${escapeHtml(entry.title)}</span>` : ''}
              ${suspectBadge}
              ${entry.victory ? `<em class="win-mark" title="${t('leaderboard.wonTitle')}">${iconSvg('victory')}</em>` : ''}
              ${entry.isMe ? `<em class="me-mark">${t('leaderboard.meMark')}</em>` : ''}
              <span class="lb-diff" style="color:${difficultyColor(entry.difficulty)}">${escapeHtml(
                difficultyName(entry.difficulty)
              )}</span>
            </span>
            <span class="lb-wave">${t('hud.nextWave.meta', { wave: Number(entry.wave) || 0 })}${
              STATE.mode === 'endless' ? ` · ${fmtDuration(entry.durationMs)}` : ''
            }</span>
            <span class="lb-score">${fmt(entry.score)}</span>
          </div>`;
      })
      .join('');
  }

  STATE.nextCursor = data.nextCursor || null;
  panel.querySelector('#lb-page').textContent = t('leaderboard.pageInfo', {
    page: data.page || STATE.index + 1,
    pages: STATE.totalPages,
    total: Number(data.total) || 0,
  });
  STATE.loading = false;
  setPagingBusy(panel, false);
}

// 加载态：分页按钮在请求期间禁用，避免连点造成游标栈错位。
function setPagingBusy(panel, busy) {
  panel.querySelector('#lb-prev').disabled = busy || STATE.index <= 0;
  panel.querySelector('#lb-next').disabled = busy || !STATE.nextCursor;
}

function showLoading(panel) {
  STATE.loading = true;
  const list = panel.querySelector('#lb-list');
  list.innerHTML = `<p class="lb-hint">${t('leaderboard.loading')}</p>`;
  const note = panel.querySelector('#lb-suspect-note');
  if (note) note.hidden = true;
  setPagingBusy(panel, true);
}

function showFailure(panel, error) {
  STATE.loading = false;
  const list = panel.querySelector('#lb-list');
  if (!list) return;
  list.innerHTML =
    error?.status === 401
      ? `<p class="lb-hint">${t('leaderboard.login')}</p>`
      : `<p class="lb-hint">${escapeHtml(error?.message || t('leaderboard.error'))}</p>`;
  setPagingBusy(panel, false);
}

async function loadPage() {
  const params = new URLSearchParams({
    mode: STATE.mode,
    limit: String(PAGE_SIZE),
  });
  if (STATE.difficulty) params.set('difficulty', STATE.difficulty);
  const cursor = STATE.cursors[STATE.index];
  if (cursor) params.set('cursor', cursor);
  return api.request(`/api/leaderboard?${params}`);
}

function install() {
  const panel = document.getElementById(PANEL_ID);
  const trigger = document.getElementById('btn-board');
  if (!panel || !trigger) return;

  // 旧版排行榜由大厅 UI 的 onclick 打开弹窗；拦截模式在捕获阶段接管同一个按钮，
  // 用增强面板替代，避免两个排行榜界面同时出现。
  createPanel({
    id: PANEL_ID,
    trigger,
    style: STYLE,
    styleId: STYLE_ID,
    html: buildShell(),
    interceptClicks: true,
    load: loadPage,
    render: (node, data) => renderRows(node, data),
    loading: showLoading,
    failed: showFailure,
    onMount: (node, controller) => bindControls(node, controller),
  });
}

registerPanel('leaderboard', install);
