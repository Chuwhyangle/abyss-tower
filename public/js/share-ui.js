// 分享码玩家入口：结算页生成分享码，大厅输入框导入并校验。
// 只消费既有 /api/replay 接口与 shared/replay.js 的校验结果，不改变编码格式。
// 文案自持中英双语，跟随 i18n 当前语言；不依赖样式表（面板样式随模块注入）。
import { MAX_REPLAY_CODE_LENGTH, validateRun } from './shared/replay.js';
import { getLocale } from './i18n.js';

const API_URL = '/api/replay';
const STYLE_ID = 'share-ui-style';
const DEFAULT_LOCALE = 'zh-CN';

const COPY = {
  'zh-CN': {
    lobbyButton: '分享码',
    lobbyTitle: '分享码',
    close: '关闭',
    importLabel: '粘贴分享码',
    importPlaceholder: 'RTD1.…',
    importAction: '导入',
    validating: '校验中…',
    importOk: '分享码有效',
    runInfo: '对局信息',
    resultTitle: '分享本局',
    resultHint: '生成一段分享码，朋友可在大厅导入复现本局配置。',
    generate: '生成分享码',
    generating: '生成中…',
    copy: '复制',
    copied: '已复制到剪贴板',
    copyManual: '无法自动复制，已选中分享码，请按 Ctrl+C 复制',
    copyFailed: '无法自动复制，请手动选择分享码',
    network: '网络异常，请稍后再试',
    codeLength: '分享码长度 {n} / {max}',
    summary: '种子 {seed} · 难度 {difficulty} · 模式 {mode} · 遗物 {relics} · 事件 {events}',
    modes: { normal: '标准', daily: '每日', endless: '无尽' },
    difficulties: { roam: '漫游', standard: '远征', abyss: '深渊' },
    errors: {
      invalidRequest: '请提供分享码',
      empty: '请输入分享码',
      tooLong: '分享码过长（最多 {max} 个字符）',
      badFormat: '分享码格式不正确，请确认是否完整复制',
      badChecksum: '分享码校验失败，可能已损坏',
      badPayload: '分享码内容损坏',
      unsupportedVersion: '分享码版本不受支持，请更新游戏',
      unknownField: '分享码包含未知字段',
      malformed: '分享码损坏，无法解析',
      invalidRun: '对局数据无效',
      invalidSeed: '对局种子无效',
      invalidMap: '地图选择无效',
      invalidDifficulty: '难度无效',
      invalidMode: '当前模式不支持分享码',
      invalidRelics: '遗物数据无效',
      invalidEvents: '事件数据无效',
      authRequired: '请先登录后再使用分享码',
      invalid: '分享码无效',
    },
  },
  'en-US': {
    lobbyButton: 'Share code',
    lobbyTitle: 'Share code',
    close: 'Close',
    importLabel: 'Paste a share code',
    importPlaceholder: 'RTD1.…',
    importAction: 'Import',
    validating: 'Checking…',
    importOk: 'Share code is valid',
    runInfo: 'Run details',
    resultTitle: 'Share this run',
    resultHint: 'Generate a code that friends can import in the lobby to reproduce this run.',
    generate: 'Generate share code',
    generating: 'Generating…',
    copy: 'Copy',
    copied: 'Copied to clipboard',
    copyManual: 'Automatic copy failed — the code is selected, press Ctrl+C to copy',
    copyFailed: 'Automatic copy failed — please select the code manually',
    network: 'Network error — please try again later',
    codeLength: 'Share code length {n} / {max}',
    summary: 'Seed {seed} · {difficulty} · {mode} · Relics {relics} · Events {events}',
    modes: { normal: 'Standard', daily: 'Daily', endless: 'Endless' },
    difficulties: { roam: 'Roam', standard: 'Expedition', abyss: 'Abyss' },
    errors: {
      invalidRequest: 'Please provide a share code',
      empty: 'Enter a share code',
      tooLong: 'Share code is too long (max {max} characters)',
      badFormat: 'Invalid share code format — check that you copied it fully',
      badChecksum: 'Share code failed verification; it may be corrupted',
      badPayload: 'Share code contents are corrupted',
      unsupportedVersion: 'Unsupported share code version — please update the game',
      unknownField: 'Share code contains unknown fields',
      malformed: 'The share code is corrupted and cannot be parsed',
      invalidRun: 'Invalid run data',
      invalidSeed: 'Invalid run seed',
      invalidMap: 'Invalid map choice',
      invalidDifficulty: 'Invalid difficulty',
      invalidMode: 'This mode does not support share codes',
      invalidRelics: 'Invalid relic data',
      invalidEvents: 'Invalid event data',
      authRequired: 'Please sign in to use share codes',
      invalid: 'Invalid share code',
    },
  },
};

