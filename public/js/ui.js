// DOM 界面层：HUD、商店、遗物、弹窗与提示。
import {
  TOWERS,
  TOWER_ORDER,
  RELIC_BY_ID,
  RARITY,
  UNLOCKS,
  MAX_WAVE,
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  RELIC_LEVEL_LABELS,
  relicEffectText,
} from './shared/data.js';
import {
  normalizeSettings,
  detectPreset,
  presetSettings,
  DECORATION_LABELS,
  FLOATER_LABELS,
} from './settings.js';
import { audio } from './audio.js';

const $ = (id) => document.getElementById(id);

const fmt = (n) => Number(n || 0).toLocaleString('en-US');

class UI {
  constructor() {
    this.handlers = {};
    this.game = null;
    this.profile = null;
    this.modalClosable = false;
    this._toastTimer = null;
    this._panelTower = null;
  }

  init(handlers) {
    this.handlers = handlers;
    this.el = {
      title: $('title-screen'),
      game: $('game-screen'),
      playerName: $('player-name'),
      cores: $('cores'),
      play: $('btn-play'),
      daily: $('btn-daily'),
      dailyLabel: $('daily-label'),
      resume: $('btn-resume'),
      shop: $('btn-shop'),
      board: $('btn-board'),
      help: $('btn-help'),
      rename: $('btn-rename'),
      settingsTitle: $('btn-settings-title'),
      settingsGame: $('btn-settings-game'),
      relicsMobile: $('btn-relics-mobile'),
      hudRelics: $('hud-relics'),
      fullscreen: $('btn-fullscreen'),
      rotateHint: $('rotate-hint'),
      rotateRetry: $('btn-rotate-retry'),
      titleStats: $('title-stats'),
      hudWave: $('hud-wave'),
      hudGold: $('hud-gold'),
      hudHp: $('hud-hp'),
      hudHpMax: $('hud-hpmax'),
      hudKills: $('hud-kills'),
      hudDifficulty: $('hud-difficulty'),
      waveState: $('wave-state'),
      nextWave: $('btn-next-wave'),
      sound: $('btn-sound'),
      quit: $('btn-quit'),
      portalHint: null,
      relicList: $('relic-list'),
      relicCount: $('relic-count'),
      towerPanel: $('tower-panel'),
      shopList: $('shop-list'),
      tooltip: $('tooltip'),
      toast: $('toast'),
      modalRoot: $('modal-root'),
      hpStat: $('hud-hp')?.closest('.stat'),
    };

    this.el.play.onclick = () => this.handlers.onPlay?.();
    this.el.daily.onclick = () => this.handlers.onDaily?.();
    this.el.resume.onclick = () => this.handlers.onResume?.();
    this.el.rename.onclick = () => this.handlers.onRename?.();
    this.el.settingsTitle.onclick = () => this.handlers.onSettings?.();
    this.el.settingsGame.onclick = () => this.handlers.onSettings?.();
    this.el.relicsMobile.onclick = () => this.handlers.onRelics?.();
    this.el.fullscreen.onclick = () => this.handlers.onFullscreen?.();
    this.el.rotateRetry.onclick = () => this.handlers.onForceLandscape?.();
    this.el.shop.onclick = () => this.handlers.onShop?.();
    this.el.board.onclick = () => this.handlers.onBoard?.('normal');
    this.el.help.onclick = () => this.handlers.onHelp?.();
    this.el.quit.onclick = () => this.handlers.onQuit?.();
    this.el.nextWave.onclick = () => this.handlers.onNextWave?.();
    this.el.sound.onclick = () => this.handlers.onSound?.();

    document.querySelectorAll('.speed-btn').forEach((button) => {
      button.onclick = () => this.handlers.onSpeed?.(Number(button.dataset.speed));
    });

    this.buildPortalHint();
    this.bindTooltips();
    this.bindClickSound();
    this.updateSoundIcon();
  }

  // HUD 入口提示：动态插入，避免改动静态页面结构；仅多入口地图显示。
  buildPortalHint() {
    if (this.el.portalHint) return;
    const anchor = this.el.waveState || this.el.nextWave;
    const parent = anchor?.parentElement;
    if (!parent) return;
    const hint = document.createElement('div');
    hint.id = 'portal-hint';
    hint.className = 'portal-hint';
    hint.hidden = true;
    hint.setAttribute('aria-live', 'polite');
    parent.insertBefore(hint, anchor);
    this.el.portalHint = hint;
  }

