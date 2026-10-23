// 本地存档：战斗快照与“选图阶段”待办记录。键名与数据形状必须保持兼容。
import { normalizeSnapshot } from '../shared/save.js';

const SNAPSHOT_KEY = 'abyss-tower.snapshot.v2';
// 选图阶段尚无战斗快照：单独记录开局参数，刷新/重进后可恢复同一组候选地图。
const MAP_PENDING_KEY = 'abyss-tower.mapselect.v1';

export class RunStore {
  loadSnapshot() {
    try {
      const raw = localStorage.getItem(SNAPSHOT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const snap = normalizeSnapshot(parsed);
      // normalizeSnapshot 会规范化 skill 字段；readyAt（epoch）只用于续玩冷却，
      // 单独从原始存档补回，避免被归一化丢弃。
      const readyAt = Number(parsed?.skill?.readyAt);
      if (snap?.skill && Number.isFinite(readyAt) && readyAt > 0) {
        snap.skill.readyAt = readyAt;
      }
      return snap;
    } catch {
      return null;
    }
  }

  saveSnapshot(snap) {
    try {
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
    } catch (error) {
      console.warn('[snapshot] 保存失败', error);
    }
  }

  // 只更新已有快照里的技能冷却，不覆盖波前的金币/波次等状态。
  // 放大招后立即调用，防止“放技能 → 刷新 → 重打本波”白赚一次冷却。
  patchSnapshotSkill(runId, skill) {
    try {
      const raw = localStorage.getItem(SNAPSHOT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (runId && parsed.runId && parsed.runId !== runId) return;
      parsed.skill = { ...(parsed.skill || {}), ...skill };
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(parsed));
    } catch (error) {
      console.warn('[snapshot] 技能冷却保存失败', error);
    }
  }

  clearSnapshot() {
    try {
      localStorage.removeItem(SNAPSHOT_KEY);
    } catch {
      /* ignore */
    }
  }

  loadPendingMap() {
    try {
      const raw = localStorage.getItem(MAP_PENDING_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  savePendingMap(data) {
    try {
      localStorage.setItem(MAP_PENDING_KEY, JSON.stringify(this.pendingMapData(data)));
    } catch (error) {
      console.warn('[map pending] 保存失败', error);
    }
  }

  clearPendingMap() {
    try {
      localStorage.removeItem(MAP_PENDING_KEY);
    } catch {
      /* ignore */
    }
  }

  pendingMapData(pending) {
    return {
      runId: pending.runId,
      seed: pending.seed,
      mode: pending.mode,
      difficulty: pending.difficulty,
      startingGold: pending.startingGold,
      baseHp: pending.baseHp,
      relics: pending.relics || [],
      towersUnlocked: pending.towersUnlocked,
      maxRerolls: pending.maxRerolls,
      day: pending.day,
      dailyAttemptsLeft: pending.dailyAttemptsLeft,
      // 开局冻结的技能/规则集；选图阶段刷新后仍要恢复同一技能。
      ruleset: pending.ruleset || null,
    };
  }
}
