// 首领核心（§4）：清波后五类候选弹窗。两步选择：先选 kind（三选一），再选该类的子选项。
// 候选由服务端权威下发，这里只按 offers 渲染；文案全部来自 i18n（bossCore.* / draft.* / faction.*）。
import { RELIC_BY_ID, RARITY, RELIC_LEVEL_LABELS, relicEffectText } from '../shared/data.js';
import { t } from '../i18n.js';
import { iconSvg, relicIconName } from '../render/canvas-shapes.js';
import { escapeHtml } from './shared.js';

// 五类核心的卡片强调色，与 draft 卡片的 --rarity 变量共用一条渲染路径。
const KIND_COLORS = {
  upgrade: '#ffd36b',
  search: '#7ee0c3',
  awakening: '#b26bff',
  doctrine: '#c9a227',
  supply: '#8fa3b2',
};

function relicOptionCard(option) {
  const relic = RELIC_BY_ID[option.id];
  if (!relic) return '';
  const rarity = RARITY[relic.rarity];
  const fromLevel =
    option.fromLevel != null
      ? Math.max(0, Math.min(3, Math.floor(Number(option.fromLevel) || 0)))
      : Math.max(0, Math.floor(Number(option.toLevel) || 1) - 1);
  const toLevel = Math.min(3, Math.max(1, Math.floor(Number(option.toLevel) || fromLevel + 1)));
  const levelLabel =
    fromLevel > 0
      ? `${RELIC_LEVEL_LABELS[fromLevel - 1]} → ${RELIC_LEVEL_LABELS[toLevel - 1]}`
      : t('draft.new');
  return `
    <button class="relic-card ${fromLevel > 0 ? 'upgrade' : ''}" style="--rarity:${rarity.color}">
      <span class="rarity">${rarity.name} ${iconSvg(relicIconName(relic.rarity), 'icon-inline')} · ${levelLabel}</span>
      <span class="faction-tag">${t('draft.faction')} · ${t(`faction.${relic.faction}.name`)}</span>
      <h3>${escapeHtml(relic.name)}</h3>
      <div class="relic-effect"><span>${t('draft.effect')}</span>${relicEffectText(relic.id, toLevel)}</div>
      <p class="relic-flavor">${escapeHtml(relic.desc)}</p>
      <span class="pick">${t('draft.pick')}</span>
    </button>
  `;
}

function supplyOptionCard(option) {
  const amount = Math.max(0, Math.floor(Number(option.amount) || 0));
  const key =
    option.type === 'maxHp'
      ? 'bossCore.supply.maxHp'
      : option.type === 'gold'
        ? 'bossCore.supply.gold'
        : option.type === 'reroll'
          ? 'bossCore.supply.reroll'
          : null;
  if (!key) return '';
  return `
    <button class="relic-card fallback" style="--rarity:${KIND_COLORS.supply}">
      <span class="rarity">${t('bossCore.kind.supply')}</span>
      <h3>${t(key, { n: amount })}</h3>
      <p class="relic-flavor">${t('bossCore.kindDesc.supply')}</p>
      <span class="pick">${t('draft.pick')}</span>
    </button>
  `;
}

function doctrineOptionCard(option) {
  return `
    <button class="relic-card fallback" style="--rarity:${KIND_COLORS.doctrine}">
      <span class="rarity">${t('bossCore.kind.doctrine')}</span>
      <h3>${t(`bossCore.doctrine.${option.doctrineId}`)}</h3>
      <p class="relic-flavor">${t('bossCore.doctrinePending')}</p>
      <span class="pick">${t('draft.pick')}</span>
    </button>
  `;
}

function awakeningOptionCard(option) {
  const relic = RELIC_BY_ID[option.relicId];
  if (!relic) return '';
  return `
    <button class="relic-card fallback" style="--rarity:${KIND_COLORS.awakening}">
      <span class="rarity">${t('bossCore.kind.awakening')}</span>
      <h3>${escapeHtml(relic.name)}</h3>
      <p class="relic-flavor">${t('bossCore.awakeningPending')}</p>
      <span class="pick">${t('draft.pick')}</span>
    </button>
  `;
}

export const bossCoreMethods = {
  showBossCore({ wave, offers = [], onChoose }) {
    if (!offers.length) return false;

    const renderKinds = () => {
      const cards = offers
        .map((offer, index) => {
          const kind = offer.kind;
          const color = KIND_COLORS[kind] || KIND_COLORS.supply;
          return `
            <button class="relic-card fallback" data-kind-index="${index}" style="--rarity:${color}">
              <span class="rarity">${t(`bossCore.kind.${kind}`)}</span>
              <h3>${t(`bossCore.kind.${kind}`)}</h3>
              <p class="relic-flavor">${t(`bossCore.kindDesc.${kind}`)}</p>
              <span class="pick">${t('draft.pick')}</span>
            </button>
          `;
        })
        .join('');

      const modal = this.openModal(
        `
          <div class="draft boss-core">
            <p class="eyebrow">${t('bossCore.waveEyebrow', { wave })}</p>
            <h2>${t('bossCore.title')}</h2>
            <p class="muted">${t('bossCore.note')}</p>
            <div class="draft-cards">${cards}</div>
          </div>
        `,
        { className: 'draft-modal', closable: false }
      );
      modal.querySelectorAll('[data-kind-index]').forEach((card) => {
        card.onclick = () => renderOptions(Number(card.dataset.kindIndex));
      });
    };

    const renderOptions = (kindIndex) => {
      const offer = offers[kindIndex];
      if (!offer) return;
      const options = Array.isArray(offer.options) ? offer.options : [];
      const cards = options
        .map((option) => {
          if (offer.kind === 'upgrade' || offer.kind === 'search') return relicOptionCard(option);
          if (offer.kind === 'supply') return supplyOptionCard(option);
          if (offer.kind === 'doctrine') return doctrineOptionCard(option);
          if (offer.kind === 'awakening') return awakeningOptionCard(option);
          return '';
        })
        .join('');

      const modal = this.openModal(
        `
          <div class="draft boss-core">
            <p class="eyebrow">${t('bossCore.waveEyebrow', { wave })}</p>
            <h2>${t(`bossCore.kind.${offer.kind}`)}</h2>
            <p class="muted">${t(`bossCore.kindDesc.${offer.kind}`)}</p>
            <div class="draft-cards">${cards}</div>
            <div class="modal-actions">
              <button class="btn ghost" id="btn-bosscore-back">${t('bossCore.back')}</button>
            </div>
          </div>
        `,
        { className: 'draft-modal', closable: false }
      );
      modal.querySelectorAll('.relic-card').forEach((card, index) => {
        card.onclick = () => onChoose?.(kindIndex, index);
      });
      const back = modal.querySelector('#btn-bosscore-back');
      if (back) back.onclick = () => renderKinds();
    };

    renderKinds();
    return true;
  },
};
