// 账号会话与大厅：资料刷新、标题页、改名、商店解锁、排行榜。
import { mountAuthWidget } from '../auth-ui.js';

export class SessionController {
  constructor(game) {
    this.game = game;
  }

  get state() {
    return this.game.state;
  }

  get api() {
    return this.game.api;
  }

  get ui() {
    return this.game.ui;
  }

  // silent 用于结算后的资料同步：离线时不提示、不写日志。
  async refreshProfile({ silent = false } = {}) {
    try {
      const res = await this.api.session();
      this.state.profile = res.profile;
      this.state.dailyLeft = res.dailyAttemptsLeft;
    } catch (error) {
      if (silent) return;
      console.error('[session]', error);
      this.ui.toast(`无法连接服务器：${error.message}`, 3200);
    }
  }

  showTitle() {
    this.ui.showTitle(this.state.profile, {
      hasSnapshot: !!this.game.store.loadSnapshot(),
      dailyLeft: this.state.dailyLeft,
    });
  }

  mountWidget() {
    mountAuthWidget(this.state.profile, () => this.api.logout());
  }

  openShop() {
    this.ui.showUnlocks(this.state.profile);
  }

  async openBoard(mode = 'normal') {
    try {
      const data = await this.api.leaderboard(mode);
      this.ui.showLeaderboard({ mode: data.mode, entries: data.entries, day: data.day });
    } catch (error) {
      this.ui.toast(error.message, 2800);
    }
  }

  async buyUnlock(id) {
    try {
      const { profile } = await this.api.unlock(id);
      this.state.profile = profile;
      this.ui.showUnlocks(profile);
      this.ui.toast('解锁成功');
    } catch (error) {
      this.ui.toast(error.message, 2800);
    }
  }

  renamePlayer() {
    this.ui.promptName(this.state.profile?.name || '', async (name) => {
      try {
        const res = await this.api.session(name);
        this.state.profile = res.profile;
        this.state.dailyLeft = res.dailyAttemptsLeft;
        this.showTitle();
      } catch (error) {
        this.ui.toast(error.message, 2800);
      }
    });
  }
}
