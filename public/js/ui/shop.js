// 局内商店、遗物列表与选中塔面板（含满级进化选择）。
import {
  TOWERS,
  TOWER_ORDER,
  RELIC_BY_ID,
  RARITY,
  RELIC_LEVEL_LABELS,
  relicEffectText,
} from '../shared/data.js';
import { EFFECT_REGISTRY, effectText, RELIC_SET_BONUSES, relicSetBonusText } from '../shared/effects.js';
import { DOCTRINES } from '../shared/doctrines.js';
import { normalizeTalent } from '../shared/data/meta.js';
import { t, tOr } from '../i18n.js';
import { iconSvg } from '../render/canvas-shapes.js';
import { drawPortrait } from '../render/portrait-draw.js';
import { drawRelicIcon } from '../render/relic-art.js';
import { towerName, evolutionEffectText, choiceLabel, escapeHtml } from './shared.js';

// 商店卡片顺序：按 TOWER_ORDER 展开，缺少定义的 id 跳过（纯函数，便于单测）。
export function orderedShopTowers() {
  return TOWER_ORDER.map((id) => ({ id, def: TOWERS[id] })).filter((entry) => entry.def);
}

// 价格可负担判定：与界面原来的 `gold < cost` 语义一致，非数值视为可负担（纯函数）。
export function shopCardAffordable(gold, cost) {
  return !(Number(gold) < Number(cost));
}

// 遗物等级夹取：数据损坏或缺失时回落到 1–3 级区间（纯函数）。
export function clampRelicLevel(level) {
  return Math.min(3, Math.max(1, level || 1));
}

// 遗物条目的展示模型：等级、等级文案与稀有度配色，列表渲染与单测共用（纯函数）。
export function relicChipView(state) {
  const relic = RELIC_BY_ID[state?.id];
  if (!relic) return null;
  const level = clampRelicLevel(state.level);
  const rarity = RARITY[relic.rarity];
  return {
    id: relic.id,
    level,
    levelLabel: RELIC_LEVEL_LABELS[level - 1],
    rarityKey: relic.rarity,
    rarityName: rarity.name,
    color: rarity.color,
  };
}

// 加成一览：把 sim.mods 的最终聚合加成按效果注册表顺序展开成展示行（纯函数）。
// dmg 按塔类型拆行，零值不展示；文案复用效果注册表，不新造数值。
export function bonusSummaryRows(mods = {}) {
  const rows = [];
  for (const [key, entry] of Object.entries(EFFECT_REGISTRY)) {
    if (entry.nested) {
      for (const [type, amount] of Object.entries(mods[key] || {})) {
        if (!amount) continue;
        rows.push({ key: `dmg:${type}`, text: effectText('dmg', amount, { towerName: towerName(TOWERS[type]) }) });
      }
    } else if (mods[key]) {
      rows.push({ key, text: effectText(key, mods[key]) });
    }
  }
  return rows;
}

