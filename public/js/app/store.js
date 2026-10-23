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
      return normalizeSnapshot(JSON.parse(raw));
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
    };
  }
}
