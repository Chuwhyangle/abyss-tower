// 排行榜面板：服务端分页 / 难度筛选 / 个人排名，只消费接口聚合结果。
import { DIFFICULTIES, DIFFICULTY_ORDER } from './shared/data.js';
import { iconSvg } from './render/canvas-shapes.js';

const PANEL_ID = 'leaderboard-panel';
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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]);
}

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US');
}

// 无尽榜以波次为主、用时为辅展示；用时统一成 m:ss，避免每行长度跳动。
function fmtDuration(ms) {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function ensureStyle() {
  if (document.getElementById('leaderboard-ui-style')) return;
  const style = document.createElement('style');
  style.id = 'leaderboard-ui-style';
  style.textContent = STYLE;
  document.head.appendChild(style);
}

function difficultyName(id) {
  return DIFFICULTIES[id]?.name || id || '远征';
}

function difficultyColor(id) {
  return DIFFICULTIES[id]?.color || DIFFICULTIES.standard.color;
}

function renderShell(panel) {
  const difficultyButtons = [
    `<button class="lb-checks active" data-difficulty="">全部</button>`,
    ...DIFFICULTY_ORDER.map(
      (id) => `<button class="lb-checks" data-difficulty="${id}">${difficultyName(id)}</button>`
    ),
  ].join('');

  panel.innerHTML = `
    <div class="lb-head">
      <h2>排行榜</h2>
      <span id="lb-summary" class="lb-summary"></span>
      <button id="lb-close" class="icon-btn" title="关闭排行榜">${iconSvg('close')}</button>
    </div>
    <div class="lb-controls">
      <div class="lb-tabs">
        <button class="lb-checks active" data-mode="normal">无尽远征</button>
        <button class="lb-checks" data-mode="endless">无尽模式</button>
        <button class="lb-checks" data-mode="daily">每日挑战</button>
        <button class="lb-checks" data-mode="weekly">本周挑战</button>
      </div>
      <div class="lb-diffs">${difficultyButtons}</div>
    </div>
    <div id="lb-list" class="lb-list"><p class="lb-hint">正在读取排行榜…</p></div>
    <div class="lb-foot">
      <button id="lb-prev" class="btn small ghost" disabled>上一页</button>
      <span id="lb-page" class="lb-page"></span>
      <button id="lb-next" class="btn small ghost" disabled>下一页</button>
    </div>
  `;

  panel.querySelector('#lb-close').addEventListener('click', () => {
    panel.hidden = true;
  });
  panel.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      if (STATE.mode === button.dataset.mode) return;
      STATE.mode = button.dataset.mode;
      resetPaging();
      markActive(panel);
      load(panel);
    });
  });
  panel.querySelectorAll('[data-difficulty]').forEach((button) => {
    button.addEventListener('click', () => {
      if (STATE.difficulty === button.dataset.difficulty) return;
      STATE.difficulty = button.dataset.difficulty;
      resetPaging();
      markActive(panel);
      load(panel);
    });
  });
  panel.querySelector('#lb-prev').addEventListener('click', () => {
    if (STATE.loading || STATE.index <= 0) return;
    STATE.index -= 1;
    load(panel);
  });
  panel.querySelector('#lb-next').addEventListener('click', () => {
    if (STATE.loading || !STATE.nextCursor) return;
    // 只保留已走过的游标，首页到末页之间可自由回退。
    STATE.cursors = STATE.cursors.slice(0, STATE.index + 1);
    STATE.cursors.push(STATE.nextCursor);
    STATE.index += 1;
    load(panel);
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
        ? `我的排名 #${me.rank} · 最佳第 ${Number(best.wave) || 0} 波 · 最近第 ${
            Number(recent.wave) || 0
          } 波`
        : `我的排名 #${me.rank} · 最佳 ${fmt(best.score)} · 最近 ${fmt(recent.score)}`;
  } else {
    summary.textContent = '你还没有成绩';
  }

  if (!entries.length) {
    list.innerHTML = '<p class="lb-empty">还没有记录，去拿下第一名。</p>';
  } else {
    list.innerHTML = entries
      .map((entry) => {
        const rank = Number(entry.rank) || 0;
        return `
          <div class="lb-row ${entry.isMe ? 'me' : ''}">
            <span class="lb-rank ${rank > 0 && rank <= 3 ? 'top' : ''}">${rank || '—'}</span>
            <span class="lb-name">
              ${escapeHtml(entry.name)}
              ${entry.title ? `<span class="player-title-badge">${escapeHtml(entry.title)}</span>` : ''}
              ${entry.victory ? `<em class="win-mark" title="已通关">${iconSvg('victory')}</em>` : ''}
              ${entry.isMe ? '<em class="me-mark">我</em>' : ''}
              <span class="lb-diff" style="color:${difficultyColor(entry.difficulty)}">${escapeHtml(
                difficultyName(entry.difficulty)
              )}</span>
            </span>
            <span class="lb-wave">第 ${Number(entry.wave) || 0} 波${
              STATE.mode === 'endless' ? ` · ${fmtDuration(entry.durationMs)}` : ''
            }</span>
            <span class="lb-score">${fmt(entry.score)}</span>
          </div>`;
      })
      .join('');
  }

  STATE.nextCursor = data.nextCursor || null;
  panel.querySelector('#lb-page').textContent =
    `第 ${data.page || STATE.index + 1} / ${STATE.totalPages} 页 · 共 ${Number(data.total) || 0} 条`;
  setPagingBusy(panel, false);
}

// 加载态：分页按钮在请求期间禁用，避免连点造成游标栈错位。
function setPagingBusy(panel, busy) {
  panel.querySelector('#lb-prev').disabled = busy || STATE.index <= 0;
  panel.querySelector('#lb-next').disabled = busy || !STATE.nextCursor;
}

async function load(panel) {
  if (STATE.loading) return;
  STATE.loading = true;
  const list = panel.querySelector('#lb-list');
  list.innerHTML = '<p class="lb-hint">正在读取排行榜…</p>';
  setPagingBusy(panel, true);
  const params = new URLSearchParams({
    mode: STATE.mode,
    limit: String(PAGE_SIZE),
  });
  if (STATE.difficulty) params.set('difficulty', STATE.difficulty);
  const cursor = STATE.cursors[STATE.index];
  if (cursor) params.set('cursor', cursor);
  try {
    const response = await fetch(`/api/leaderboard?${params}`, {
      credentials: 'same-origin',
    });
    const data = await response.json().catch(() => null);
    if (response.status === 401) {
      list.innerHTML = '<p class="lb-hint">请先登录后查看排行榜。</p>';
      return;
    }
    if (!response.ok) throw new Error(data?.error || '读取排行榜失败');
    renderRows(panel, data);
  } catch (error) {
    list.innerHTML = `<p class="lb-hint">${escapeHtml(error.message || '读取排行榜失败')}</p>`;
  } finally {
    STATE.loading = false;
    setPagingBusy(panel, false);
  }
}

function install() {
  const panel = document.getElementById(PANEL_ID);
  const trigger = document.getElementById('btn-board');
  if (!panel || !trigger) return;
  ensureStyle();
  renderShell(panel);

  // 旧版排行榜由大厅 UI 的 onclick 打开弹窗；这里在捕获阶段接管同一个按钮，
  // 用增强面板替代，避免两个排行榜界面同时出现。
  document.addEventListener(
    'click',
    (event) => {
      if (!event.target.closest?.(`#${trigger.id}`)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      panel.hidden = !panel.hidden;
      if (!panel.hidden) load(panel);
    },
    true
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', install, { once: true });
} else {
  install();
}