// 加成一览的来源分组：遗物/套装/海克斯/契约/教义/天赋逐项效果（纯函数）。
// 只读本局状态、不新造数值；契约沿用 HUD chip 的「run 常驻 / wave 未过期」口径。
export function bonusSourceRows(sim = {}) {
  const groups = [];
  const relicStates = sim.relics || [];

  const relics = relicStates
    .filter((state) => RELIC_BY_ID[state?.id])
    .map((state) => {
      const level = clampRelicLevel(state.level);
      return {
        name: `${RELIC_BY_ID[state.id].name} ${RELIC_LEVEL_LABELS[level - 1]}`,
        effect: relicEffectText(state.id, level),
      };
    });
  if (relics.length) groups.push({ id: 'relic', items: relics });

  // 套装按「不同遗物」计件，与 recomputeMods 口径一致。
  const setPieces = new Map();
  const counted = new Set();
  for (const state of relicStates) {
    const def = RELIC_BY_ID[state?.id];
    if (!def?.set || counted.has(state.id)) continue;
    counted.add(state.id);
    setPieces.set(def.set, (setPieces.get(def.set) || 0) + 1);
  }
  const sets = [];
  for (const [setId, pieces] of setPieces) {
    const text = relicSetBonusText(setId, pieces);
    if (text) sets.push({ name: `${RELIC_SET_BONUSES[setId].name} ${pieces}`, effect: text });
  }
  if (sets.length) groups.push({ id: 'set', items: sets });

  const hex = sim.hex;
  if (hex) {
    groups.push({
      id: 'hex',
      items: [{ name: tOr(`hex.${hex.id}.name`, hex.name), effect: tOr(`hex.${hex.id}.pitch`, hex.pitch) }],
    });
  }

  const contracts = (sim.rogue2?.contracts || [])
    .filter((record) => record.scope === 'run' || sim.clearedWave < record.untilWave)
    .map((record) => ({ name: t(`contract.${record.id}.name`), effect: t(`contract.${record.id}.desc`) }));
  if (contracts.length) groups.push({ id: 'contract', items: contracts });

  const doctrines = (sim.rogue2?.doctrines || [])
    .filter((id) => DOCTRINES[id])
    .map((id) => ({ name: t(DOCTRINES[id].nameKey), effect: t(DOCTRINES[id].descKey) }));
  if (doctrines.length) groups.push({ id: 'doctrine', items: doctrines });

  const talentNodes = Object.entries(normalizeTalent(sim.opts?.talent).nodes)
    .map(([id]) => ({ name: t(`data.talent.${id}.name`), effect: t(`data.talent.${id}.desc`) }));
  if (talentNodes.length) groups.push({ id: 'talent', items: talentNodes });

  return groups;
}

