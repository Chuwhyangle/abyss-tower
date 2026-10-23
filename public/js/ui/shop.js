// 局内商店、遗物列表与选中塔面板（含满级进化选择）。
import {
  TOWERS,
  TOWER_ORDER,
  RELIC_BY_ID,
  RARITY,
  RELIC_LEVEL_LABELS,
  relicEffectText,
} from '../shared/data.js';
import { t } from '../i18n.js';
import { iconSvg } from '../render/canvas-shapes.js';
import { towerName, evolutionEffectText, choiceLabel, escapeHtml } from './shared.js';

export const shopMethods = {
  // ---------- 商店 ----------

  renderShop() {
    if (!this.el?.shopList) return;
    this.el.shopList.innerHTML = '';
    TOWER_ORDER.forEach((id, index) => {
      const def = TOWERS[id];
      const locked = !this.game.unlockedTowers.includes(id);
      const button = document.createElement('button');
      button.className = `tower-card${locked ? ' locked' : ''}`;
      button.dataset.type = id;
      button.disabled = locked;
      const level0 = def.levels[0];
      const statsText = def.support
        ? t('shop.auraStats', {
            dmg: Math.round(level0.buffDmg * 100),
            rate: Math.round(level0.buffRate * 100),
            range: level0.range,
          })
        : t('shop.baseStats', { dmg: level0.dmg, range: level0.range });
      button.dataset.tip = `<b style="color:${def.color}">${towerName(def)}</b><p>${def.desc}</p>
        <p class="tip-stats">${t('shop.cost')} ${this.game.towerCost(id)} · ${statsText}</p>`;
      button.innerHTML = `
        <span class="key">${index + 1}</span>
        <span class="glyph" style="color:${def.color}">${iconSvg('tower')}</span>
        <span class="name">${towerName(def)}</span>
        <span class="cost">${iconSvg('gold', 'icon-inline')}${this.game.towerCost(id)}</span>
        ${locked ? `<span class="lock">${t('shop.locked')}</span>` : ''}
      `;
      button.onclick = () => this.handlers.onSelectShop?.(id);
      this.el.shopList.appendChild(button);
    });
    this.updateShopState();
  },

  updateShopState() {
    if (!this.game) return;
    document.querySelectorAll('.tower-card').forEach((card) => {
      const type = card.dataset.type;
      card.classList.toggle('selected', this.game.placementType === type);
      const cost = this.game.towerCost(type);
      card.classList.toggle('poor', this.game.gold < cost);
    });
  },

  // ---------- 遗物 ----------

  renderRelics() {
    if (!this.el?.relicList || !this.game) return;
    this.el.relicList.innerHTML = '';
    this.el.relicCount.textContent = this.game.relics.length;
    if (!this.game.relics.length) {
      const empty = document.createElement('div');
      empty.className = 'relic-empty';
      empty.textContent = t('relic.empty');
      this.el.relicList.appendChild(empty);
      return;
    }
    for (const state of this.game.relics) {
      const relic = RELIC_BY_ID[state.id];
      if (!relic) continue;
      const level = Math.min(3, Math.max(1, state.level || 1));
      const rarity = RARITY[relic.rarity];
      const chip = document.createElement('div');
      chip.className = 'relic-chip';
      chip.dataset.tip = `<b style="color:${rarity.color}">${relic.name} ${RELIC_LEVEL_LABELS[level - 1]}</b><span class="rarity-tag" style="color:${rarity.color}">${rarity.name}</span><p>${relicEffectText(state.id, level)}</p>`;
      chip.innerHTML = `<i style="background:${rarity.color}"></i><span>${relic.name} <em class="relic-level">${RELIC_LEVEL_LABELS[level - 1]}</em></span>`;
      this.el.relicList.appendChild(chip);
    }
  },

  // ---------- 选中塔面板 ----------

  showTowerPanel(tower) {
    if (!this.game || !this.el?.towerPanel) return;
    this._panelTower = tower;
    const def = TOWERS[tower.type];
    const stats = this.game.statsFor(tower);
    const cost = this.game.upgradeCost(tower);
    const sell = this.game.sellValue(tower);
    const evolution = this.game.towerEvolution?.(tower) || null;
    const evolutions = this.game.evolutionOptions?.(tower) || [];
    const title = evolution ? `${towerName(def)} · ${evolution.name}` : towerName(def);
    this.el.towerPanel.hidden = false;
    this.el.towerPanel.innerHTML = `
      <div class="tp-head">
        <span class="tp-name" style="color:${evolution?.color || def.color}">${title} <em>Lv.${tower.level + 1}</em></span>
        <button class="tp-close" title="${t('towerPanel.close')}">${iconSvg('close')}</button>
      </div>
      <div class="tp-stats">
        ${def.support
          ? `<span>${t('towerPanel.auraDmg')} <b>+${Math.round(stats.buffDmg * 100)}%</b></span>
        <span>${t('towerPanel.auraRate')} <b>+${Math.round(stats.buffRate * 100)}%</b></span>
        <span>${t('towerPanel.range')} <b>${stats.range.toFixed(1)}</b></span>`
          : `<span>${t('towerPanel.damage')} <b>${stats.dmg.toFixed(1)}</b></span>
        <span>${t('towerPanel.attackSpeed')} <b>${stats.rate.toFixed(2)}/s</b></span>
        <span>${t('towerPanel.rangeShort')} <b>${stats.range.toFixed(1)}</b></span>`}
      </div>
      <div class="tp-actions">
        <button class="btn small upgrade" ${cost == null ? 'disabled' : ''}>
          ${cost == null ? t('towerPanel.maxed') : t('towerPanel.upgrade', { cost })}
        </button>
        <button class="btn small danger sell">${t('towerPanel.sell', { value: sell })}</button>
      </div>
      ${evolution
        ? `<div class="tp-evolution" style="display:flex;gap:8px;align-items:baseline;margin-top:8px">
             <span class="muted">进化</span>
             <b style="color:${evolution.color || def.color}">${evolution.name}</b>
             <em class="muted" style="font-size:11px">${evolutionEffectText(evolution)}</em>
           </div>`
        : ''}
      ${evolutions.length
        ? `<div class="tp-evolutions" style="display:flex;flex-direction:column;gap:6px;margin-top:8px">
             <span class="muted">满级进化 · ${choiceLabel(evolutions.length)}</span>
             <div class="tp-evolution-actions" style="display:flex;gap:6px;overflow-x:auto;padding-bottom:2px">
               ${evolutions
                 .map(
                   (entry, index) =>
                     `<button class="btn small evolve" data-evolve="${entry.id}" title="${escapeHtml(entry.desc)}"
                        style="border-color:${entry.color || def.color};flex:0 0 auto;white-space:nowrap"><em>${index + 1}</em> ${escapeHtml(entry.name)}</button>`
                 )
                 .join('')}
             </div>
           </div>`
        : ''}
    `;
    this.el.towerPanel.querySelector('.tp-close').onclick = () => this.handlers.onDeselect?.();
    const upgradeBtn = this.el.towerPanel.querySelector('.upgrade');
    if (cost != null) upgradeBtn.onclick = () => this.handlers.onUpgrade?.(tower);
    this.el.towerPanel.querySelectorAll('[data-evolve]').forEach((button) => {
      button.onclick = () => this.handlers.onEvolve?.(tower, button.dataset.evolve);
    });
    this.el.towerPanel.querySelector('.sell').onclick = () => this.handlers.onSell?.(tower);
    this.updateTowerPanelState(this.game.gold);
  },

  updateTowerPanelState(gold) {
    if (!this._panelTower || !this.el?.towerPanel || this.el.towerPanel.hidden) return;
    const cost = this.game.upgradeCost(this._panelTower);
    const button = this.el.towerPanel.querySelector('.upgrade');
    if (!button || cost == null) return;
    button.classList.toggle('poor', gold < cost);
  },

  hideTowerPanel() {
    this._panelTower = null;
    if (this.el?.towerPanel) {
      this.el.towerPanel.hidden = true;
      this.el.towerPanel.innerHTML = '';
    }
  },

  // 满级分支选择：与遗物三选一区分开，键盘 1 / 2 / 3 直接选择。
  showEvolutionModal(tower) {
    if (!this.game || !tower) return;
    const def = TOWERS[tower.type];
    const options = this.game.evolutionOptions?.(tower) || [];
    if (!options.length) return;
    const cards = options
      .map(
        (evolution, index) => `
          <button class="relic-card evolution-card" data-evolve="${evolution.id}"
            style="--rarity:${evolution.color || def.color}">
            <span class="rarity">进化 · ${index + 1}</span>
            <h3>${escapeHtml(evolution.name)}</h3>
            <div class="relic-effect"><span>属性</span>${evolutionEffectText(evolution)}</div>
            <p class="relic-flavor">${escapeHtml(evolution.desc)}</p>
            <span class="pick">选择</span>
          </button>`
      )
      .join('');
    const modal = this.openModal(
      `
        <div class="draft evolution">
          <p class="eyebrow">${escapeHtml(towerName(def))} · Lv.${tower.level + 1}</p>
          <h2>选择最终形态</h2>
          <div class="draft-cards">${cards}</div>
          <div class="draft-actions">
            <span class="muted">键盘 ${options.map((_, index) => index + 1).join(' / ')} 选择 · Esc 稍后再选</span>
          </div>
        </div>
      `,
      { className: 'evolution-modal' }
    );

    const pick = (evolutionId) => {
      this.closeModal();
      this.handlers.onEvolve?.(tower, evolutionId);
    };
    modal.querySelectorAll('[data-evolve]').forEach((card) => {
      card.onclick = () => pick(card.dataset.evolve);
    });

    const onKey = (event) => {
      if (!/^[1-9]$/.test(event.key)) return;
      const evolution = options[Number(event.key) - 1];
      if (!evolution) return;
      event.preventDefault();
      pick(evolution.id);
    };
    window.addEventListener('keydown', onKey);
    this._modalCleanup = () => window.removeEventListener('keydown', onKey);
  },
};
