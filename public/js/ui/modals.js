// 通用弹窗：遮罩生命周期、遗物三选一、事件节点、选图、确认框与提示。
import { RELIC_BY_ID, RARITY, RELIC_LEVEL_LABELS, relicEffectText } from '../shared/data.js';
import { canAffordEventOption, findEventChain } from '../shared/events.js';
import { DESTRUCTIBLE_BY_ID } from '../shared/destructibles.js';
import { SCENE_SPRITE_IDS, applySceneSpritesTo } from '../shared/scene-sprites.js';
import { t, tData, tOr } from '../i18n.js';
import { audio } from '../audio.js';
import { iconSvg, relicIconName } from '../render/canvas-shapes.js';
import { destructibleCostSpec, destructibleEffectSpec, destructibleFailureKey, destructibleWarningKey } from '../render/destructible-renderer.js';
import { fmt, modifierName, modifierDesc, mapPreviewSvg, escapeHtml } from './shared.js';

// 固定地图的专有名词按 id 取译名；旧随机地图没有 id 时回退数据表自带名称。
const mapName = (map) =>
  map ? tData('map', map.id, 'name', map.name || map.archetypeName) : null;
const mapDesc = (map) => (map ? tData('map', map.id, 'desc', map.desc || '') : null);

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

// 放弃确认文案：按模式说明代价，并给出该模式剩余次数（纯函数）。
export function abandonConfirmCopy(mode, { dailyLeft = null, weeklyLeft = null } = {}) {
  const confirmText = t('uiEvent.abandon.confirm');
  if (mode === 'daily' || mode === 'weekly') {
    const leftCount = mode === 'daily' ? dailyLeft : weeklyLeft;
    const left = Number.isFinite(leftCount)
      ? t(`uiEvent.abandon.${mode}Left`, { n: leftCount })
      : '';
    return {
      title: t(`uiEvent.abandon.${mode}Title`),
      text: t(`uiEvent.abandon.${mode}Text`, { left }),
      confirmText,
    };
  }
  // 无尽 / 变异 / 常规共用同一段「当前波次进度将丢失」说明。
  const titles = {
    endless: 'uiEvent.abandon.endlessTitle',
    mutated: 'uiEvent.abandon.mutatedTitle',
  };
  return {
    title: t(titles[mode] || 'uiEvent.abandon.defaultTitle'),
    text: t('uiEvent.abandon.endlessText'),
    confirmText,
  };
}

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
    // 固定地图池：卡片顺序即 canyon → twin → ring，服务端与客户端共用同一份地图数据。
    const cards = candidates
      .map((candidate, index) => {
        const modifier = candidate.modifier;
        const color = modifier?.color || '#9fb0c3';
        const preview = mapPreviewSvg(candidate);
        const portalCount = candidate.meta?.portalCount || candidate.spawns?.length || 1;
        const title =
          mapName(candidate) ||
          (candidate.archetype
            ? tData('mapArchetype', candidate.archetype, 'name', candidate.archetypeName || candidate.archetype)
            : candidate.archetypeName || '');
        const desc = mapDesc(candidate) || candidate.desc || '';
        // 固定 trait：canyon 没有 trait，明确标注“无固定特性”，不再出现随机词缀文案。
        const traitName = modifierName(modifier) || t('mapSelect.noTrait');
        const traitDesc = modifierDesc(modifier) || t('mapSelect.noTraitDesc');
        return `
          <button class="map-card" data-index="${index}" data-map-id="${escapeHtml(candidate.id || candidate.archetype || '')}" style="--lane:${color}">
            <div class="map-preview">${preview}</div>
            <div class="map-card-head">
              <b>${escapeHtml(title)}</b>
              <span class="map-portals">${t('mapSelect.portals', { n: portalCount })}</span>
            </div>
            <p class="map-desc">${escapeHtml(desc)}</p>
            <div class="map-mod" style="color:${color}">
              <i class="map-mod-label">${t('mapSelect.trait')}</i>
              <b>${escapeHtml(traitName)}</b>
              <span>${escapeHtml(traitDesc)}</span>
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
        <div class="map-select" style="position:relative;">
          <div class="scene-sprites" aria-hidden="true" style="position:absolute;inset:0;pointer-events:none;z-index:0;">
            <div class="scene-sprite" data-sprite-id="${SCENE_SPRITE_IDS.mapThumbnail}"
              style="position:absolute;right:12px;top:8px;opacity:.45;"></div>
            <div class="scene-sprite" data-sprite-id="${SCENE_SPRITE_IDS.mapCard}"
              style="position:absolute;left:12px;bottom:8px;opacity:.4;"></div>
          </div>
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
    // 选图场景精灵：资源就绪时替换装饰底图，缺资源时保留既有卡片样式并标回退。
    applySceneSpritesTo(modal, this.sceneSprites?.(), 'map');
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
        const chain = findEventChain(event.id, option.id);
        const optionName = tOr(`data.event.${event.id}.option.${option.id}.name`, option.name);
        const optionDesc = tOr(`data.event.${event.id}.option.${option.id}.desc`, option.desc);
        return `
          <button class="relic-card event-card ${affordable ? '' : 'locked'}" data-index="${index}"
            ${affordable ? '' : 'disabled'} style="--rarity:${accent}">
            <span class="rarity">${t(event.rare ? 'uiEvent.rare' : 'uiEvent.event')} · ${index + 1}</span>
            <h3>${escapeHtml(optionName)}</h3>
            <p class="relic-flavor">${escapeHtml(optionDesc)}</p>
            ${chain ? `<span class="muted chain-hint">${t('uiEvent.chain', { waves: chain.delayWaves })}</span>` : ''}
            <span class="pick">${affordable ? t('uiEvent.pick') : t('uiEvent.insufficient')}</span>
          </button>
        `;
      })
      .join('');

    const modal = this.openModal(
      `
        <div class="event-node">
          <p class="eyebrow">${t('uiEvent.waveEyebrow', { wave })}</p>
          <h2>${escapeHtml(tData('event', event.id, 'name', event.name))}</h2>
          <p class="muted">${escapeHtml(tData('event', event.id, 'desc', event.desc))}</p>
          <div class="draft-cards">${cards}</div>
          <div class="draft-actions">
            <span class="muted">${t('uiEvent.keyboardHint', { count: options.length })}</span>
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

  // 可破坏物确认面板：确认后调用 sim.destroyDestructible，成功音效/toast，失败按原因提示。
  showDestructibleConfirm({ sim, item, onResolved = null }) {
    const type = DESTRUCTIBLE_BY_ID[item?.type];
    if (!sim || !item || item.destroyed || !type) return null;
    const name = tData('destructible', type.id, 'name', type.name);
    const desc = tData('destructible', type.id, 'desc', type.desc);
    const cost = destructibleCostSpec(type);
    const effect = destructibleEffectSpec(type);
    const warning = destructibleWarningKey(type);
    const modal = this.openModal(
      `<div class="destructible-confirm" style="--destructible-color:${escapeHtml(type.color)}">
        <p class="eyebrow">${t('destructible.eyebrow')}</p>
        <h2 class="destructible-title"><span class="destructible-glyph" aria-hidden="true">${escapeHtml(type.glyph)}</span>${escapeHtml(name)}</h2>
        <p class="muted destructible-desc">${escapeHtml(desc)}</p>
        <div class="destructible-facts">
          <div class="destructible-fact"><span>${t('destructible.costLabel')}</span><b>${escapeHtml(t(cost.key, cost.params))}</b></div>
          <div class="destructible-fact"><span>${t('destructible.effectLabel')}</span><b>${escapeHtml(t(effect.key, effect.params))}</b></div>
        </div>
        ${warning ? `<p class="destructible-warning">${escapeHtml(t(warning))}</p>` : ''}
        <div class="modal-actions">
          <button class="btn primary" id="btn-destructible-yes">${t('destructible.confirm')}</button>
          <button class="btn ghost" id="btn-destructible-no">${t('destructible.cancel')}</button>
        </div>
      </div>`,
      { className: 'destructible-modal confirm-modal', closable: true }
    );
    modal.querySelector('#btn-destructible-yes').onclick = () => {
      const result = sim.destroyDestructible?.(item.id) ?? { ok: false, reason: 'not-found' };
      this.closeModal();
      if (result.ok) audio.play('destructible');
      this.toast(result.ok ? t('destructible.toast.done', { name }) : t(destructibleFailureKey(result.reason)));
      onResolved?.(result);
    };
    modal.querySelector('#btn-destructible-no').onclick = () => this.closeModal();
    audio.play('click');
    return modal;
  },

  showConfirm({ title, text, confirmText = null, danger = false, onConfirm, onCancel = null }) {
    // 只有「没点确认就关掉」才算取消：确认路径也会走 closeModal。
    let confirmed = false;
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
      {
        className: 'confirm-modal',
        closable: true,
        onClose: () => {
          if (!confirmed) onCancel?.();
        },
      }
    );
    modal.querySelector('#btn-confirm-yes').onclick = () => {
      confirmed = true;
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