const ERROR_KEYS = {
  REPLAY_INVALID_REQUEST: 'invalidRequest',
  REPLAY_EMPTY: 'empty',
  REPLAY_TOO_LONG: 'tooLong',
  REPLAY_BAD_FORMAT: 'badFormat',
  REPLAY_BAD_CHECKSUM: 'badChecksum',
  REPLAY_BAD_PAYLOAD: 'badPayload',
  REPLAY_UNSUPPORTED_VERSION: 'unsupportedVersion',
  REPLAY_UNKNOWN_FIELD: 'unknownField',
  REPLAY_MALFORMED: 'malformed',
  REPLAY_INVALID_RUN: 'invalidRun',
  REPLAY_INVALID_SEED: 'invalidSeed',
  REPLAY_INVALID_MAP: 'invalidMap',
  REPLAY_INVALID_DIFFICULTY: 'invalidDifficulty',
  REPLAY_INVALID_MODE: 'invalidMode',
  REPLAY_INVALID_RELICS: 'invalidRelics',
  REPLAY_INVALID_EVENTS: 'invalidEvents',
  AUTH_REQUIRED: 'authRequired',
};

const STYLE = `
  #share-panel {
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
  #share-panel[hidden] { display: none; }
  .share-head {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }
  .share-head h2 {
    margin: 0;
    font-size: 18px;
    letter-spacing: 0.04em;
  }
  .share-head .icon-btn { margin-left: auto; }
  .share-label {
    display: block;
    margin: 12px 0 6px;
    font-size: 12px;
    letter-spacing: 0.06em;
    color: var(--muted, #8fa3b2);
  }
  .share-input,
  .share-code-value {
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    padding: 10px 12px;
    border: 1px solid rgba(120, 160, 175, 0.22);
    border-radius: 10px;
    background: rgba(8, 13, 16, 0.72);
    color: var(--text, #e6eef2);
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 12px;
    line-height: 1.55;
    overflow-wrap: anywhere;
    word-break: break-all;
  }
  .share-input {
    min-height: 74px;
    resize: vertical;
  }
  .share-code-value {
    margin: 10px 0;
    border-style: dashed;
    color: var(--gold, #ffd36b);
    white-space: pre-wrap;
    user-select: all;
  }
  .share-code-value:focus-visible {
    outline: 2px solid var(--focus-ring, #6bd6ff);
    outline-offset: 2px;
  }
  .share-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .share-status {
    font-size: 12px;
    line-height: 1.4;
    color: var(--muted, #8fa3b2);
    overflow-wrap: anywhere;
  }
  .share-status.error { color: var(--red, #ff8b7a); }
  .share-status.ok { color: var(--green, #7ad7a0); }
  .share-hint,
  .share-summary {
    margin: 0 0 10px;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--muted, #8fa3b2);
    overflow-wrap: anywhere;
  }
  .share-result-panel {
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid rgba(120, 160, 175, 0.14);
    text-align: left;
  }
  .share-result-panel h3 {
    margin: 0 0 8px;
    font-size: 13px;
    letter-spacing: 0.06em;
    color: var(--muted, #8fa3b2);
  }
  @media (max-width: 560px) {
    #share-panel { padding: 14px 14px; }
    .share-input,
    .share-code-value { font-size: 11px; padding: 8px 10px; }
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

// 错误码 → 可读文案；未知错误码回退到通用提示，绝不把裸错误码抛给玩家。
export function errorText(code, locale = getLocale()) {
  const copy = copyFor(locale);
  const key = ERROR_KEYS[code] || 'invalid';
  return fill(copy.errors[key] || copy.errors.invalid, { max: MAX_REPLAY_CODE_LENGTH });
}

// 分享码长度展示：小屏也完整显示当前码长与上限。
export function formatCodeLength(code, locale = getLocale()) {
  const length = typeof code === 'string' ? code.length : 0;
  return fill(copyFor(locale).codeLength, { n: length, max: MAX_REPLAY_CODE_LENGTH });
}

// 导入成功后的对局摘要；难度按当前语言取译名，缺失时回退原始值。
export function formatReplaySummary(run = {}, locale = getLocale()) {
  const copy = copyFor(locale);
  const difficulty = copy.difficulties[run.difficulty] || run.difficulty || '—';
  return fill(copy.summary, {
    seed: run.seed ?? '—',
    difficulty,
    mode: copy.modes[run.mode] || run.mode || '—',
    relics: Array.isArray(run.relics) ? run.relics.length : 0,
    events: Array.isArray(run.events) ? run.events.length : 0,
  });
}

// 从页面状态提取可编码的对局：结算时 state.run/state.sim 仍在内存中。
export function buildRunPayload(state = {}) {
  const run = state?.run || {};
  const sim = state?.sim || {};
  const payload = {
    seed: run.seed ?? sim.seed,
    mapChoice: run.mapChoice ?? sim.map?.index ?? 0,
    difficulty: run.difficulty ?? sim.difficulty,
    mode: run.mode ?? sim.mode,
    relics: (sim.relics || []).map((relic) => [relic.id, relic.level]),
    events: (sim.events || []).map((event) => [event.wave, event.eventId, event.optionId]),
  };
  const result = validateRun(payload);
  return result.ok ? { ok: true, run: result.run } : { ok: false, code: result.code };
}

// 剪贴板写入；不可用或被拒绝时回退为调用方提供的“手动选择”钩子。
export async function copyToClipboard(text, { clipboard, select } = {}) {
  const value = String(text ?? '');
  if (!value) return { ok: false, method: 'manual', selected: false };
  const api = clipboard ?? globalThis.navigator?.clipboard;
  if (api && typeof api.writeText === 'function') {
    try {
      await api.writeText(value);
      return { ok: true, method: 'clipboard' };
    } catch {
      /* 权限被拒或非安全上下文：继续走手动选择 */
    }
  }
  let selected = false;
  if (typeof select === 'function') {
    try {
      select(value);
      selected = true;
    } catch {
      selected = false;
    }
  }
  return { ok: false, method: 'manual', selected };
}

async function postReplay(body) {
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
      return { ok: false, code: data?.code || null, status: response.status };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, code: null, offline: true };
  }
}

function selectElementText(element) {
  const selection = globalThis.getSelection?.();
  if (!selection || typeof document.createRange !== 'function') {
    throw new Error('selection-unavailable');
  }
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

function setStatus(node, text, tone) {
  if (!node) return;
  node.textContent = text || '';
  node.classList.toggle('ok', tone === 'ok');
  node.classList.toggle('error', tone === 'error');
}

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.appendChild(style);
}

class ShareUI {
  constructor() {
    this.installed = false;
    this.lobby = null;
    this.button = null;
    this.resultSection = null;
    this.resultCode = '';
  }

  install() {
    if (this.installed || typeof document === 'undefined') return;
    this.installed = true;
    injectStyle();

    this.lobby = document.getElementById('share-panel');
    this.button = document.getElementById('btn-share');
    this.button?.addEventListener('click', () => this.toggleLobby());
    this.syncButton();

    const root = document.getElementById('modal-root');
    if (root) {
      this.observer = new MutationObserver(() => this.attachToResults(root));
      this.observer.observe(root, { childList: true, subtree: true });
      this.attachToResults(root);
    }
    document.addEventListener('i18n:change', () => this.refreshCopy());
  }

  syncButton() {
    if (!this.button) return;
    const label = copyFor().lobbyButton;
    this.button.textContent = label;
    this.button.title = label;
    this.button.setAttribute('aria-label', label);
  }

  toggleLobby() {
    if (!this.lobby) return;
    if (this.lobby.hidden) {
      this.renderLobby();
      this.lobby.hidden = false;
      this.lobby.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    } else {
      this.lobby.hidden = true;
    }
  }

  renderLobby() {
    if (!this.lobby) return;
    const copy = copyFor();
    const previous = this.lobby.querySelector('#share-import-input')?.value || '';
    this.lobby.innerHTML = `
      <div class="share-head">
        <h2>${escapeHtml(copy.lobbyTitle)}</h2>
        <button class="icon-btn" type="button" data-share-close title="${escapeHtml(copy.close)}"
          aria-label="${escapeHtml(copy.close)}">×</button>
      </div>
      <label class="share-label" for="share-import-input">${escapeHtml(copy.importLabel)}</label>
      <textarea id="share-import-input" class="share-input" rows="3" spellcheck="false"
        maxlength="${MAX_REPLAY_CODE_LENGTH}" placeholder="${escapeHtml(copy.importPlaceholder)}"></textarea>
      <div class="share-actions" style="margin-top:10px">
        <button class="btn small" type="button" data-share-import>${escapeHtml(copy.importAction)}</button>
        <span class="share-status" role="status" aria-live="polite" data-share-import-status></span>
      </div>
      <div data-share-import-result hidden></div>
    `;
    const input = this.lobby.querySelector('#share-import-input');
    input.value = previous;
    this.lobby.querySelector('[data-share-close]').onclick = () => {
      this.lobby.hidden = true;
    };
    const submit = () => this.importCode(input.value);
    this.lobby.querySelector('[data-share-import]').onclick = submit;
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        submit();
      }
    });
  }

  async importCode(raw) {
    if (!this.lobby) return;
    const status = this.lobby.querySelector('[data-share-import-status]');
    const result = this.lobby.querySelector('[data-share-import-result]');
    const code = String(raw || '').trim();
    if (!code) {
      setStatus(status, errorText('REPLAY_EMPTY'), 'error');
      return;
    }
    setStatus(status, copyFor().validating, null);
    const response = await postReplay({ code });
    if (!response.ok) {
      setStatus(status, this.failureText(response), 'error');
      if (result) {
        result.hidden = true;
        result.innerHTML = '';
      }
      return;
    }
    const run = response.data?.run || {};
    setStatus(status, copyFor().importOk, 'ok');
    if (result) {
      result.hidden = false;
      result.innerHTML = `
        <h3>${escapeHtml(copyFor().runInfo)}</h3>
        <p class="share-summary">${escapeHtml(formatReplaySummary(run))}</p>
      `;
    }
  }

  failureText(response) {
    if (response?.code) return errorText(response.code);
    if (response?.offline) return copyFor().network;
    return errorText(null);
  }

  attachToResults(root) {
    const modal = root.querySelector('.result-modal .result');
    if (!modal) return;
    if (modal.querySelector('[data-share-result]')) return;
    const section = document.createElement('section');
    section.className = 'share-result-panel';
    section.dataset.shareResult = '';
    this.resultSection = section;
    this.resultCode = '';
    this.buildResultSection(section);
    const actions = modal.querySelector('.modal-actions');
    modal.insertBefore(section, actions || null);
  }

  buildResultSection(section) {
    const copy = copyFor();
    const previousOutput = section.querySelector('[data-share-output]');
    const hadOutput = previousOutput ? !previousOutput.hidden : false;
    section.innerHTML = `
      <h3>${escapeHtml(copy.resultTitle)}</h3>
      <p class="share-hint">${escapeHtml(copy.resultHint)}</p>
      <div class="share-actions">
        <button class="btn small" type="button" data-share-generate>${escapeHtml(copy.generate)}</button>
        <span class="share-status" role="status" aria-live="polite" data-share-status></span>
      </div>
      <div data-share-output hidden></div>
    `;
    section.querySelector('[data-share-generate]').onclick = () => this.generate(section);
    if (hadOutput && this.resultCode) {
      this.renderOutput(section.querySelector('[data-share-output]'), this.resultCode);
    }
  }

  async generate(section) {
    const status = section.querySelector('[data-share-status]');
    const output = section.querySelector('[data-share-output]');
    const button = section.querySelector('[data-share-generate]');
    const built = buildRunPayload(globalThis.__rtd?.state || {});
    if (!built.ok) {
      setStatus(status, errorText(built.code), 'error');
      return;
    }
    if (button) button.disabled = true;
    setStatus(status, copyFor().generating, null);
    const response = await postReplay({ run: built.run });
    if (button) button.disabled = false;
    if (!response.ok) {
      setStatus(status, this.failureText(response), 'error');
      if (output) output.hidden = true;
      return;
    }
    const code = response.data?.code;
    if (typeof code !== 'string' || code.length === 0) {
      setStatus(status, errorText(null), 'error');
      return;
    }
    this.resultCode = code;
    setStatus(status, '', null);
    this.renderOutput(output, code);
  }

  renderOutput(output, code) {
    if (!output) return;
    const copy = copyFor();
    output.hidden = false;
    output.innerHTML = `
      <div class="share-code-value" tabindex="0" role="textbox" aria-readonly="true"
        aria-label="${escapeHtml(copy.resultTitle)}" data-share-code></div>
      <p class="share-status" data-share-length></p>
      <div class="share-actions">
        <button class="btn small" type="button" data-share-copy>${escapeHtml(copy.copy)}</button>
        <span class="share-status" role="status" aria-live="polite" data-share-copy-status></span>
      </div>
    `;
    const codeNode = output.querySelector('[data-share-code]');
    codeNode.textContent = code;
    output.querySelector('[data-share-length]').textContent = formatCodeLength(code);
    output.querySelector('[data-share-copy]').onclick = () => this.copyCode(output);
  }

  async copyCode(output) {
    const codeNode = output.querySelector('[data-share-code]');
    const status = output.querySelector('[data-share-copy-status]');
    const code = codeNode?.textContent || '';
    const result = await copyToClipboard(code, {
      clipboard: globalThis.navigator?.clipboard,
      select: () => selectElementText(codeNode),
    });
    const copy = copyFor();
    const message = result.ok ? copy.copied : result.selected ? copy.copyManual : copy.copyFailed;
    setStatus(status, message, result.ok ? 'ok' : 'error');
  }

  refreshCopy() {
    this.syncButton();
    if (this.lobby && !this.lobby.hidden) this.renderLobby();
    if (this.resultSection?.isConnected) this.buildResultSection(this.resultSection);
  }
}

let singleton = null;

if (typeof document !== 'undefined') {
  singleton = new ShareUI();
  singleton.install();
}

export { ShareUI };