  bindClickSound() {
    document.addEventListener('click', (event) => {
      if (event.target.closest('button')) audio.play('click');
    });
  }

  bindTooltips() {
    document.addEventListener('mouseover', (event) => {
      const target = event.target.closest('[data-tip]');
      if (!target) return;
      this.el.tooltip.innerHTML = target.dataset.tip;
      this.el.tooltip.hidden = false;
      this.moveTooltip(event);
    });
    document.addEventListener('mousemove', (event) => {
      if (!this.el.tooltip.hidden) this.moveTooltip(event);
    });
    document.addEventListener('mouseout', (event) => {
      if (event.target.closest('[data-tip]')) this.el.tooltip.hidden = true;
    });
  }

  moveTooltip(event) {
    const tip = this.el.tooltip;
    const pad = 16;
    let x = event.clientX + pad;
    let y = event.clientY + pad;
    const rect = tip.getBoundingClientRect();
    if (x + rect.width > window.innerWidth - 8) x = event.clientX - rect.width - pad;
    if (y + rect.height > window.innerHeight - 8) y = event.clientY - rect.height - pad;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }

  updateSoundIcon() {
    if (!this.el?.sound) return;
    this.el.sound.textContent = audio.enabled ? '🔊' : '🔇';
    this.el.sound.title = audio.enabled ? '音效：开' : '音效：关';
  }

  setResumeAvailable(available) {
    if (this.el.resume) this.el.resume.hidden = !available;
  }

  showTitle(profile, extras = {}) {
    this.profile = profile;
    this.game = null;
    this.el.title.hidden = false;
    this.el.game.hidden = true;
    this.closeModal();
    this.hideTowerPanel();

    const stats = profile?.stats || {};
    this.el.playerName.textContent = profile?.name || '离线指挥官';
    this.el.cores.textContent = fmt(profile?.cores || 0);
    this.el.titleStats.innerHTML = `
      <div class="stat-cell"><span>最高波次</span><b>${fmt(stats.bestWave)}</b></div>
      <div class="stat-cell"><span>最高分数</span><b>${fmt(stats.bestScore)}</b></div>
      <div class="stat-cell"><span>累计击杀</span><b>${fmt(stats.kills)}</b></div>
      <div class="stat-cell"><span>远征次数</span><b>${fmt(stats.runs)}</b></div>
    `;

    const left = extras.dailyLeft;
    const date = new Date();
    const label = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    this.el.dailyLabel.textContent = left == null ? label : `${label} · 剩 ${left} 次`;
    this.setResumeAvailable(!!extras.hasSnapshot);
  }

