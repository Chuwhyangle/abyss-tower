// 最近对局回放：在结算页回看这场对局的决策与结果时间线。
// 只消费 /api/replays 摘要，不做重演渲染；时间线节点全部来自种子、遗物、事件与结算数据。
import { RELIC_BY_ID } from './shared/data.js';

const API_URL = '/api/replays';
const STYLE_ID = 'replay-ui-style';
const LIMIT = 20;

const STYLE = `
  .replay-panel {
    margin-top: 18px;
    padding: 16px 18px;
    border: 1px solid var(--line, #22333f);
    border-radius: var(--radius, 16px);
    background: rgba(13, 21, 27, 0.9);
    text-align: left;
  }
  .replay-panel h3 { margin: 0 0 6px; font-size: 16px; letter-spacing: 0.04em; }
  .replay-hint { margin: 0 0 10px; font-size: 12px; color: var(--muted, #8fa3b2); }
  .replay-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 12px;
    max-height: 132px;
    overflow-y: auto;
  }
  .replay-item {
    font-family: var(--font-mono, monospace);
    font-size: 11.5px;
    padding: 5px 9px;
    border: 1px solid var(--line, #22333f);
    border-radius: 999px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .replay-item[aria-pressed="true"] {
    border-color: var(--gold, #ffd36b);
    color: var(--gold, #ffd36b);
  }
  .replay-timeline { display: flex; flex-direction: column; gap: 0; }
  .replay-node {
    position: relative;
    padding: 7px 0 7px 18px;
    border-left: 1px solid rgba(120, 160, 175, 0.28);
    font-size: 13px;
  }
  .replay-node::before {
    content: '';
    position: absolute;
    left: -4px;
    top: 13px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--muted, #8fa3b2);
  }
  .replay-node.event::before { background: var(--cyan, #6bd6ff); }
  .replay-node.end::before { background: var(--gold, #ffd36b); }
  .replay-node b { font-weight: 600; }
  .replay-node small { display: block; color: var(--muted, #8fa3b2); font-family: var(--font-mono, monospace); }
  .replay-relics { display: flex; flex-wrap: wrap; gap: 5px; margin: 8px 0 0; }
  .replay-relic {
    font-size: 10.5px;
    padding: 2px 7px;
    border: 1px solid currentColor;
    border-radius: 999px;
    color: var(--cyan, #6bd6ff);
  }
  .replay-empty { color: var(--muted, #8fa3b2); font-size: 12.5px; }
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

function relicName(id) {
  return RELIC_BY_ID[id]?.name || id;
}

function modifierName(modifier) {
  return modifier?.name || modifier?.id || '';
}

export function replayUrl(id) {
  return id ? `${API_URL}/${encodeURIComponent(id)}` : API_URL;
}

// 把一局摘要压成线性时间线：开局面板 → 事件节点 → 结算节点。
export function buildTimeline(replay) {
  if (!replay) return [];
  const map = replay.map || {};
  const waves = replay.waves || {};
  const result = replay.result || {};
  const reached = Number(result.waveReached ?? waves.reached ?? 0);
  const cleared = Number(waves.cleared ?? reached);
  const modifier = modifierName(map.modifier);
  const startDetail = [
    map.archetypeName || map.archetype || '未知地图',
    modifier ? `词缀 ${modifier}` : null,
    `种子 ${replay.seed || '—'}`,
  ]
    .filter(Boolean)
    .join(' · ');

  const nodes = [
    {
      kind: 'start',
      wave: 0,
      title: '开局',
      detail: startDetail,
    },
  ];

  const events = Array.isArray(replay.events) ? [...replay.events] : [];
  events.sort((a, b) => Number(a.wave) - Number(b.wave));
  for (const event of events) {
    const choice = event.optionId ? `选择 ${event.optionId}` : '未选择';
    nodes.push({
      kind: 'event',
      wave: Number(event.wave) || 0,
      title: `第 ${Number(event.wave) || 0} 波 · 事件`,
      detail: `${event.eventId || '未知事件'} · ${choice}`,
    });
  }

  nodes.push({
    kind: 'end',
    wave: reached,
    title: result.victory ? '通关' : `止步第 ${reached} 波`,
    detail: `已清 ${cleared} 波 · 得分 ${fmt(result.score)} · 击杀 ${fmt(result.kills)}`,
  });

  return nodes;
}

export function formatReplayEntry(entry) {
  if (!entry) return '';
  const tag = entry.victory ? '通关' : `第 ${Number(entry.waveReached) || 0} 波`;
  return `${tag} · ${fmt(entry.score)} 分 · 遗物 ${Number(entry.relicCount) || 0} 件`;
}

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.appendChild(style);
}

function renderTimeline(replay) {
  const nodes = buildTimeline(replay);
  const timeline = nodes
    .map(
      (node) => `
        <div class="replay-node ${escapeHtml(node.kind)}">
          <b>${escapeHtml(node.title)}</b>
          <small>${escapeHtml(node.detail)}</small>
        </div>`
    )
    .join('');
  const relics = Array.isArray(replay.relics) && replay.relics.length
    ? `<div class="replay-relics">${replay.relics
        .map(
          (relic) =>
            `<span class="replay-relic">${escapeHtml(relicName(relic.id))} Lv.${Number(relic.level) || 1}</span>`
        )
        .join('')}</div>`
    : '<p class="replay-empty">本局没有遗物。</p>';
  return `<div class="replay-timeline">${timeline}</div>${relics}`;
}

class ReplayUI {
  constructor() {
    this.installed = false;
    this.section = null;
    this.replays = [];
    this.selectedId = null;
  }

  install() {
    if (this.installed || typeof document === 'undefined') return;
    this.installed = true;
    injectStyle();
    const root = document.getElementById('modal-root');
    if (!root) return;
    this.observer = new MutationObserver(() => this.attachToResults(root));
    this.observer.observe(root, { childList: true, subtree: true });
    this.attachToResults(root);
  }

  attachToResults(root) {
    const modal = root.querySelector('.result-modal .result');
    if (!modal) return;
    if (modal.querySelector('[data-replay-panel]')) return;
    const section = document.createElement('section');
    section.className = 'replay-panel';
    section.dataset.replayPanel = '';
    this.section = section;
    this.selectedId = null;
    this.replays = [];
    section.innerHTML = `
      <h3>最近对局回放</h3>
      <p class="replay-hint">回看最近 ${LIMIT} 局的决策与结果摘要，不做实时重演。</p>
      <div class="replay-list" data-replay-list><span class="replay-empty">正在读取回放…</span></div>
      <div data-replay-detail></div>
    `;
    const actions = modal.querySelector('.modal-actions');
    modal.insertBefore(section, actions || null);
    this.load();
  }

  async load() {
    const section = this.section;
    if (!section) return;
    const list = section.querySelector('[data-replay-list]');
    const detail = section.querySelector('[data-replay-detail]');
    try {
      const response = await fetch(replayUrl(), { credentials: 'same-origin' });
      const data = await response.json().catch(() => null);
      if (response.status === 401) {
        list.innerHTML = '<span class="replay-empty">请先登录后查看回放。</span>';
        return;
      }
      if (!response.ok) throw new Error(data?.error || '读取回放失败');
      this.replays = Array.isArray(data?.replays) ? data.replays : [];
      if (!this.replays.length) {
        list.innerHTML = '<span class="replay-empty">还没有可回看的对局。</span>';
        detail.innerHTML = '';
        return;
      }
      list.innerHTML = this.replays
        .map(
          (entry) => `
            <button class="replay-item" type="button" data-replay-id="${escapeHtml(entry.id)}"
              aria-pressed="false">${escapeHtml(formatReplayEntry(entry))}</button>`
        )
        .join('');
      list.querySelectorAll('[data-replay-id]').forEach((button) => {
        button.addEventListener('click', () => this.select(button.dataset.replayId));
      });
      // 结算页默认展开最新一局（刚结算完的那局）。
      await this.select(this.replays[0].id);
    } catch (error) {
      list.innerHTML = `<span class="replay-empty">${escapeHtml(error.message || '读取回放失败')}</span>`;
    }
  }

  async select(id) {
    const section = this.section;
    if (!section || !id) return;
    const detail = section.querySelector('[data-replay-detail]');
    this.selectedId = id;
    section.querySelectorAll('[data-replay-id]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.replayId === id));
    });
    detail.innerHTML = '<p class="replay-empty">正在读取时间线…</p>';
    try {
      const response = await fetch(replayUrl(id), { credentials: 'same-origin' });
      const data = await response.json().catch(() => null);
      if (response.status === 401) {
        detail.innerHTML = '<p class="replay-empty">请先登录后查看回放。</p>';
        return;
      }
      if (!response.ok) throw new Error(data?.error || '读取回放失败');
      if (this.selectedId !== id) return;
      detail.innerHTML = renderTimeline(data.replay || {});
    } catch (error) {
      detail.innerHTML = `<p class="replay-empty">${escapeHtml(error.message || '读取回放失败')}</p>`;
    }
  }
}

let singleton = null;

if (typeof document !== 'undefined') {
  singleton = new ReplayUI();
  singleton.install();
}

export { ReplayUI };
