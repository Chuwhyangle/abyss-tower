// DOM 界面层门面：持有页面状态与事件绑定，渲染职责按面板拆到 ./ui/。
import { weekKey, weeklyChallenge } from './shared/scoring.js';
import { t, initI18n } from './i18n.js';
import { audio } from './audio.js';
import { $, hydrateIcons, fmt } from './ui/shared.js';
import { titleMethods } from './ui/title.js';
import { hudMethods } from './ui/hud.js';
import { shopMethods } from './ui/shop.js';
import { modalMethods } from './ui/modals.js';
import { resultMethods } from './ui/result.js';
import { settingsPanelMethods } from './ui/settings-panel.js';
import { panelMethods } from './ui/panels.js';
import { MenuBackground, menuTheme, createMenuCanvas } from './render/menu-background.js';
import { battleTransition } from './render/transition.js';
import { loadSettings } from './settings.js';

class UI {
  constructor() {
    this.handlers = {};
    this.game = null;
    this.profile = null;
    this.modalClosable = false;
    this._toastTimer = null;
    this._panelTower = null;
    this._skillState = null;
    this.selectedSkill = null;
    this._bossBannerWave = null;
    this._bossBannerTimer = null;
    this._menuBackground = null;
  }

  init(handlers) {
    this.handlers = handlers;
    initI18n();
    document.addEventListener('i18n:change', () => this.refreshLocale());
    this.el = {
      title: $('title-screen'),
      game: $('game-screen'),
      playerName: $('player-name'),
      cores: $('cores'),
      play: $('btn-play'),
      daily: $('btn-daily'),
      dailyLabel: $('daily-label'),
      endless: $('btn-endless'),
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
      titleSkills: $('title-skills'),
      btnSkill: $('btn-skill'),
      skillCount: $('skill-count'),
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
      nextWavePanel: $('next-wave-panel'),
      nextWaveList: $('next-wave-list'),
      nextWaveMeta: $('next-wave-meta'),
      towerPanel: $('tower-panel'),
      shopList: $('shop-list'),
      tooltip: $('tooltip'),
      toast: $('toast'),
      modalRoot: $('modal-root'),
      hpStat: $('hud-hp')?.closest('.stat'),
    };

    hydrateIcons();

    this.el.play.onclick = () => this.handlers.onPlay?.();
    this.el.daily.onclick = () => this.handlers.onDaily?.();
    this.buildWeeklyEntry();
    this.buildMutationEntry();
    if (this.el.endless) this.el.endless.onclick = () => this.handlers.onEndless?.();
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
    // 过场结束才允许开波：点击先同步结束过场，再走既有开波流程。
    this.el.nextWave.onclick = () => {
      battleTransition.skip();
      this.handlers.onNextWave?.();
    };
    this.el.sound.onclick = () => this.handlers.onSound?.();
    if (this.el.btnSkill) this.el.btnSkill.onclick = () => this.handlers.onSkill?.();

    document.querySelectorAll('.speed-btn').forEach((button) => {
      button.onclick = () => this.handlers.onSpeed?.(Number(button.dataset.speed));
    });

    this.buildPortalHint();
    this.bindTooltips();
    this.bindClickSound();
    this.updateSoundIcon();
  }

  // 本周挑战入口动态插入，避免改动静态标题页结构（与 HUD 提示同一做法）。
  buildWeeklyEntry() {
    if (this.el.weekly || !this.el.daily?.parentElement) return;
    const button = document.createElement('button');
    button.id = 'btn-weekly';
    button.type = 'button';
    button.className = 'btn ghost';
    button.innerHTML = '<span data-weekly-title></span> <span id="weekly-label"></span>';
    button.onclick = () => {
      if (this.handlers.onWeekly) return this.handlers.onWeekly();
      this.showWeeklySelect();
    };
    this.el.daily.insertAdjacentElement('afterend', button);
    this.el.weekly = button;
    this.el.weeklyTitle = button.querySelector('[data-weekly-title]');
    this.el.weeklyLabel = button.querySelector('#weekly-label');
  }

  // 变异挑战入口同样动态插入，保持标题页既有结构不变。
  buildMutationEntry() {
    if (this.el.mutation || !this.el.weekly) return;
    const button = document.createElement('button');
    button.id = 'btn-mutation';
    button.type = 'button';
    button.className = 'btn ghost';
    button.textContent = '变异挑战';
    button.onclick = () => {
      if (this.handlers.onMutation) return this.handlers.onMutation();
      this.showMutationSelect();
    };
    this.el.weekly.insertAdjacentElement('afterend', button);
    this.el.mutation = button;
  }

  // 周规则来自共享派生函数：同一周键与服务端派生同一套种子和词缀。
  showWeeklySelect() {
    this.showDifficultySelect('weekly', {
      weekly: weeklyChallenge(),
      skillState: this._titleExtras?.skillState,
      selectedSkill: this.selectedSkill,
    });
  }

