// 主海克斯：开局三选一面板（选中 → 确认 → 不可返回）与 HUD/标题页徽标。
// 文案全部来自 i18n（hex.* / hex.<id>.*）；数据（图标、颜色、scoreMul）来自共享注册表。
import { HEX_BY_ID } from '../shared/hexes.js';
import { t, tOr } from '../i18n.js';
import { escapeHtml } from './shared.js';

const BADGE_KEY = 'abyss-tower.hex.badge.v1';
const HUD_ANCHOR_ID = 'hud-difficulty';
const TITLE_ANCHOR = '.title-card';

function safeStorage(storage) {
  if (storage !== undefined) return storage;
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

// 测试会在 Node 里挂最小 document 桩：只有真正具备查询/创建能力时才操作 DOM。
function domReady() {
  return (
    typeof document !== 'undefined' &&
    typeof document.getElementById === 'function' &&
    typeof document.querySelector === 'function' &&
    typeof document.createElement === 'function'
  );
}

export function hexDefinition(id) {
  return typeof id === 'string' ? HEX_BY_ID[id] || null : null;
}

// 数据表只有中文原文；按 id 取当前语言文案，缺译名时回退注册表原文。
export const hexName = (def) => (def ? tOr(`hex.${def.id}.name`, def.name) : '');
export const hexPitch = (def) => (def ? tOr(`hex.${def.id}.pitch`, def.pitch) : '');
export const hexDownside = (def) => (def ? tOr(`hex.${def.id}.downside`, def.downside) : '');
export const hexTags = (def) =>
  def ? tOr(`hex.${def.id}.tags`, def.tags.join(' · ')) : '';

// 分数倍率文案：1.1 → ×1.10（与地图卡同一格式）。
export function hexScoreText(def) {
  const mul = Number(def?.scoreMul);
  return t('hex.score', { mul: (Number.isFinite(mul) ? mul : 1).toFixed(2) });
}

// 卡片视图（纯函数）：名称、图标、定位标签、强项、代价与 scoreMul。
export function hexCardView(def, index = 0) {
  if (!def) return '';
  const tags = hexTags(def)
    .split('·')
    .map((tag) => tag.trim())
    .filter(Boolean);
  return `
    <button class="hex-card" type="button" data-index="${index}" data-hex-id="${escapeHtml(def.id)}"
      style="--hex:${def.color}" aria-pressed="false">
      <div class="hex-card-head">
        <span class="hex-glyph" aria-hidden="true">${escapeHtml(def.glyph)}</span>
        <span class="hex-tags">${tags
          .map((tag) => `<i class="hex-tag">${escapeHtml(tag)}</i>`)
          .join('')}</span>
      </div>
      <h3>${escapeHtml(hexName(def))}</h3>
      <p class="hex-pitch">${escapeHtml(hexPitch(def))}</p>
      <div class="hex-tradeoff">
        <i>${escapeHtml(t('hex.downside'))}</i>
        <span>${escapeHtml(hexDownside(def))}</span>
      </div>
      <div class="hex-foot">
        <span class="hex-score">${escapeHtml(hexScoreText(def))}</span>
        <span class="pick">${escapeHtml(t('hex.pick'))}</span>
      </div>
    </button>`;
}

// 徽标视图（纯函数）：局内 HUD 与标题页共用，tooltip 给出强项与代价。
export function hexBadgeView(def) {
  if (!def) return '';
  const tip = [
    `<b>${escapeHtml(hexName(def))}</b>`,
    escapeHtml(hexPitch(def)),
    `${escapeHtml(t('hex.downside'))}：${escapeHtml(hexDownside(def))}`,
    escapeHtml(hexScoreText(def)),
  ].join('<br>');
  return {
    html: `
      <span class="hex-badge-glyph" aria-hidden="true">${escapeHtml(def.glyph)}</span>
      <span class="hex-badge-name">${escapeHtml(hexName(def))}</span>
      <span class="hex-badge-mul">×${(Number(def.scoreMul) || 1).toFixed(2)}</span>`,
    tip,
    label: hexName(def),
  };
}

// 徽标状态：记住最近一局的海克斯，标题页在刷新后仍能显示；局内徽标由 RunController 刷新。
export class HexBadge {
  constructor({ storage } = {}) {
    this.storage = safeStorage(storage);
    this.id = this.read();
    this._bound = false;
  }

  read() {
    try {
      const stored = this.storage?.getItem?.(BADGE_KEY);
      return hexDefinition(stored) ? stored : null;
    } catch {
      return null;
    }
  }

  remember(hexId) {
    const def = hexDefinition(hexId);
    this.id = def ? def.id : null;
    try {
      if (def) this.storage?.setItem?.(BADGE_KEY, def.id);
      else this.storage?.removeItem?.(BADGE_KEY);
    } catch {
      /* 存储不可用时只保留内存状态 */
    }
    return this.definition;
  }

  get definition() {
    return hexDefinition(this.id);
  }

  // 语言切换后重渲染两处徽标（tooltip 文案随语言变化）。
  bindLocale() {
    if (this._bound || !domReady() || typeof document.addEventListener !== 'function') return;
    this._bound = true;
    document.addEventListener('i18n:change', () => this.render());
  }

  mount() {
    if (!domReady()) return this;
    this.bindLocale();
    this.render();
    return this;
  }

  // 局内：插到难度徽标之前；标题页：插到主营卡片顶部。缺失元素时静默跳过。
  render() {
    if (!domReady()) return this;
    const def = this.definition;
    const hud = document.getElementById(HUD_ANCHOR_ID);
    if (hud?.parentElement) {
      let node = hud.parentElement.querySelector('.hex-badge.hud');
      if (!def) {
        node?.remove();
      } else {
        if (!node) {
          node = document.createElement('div');
          node.className = 'hex-badge hud';
          hud.insertAdjacentElement('beforebegin', node);
        }
        this.fill(node, def);
      }
    }
    const title = document.querySelector(TITLE_ANCHOR);
    if (title && def) {
      let node = title.querySelector('.hex-badge.title');
      if (!node) {
        node = document.createElement('div');
        node.className = 'hex-badge title';
        node.hidden = true;
        const anchor = title.querySelector('.title-actions');
        if (anchor) anchor.insertAdjacentElement('beforebegin', node);
        else title.prepend(node);
      }
      this.fill(node, def);
      node.hidden = false;
    } else if (!def) {
      title?.querySelector('.hex-badge.title')?.remove();
    }
    return this;
  }

  fill(node, def) {
    const view = hexBadgeView(def);
    node.innerHTML = view.html;
    node.dataset.tip = view.tip;
    node.setAttribute('role', 'img');
    node.setAttribute('aria-label', view.label);
  }
}

// 单例：run.js 只调用 UI 方法，DOM 细节留在这里。
let badgeSingleton = null;
export function hexBadge() {
  if (!badgeSingleton) badgeSingleton = new HexBadge();
  return badgeSingleton;
}

export const hexSelectMethods = {
  // 开局海克斯三选一：先点选卡片，再确认；确认后弹窗关闭且流程不可返回。
  showHexSelect({ offers = [], onChoose, onCancel = null } = {}) {
    const defs = offers.map(hexDefinition).filter(Boolean);
    if (!defs.length) return false;
    this.hexChoosingId = null;
    const cards = defs.map((def, index) => hexCardView(def, index)).join('');
    const modal = this.openModal(
      `
        <div class="hex-select">
          <p class="eyebrow">${t('hex.eyebrow')}</p>
          <h2>${t('hex.title')}</h2>
          <p class="muted">${t('hex.note')}</p>
          <div class="hex-cards">${cards}</div>
          <div class="modal-actions">
            ${onCancel ? `<button class="btn ghost" id="btn-cancel-hex">${t('hex.abandon')}</button>` : ''}
            <button class="btn primary" id="btn-confirm-hex" disabled>${t('hex.confirm')}</button>
          </div>
          <p class="muted hex-confirm-note">${t('hex.confirmNote')}</p>
        </div>
      `,
      { className: 'hex-modal', closable: false }
    );
    this.playViewEnter(modal);

    const confirm = modal.querySelector('#btn-confirm-hex');
    modal.querySelectorAll('.hex-card').forEach((card) => {
      card.onclick = () => {
        this.hexChoosingId = card.dataset.hexId;
        modal.querySelectorAll('.hex-card').forEach((item) => {
          const active = item === card;
          item.classList.toggle('selected', active);
          item.setAttribute('aria-pressed', String(active));
        });
        confirm.disabled = false;
        confirm.textContent = t('hex.confirmPick', { name: hexName(hexDefinition(this.hexChoosingId)) });
      };
    });
    confirm.onclick = () => {
      const id = this.hexChoosingId;
      if (!id) return;
      confirm.disabled = true;
      this.hexChoosingId = null;
      onChoose?.(id);
    };
    const cancel = modal.querySelector('#btn-cancel-hex');
    if (cancel) cancel.onclick = () => {
      this.hexChoosingId = null;
      onCancel?.();
    };
    return true;
  },

  // 更新徽标：传 id/定义时记住并显示；传 null 清除。无海克斯（旧局/新页面）不显示。
  updateHexBadge(hexOrId) {
    const badge = hexBadge();
    const id = typeof hexOrId === 'string' ? hexOrId : hexOrId?.id || null;
    if (id) badge.remember(id);
    else badge.remember(null);
    badge.mount();
    return badge.definition;
  },
};

// 页面加载即挂载标题页徽标（记住最近一局）；局内徽标由 RunController 在 beginGame 刷新。
if (domReady()) hexBadge().mount();