export const shopMethods = {
  // ---------- 商店 ----------

  renderShop() {
    if (!this.el?.shopList) return;
    this.el.shopList.innerHTML = '';
    orderedShopTowers().forEach(({ id, def }, index) => {
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
        <span class="glyph" style="color:${def.color}"><canvas width="48" height="48" style="width:var(--icon-size-lg);height:var(--icon-size-lg)"></canvas></span>
        <span class="name">${towerName(def)}</span>
        <span class="cost">${iconSvg('gold', 'icon-inline')}${this.game.towerCost(id)}</span>
        ${locked ? `<span class="lock">${t('shop.locked')}</span>` : ''}
      `;
      button.onclick = () => this.handlers.onSelectShop?.(id);
      this.el.shopList.appendChild(button);
      const portrait = button.querySelector('canvas');
      if (portrait) drawPortrait(portrait.getContext('2d'), `tower.${id}`, 48);
    });
    this.updateShopState();
  },

  updateShopState() {
    if (!this.game) return;
    document.querySelectorAll('.tower-card').forEach((card) => {
      const type = card.dataset.type;
      card.classList.toggle('selected', this.game.placementType === type);
      const cost = this.game.towerCost(type);
      card.classList.toggle('poor', !shopCardAffordable(this.game.gold, cost));
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
      const view = relicChipView(state);
      if (!view) continue;
      const relic = RELIC_BY_ID[state.id];
      const rarity = RARITY[relic.rarity];
      const chip = document.createElement('div');
      chip.className = 'relic-chip';
      chip.dataset.tip = `<b style="color:${view.color}">${relic.name} ${view.levelLabel}</b><span class="rarity-tag" style="color:${view.color}">${rarity.name}</span><p>${relicEffectText(state.id, view.level)}</p>`;
      chip.innerHTML = `<canvas width="32" height="32" style="width:16px;height:16px;flex:0 0 auto"></canvas><span>${relic.name} <em class="relic-level">${view.levelLabel}</em></span>`;
      this.el.relicList.appendChild(chip);
      const canvas = chip.querySelector('canvas');
      if (canvas) drawRelicIcon(canvas.getContext('2d'), state.id, 32);
    }
  },

  // 加成一览：汇总 sim.mods 最终加成并列出来源，复用效果注册表文案，不新造数值。
  showBonusSummary() {
    if (!this.game) return;
    const rows = bonusSummaryRows(this.game.mods);
    const groups = bonusSourceRows(this.game);
    const rowsHtml = rows.length
      ? `<ul class="bonus-rows">${rows.map((row) => `<li>${escapeHtml(row.text)}</li>`).join('')}</ul>`
      : `<p class="bonus-empty">${t('bonus.empty')}</p>`;
    const sourcesHtml = groups.length
      ? groups
          .map(
            (group) => `
              <div class="bonus-source">
                <span class="bonus-source-label">${t(`bonus.source.${group.id}`)}</span>
                <ul>${group.items
                  .map((item) => `<li><b>${escapeHtml(item.name)}</b><span>${escapeHtml(item.effect)}</span></li>`)
                  .join('')}</ul>
              </div>`
          )
          .join('')
      : `<p class="bonus-empty">${t('bonus.empty')}</p>`;
    const modal = this.openModal(
      `
        <div class="bonus-summary">
          <p class="eyebrow">${t('bonus.eyebrow')}</p>
          <h2>${t('bonus.title')}</h2>
          <section class="bonus-block">
            <h3>${t('bonus.aggregate')}</h3>
            ${rowsHtml}
          </section>
          <section class="bonus-block">
            <h3>${t('bonus.sources')}</h3>
            ${sourcesHtml}
          </section>
          <div class="modal-actions">
            <button class="btn ghost" id="btn-close-bonus">${t('common.close')}</button>
          </div>
        </div>
      `,
      { className: 'bonus-modal', closable: true }
    );
    modal.querySelector('#btn-close-bonus').onclick = () => this.closeModal();
  },

  // ---------- 选中塔面板 ----------

  showTowerPanel(tower) {
    if (!this.game || !this.el?.towerPanel) return;
    this._panelTower = tower;
    const def = TOWERS[tower.type];
    const stats = this.game.statsFor(tower);
    const cost = this.game.upgradeCost(tower);
    const sell = this.game.sellValue(tower);
    const picked = this.game.towerEvolutions?.(tower) || [];
    const options = this.game.evolutionOptions?.(tower) || [];
    const title = picked.length
      ? `${towerName(def)} · ${picked.map((entry) => entry.name).join(' / ')}`
      : towerName(def);
    this.el.towerPanel.hidden = false;
    this.el.towerPanel.innerHTML = `
      <div class="tp-head">
        <span class="tp-name" style="color:${picked[0]?.color || def.color}">${title} <em>Lv.${tower.level + 1}</em></span>
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
      ${picked.length
        ? `<div class="tp-evolution" style="display:flex;flex-wrap:wrap;gap:6px 12px;align-items:baseline;margin-top:8px">
             <span class="muted">${t('shop.evolution')}</span>
             ${picked
               .map(
                 (entry) =>
                   `<b style="color:${entry.color || def.color}">${entry.name}</b>
                    <em class="muted" style="font-size:11px">${evolutionEffectText(entry)}</em>`
               )
               .join('')}
           </div>`
        : ''}
      ${options.length
        ? `<div class="tp-evolutions" style="display:flex;flex-direction:column;gap:6px;margin-top:8px">
             <span class="muted">${t('shop.evolution')} · ${choiceLabel(options.length)}</span>
             <div class="tp-evolution-actions" style="display:flex;gap:6px;overflow-x:auto;padding-bottom:2px">
               ${options
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
    button.classList.toggle('poor', !shopCardAffordable(gold, cost));
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
    const picked = this.game.towerEvolutions?.(tower)?.length || 0;
    const total = def.evolutions?.length || options.length;
    const cards = options
      .map(
        (evolution, index) => `
          <button class="relic-card evolution-card" data-evolve="${evolution.id}"
            style="--rarity:${evolution.color || def.color}">
            <span class="rarity">${t('shop.evolutionIndex', { index: index + 1 })}</span>
            <h3>${escapeHtml(evolution.name)}</h3>
            <div class="relic-effect"><span>${t('shop.stats')}</span>${evolutionEffectText(evolution)}</div>
            <p class="relic-flavor">${escapeHtml(evolution.desc)}</p>
            <span class="pick">${t('shop.pick')}</span>
          </button>`
      )
      .join('');
    const modal = this.openModal(
      `
        <div class="draft evolution">
          <p class="eyebrow">${escapeHtml(towerName(def))} · Lv.${tower.level + 1}</p>
          <h2>${t('shop.chooseEvolution', { index: picked + 1, total })}</h2>
          <div class="draft-cards">${cards}</div>
          <div class="draft-actions">
            <span class="muted">${t('shop.keyboardHint', {
              keys: options.map((_, index) => index + 1).join(' / '),
            })}</span>
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
