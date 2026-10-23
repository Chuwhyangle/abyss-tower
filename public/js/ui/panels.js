// 大厅面板：排行榜、解锁商店、遗物详情与帮助。
import {
  DIFFICULTIES,
  UNLOCKS,
  RELIC_BY_ID,
  RARITY,
  RELIC_LEVEL_LABELS,
  relicEffectText,
  ENEMIES,
} from '../shared/data.js';
import { t } from '../i18n.js';
import { iconSvg } from '../render/canvas-shapes.js';
import { fmt, diffName, enemyName, escapeHtml } from './shared.js';

export const panelMethods = {
  showLeaderboard({ mode = 'normal', entries = [], day = '' }) {
    const rows = entries.length
      ? entries
          .map((entry, index) => {
            const diff = DIFFICULTIES[entry.difficulty] || DIFFICULTIES.standard;
            return `
              <div class="board-row">
                <span class="rank ${index < 3 ? 'top' : ''}">${index + 1}</span>
                <span class="board-name">
                  ${escapeHtml(entry.name)}
                  ${entry.victory ? `<em class="win-mark" title="${t('board.cleared')}">${iconSvg('victory')}</em>` : ''}
                  <span class="board-diff" style="color:${diff.color}">${diffName(diff)}</span>
                </span>
                <span class="board-wave">${t('board.wave', { n: entry.wave })}</span>
                <span class="board-score">${fmt(entry.score)}</span>
              </div>`;
          })
          .join('')
      : `<p class="empty">${t('board.empty')}</p>`;

    const modal = this.openModal(
      `
        <div class="board">
          <p class="eyebrow">${t('board.eyebrow')}</p>
          <h2>${t('board.title')}</h2>
          <div class="tabs">
            <button class="tab ${mode === 'normal' ? 'active' : ''}" data-mode="normal">${t('board.normal')}</button>
            <button class="tab ${mode === 'daily' ? 'active' : ''}" data-mode="daily">${t('board.daily')}${day ? ` · ${day.slice(5)}` : ''}</button>
            <button class="tab ${mode === 'endless' ? 'active' : ''}" data-mode="endless">${t('board.endless')}</button>
          </div>
          <div class="board-list">${rows}</div>
          <div class="modal-actions">
            <button class="btn ghost" id="btn-close-board">${t('common.close')}</button>
          </div>
        </div>
      `,
      { className: 'board-modal', closable: true }
    );

    modal.querySelectorAll('.tab').forEach((tab) => {
      tab.onclick = () => this.handlers.onBoard?.(tab.dataset.mode);
    });
    modal.querySelector('#btn-close-board').onclick = () => this.closeModal();
  },

  showUnlocks(profile) {
    this.profile = profile;
    const cores = profile?.cores || 0;
    const owned = profile?.unlocks || [];
    const rows = UNLOCKS.map((unlock) => {
      const isOwned = owned.includes(unlock.id);
      const affordable = cores >= unlock.cost;
      return `
        <div class="unlock-row ${isOwned ? 'owned' : ''}">
          <div class="unlock-info">
            <b>${unlock.name}</b>
            <p>${unlock.desc}</p>
          </div>
          <button class="btn small ${isOwned ? 'ghost' : 'primary'}" data-id="${unlock.id}"
            ${isOwned || !affordable ? 'disabled' : ''}>
            ${isOwned ? t('unlocks.owned') : `${iconSvg('cores', 'icon-inline')}${unlock.cost}`}
          </button>
        </div>`;
    }).join('');

    const modal = this.openModal(
      `
        <div class="unlocks">
          <p class="eyebrow">${t('unlocks.eyebrow')}</p>
          <h2>${t('unlocks.title')} <span class="cores-inline">${iconSvg('cores', 'icon-inline')}${fmt(cores)}</span></h2>
          <p class="muted">${t('unlocks.note')}</p>
          <div class="unlock-list">${rows}</div>
          <div class="modal-actions">
            <button class="btn ghost" id="btn-close-unlocks">${t('common.close')}</button>
          </div>
        </div>
      `,
      { className: 'unlock-modal', closable: true }
    );

    modal.querySelectorAll('.unlock-row button[data-id]').forEach((button) => {
      button.onclick = () => this.handlers.onBuyUnlock?.(button.dataset.id);
    });
    modal.querySelector('#btn-close-unlocks').onclick = () => this.closeModal();
  },

  showRelicsModal() {
    const relics = this.game?.relics || [];
    const hud = this.game?.getHud?.() || {};
    const preview = hud.phase === 'prep' ? hud.nextWave : null;
    const rows = relics.length
      ? relics
          .map((state) => {
            const relic = RELIC_BY_ID[state.id];
            if (!relic) return '';
            const level = Math.min(3, Math.max(1, state.level || 1));
            const rarity = RARITY[relic.rarity];
            return `
              <div class="relic-modal-row">
                <b style="color:${rarity.color}">${relic.name} ${RELIC_LEVEL_LABELS[level - 1]}</b>
                <span>${relicEffectText(state.id, level)}</span>
              </div>`;
          })
          .join('')
      : `<p class="empty">${t('relicsModal.none')}</p>`;

    const waveBlock = preview
      ? `
          <p class="eyebrow">${t('relicsModal.nextWave')}</p>
          <h2>${t('hud.nextWave')} <span class="cores-inline">${t('relicsModal.enemies', { n: preview.totalCount })}</span></h2>
          <div class="relic-modal-list">
            ${[...preview.enemies]
              .sort((a, b) => b.count - a.count)
              .map(({ type, count }) => {
                const def = ENEMIES[type] || { id: type, name: type, color: '#9fb0c3' };
                return `<div class="next-wave-row"><i style="--c:${def.color}"></i>${enemyName(def)}<b>×${count}</b></div>`;
              })
              .join('')}
          </div>`
      : '';

    const modal = this.openModal(
      `
        <div class="relics-modal">
          ${waveBlock}
          <p class="eyebrow">RELICS</p>
          <h2>${t('relicsModal.title')} <span class="cores-inline">${relics.length}</span></h2>
          <div class="relic-modal-list">${rows}</div>
          <div class="modal-actions">
            <button class="btn ghost" id="btn-close-relics">${t('common.close')}</button>
          </div>
        </div>
      `,
      { className: 'relics-modal', closable: true }
    );
    modal.querySelector('#btn-close-relics').onclick = () => this.closeModal();
  },

  showHelp() {
    this.openModal(
      `
        <div class="help">
          <p class="eyebrow">${t('help.eyebrow')}</p>
          <h2>${t('help.title')}</h2>
          <div class="help-section">
            <h3>${t('help.coreTitle')}</h3>
            <p>${t('help.coreBody')}</p>
          </div>
          <div class="help-section">
            <h3>${t('help.resourceTitle')}</h3>
            <p>${t('help.resourceBody')}</p>
          </div>
          <div class="help-section">
            <h3>${t('help.tacticTitle')}</h3>
            <p>${t('help.tacticBody')}</p>
          </div>
          <div class="help-section">
            <h3>${t('help.keysTitle')}</h3>
            <p>${t('help.keysBody')}</p>
          </div>
          <div class="help-section">
            <h3>${t('help.dailyTitle')}</h3>
            <p>${t('help.dailyBody')}</p>
          </div>
          <div class="modal-actions">
            <button class="btn ghost" id="btn-close-help">${t('help.close')}</button>
          </div>
        </div>
      `,
      { className: 'help-modal', closable: true }
    );
    this.el.modalRoot.querySelector('#btn-close-help').onclick = () => this.closeModal();
  },
};