  showDifficultySelect(mode = 'normal', { dailyLeft = null } = {}) {
    const stats = this.profile?.stats?.byDifficulty || {};
    const cards = DIFFICULTY_ORDER.map((id) => {
      const diff = DIFFICULTIES[id];
      const best = stats[id] || {};
      return `
        <button class="diff-card" data-id="${id}" style="--diff:${diff.color}">
          <span class="diff-name">${diff.name}</span>
          <p>${diff.desc}</p>
          <div class="diff-mods">
            <span>敌人生命 ×${diff.hpMul.toFixed(2)}</span>
            <span>数量 ×${diff.countMul.toFixed(2)}</span>
            <span>分数 ×${diff.scoreMul.toFixed(2)}</span>
          </div>
          <div class="diff-best">最佳：第 ${fmt(best.bestWave)} 波 · ${fmt(best.bestScore)} 分</div>
        </button>`;
    }).join('');

    const title = mode === 'daily' ? '每日挑战' : '开始远征';
    const note =
      mode === 'daily'
        ? `<p class="muted">今日同一套地图与波次种子 · 剩余 ${dailyLeft ?? 0} 次结算机会</p>`
        : '<p class="muted">三档难度共享 30 波结构，选择你的挑战。</p>';

    const modal = this.openModal(
      `<div class="difficulty">
        <p class="eyebrow">${mode === 'daily' ? 'DAILY CHALLENGE' : 'EXPEDITION'}</p>
        <h2>${title} · 选择难度</h2>
        ${note}
        <div class="diff-cards">${cards}</div>
        <div class="modal-actions">
          <button class="btn ghost" id="btn-cancel-diff">取消</button>
        </div>
      </div>`,
      { className: 'difficulty-modal', closable: true }
    );

    modal.querySelectorAll('.diff-card').forEach((card) => {
      card.onclick = () => this.handlers.onChooseDifficulty?.(mode, card.dataset.id);
    });
    modal.querySelector('#btn-cancel-diff').onclick = () => this.closeModal();
  }

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
            ? '单路推进，塔位充足'
            : candidate.archetype === 'cross'
              ? '先汇合再分叉，火力需要二次分配'
              : '路径汇流，关键路口价值高';
        return `
          <button class="map-card" data-index="${index}" style="--lane:${color}">
            <div class="map-preview">${preview}</div>
            <div class="map-card-head">
              <b>${candidate.archetypeName}</b>
              <span class="map-portals">${portalCount} 入口</span>
            </div>
            <p class="map-desc">${desc}</p>
            <div class="map-mod" style="color:${color}">
              <b>${modifier?.name || '无词缀'}</b>
              <span>${modifier?.desc || '标准地图'}</span>
            </div>
            <div class="map-foot">
              <span>分数 ×${candidate.meta?.scoreMul?.toFixed(2) || '1.00'}</span>
              <span class="pick">选择此图</span>
            </div>
          </button>`;
      })
      .join('');

    const modal = this.openModal(
      `
        <div class="map-select">
          <p class="eyebrow">EXPEDITION MAP</p>
          <h2>选择远征地图</h2>
          <p class="muted">三张候选地图共享本局种子；入口、汇流与词缀会改变防守策略。</p>
          <div class="map-cards">${cards}</div>
          <div class="modal-actions">
            <button class="btn ghost" id="btn-cancel-map">放弃本局</button>
          </div>
        </div>
      `,
      { className: 'map-modal', closable: false }
    );

    modal.querySelectorAll('.map-card').forEach((card) => {
      card.onclick = () => onChoose?.(Number(card.dataset.index));
    });
    modal.querySelector('#btn-cancel-map').onclick = () => onCancel?.();
  }

  showGame({ game, profile }) {
    this.game = game;
    if (profile) this.profile = profile;
    this.el.title.hidden = true;
    this.el.game.hidden = false;
    this.closeModal();
    this.hideTowerPanel();
    this.renderShop();
    this.renderRelics();
    this.updateHud(game.getHud());
  }

  // ---------- HUD ----------

  updateHud(hud) {
    if (!hud || !this.el) return;
    this.el.hudWave.textContent = hud.wave;
    this.el.hudGold.textContent = fmt(hud.gold);
    this.el.hudHp.textContent = hud.baseHp;
    this.el.hudHpMax.textContent = `/${hud.maxBaseHp}`;
    this.el.hudKills.textContent = fmt(hud.kills);
    if (this.el.hudRelics) this.el.hudRelics.textContent = hud.relicCount ?? 0;

    this.el.hudHp.classList.toggle('low', hud.baseHp / hud.maxBaseHp <= 0.35);

    if (hud.difficulty && this.el.hudDifficulty) {
      const diff = DIFFICULTIES[hud.difficulty] || DIFFICULTIES.standard;
      this.el.hudDifficulty.textContent = diff.name;
      this.el.hudDifficulty.style.setProperty('--diff', diff.color);
    }

    this.updatePortalHint(hud);

    if (hud.phase === 'wave') {
      this.el.waveState.textContent = hud.waveDef?.finalBoss
        ? '⚠ 最终首领'
        : hud.waveDef?.boss
          ? '⚠ 首领波次'
          : '战斗中';
      this.el.waveState.classList.add('live');
      this.el.nextWave.disabled = true;
      this.el.nextWave.textContent = `战斗中 · ${hud.enemies} 敌`;
    } else if (hud.phase === 'over') {
      this.el.waveState.textContent = '远征结束';
      this.el.waveState.classList.remove('live');
      this.el.nextWave.disabled = true;
    } else {
      this.el.waveState.textContent = hud.wave === 0 ? '准备阶段' : '整备阶段';
      this.el.waveState.classList.remove('live');
      this.el.nextWave.disabled = hud.wave >= MAX_WAVE;
      this.el.nextWave.textContent =
        hud.wave === 0
          ? '开始第 1 波'
          : hud.wave >= MAX_WAVE
            ? '已抵达最终波次'
            : `开始第 ${hud.wave + 1} 波`;
    }

    document.querySelectorAll('.speed-btn').forEach((button) => {
      const value = Number(button.dataset.speed);
      const active = value === 0 ? hud.paused : !hud.paused && value === hud.speed;
      button.classList.toggle('active', active);
    });

    this.updateShopState();
    this.updateTowerPanelState(hud.gold);
  }

  // 本波入口：波中高亮激活入口，其余变暗；整备阶段全部保持常态。
  updatePortalHint(hud) {
    const hint = this.el?.portalHint;
    if (!hint) return;
    const count = Math.max(1, Math.min(3, Math.floor(hud.portalCount || 1)));
    if (count < 2) {
      hint.hidden = true;
      hint.innerHTML = '';
      return;
    }
    const inWave = hud.phase === 'wave';
    const active = new Set(
      inWave
        ? hud.activePortals?.length
          ? hud.activePortals
          : [0]
        : Array.from({ length: count }, (_, i) => i)
    );
    const spawns = this.game?.map?.spawns || [];
    const chips = Array.from({ length: count }, (_, index) => {
      const color = spawns[index]?.color || '#9fb0c3';
      const isActive = active.has(index);
      const idle = inWave && !isActive;
      return `<span class="portal-chip${isActive ? ' active' : ''}${idle ? ' idle' : ''}"
        style="--portal:${color}" title="传送门 ${index + 1}${idle ? '（本波未激活）' : ''}">
        <i aria-hidden="true"></i>${index + 1}
      </span>`;
    }).join('');
    hint.hidden = false;
    hint.innerHTML = `<span class="portal-label">${inWave ? '本波入口' : '入口'}</span>${chips}`;
  }

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
      button.dataset.tip = `<b style="color:${def.color}">${def.name}</b><p>${def.desc}</p>
        <p class="tip-stats">造价 ${this.game.towerCost(id)} · 基础伤害 ${def.levels[0].dmg} · 射程 ${def.levels[0].range}</p>`;
      button.innerHTML = `
        <span class="key">${index + 1}</span>
        <span class="glyph" style="color:${def.color}">${def.glyph}</span>
        <span class="name">${def.name}</span>
        <span class="cost">◆ ${this.game.towerCost(id)}</span>
        ${locked ? '<span class="lock">未解锁</span>' : ''}
      `;
      button.onclick = () => this.handlers.onSelectShop?.(id);
      this.el.shopList.appendChild(button);
    });
    this.updateShopState();
  }

  updateShopState() {
    if (!this.game) return;
    document.querySelectorAll('.tower-card').forEach((card) => {
      const type = card.dataset.type;
      card.classList.toggle('selected', this.game.placementType === type);
      const cost = this.game.towerCost(type);
      card.classList.toggle('poor', this.game.gold < cost);
    });
  }

  // ---------- 遗物 ----------

  renderRelics() {
    if (!this.el?.relicList || !this.game) return;
    this.el.relicList.innerHTML = '';
    this.el.relicCount.textContent = this.game.relics.length;
    if (!this.game.relics.length) {
      const empty = document.createElement('div');
      empty.className = 'relic-empty';
      empty.textContent = '每波结束可三选一';
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
  }

  // ---------- 选中塔面板 ----------

  showTowerPanel(tower) {
    if (!this.game || !this.el?.towerPanel) return;
    this._panelTower = tower;
    const def = TOWERS[tower.type];
    const stats = this.game.statsFor(tower);
    const cost = this.game.upgradeCost(tower);
    const sell = this.game.sellValue(tower);
    this.el.towerPanel.hidden = false;
    this.el.towerPanel.innerHTML = `
      <div class="tp-head">
        <span class="tp-name" style="color:${def.color}">${def.name} <em>Lv.${tower.level + 1}</em></span>
        <button class="tp-close" title="取消选择">✕</button>
      </div>
      <div class="tp-stats">
        <span>伤害 <b>${stats.dmg.toFixed(1)}</b></span>
        <span>攻速 <b>${stats.rate.toFixed(2)}/s</b></span>
        <span>射程 <b>${stats.range.toFixed(1)}</b></span>
      </div>
      <div class="tp-actions">
        <button class="btn small upgrade" ${cost == null ? 'disabled' : ''}>
          ${cost == null ? '已满级' : `升级 · ◆ ${cost}`}
        </button>
        <button class="btn small danger sell">出售 +${sell}</button>
      </div>
    `;
    this.el.towerPanel.querySelector('.tp-close').onclick = () => this.handlers.onDeselect?.();
    const upgradeBtn = this.el.towerPanel.querySelector('.upgrade');
    if (cost != null) upgradeBtn.onclick = () => this.handlers.onUpgrade?.(tower);
    this.el.towerPanel.querySelector('.sell').onclick = () => this.handlers.onSell?.(tower);
    this.updateTowerPanelState(this.game.gold);
  }

  updateTowerPanelState(gold) {
    if (!this._panelTower || !this.el?.towerPanel || this.el.towerPanel.hidden) return;
    const cost = this.game.upgradeCost(this._panelTower);
    const button = this.el.towerPanel.querySelector('.upgrade');
    if (!button || cost == null) return;
    button.classList.toggle('poor', gold < cost);
  }

  hideTowerPanel() {
    this._panelTower = null;
    if (this.el?.towerPanel) {
      this.el.towerPanel.hidden = true;
      this.el.towerPanel.innerHTML = '';
    }
  }

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
  }

  closeModal() {
    const onClose = this._modalOnClose;
    this._modalOnClose = null;
    if (this.el?.modalRoot) this.el.modalRoot.innerHTML = '';
    this.modalClosable = false;
    if (onClose) onClose();
  }

  closeModalIfClosable() {
    if (this.modalClosable) this.closeModal();
  }

  hasModal() {
    return !!this.el?.modalRoot?.querySelector('.modal');
  }

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
            : '新获得 · Ⅰ级';
          const effect = isUpgrade
            ? `<div class="relic-effect"><span>当前</span>${relicEffectText(offer.id, fromLevel)}</div>
               <div class="relic-effect upgrade"><span>升级</span>${relicEffectText(offer.id, toLevel)}</div>`
            : `<div class="relic-effect"><span>效果</span>${relicEffectText(offer.id, toLevel)}</div>`;
          return `
            <button class="relic-card ${isUpgrade ? 'upgrade' : ''}" data-index="${index}" style="--rarity:${rarity.color}">
              <span class="rarity">${rarity.name} · ${levelLabel}</span>
              <h3>${relic.name}</h3>
              ${effect}
              <p class="relic-flavor">${relic.desc}</p>
              <span class="pick">选择</span>
            </button>
          `;
        }

        const isGold = offer.kind === 'gold';
        const amount = Math.max(0, Math.floor(offer.amount || 0));
        return `
          <button class="relic-card fallback" data-index="${index}" style="--rarity:#8fa3b2">
            <span class="rarity">补给 · 通用奖励</span>
            <h3>${isGold ? '金币补给' : '基地修复'}</h3>
            <div class="relic-effect"><span>效果</span>${
              isGold ? `获得 ${amount} 金币` : `恢复 ${amount} 点基地生命（不超过上限）`
            }</div>
            <p class="relic-flavor">遗物池耗尽时的通用补位，保证选择流程继续。</p>
            <span class="pick">选择</span>
          </button>
        `;
      })
      .join('');

    const modal = this.openModal(
      `
        <div class="draft">
          <p class="eyebrow">第 ${wave} 波清除 · 战利品</p>
          <h2>选择一件遗物或补给</h2>
          <div class="draft-cards">${cards}</div>
          <div class="draft-actions">
            <span class="muted">当前金币 ◆ ${fmt(gold)}</span>
            <button class="btn ghost" id="btn-reroll" ${used >= max || gold < cost ? 'disabled' : ''}>
              刷新选项 · ◆ ${cost} <span class="muted">(${used}/${max})</span>
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
  }

  showSettings({ settings, inGame = false, onApply, onCancel }) {
    const current = normalizeSettings(settings);
    const option = (value, label, selected) =>
      `<option value="${value}" ${String(selected) === String(value) ? 'selected' : ''}>${label}</option>`;
    const presetName = detectPreset(current);
    const presetLabel =
      presetName === 'custom' ? '自定义' : presetName === 'low' ? '低配预设' : '高配预设';

    const modal = this.openModal(
      `
        <div class="settings">
          <p class="eyebrow">DISPLAY & PERFORMANCE</p>
          <h2>画质设置</h2>
          <p class="muted">${
            inGame ? '游戏已暂停。设置只影响表现，不改变战斗结果。' : '设置会保存在当前浏览器。'
          }</p>
          <div class="settings-grid">
            <label class="setting-field"><span>目标帧率</span>
              <select id="set-fps">${option(30, '30 FPS', current.fps)}${option(60, '60 FPS', current.fps)}</select>
            </label>
            <label class="setting-field"><span>画面清晰度</span>
              <select id="set-dpr">${option(1, '标准（DPR 1）', current.dpr)}${option(2, '高清（DPR 2）', current.dpr)}</select>
            </label>
            <label class="setting-field"><span>装饰特效</span>
              <select id="set-decorations">${['off', 'light', 'full']
                .map((value) => option(value, DECORATION_LABELS[value], current.decorations))
                .join('')}</select>
            </label>
            <label class="setting-field"><span>伤害飘字</span>
              <select id="set-floaters">${['off', 'key', 'all']
                .map((value) => option(value, FLOATER_LABELS[value], current.floaters))
                .join('')}</select>
            </label>
            <label class="setting-check"><input type="checkbox" id="set-glow" ${current.glow ? 'checked' : ''} /> 光晕</label>
            <label class="setting-check"><input type="checkbox" id="set-shake" ${current.shake ? 'checked' : ''} /> 屏幕震动</label>
            <label class="setting-check"><input type="checkbox" id="set-showfps" ${current.showFps ? 'checked' : ''} /> 显示 FPS</label>
          </div>
          <div class="settings-presets">
            <button class="btn small" id="preset-low">恢复低配</button>
            <button class="btn small" id="preset-high">恢复高配</button>
            <span class="muted" id="preset-label">当前：${presetLabel}</span>
          </div>
          <div class="modal-actions">
            <button class="btn primary" id="settings-apply">应用</button>
            <button class="btn ghost" id="settings-cancel">取消</button>
          </div>
        </div>
      `,
      {
        className: 'settings-modal',
        closable: true,
        onClose: () => onCancel?.(),
      }
    );

    const read = () => ({
      fps: Number(modal.querySelector('#set-fps').value),
      dpr: Number(modal.querySelector('#set-dpr').value),
      decorations: modal.querySelector('#set-decorations').value,
      floaters: modal.querySelector('#set-floaters').value,
      glow: modal.querySelector('#set-glow').checked,
      shake: modal.querySelector('#set-shake').checked,
      showFps: modal.querySelector('#set-showfps').checked,
    });

    const fill = (values) => {
      const next = normalizeSettings(values);
      modal.querySelector('#set-fps').value = String(next.fps);
      modal.querySelector('#set-dpr').value = String(next.dpr);
      modal.querySelector('#set-decorations').value = next.decorations;
      modal.querySelector('#set-floaters').value = next.floaters;
      modal.querySelector('#set-glow').checked = next.glow;
      modal.querySelector('#set-shake').checked = next.shake;
      modal.querySelector('#set-showfps').checked = next.showFps;
      updateLabel();
    };

    const updateLabel = () => {
      const detected = detectPreset(read());
      modal.querySelector('#preset-label').textContent =
        `当前：${detected === 'custom' ? '自定义' : detected === 'low' ? '低配预设' : '高配预设'}`;
    };

    modal.querySelectorAll('select, input').forEach((input) => {
      input.addEventListener('change', updateLabel);
    });
    modal.querySelector('#preset-low').onclick = () => fill(presetSettings('low'));
    modal.querySelector('#preset-high').onclick = () => fill(presetSettings('high'));
    modal.querySelector('#settings-apply').onclick = () => {
      const next = read();
      this._modalOnClose = null;
      this.closeModal();
      onApply?.(next);
    };
    modal.querySelector('#settings-cancel').onclick = () => this.closeModal();
  }

  showResult({ stats, res, mode, dailyLeft }) {
    const victory = res?.victory ?? stats.victory ?? false;
    const difficulty = res?.difficulty || stats.difficulty || 'standard';
    const diff = DIFFICULTIES[difficulty] || DIFFICULTIES.standard;
    const score = res?.score ?? stats.score;
    const cores = res ? res.coresEarned : 0;
    const rank = res?.rank;
    const personalBest = res?.personalBest;
    const extra =
      mode === 'daily' && dailyLeft != null
        ? `<p class="muted">今日剩余挑战次数：${dailyLeft}</p>`
        : '';

    const modal = this.openModal(
      `
        <div class="result ${victory ? 'victory' : ''}">
          <p class="eyebrow">${victory ? 'VICTORY' : 'EXPEDITION OVER'}</p>
          <h2>${victory ? '深渊已被肃清' : `抵达第 ${stats.wave} 波`}</h2>
          <p class="diff-tag" style="color:${diff.color}">${diff.name}难度${victory ? ' · 通关' : ''}</p>
          <div class="score-big">${fmt(score)}</div>
          <p class="muted">最终得分</p>
          <div class="result-grid">
            <div><span>已清波次</span><b>${stats.clearedWave ?? stats.wave}</b></div>
            <div><span>击杀</span><b>${fmt(stats.kills)}</b></div>
            <div><span>剩余金币</span><b>◆ ${fmt(Math.floor(stats.gold))}</b></div>
            <div><span>基地生命</span><b>${Math.max(0, Math.ceil(stats.baseHp))}</b></div>
            <div><span>获得星核</span><b>◈ ${fmt(cores)}</b></div>
            ${rank ? `<div><span>排行榜</span><b>#${rank}</b></div>` : ''}
            <div><span>个人纪录</span><b>${personalBest ? '新纪录！' : '—'}</b></div>
          </div>
          ${extra}
          ${res ? '' : '<p class="muted warn">结算未上传（服务器不可用），本局奖励未入库。</p>'}
          <div class="modal-actions">
            <button class="btn primary" id="btn-again">再来一局</button>
            <button class="btn ghost" id="btn-home">返回大厅</button>
          </div>
        </div>
      `,
      { className: 'result-modal', closable: false }
    );

    modal.querySelector('#btn-again').onclick = () => this.handlers.onRestart?.(mode, difficulty);
    modal.querySelector('#btn-home').onclick = () => this.handlers.onHome?.();
  }

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
                  ${entry.victory ? '<em class="win-mark" title="已通关">★</em>' : ''}
                  <span class="board-diff" style="color:${diff.color}">${diff.name}</span>
                </span>
                <span class="board-wave">第 ${entry.wave} 波</span>
                <span class="board-score">${fmt(entry.score)}</span>
              </div>`;
          })
          .join('')
      : '<p class="empty">还没有记录，去拿下第一名。</p>';

    const modal = this.openModal(
      `
        <div class="board">
          <p class="eyebrow">名人堂</p>
          <h2>排行榜</h2>
          <div class="tabs">
            <button class="tab ${mode === 'normal' ? 'active' : ''}" data-mode="normal">无尽远征</button>
            <button class="tab ${mode === 'daily' ? 'active' : ''}" data-mode="daily">每日挑战${day ? ` · ${day.slice(5)}` : ''}</button>
          </div>
          <div class="board-list">${rows}</div>
          <div class="modal-actions">
            <button class="btn ghost" id="btn-close-board">关闭</button>
          </div>
        </div>
      `,
      { className: 'board-modal', closable: true }
    );

    modal.querySelectorAll('.tab').forEach((tab) => {
      tab.onclick = () => this.handlers.onBoard?.(tab.dataset.mode);
    });
    modal.querySelector('#btn-close-board').onclick = () => this.closeModal();
  }

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
            ${isOwned ? '已拥有' : `◈ ${unlock.cost}`}
          </button>
        </div>`;
    }).join('');

    const modal = this.openModal(
      `
        <div class="unlocks">
          <p class="eyebrow">永久成长</p>
          <h2>星核商店 <span class="cores-inline">◈ ${fmt(cores)}</span></h2>
          <p class="muted">星核通过远征结算获得，解锁内容永久生效。</p>
          <div class="unlock-list">${rows}</div>
          <div class="modal-actions">
            <button class="btn ghost" id="btn-close-unlocks">关闭</button>
          </div>
        </div>
      `,
      { className: 'unlock-modal', closable: true }
    );

    modal.querySelectorAll('.unlock-row button[data-id]').forEach((button) => {
      button.onclick = () => this.handlers.onBuyUnlock?.(button.dataset.id);
    });
    modal.querySelector('#btn-close-unlocks').onclick = () => this.closeModal();
  }

  showRelicsModal() {
    const relics = this.game?.relics || [];
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
      : '<p class="empty">本局还没有遗物。</p>';

    const modal = this.openModal(
      `
        <div class="relics-modal">
          <p class="eyebrow">RELICS</p>
          <h2>遗物 <span class="cores-inline">${relics.length}</span></h2>
          <div class="relic-modal-list">${rows}</div>
          <div class="modal-actions">
            <button class="btn ghost" id="btn-close-relics">关闭</button>
          </div>
        </div>
      `,
      { className: 'relics-modal', closable: true }
    );
    modal.querySelector('#btn-close-relics').onclick = () => this.closeModal();
  }

  showHelp() {
    this.openModal(
      `
        <div class="help">
          <p class="eyebrow">作战手册</p>
          <h2>玩法说明</h2>
          <div class="help-section">
            <h3>核心循环</h3>
            <p>在空地建造防御塔，阻止敌人从紫色传送门抵达基地水晶。每清空一波，可从三件遗物中选择一件强化本局。每 5 波会出现首领。</p>
          </div>
          <div class="help-section">
            <h3>资源</h3>
            <p>击杀与清波获得金币，用于建造/升级/出售（返还 70%）。基地生命归零则远征结束。结算获得的星核可在星核商店永久解锁内容。</p>
          </div>
          <div class="help-section">
            <h3>战术要点</h3>
            <p>炮台无法锁定空中单位；电弧与毒素无视护甲；霜塔减速能为全场争取输出时间。敌人越接近基地，越优先被塔锁定。</p>
          </div>
          <div class="help-section">
            <h3>快捷键</h3>
            <p><kbd>1</kbd>–<kbd>5</kbd> 选择塔 · <kbd>U</kbd> 升级 · <kbd>S</kbd> 出售 · <kbd>空格</kbd> 暂停 · <kbd>Esc</kbd> 取消</p>
          </div>
          <div class="help-section">
            <h3>每日挑战</h3>
            <p>所有人使用同一套地图与波次种子，每天最多结算 3 次，取最高分上榜。</p>
          </div>
          <div class="modal-actions">
            <button class="btn ghost" id="btn-close-help">知道了</button>
          </div>
        </div>
      `,
      { className: 'help-modal', closable: true }
    );
    this.el.modalRoot.querySelector('#btn-close-help').onclick = () => this.closeModal();
  }

  showConfirm({ title, text, confirmText = '确认', danger = false, onConfirm }) {
    const modal = this.openModal(
      `
        <div class="confirm">
          <h2>${title}</h2>
          <p>${text}</p>
          <div class="modal-actions">
            <button class="btn ${danger ? 'danger' : 'primary'}" id="btn-confirm-yes">${confirmText}</button>
            <button class="btn ghost" id="btn-confirm-no">取消</button>
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
  }

  promptName(current, onSave) {
    const modal = this.openModal(
      `
        <div class="confirm">
          <h2>修改昵称</h2>
          <p class="muted">最多 16 个字符，会显示在排行榜上。</p>
          <input id="name-input" class="text-input" maxlength="16" value="${escapeHtml(current || '')}" />
          <div class="modal-actions">
            <button class="btn primary" id="btn-name-save">保存</button>
            <button class="btn ghost" id="btn-name-cancel">取消</button>
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
  }

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
  }
}

function mapPreviewSvg(map) {
  const w = 220;
  const h = 120;
  const pad = 7;
  const sx = (w - pad * 2) / map.cols;
  const sy = (h - pad * 2) / map.rows;
  const lanes = (map.lanes || [])
    .map((lane) => {
      const points = lane.polyline
        .map((p) => `${(pad + p.x * sx).toFixed(1)},${(pad + p.y * sy).toFixed(1)}`)
        .join(' ');
      return `<polyline points="${points}" fill="none" stroke="${lane.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0.9" />`;
    })
    .join('');
  const spawns = (map.spawns || [])
    .map(
      (spawn) =>
        `<circle cx="${(pad + spawn.x * sx).toFixed(1)}" cy="${(pad + spawn.y * sy).toFixed(1)}" r="4.2" fill="${spawn.color}" stroke="#071014" stroke-width="1.5" />`
    )
    .join('');
  const base = `<circle cx="${(pad + map.base.x * sx).toFixed(1)}" cy="${(pad + map.base.y * sy).toFixed(1)}" r="5" fill="#4fd8c8" stroke="#d8fff9" stroke-width="1.5" />`;
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="地图预览">
    <rect width="${w}" height="${h}" rx="10" fill="#0a1319" />
    <g opacity="0.12" stroke="#6fa78a" stroke-width="0.5">
      ${Array.from({ length: map.cols + 1 }, (_, i) => `<line x1="${pad + i * sx}" y1="${pad}" x2="${pad + i * sx}" y2="${h - pad}" />`).join('')}
      ${Array.from({ length: map.rows + 1 }, (_, i) => `<line x1="${pad}" y1="${pad + i * sy}" x2="${w - pad}" y2="${pad + i * sy}" />`).join('')}
    </g>
    ${lanes}
    ${spawns}
    ${base}
  </svg>`;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export const ui = new UI();
