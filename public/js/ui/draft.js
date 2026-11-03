// 遗物三选一弹窗：卡片渲染、选中高亮与「确定」确认，只有点「确定」才应用并推进。
import { RELIC_BY_ID, RARITY, RELIC_LEVEL_LABELS, relicEffectText } from '../shared/data.js';
import { t } from '../i18n.js';
import { audio } from '../audio.js';
import { iconSvg, relicIconName } from '../render/canvas-shapes.js';
import { fmt, contractCardHtml } from './shared.js';

// 遗物草稿的等级分组：fromLevel 为 0 表示新遗物，升级组夹在 1–3 级（纯函数）。
export function relicDraftLevels(offer) {
  const fromLevel = Math.max(0, Math.min(3, offer?.fromLevel || 0));
  const toLevel = Math.min(3, offer?.toLevel || fromLevel + 1);
  return { fromLevel, toLevel, isUpgrade: fromLevel > 0 };
}

// 金币/修理补给的数量：向下取整并夹到非负，非数值按 0 处理（纯函数）。
export function supplyAmount(offer) {
  const amount = Number(offer?.amount);
  return Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0;
}

export const draftMethods = {
  showDraft({ wave, offers, rerolls, gold, cost = 25 }) {
    const used = rerolls?.used || 0;
    const max = rerolls?.max || 0;
    const cards = offers
      .map((offer, index) => {
        if (offer.kind === 'contract') return contractCardHtml(offer, index, { used, max });
        if (offer.kind === 'relic') {
          const relic = RELIC_BY_ID[offer.id];
          if (!relic) return '';
          const rarity = RARITY[relic.rarity];
          const { fromLevel, toLevel, isUpgrade } = relicDraftLevels(offer);
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
              <span class="faction-tag">${t('draft.faction')} · ${t(`faction.${relic.faction}.name`)}</span>
              <h3>${relic.name}</h3>
              ${effect}
              <p class="relic-flavor">${relic.desc}</p>
              <span class="pick">${t('draft.pick')}</span>
            </button>
          `;
        }

        const isGold = offer.kind === 'gold';
        const amount = supplyAmount(offer);
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
            <button class="btn primary" id="btn-confirm-draft" disabled>${t('common.confirm')}</button>
          </div>
        </div>
      `,
      { className: 'draft-modal', closable: false }
    );

    // 点卡片只高亮选中并启用「确定」；只有点「确定」才真正 pickOffer，避免误触直接推进。
    const confirm = modal.querySelector('#btn-confirm-draft');
    modal.querySelectorAll('.relic-card').forEach((card) => {
      card.onclick = () => {
        modal.querySelectorAll('.relic-card').forEach((item) => {
          const active = item === card;
          item.classList.toggle('selected', active);
          item.setAttribute('aria-pressed', String(active));
        });
        confirm.disabled = false;
      };
    });
    confirm.onclick = () => {
      if (confirm.disabled) return;
      const selected = modal.querySelector('.relic-card.selected');
      if (!selected) return;
      confirm.disabled = true;
      this.handlers.onPickOffer?.(Number(selected.dataset.index));
    };
    const reroll = modal.querySelector('#btn-reroll');
    if (reroll) reroll.onclick = () => this.handlers.onReroll?.();
    audio.play('draft');
  },
};