  showTitle(profile, extras = {}) {
    this.profile = profile;
    this._titleExtras = extras;
    this.game = null;
    audio.startMusic('menu');
    this.el.title.hidden = false;
    this.el.game.hidden = true;
    battleTransition.cancel();
    this.hideBossBanner();
    this.playViewEnter(this.el.title);
    this.closeModal();
    this.hideTowerPanel();
    this.renderTitle();
    this.startMenuBackground();
  }

  // 大厅动态背景：标题页显示时启动；低配零粒子，进入战斗时停止以免后台耗帧。
  startMenuBackground() {
    if (!this.el?.title) return;
    if (!this._menuBackground) {
      const canvas = createMenuCanvas(this.el.title);
      if (!canvas) return;
      this._menuBackground = new MenuBackground({ canvas });
    }
    this._menuBackground.setTheme(menuTheme());
    this.refreshMenuBackground();
    this._menuBackground.start();
  }

  stopMenuBackground() {
    this._menuBackground?.stop();
  }

  // 画质/音乐设置变化后就地更新预算与色调；不重建画布，也不读取模拟状态。
  refreshMenuBackground() {
    if (!this._menuBackground) return;
    this._menuBackground.updateSettings(loadSettings());
    this._menuBackground.setMusicMood(audio.musicEnabled ? audio.mood || 'menu' : null);
  }

  renderTitle() {
    const profile = this.profile;
    const extras = this._titleExtras || {};
    const stats = profile?.stats || {};
    this.el.playerName.textContent = profile?.name || t('title.offline');
    this.el.cores.textContent = fmt(profile?.cores || 0);
    this.el.titleStats.innerHTML = `
      <div class="stat-cell"><span>${t('title.stat.bestWave')}</span><b>${fmt(stats.bestWave)}</b></div>
      <div class="stat-cell"><span>${t('title.stat.bestScore')}</span><b>${fmt(stats.bestScore)}</b></div>
      <div class="stat-cell"><span>${t('title.stat.kills')}</span><b>${fmt(stats.kills)}</b></div>
      <div class="stat-cell"><span>${t('title.stat.runs')}</span><b>${fmt(stats.runs)}</b></div>
    `;

    const left = extras.dailyLeft;
    const date = new Date();
    const label = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const streak = extras.daily?.streak || 0;
    const parts = [label];
    if (left != null) parts.push(t('title.daily.left', { n: left }));
    if (streak > 0) parts.push(t('title.daily.streak', { n: streak }));
    this.el.dailyLabel.textContent = parts.join(' · ');
    if (this.el.weeklyTitle) this.el.weeklyTitle.textContent = t('title.weekly');
    if (this.el.weeklyLabel) this.el.weeklyLabel.textContent = weekKey();
    this.setResumeAvailable(!!extras.hasSnapshot);
    this.renderTitleSkills(profile, extras);
  }

  // 语言切换后重渲染当前界面的动态文案；静态文案由 i18n 层统一处理。
  refreshLocale() {
    if (!this.el) return;
    this.updateSoundIcon();
    if (this.game) {
      this.updateHud(this.game.getHud());
      this.renderShop();
      this.renderRelics();
      if (this._panelTower) this.showTowerPanel(this._panelTower);
    } else if (this.profile) {
      this.renderTitle();
    }
  }

  showGame({ game, profile }) {
    this.game = game;
    if (profile) this.profile = profile;
    this.stopMenuBackground();
    audio.startMusic('battle');
    this.el.title.hidden = true;
    this.el.game.hidden = false;
    battleTransition.play();
    this._bossBannerWave = null;
    this.hideBossBanner();
    this.playViewEnter(this.el.game);
    this.closeModal();
    this.hideTowerPanel();
    this.renderShop();
    this.renderRelics();
    this.updateHud(game.getHud());
    this.updateSkillButton(game.getHud());
  }
}

// 设置面板应用后同步大厅背景：标题页里的画质/音乐改动不必等到下一次 showTitle。
const settingsMethodsWithMenu = {
  ...settingsPanelMethods,
  showSettings(options = {}) {
    const onApply = options.onApply;
    return settingsPanelMethods.showSettings.call(this, {
      ...options,
      onApply: (next) => {
        onApply?.(next);
        this.refreshMenuBackground();
      },
    });
  },
};

// 各面板以方法集合形式挂在同一原型上，对外仍是同一个 UI 实例与同一套方法签名。
Object.assign(
  UI.prototype,
  titleMethods,
  hudMethods,
  shopMethods,
  modalMethods,
  resultMethods,
  settingsMethodsWithMenu,
  panelMethods
);

export const ui = new UI();
