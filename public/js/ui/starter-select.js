// 信物三选一：开局面板（选中 → 确认 → 不可返回）。候选 id 由服务端权威下发，
// 这里只按 id 渲染静态遗物定义、不自造候选；文案全部来自 i18n（starter.* / draft.*）。
import { RELIC_BY_ID, RARITY, relicEffectText } from '../shared/data.js';
import { t } from '../i18n.js';
import { iconSvg, relicIconName } from '../render/canvas-shapes.js';
import { escapeHtml } from './shared.js';

export const starterSelectMethods = {
  showStarterSelect({ offers = [], onChoose, onCancel = null } = {}) {
    const cards = offers
      .map((id, index) => {
        const relic = RELIC_BY_ID[id];
        if (!relic) return '';
        const rarity = RARITY[relic.rarity];
        return `
          <button class="relic-card" data-index="${index}" data-relic-id="${escapeHtml(relic.id)}"
            style="--rarity:${rarity.color}" aria-pressed="false">
            <span class="rarity">${rarity.name} ${iconSvg(relicIconName(relic.rarity), 'icon-inline')}· ${t('draft.new')}</span>
            <span class="faction-tag">${t('draft.faction')} · ${t(`faction.${relic.faction}.name`)}</span>
            <h3>${relic.name}</h3>
            <div class="relic-effect"><span>${t('draft.effect')}</span>${relicEffectText(relic.id, 1)}</div>
            <p class="relic-flavor">${relic.desc}</p>
            <span class="pick">${t('draft.pick')}</span>
          </button>
        `;
      })
      .join('');
    if (!cards) return false;

    this.starterChoosingId = null;
    const modal = this.openModal(
      `
        <div class="draft starter-select">
          <p class="eyebrow">${t('starter.eyebrow')}</p>
          <h2>${t('starter.title')}</h2>
          <p class="muted">${t('starter.note')}</p>
          <div class="draft-cards">${cards}</div>
          <div class="modal-actions">
            ${onCancel ? `<button class="btn ghost" id="btn-cancel-starter">${t('starter.abandon')}</button>` : ''}
            <button class="btn primary" id="btn-confirm-starter" disabled>${t('starter.confirm')}</button>
          </div>
        </div>
      `,
      { className: 'draft-modal', closable: false }
    );

    const confirm = modal.querySelector('#btn-confirm-starter');
    modal.querySelectorAll('.relic-card').forEach((card) => {
      card.onclick = () => {
        this.starterChoosingId = card.dataset.relicId;
        modal.querySelectorAll('.relic-card').forEach((item) => {
          const active = item === card;
          item.classList.toggle('selected', active);
          item.setAttribute('aria-pressed', String(active));
        });
        confirm.disabled = false;
        confirm.textContent = t('starter.confirmPick', { name: RELIC_BY_ID[this.starterChoosingId]?.name || '' });
      };
    });
    confirm.onclick = () => {
      const id = this.starterChoosingId;
      if (!id) return;
      confirm.disabled = true;
      this.starterChoosingId = null;
      onChoose?.(id);
    };
    const cancel = modal.querySelector('#btn-cancel-starter');
    if (cancel) cancel.onclick = () => {
      this.starterChoosingId = null;
      onCancel?.();
    };
    return true;
  },
};
