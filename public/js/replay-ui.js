// 最近对局回放：在结算页回看这场对局的决策与结果时间线。
// 只消费 /api/replays 摘要，不做重演渲染；时间线节点全部来自种子、遗物、事件与结算数据。
// 详情页可把当前回放转成分享码，并把时间线复制成纯文本。
import { RELIC_BY_ID } from './shared/data.js';
import { validateRun } from './shared/replay.js';
import { getLocale } from './i18n.js';
import { copyToClipboard, errorText } from './share-ui.js';

const API_URL = '/api/replays';
const SHARE_API_URL = '/api/replay';
const STYLE_ID = 'replay-ui-style';
const LIMIT = 20;
const DEFAULT_LOCALE = 'zh-CN';

const COPY = {
  'zh-CN': {
    title: '最近对局回放',
    hint: '回看最近 {limit} 局的决策与结果摘要，不做实时重演。',
    loading: '正在读取回放…',
    authRequired: '请先登录后查看回放。',
    loadFailed: '读取回放失败',
    empty: '还没有可回看的对局。',
    timelineLoading: '正在读取时间线…',
    unknownMap: '未知地图',
    unknownEvent: '未知事件',
    modifier: '词缀 {name}',
    seed: '种子 {seed}',
    start: '开局',
    eventTitle: '第 {wave} 波 · 事件',
    choice: '选择 {option}',
    noChoice: '未选择',
    victory: '通关',
    stopAt: '止步第 {wave} 波',
    endDetail: '已清 {cleared} 波 · 得分 {score} · 击杀 {kills}',
    noRelics: '本局没有遗物。',
    entryVictory: '通关',
    entryWave: '第 {wave} 波',
    entry: '{tag} · {score} 分 · 遗物 {relics} 件',
    shareHint: '生成一段分享码，朋友可在大厅导入复现本局配置。',
    shareAction: '生成分享码',
    sharing: '生成中…',
    timelineAction: '复制时间线',
    codeLabel: '分享码',
    copy: '复制',
    copied: '已复制到剪贴板',
    copyManual: '无法自动复制，已选中文本，请按 Ctrl+C 复制',
    copyFailed: '无法自动复制，请手动选择文本',
    shareFailed: '分享码生成失败，请稍后再试',
    noData: '暂无可分享的回放数据',
    network: '网络异常，请稍后再试',
    timelineTitle: '渊塔守卫 · 回放摘要',
    timelineRelic: '{name} Lv.{level}',
    timelineRelics: '遗物：{list}',
  },
  'en-US': {
    title: 'Recent replays',
    hint: 'Review decisions and results from the last {limit} runs — no live re-simulation.',
    loading: 'Loading replays…',
    authRequired: 'Sign in to view your replays.',
    loadFailed: 'Could not load replays',
    empty: 'No replays to review yet.',
    timelineLoading: 'Loading timeline…',
    unknownMap: 'Unknown map',
    unknownEvent: 'Unknown event',
    modifier: 'Modifier {name}',
    seed: 'Seed {seed}',
    start: 'Start',
    eventTitle: 'Wave {wave} · Event',
    choice: 'Chose {option}',
    noChoice: 'No choice',
    victory: 'Victory',
    stopAt: 'Fell at wave {wave}',
    endDetail: '{cleared} waves cleared · Score {score} · Kills {kills}',
    noRelics: 'No relics this run.',
    entryVictory: 'Victory',
    entryWave: 'Wave {wave}',
    entry: '{tag} · {score} pts · {relics} relics',
    shareHint: 'Generate a share code friends can import in the lobby to reproduce this run.',
    shareAction: 'Generate share code',
    sharing: 'Generating…',
    timelineAction: 'Copy timeline',
    codeLabel: 'Share code',
    copy: 'Copy',
    copied: 'Copied to clipboard',
    copyManual: 'Automatic copy failed — the text is selected, press Ctrl+C to copy',
    copyFailed: 'Automatic copy failed — please select the text manually',
    shareFailed: 'Could not generate a share code — please try again later',
    noData: 'No replay data to share',
    network: 'Network error — please try again later',
    timelineTitle: 'Abyss Tower · Replay summary',
    timelineRelic: '{name} Lv.{level}',
    timelineRelics: 'Relics: {list}',
  },
};

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
  .replay-share {
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid rgba(120, 160, 175, 0.14);
  }
  .replay-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .replay-action {
    font-size: 12px;
    padding: 6px 11px;
    border: 1px solid var(--line, #22333f);
    border-radius: 10px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .replay-action[disabled] { opacity: 0.55; cursor: default; }
  .replay-status { font-size: 12px; line-height: 1.4; color: var(--muted, #8fa3b2); overflow-wrap: anywhere; }
  .replay-status.error { color: var(--red, #ff8b7a); }
  .replay-status.ok { color: var(--green, #7ad7a0); }
  .replay-code-value {
    width: 100%;
    box-sizing: border-box;
    margin: 10px 0;
    padding: 10px 12px;
    border: 1px dashed rgba(120, 160, 175, 0.35);
    border-radius: 10px;
    background: rgba(8, 13, 16, 0.72);
    color: var(--gold, #ffd36b);
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 12px;
    line-height: 1.55;
    overflow-wrap: anywhere;
    word-break: break-all;
    resize: vertical;
  }
`;

function copyFor(locale = getLocale()) {
  return COPY[locale] || COPY[DEFAULT_LOCALE];
}

function fill(template, params = {}) {
  return String(template).replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match
  );
}

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

function setStatus(node, text, tone) {
  if (!node) return;
  node.textContent = text || '';
  node.classList.toggle('ok', tone === 'ok');
  node.classList.toggle('error', tone === 'error');
}

function selectNodeText(element) {
  const selection = globalThis.getSelection?.();
  if (!element || !selection || typeof globalThis.document?.createRange !== 'function') {
    throw new Error('selection-unavailable');
  }
  const range = globalThis.document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function replayUrl(id) {
  return id ? `${API_URL}/${encodeURIComponent(id)}` : API_URL;
}

// 把一局摘要压成线性时间线：开局面板 → 事件节点 → 结算节点。
export function buildTimeline(replay, locale = getLocale()) {
  if (!replay) return [];
  const copy = copyFor(locale);
  const map = replay.map || {};
  const waves = replay.waves || {};
  const result = replay.result || {};
  const reached = Number(result.waveReached ?? waves.reached ?? 0);
  const cleared = Number(waves.cleared ?? reached);
  const modifier = modifierName(map.modifier);
  const startDetail = [
    map.archetypeName || map.archetype || copy.unknownMap,
    modifier ? fill(copy.modifier, { name: modifier }) : null,
    fill(copy.seed, { seed: replay.seed || '—' }),
  ]
    .filter(Boolean)
    .join(' · ');

  const nodes = [
    {
      kind: 'start',
      wave: 0,
      title: copy.start,
      detail: startDetail,
    },
  ];

  const events = Array.isArray(replay.events) ? [...replay.events] : [];
  events.sort((a, b) => Number(a.wave) - Number(b.wave));
  for (const event of events) {
    const wave = Number(event.wave) || 0;
    const choice = event.optionId ? fill(copy.choice, { option: event.optionId }) : copy.noChoice;
    nodes.push({
      kind: 'event',
      wave,
      title: fill(copy.eventTitle, { wave }),
      detail: `${event.eventId || copy.unknownEvent} · ${choice}`,
    });
  }

  nodes.push({
    kind: 'end',
    wave: reached,
    title: result.victory ? copy.victory : fill(copy.stopAt, { wave: reached }),
    detail: fill(copy.endDetail, {
      cleared,
      score: fmt(result.score),
      kills: fmt(result.kills),
    }),
  });

  return nodes;
}

export function formatReplayEntry(entry, locale = getLocale()) {
  if (!entry) return '';
  const copy = copyFor(locale);
  const tag = entry.victory
    ? copy.entryVictory
    : fill(copy.entryWave, { wave: Number(entry.waveReached) || 0 });
  return fill(copy.entry, {
    tag,
    score: fmt(entry.score),
    relics: Number(entry.relicCount) || 0,
  });
}

// 纯文本时间线：只含地图、种子、事件、结果与遗物，绝不含账号、回放 id 或时间戳。
export function formatTimelineText(replay, locale = getLocale()) {
  if (!replay) return '';
  const copy = copyFor(locale);
  const lines = [copy.timelineTitle];
  for (const node of buildTimeline(replay, locale)) {
    lines.push(`${node.title} · ${node.detail}`);
  }
  const relics = Array.isArray(replay.relics) ? replay.relics : [];
  if (relics.length) {
    const list = relics
      .map((relic) =>
        fill(copy.timelineRelic, {
          name: relicName(relic.id),
          level: Number(relic.level) || 1,
        })
      )
      .join(' · ');
    lines.push(fill(copy.timelineRelics, { list }));
  }
  return lines.join('\n');
}

// 回放摘要 → 分享码所需的对局字段；不支持的极端模式返回可读错误码。
export function buildShareRun(replay) {
  if (!replay) return { ok: false, code: 'REPLAY_INVALID_RUN' };
  const relics = (Array.isArray(replay.relics) ? replay.relics : [])
    .map((relic) => [relic.id, Number(relic.level) || 1]);
  const events = (Array.isArray(replay.events) ? replay.events : [])
    .map((event) => [Number(event.wave) || 0, event.eventId, event.optionId]);
  const result = validateRun({
    seed: replay.seed,
    mapChoice: replay.mapChoice,
    difficulty: replay.difficulty,
    mode: replay.mode,
    relics,
    events,
  });
  return result.ok ? { ok: true, run: result.run } : { ok: false, code: result.code };
}

// 调既有 /api/replay 生成分享码；网络异常与业务错误分开返回，供界面给出明确提示。
export async function requestShareCode(run, { fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') return { ok: false, code: null, offline: true };
  try {
    const response = await fetchImpl(SHARE_API_URL, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ run }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
      return { ok: false, code: data?.code || null, status: response.status };
    }
    const code = data.code;
    if (typeof code !== 'string' || code.length === 0) {
      return { ok: false, code: null, status: response.status };
    }
    return { ok: true, code };
  } catch {
    return { ok: false, code: null, offline: true };
  }
}

export function shareFailureText(response, locale = getLocale()) {
  if (response?.code) return errorText(response.code, locale);
  if (response?.offline) return copyFor(locale).network;
  return copyFor(locale).shareFailed;
}

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.appendChild(style);
}

function renderTimeline(replay) {
  const copy = copyFor();
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
    : `<p class="replay-empty">${escapeHtml(copy.noRelics)}</p>`;
  return `
    <div class="replay-timeline" data-replay-timeline>${timeline}</div>
    ${relics}
    <div class="replay-share">
      <p class="replay-hint">${escapeHtml(copy.shareHint)}</p>
      <div class="replay-actions">
        <button class="replay-action" type="button" data-replay-share>${escapeHtml(copy.shareAction)}</button>
        <button class="replay-action" type="button" data-replay-copy>${escapeHtml(copy.timelineAction)}</button>
        <span class="replay-status" role="status" aria-live="polite" data-replay-status></span>
      </div>
      <div data-replay-share-output hidden></div>
    </div>`;
}

class ReplayUI {
  constructor() {
    this.installed = false;
    this.section = null;
    this.replays = [];
    this.selectedId = null;
    this.selectedReplay = null;
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
    document.addEventListener('i18n:change', () => this.refreshCopy());
  }

  attachToResults(root) {
    const modal = root.querySelector('.result-modal .result');
    if (!modal) return;
    if (modal.querySelector('[data-replay-panel]')) return;
    const copy = copyFor();
    const section = document.createElement('section');
    section.className = 'replay-panel';
    section.dataset.replayPanel = '';
    this.section = section;
    this.selectedId = null;
    this.selectedReplay = null;
    this.replays = [];
    section.innerHTML = `
      <h3>${escapeHtml(copy.title)}</h3>
      <p class="replay-hint">${escapeHtml(fill(copy.hint, { limit: LIMIT }))}</p>
      <div class="replay-list" data-replay-list><span class="replay-empty">${escapeHtml(copy.loading)}</span></div>
      <div data-replay-detail></div>
    `;
    const actions = modal.querySelector('.modal-actions');
    modal.insertBefore(section, actions || null);
    this.load();
  }

  async load() {
    const section = this.section;
    if (!section) return;
    const copy = copyFor();
    const list = section.querySelector('[data-replay-list]');
    const detail = section.querySelector('[data-replay-detail]');
    try {
      const response = await fetch(replayUrl(), { credentials: 'same-origin' });
      const data = await response.json().catch(() => null);
      if (response.status === 401) {
        list.innerHTML = `<span class="replay-empty">${escapeHtml(copy.authRequired)}</span>`;
        return;
      }
      if (!response.ok) throw new Error(data?.error || copy.loadFailed);
      this.replays = Array.isArray(data?.replays) ? data.replays : [];
      if (!this.replays.length) {
        list.innerHTML = `<span class="replay-empty">${escapeHtml(copy.empty)}</span>`;
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
      list.innerHTML = `<span class="replay-empty">${escapeHtml(error.message || copy.loadFailed)}</span>`;
    }
  }

  async select(id) {
    const section = this.section;
    if (!section || !id) return;
    const copy = copyFor();
    const detail = section.querySelector('[data-replay-detail]');
    this.selectedId = id;
    section.querySelectorAll('[data-replay-id]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.replayId === id));
    });
    detail.innerHTML = `<p class="replay-empty">${escapeHtml(copy.timelineLoading)}</p>`;
    try {
      const response = await fetch(replayUrl(id), { credentials: 'same-origin' });
      const data = await response.json().catch(() => null);
      if (response.status === 401) {
        detail.innerHTML = `<p class="replay-empty">${escapeHtml(copy.authRequired)}</p>`;
        return;
      }
      if (!response.ok) throw new Error(data?.error || copy.loadFailed);
      if (this.selectedId !== id) return;
      this.renderDetail(detail, data.replay || {});
    } catch (error) {
      detail.innerHTML = `<p class="replay-empty">${escapeHtml(error.message || copy.loadFailed)}</p>`;
    }
  }

  renderDetail(detail, replay) {
    if (!detail) return;
    this.selectedReplay = replay || null;
    if (!replay) {
      detail.innerHTML = '';
      return;
    }
    detail.innerHTML = renderTimeline(replay);
    detail.querySelector('[data-replay-share]')?.addEventListener('click', () => this.generateShareCode(detail));
    detail.querySelector('[data-replay-copy]')?.addEventListener('click', () => this.copyTimeline(detail));
  }

  async generateShareCode(detail) {
    const copy = copyFor();
    const status = detail.querySelector('[data-replay-status]');
    const output = detail.querySelector('[data-replay-share-output]');
    const button = detail.querySelector('[data-replay-share]');
    if (!this.selectedReplay) {
      setStatus(status, copy.noData, 'error');
      return;
    }
    const built = buildShareRun(this.selectedReplay);
    if (!built.ok) {
      setStatus(status, errorText(built.code), 'error');
      if (output) {
        output.hidden = true;
        output.innerHTML = '';
      }
      return;
    }
    if (button) button.disabled = true;
    setStatus(status, copy.sharing, null);
    const response = await requestShareCode(built.run);
    if (button) button.disabled = false;
    if (!response.ok) {
      setStatus(status, shareFailureText(response), 'error');
      if (output) {
        output.hidden = true;
        output.innerHTML = '';
      }
      return;
    }
    setStatus(status, '', null);
    this.renderShareOutput(output, response.code);
  }

  renderShareOutput(output, code) {
    if (!output) return;
    const copy = copyFor();
    output.hidden = false;
    output.innerHTML = `
      <textarea class="replay-code-value" rows="3" readonly spellcheck="false"
        aria-label="${escapeHtml(copy.codeLabel)}" data-replay-code></textarea>
      <div class="replay-actions">
        <button class="replay-action" type="button" data-replay-code-copy>${escapeHtml(copy.copy)}</button>
        <span class="replay-status" role="status" aria-live="polite" data-replay-code-status></span>
      </div>
    `;
    const codeNode = output.querySelector('[data-replay-code]');
    codeNode.value = code;
    output.querySelector('[data-replay-code-copy]').addEventListener('click', () => this.copyCode(output));
  }

  async copyCode(output) {
    const codeNode = output.querySelector('[data-replay-code]');
    const status = output.querySelector('[data-replay-code-status]');
    const result = await copyToClipboard(codeNode?.value || '', {
      clipboard: globalThis.navigator?.clipboard,
      select: () => selectNodeText(codeNode),
    });
    const copy = copyFor();
    const message = result.ok ? copy.copied : result.selected ? copy.copyManual : copy.copyFailed;
    setStatus(status, message, result.ok ? 'ok' : 'error');
  }

  async copyTimeline(detail) {
    const copy = copyFor();
    const status = detail.querySelector('[data-replay-status]');
    const text = formatTimelineText(this.selectedReplay);
    if (!text) {
      setStatus(status, copy.noData, 'error');
      return;
    }
    const result = await copyToClipboard(text, {
      clipboard: globalThis.navigator?.clipboard,
      select: () => selectNodeText(detail.querySelector('[data-replay-timeline]')),
    });
    const message = result.ok ? copy.copied : result.selected ? copy.copyManual : copy.copyFailed;
    setStatus(status, message, result.ok ? 'ok' : 'error');
  }

  refreshCopy() {
    const section = this.section;
    if (!section || !section.isConnected) return;
    const copy = copyFor();
    const heading = section.querySelector('h3');
    const hint = section.querySelector('.replay-hint');
    if (heading) heading.textContent = copy.title;
    if (hint) hint.textContent = fill(copy.hint, { limit: LIMIT });
    section.querySelectorAll('[data-replay-id]').forEach((button) => {
      const entry = this.replays.find((item) => item.id === button.dataset.replayId);
      button.textContent = formatReplayEntry(entry);
    });
    if (this.selectedReplay) {
      this.renderDetail(section.querySelector('[data-replay-detail]'), this.selectedReplay);
    }
  }
}

let singleton = null;

if (typeof document !== 'undefined') {
  singleton = new ReplayUI();
  singleton.install();
}

export { ReplayUI };
