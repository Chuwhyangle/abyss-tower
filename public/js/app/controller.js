// 页面编排根控制器：持有实例状态，装配各子控制器并注册 UI 回调。
import { api } from '../api.js';
import { ui } from '../ui.js';
import { audio } from '../audio.js';
import { loadSettings, saveSettings } from '../settings.js';
import { ensureAuthGate } from '../auth-ui.js';
import { RunStore } from './store.js';
import { SessionController } from './session.js';
import { RunController } from './run.js';
import { CombatController } from './combat.js';
import { InputController } from './input.js';

export class GameController {
  constructor({ api: apiClient = api, ui: uiLayer = ui, audio: audioEngine = audio, store = new RunStore() } = {}) {
    this.api = apiClient;
    this.ui = uiLayer;
    this.audio = audioEngine;
    this.store = store;

    // 唯一的可变状态：由控制器实例持有；window.__rtd.state 直接引用该对象。
    this.state = {
      profile: null,
      dailyLeft: null,
      // 技能养成：服务端快照 + 本次携带技能（localStorage 记住上次选择）。
      skills: null,
      selectedSkill: null,
      run: null,
      sim: null,
      app: null,
      currentOffers: null,
      settings: loadSettings(),
      starting: false,
      loadingWave: false,
      mapChoosing: false,
      mapCandidates: null,
    };

    this.session = new SessionController(this);
    this.run = new RunController(this);
    this.combat = new CombatController(this);
    this.input = new InputController(this);
  }

  async boot() {
    document.body.classList.toggle(
      'is-touch',
      navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches
    );

    // 账号模式：未登录只渲染登录/注册页，不初始化大厅与战斗。
    const authenticated = await ensureAuthGate();
    if (!authenticated) return;

    this.ui.init({
      onPlay: () =>
        this.ui.showDifficultySelect('normal', {
          dailyLeft: this.state.dailyLeft,
          skillState: this.state.skills,
          selectedSkill: this.state.selectedSkill,
        }),
      onDaily: () => {
        if (this.state.dailyLeft === 0) return this.ui.toast('今日挑战次数已用完');
        this.ui.showDifficultySelect('daily', {
          dailyLeft: this.state.dailyLeft,
          skillState: this.state.skills,
          selectedSkill: this.state.selectedSkill,
        });
      },
      onChooseDifficulty: (mode, difficulty) => {
        this.forceLandscape();
        this.ui.closeModal();
        this.run.startRun(mode, difficulty);
      },
      onResume: () => {
        this.forceLandscape();
        this.run.resumeRun();
      },
      onRename: () => this.session.renamePlayer(),
      onShop: () => this.session.openShop(),
      onBoard: (mode) => this.session.openBoard(mode),
      onHelp: () => this.ui.showHelp(),
      onSettings: () => this.openSettings(),
      onRelics: () => this.ui.showRelicsModal(),
      onFullscreen: () => this.toggleFullscreen(),
      onForceLandscape: () => this.forceLandscape(),
      onQuit: () => this.quitRun(),
      onNextWave: () => this.combat.nextWave(),
      onSpeed: (value) => this.state.app?.setSpeed(value),
      onSound: () => {
        this.audio.setEnabled(!this.audio.enabled);
        this.ui.updateSoundIcon();
      },
      onSelectShop: (type) => this.input.selectShop(type),
      onUpgrade: (tower) => this.input.upgradeTower(tower),
      onSell: (tower) => this.input.sellTower(tower),
      onDeselect: () => this.input.selectTower(null),
      onPickOffer: (index) => this.combat.pickOffer(index),
      onReroll: () => this.combat.rerollRelics(),
      onRestart: (mode, difficulty) => {
        this.forceLandscape();
        this.store.clearSnapshot();
        this.run.startRun(mode, difficulty);
      },
      onHome: () => this.goHome(),
      onBuyUnlock: (id) => this.session.buyUnlock(id),
      onSelectSkill: (id) => this.session.selectSkill(id),
      onSkillUpgrade: (id) => this.session.upgradeSkill(id),
      onSkill: () => this.input.castSkill(),
    });

    document.addEventListener('pointerdown', () => this.audio.ensure(), { once: true });
    window.addEventListener('keydown', (event) => this.input.handleKeydown(event));

    await this.session.refreshProfile();
    await this.session.refreshSkills();
    this.session.showTitle();
    this.session.mountWidget();
    // 调试/冒烟测试入口（单机游戏，不涉及敏感状态）。
    window.__rtd = { state: this.state, ui: this.ui, api: this.api };
    // 选图阶段刷新：恢复服务端尚未选定地图的远征与同一组候选。
    await this.run.restorePendingMap();
    document.body.dataset.boot = 'ok';
  }

  // ---------- 大厅外壳：设置、全屏、退出、回主页 ----------

  isTouchDevice() {
    return document.body.classList.contains('is-touch');
  }

  // 手机端进入战斗时自动尝试全屏 + 横屏锁定。
  // 必须在用户点击手势内调用；Safari/iOS 不支持时只能保留强制旋转提示。
  async forceLandscape() {
    if (!this.isTouchDevice()) return;
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        try {
          await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        } catch {
          /* 用户拒绝或浏览器不支持 */
        }
      }
      if (screen.orientation?.lock) {
        try {
          await screen.orientation.lock('landscape');
        } catch {
          /* iOS Safari / 桌面浏览器不支持方向锁定 */
        }
      }
    } catch {
      /* 保持竖屏提示 */
    }
  }

  async toggleFullscreen() {
    if (!this.isTouchDevice()) return;
    if (!document.fullscreenElement) {
      await this.forceLandscape();
      return;
    }
    try {
      await document.exitFullscreen?.();
      try {
        screen.orientation?.unlock?.();
      } catch {
        /* ignore */
      }
    } catch {
      this.ui.toast('退出全屏失败', 2000);
    }
  }

  openSettings() {
    if (this.ui.hasModal()) {
      this.ui.toast('请先完成当前的遗物选择或结算');
      return;
    }
    const state = this.state;
    const inGame = !!state.app;
    const wasPaused = state.app?.paused || false;
    if (inGame) state.app.setPaused(true);

    this.ui.showSettings({
      settings: state.settings,
      inGame,
      onApply: (next) => {
        state.settings = saveSettings(next);
        state.app?.applySettings(state.settings);
        if (inGame) state.app?.setPaused(wasPaused);
        this.ui.toast('画质设置已应用', 1800);
      },
      onCancel: () => {
        if (inGame) state.app?.setPaused(wasPaused);
      },
    });
  }

  quitRun() {
    if (!this.state.sim) return this.goHome();
    this.ui.showConfirm({
      title: '退出远征',
      text: '当前波次进度将丢失，本局不会计入每日结算。',
      confirmText: '退出',
      danger: true,
      onConfirm: async () => {
        if (this.state.run?.id) {
          try {
            await this.api.abandonRun(this.state.run.id);
          } catch {
            /* 离线时仍允许本地退出 */
          }
        }
        this.store.clearSnapshot();
        this.goHome();
      },
    });
  }

  async goHome() {
    const state = this.state;
    if (state.app) state.app.destroy();
    state.app = null;
    state.sim = null;
    state.run = null;
    await this.session.refreshProfile();
    await this.session.refreshSkills();
    this.session.showTitle();
  }
}
