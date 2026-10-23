// 通用弹窗：遮罩生命周期、遗物三选一、事件节点、选图、确认框与提示。
import { RELIC_BY_ID, RARITY, RELIC_LEVEL_LABELS, relicEffectText } from '../shared/data.js';
import { canAffordEventOption } from '../shared/events.js';
import { t } from '../i18n.js';
import { audio } from '../audio.js';
import { iconSvg, relicIconName } from '../render/canvas-shapes.js';
import { fmt, modifierName, modifierDesc, mapPreviewSvg, escapeHtml } from './shared.js';

export const modalMethods = {
  // ---------- 弹窗 ----------

  openModal(html, { className = '', closable = true, onClose = null } = {}) {
    this.modalClosable = closable;
    this._modalOnClose = onClose;
    this.el.modalRoot.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal ${className}">${html}</div>
      </div>
    `;
    const backdrop = this.el.modalRoot.querySelector('.modal-backdrop');
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop && this.modalClosable) this.closeModal();
    });
    return this.el.modalRoot.querySelector('.modal');
  },

  closeModal() {
    const onClose = this._modalOnClose;
    const cleanup = this._modalCleanup;
    this._modalOnClose = null;
    this._modalCleanup = null;
    if (this.el?.modalRoot) this.el.modalRoot.innerHTML = '';
    this.modalClosable = false;
    if (cleanup) cleanup();
    if (onClose) onClose();
  },

  closeModalIfClosable() {
    if (this.modalClosable) this.closeModal();
  },

  hasModal() {
    return !!this.el?.modalRoot?.querySelector('.modal');
  },

  showDraft({ wave, offers, rerolls, gold, cost = 25 }) {
    const used = rerolls?.used || 0;
    const max = rerolls?.max || 0;
    const cards = offers
      .map((offer, index) => {
        if (offer.kind === 'relic') {
          const relic = RELIC_BY_ID[offer.id];
          if (!relic) return '';
          const rarity = RARITY[relic.rarity];
          const fromLevel = Math.max(0, Math.min(3, offer.fromLevel || 0));
          const toLevel = Math.min(3, offer.toLevel || fromLevel + 1);
          const isUpgrade = fromLevel > 0;
          const levelLabel = isUpgrade
            ? `${RELIC_LEVEL_LABELS[fromLevel - 1]} → ${RELIC_LEVEL_LABELS[toLevel - 1]}`
            : t('draft.new');
          const effect = isUpgrade
            ? `<div class="relic-effect"><span>${t('draft.current')}</span>${relicEffectText(offer.id, fromLevel)}</div>
               <div class="relic-effect upgrade"><span>${t('draft.upgrade')}</span>${relicEffectText(offer.id, toLevel)}</div>`
            : `<div class="relic-effect"><span>${t('draft.effect')}</span>${relicEffectText(offer.id, toLevel)}</div>`;
          return `
            <button class="relic-card ${isUpgrade ? 'upgrade' : ''}" data-index="${index}" style="--rarity:${rarity.color}">
              <span class="rarity">${rarity.name} ${iconSvg(relicIconName(relic.rarity), 'icon-inline')}· ${levelLabel}</span>
              <h3>${relic.name}</h3>
              ${effect}
              <p class="relic-flavor">${relic.desc}</p>
              <span class="pick">${t('draft.pick')}</span>
            </button>
          `;
        }

        const isGold = offer.kind === 'gold';
        const amount = Math.max(0, Math.floor(offer.amount || 0));
        return `
          <button class="relic-card fallback" data-index="${index}" style="--rarity:#8fa3b2">
            <span class="rarity">${t('draft.supply')}</span>
            <h3>${isGold ? t('draft.goldSupply') : t('draft.repair')}</h3>
            <div class="relic-effect"><span>${t('draft.effect')}</span>${
              isGold ? t('draft.goldEffect', { n: amount }) : t('draft.repairEffect', { n: amount })
            }</div>
            <p class="relic-flavor">${t('draft.fallbackFlavor')}</p>
            <span class="pick">${t('draft.pick')}</span>
          </button>
        `;
      })
      .join('');

    const modal = this.openModal(
      `
        <div class="draft">
          <p class="eyebrow">${t('draft.eyebrow', { wave })}</p>
          <h2>${t('draft.title')}</h2>
          <div class="draft-cards">${cards}</div>
          <div class="draft-actions">
            <span class="muted">${t('draft.gold', { gold: fmt(gold) })}</span>
            <button class="btn ghost" id="btn-reroll" ${used >= max || gold < cost ? 'disabled' : ''}>
              ${t('draft.reroll', { cost })} <span class="muted">(${used}/${max})</span>
            </button>
          </div>
        </div>
      `,
      { className: 'draft-modal', closable: false }
    );

    modal.querySelectorAll('.relic-card').forEach((card) => {
      card.onclick = () => this.handlers.onPickOffer?.(Number(card.dataset.index));
    });
    const reroll = modal.querySelector('#btn-reroll');
    if (reroll) reroll.onclick = () => this.handlers.onReroll?.();
    audio.play('draft');
  },

  showMapSelect({ candidates, onChoose, onCancel }) {
    const cards = candidates
      .map((candidate, index) => {
        const modifier = candidate.modifier;
        const color = modifier?.color || '#9fb0c3';
        const preview = mapPreviewSvg(candidate);
        const portalCount = candidate.spawns?.length || 1;
        // 单入口地图即使 meta.merge 指向基地，也不应展示“汇流”文案。
        const desc =
          portalCount <= 1
            ? t('mapSelect.single')
            : candidate.archetype === 'cross'
              ? t('mapSelect.cross')
              : t('mapSelect.merge');
        return `
          <button class="map-card" data-index="${index}" style="--lane:${color}">
            <div class="map-preview">${preview}</div>
            <div class="map-card-head">
              <b>${candidate.archetypeName}</b>
              <span class="map-portals">${t('mapSelect.portals', { n: portalCount })}</span>
            </div>
            <p class="map-desc">${desc}</p>
            <div class="map-mod" style="color:${color}">
              <b>${modifierName(modifier) || t('mapSelect.noModifier')}</b>
              <span>${modifierDesc(modifier) || t('mapSelect.standard')}</span>
            </div>
            <div class="map-foot">
              <span>${t('mapSelect.score', { mul: candidate.meta?.scoreMul?.toFixed(2) || '1.00' })}</span>
              <span class="pick">${t('mapSelect.pick')}</span>
            </div>
          </button>`;
      })
      .join('');

    const modal = this.openModal(
      `
        <div class="map-select">
          <p class="eyebrow">${t('mapSelect.eyebrow')}</p>
          <h2>${t('mapSelect.title')}</h2>
          <p class="muted">${t('mapSelect.note')}</p>
          <div class="map-cards">${cards}</div>
          <div class="modal-actions">
            <button class="btn ghost" id="btn-cancel-map">${t('mapSelect.abandon')}</button>
          </div>
        </div>
      `,
      { className: 'map-modal', closable: false }
    );
    this.playViewEnter(modal);

    modal.querySelectorAll('.map-card').forEach((card) => {
      card.onclick = () => onChoose?.(Number(card.dataset.index));
    });
    modal.querySelector('#btn-cancel-map').onclick = () => onCancel?.();
  },

  // 局内事件节点：常规/稀有事件共用一套面板，选项数量随事件定义（键盘 1–N 选择）。
  showEventModal({ wave, event, gold, baseHp, maxHp, onChoose }) {
    if (!event) return;
    const options = event.options || [];
    const accent = event.rare ? '#b26bff' : '#c9a227';
    const cards = options
      .map((option, index) => {
        const affordable = canAffordEventOption(option, { gold, baseHp, maxHp });
        return `
          <button class="relic-card event-card ${affordable ? '' : 'locked'}" data-index="${index}"
            ${affordable ? '' : 'disabled'} style="--rarity:${accent}">
            <span class="rarity">${event.rare ? '稀有事件' : '事件'} · ${index + 1}</span>
            <h3>${escapeHtml(option.name)}</h3>
            <p class="relic-flavor">${escapeHtml(option.desc)}</p>
            <span class="pick">${affordable ? '选择' : '资源不足'}</span>
          </button>
        `;
      })
      .join('');

    const modal = this.openModal(
      `
        <div class="event-node">
          <p class="eyebrow">第 ${wave} 波 · 事件节点</p>
          <h2>${escapeHtml(event.name)}</h2>
          <p class="muted">${escapeHtml(event.desc)}</p>
          <div class="draft-cards">${cards}</div>
          <div class="draft-actions">
            <span class="muted">键盘 1–${options.length} 选择</span>
          </div>
        </div>
      `,
      { className: 'event-modal', closable: false }
    );

    modal.querySelectorAll('.event-card').forEach((card) => {
      if (card.disabled) return;
      card.onclick = () => onChoose?.(Number(card.dataset.index));
    });

    const onKey = (event) => {
      const index = Number(event.key);
      if (!Number.isInteger(index) || index < 1 || index > options.length) return;
      if (!canAffordEventOption(options[index - 1], { gold, baseHp, maxHp })) return;
      event.preventDefault();
      onChoose?.(index - 1);
    };
    window.addEventListener('keydown', onKey);
    this._modalCleanup = () => window.removeEventListener('keydown', onKey);
    audio.play('draft');
  },

  showConfirm({ title, text, confirmText = null, danger = false, onConfirm }) {
    const modal = this.openModal(
      `
        <div class="confirm">
          <h2>${title}</h2>
          <p>${text}</p>
          <div class="modal-actions">
            <button class="btn ${danger ? 'danger' : 'primary'}" id="btn-confirm-yes">${confirmText ?? t('common.confirm')}</button>
            <button class="btn ghost" id="btn-confirm-no">${t('common.cancel')}</button>
          </div>
        </div>
      `,
      { className: 'confirm-modal', closable: true }
    );
    modal.querySelector('#btn-confirm-yes').onclick = () => {
      this.closeModal();
      onConfirm?.();
    };
    modal.querySelector('#btn-confirm-no').onclick = () => this.closeModal();
  },

  promptName(current, onSave) {
    const modal = this.openModal(
      `
        <div class="confirm">
          <h2>${t('prompt.title')}</h2>
          <p class="muted">${t('prompt.note')}</p>
          <input id="name-input" class="text-input" maxlength="16" value="${escapeHtml(current || '')}" />
          <div class="modal-actions">
            <button class="btn primary" id="btn-name-save">${t('common.save')}</button>
            <button class="btn ghost" id="btn-name-cancel">${t('common.cancel')}</button>
          </div>
        </div>
      `,
      { className: 'confirm-modal', closable: true }
    );
    const input = modal.querySelector('#name-input');
    input.focus();
    input.select();
    const save = () => {
      const value = input.value.trim();
      if (!value) return;
      this.closeModal();
      onSave?.(value);
    };
    modal.querySelector('#btn-name-save').onclick = save;
    modal.querySelector('#btn-name-cancel').onclick = () => this.closeModal();
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') save();
    });
  },

  toast(message, duration = 1900) {
    if (!this.el?.toast) return;
    clearTimeout(this._toastTimer);
    this.el.toast.textContent = message;
    this.el.toast.hidden = false;
    requestAnimationFrame(() => this.el.toast.classList.add('show'));
    this._toastTimer = setTimeout(() => {
      this.el.toast.classList.remove('show');
      setTimeout(() => {
        this.el.toast.hidden = true;
      }, 260);
    }, duration);
  },
};
