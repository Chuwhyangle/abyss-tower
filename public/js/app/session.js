// 账号会话与大厅：资料刷新、标题页、改名、商店解锁、排行榜、技能养成。
import { mountAuthWidget } from '../auth-ui.js';
import { SKILLS, isSkillUnlocked } from '../shared/data.js';
import { skillApi, loadSelectedSkill, saveSelectedSkill } from './skills.js';

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

  // 技能快照：接口不可用时降级为 null，由 UI 用共享数据 + 资料推导锁定状态。
  async refreshSkills() {
    try {
      const data = await skillApi.list();
      if (!data?.skills?.length) return false;
      this.state.skills = data;
      this.state.selectedSkill = this.resolveSelectedSkill(data);
      return true;
    } catch (error) {
      console.warn('[skills]', error);
      this.state.skills = null;
      if (!this.state.selectedSkill) {
        this.state.selectedSkill = this.fallbackSelectedSkill();
      }
      return false;
    }
  }

  // 选择优先级：当前内存 → localStorage 记住的上次选择 → 服务端记录 → 首个已解锁。
  resolveSelectedSkill(data) {
    const owned = new Map((data?.skills || []).map((skill) => [skill.id, skill]));
    const candidates = [this.state.selectedSkill, loadSelectedSkill(), data?.selected];
    for (const id of candidates) {
      if (id && owned.get(id)?.unlocked) return id;
    }
    return (data?.skills || []).find((skill) => skill.unlocked)?.id || null;
  }

  fallbackSelectedSkill() {
    const saved = loadSelectedSkill();
    if (saved && SKILLS[saved] && isSkillUnlocked(saved, this.state.profile)) return saved;
    return Object.keys(SKILLS).find((id) => isSkillUnlocked(id, this.state.profile)) || null;
  }

  showTitle() {
    this.ui.showTitle(this.state.profile, {
      hasSnapshot: !!this.game.store.loadSnapshot(),
      dailyLeft: this.state.dailyLeft,
      skillState: this.state.skills,
      selectedSkill: this.state.selectedSkill,
    });
  }

  selectSkill(skillId) {
    if (!SKILLS[skillId]) return;
    const entry = this.state.skills?.skills?.find((skill) => skill.id === skillId);
    if (entry && !entry.unlocked) {
      this.ui.toast(`尚未解锁：${entry.unlockHint || '完成对应难度首通'}`);
      return;
    }
    this.state.selectedSkill = skillId;
    saveSelectedSkill(skillId);
    // 选择本身只影响建局参数；服务端记录失败不阻断本地选择。
    skillApi.select(skillId).catch(() => {});
    if (this.ui.hasModal()) this.ui.updateSkillSelection(skillId);
    else this.showTitle();
  }

  async upgradeSkill(skillId) {
    const entry = this.state.skills?.skills?.find((skill) => skill.id === skillId);
    try {
      const data = await skillApi.upgrade(skillId, entry?.level);
      this.state.skills = data;
      if (data?.wallet?.cores != null && this.state.profile) {
        this.state.profile.cores = data.wallet.cores;
      }
      if (!this.state.selectedSkill && data?.skills) {
        this.state.selectedSkill = this.resolveSelectedSkill(data);
      }
      this.showTitle();
      const upgraded = data?.upgraded;
      this.ui.toast(
        upgraded
          ? `${entry?.name || SKILLS[skillId]?.name || '技能'} 升级至 ${upgraded.to} 级`
          : '技能升级成功'
      );
    } catch (error) {
      this.ui.toast(error.message || '升级失败', 2800);
    }
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
