// 远征生命周期：新开局、选图三选一、续玩恢复、遗物抽取恢复。
import { generateMap, generateMapCandidates } from '../shared/mapgen.js';
import { RELIC_BY_ID } from '../shared/data.js';
import { Simulation } from '../sim.js';
import { GameApp } from '../game-app.js';
import { RelicOffers } from './offers.js';

export class RunController {
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

  get store() {
    return this.game.store;
  }

  async restorePendingMap() {
    const { store } = this;
    const pending = store.loadPendingMap();
    if (!pending?.runId) return false;
    // 已有战斗快照时，“继续上一局”优先，丢弃过期的选图阶段记录。
    if (store.loadSnapshot()) {
      store.clearPendingMap();
      return false;
    }
    try {
      const { run } = await this.api.getRun(pending.runId);
      if (!run || run.status !== 'active') {
        store.clearPendingMap();
        return false;
      }
      if (run.mapChoice >= 0) {
        // 地图已选定但快照未落盘（极端刷新时机）：沿用服务端选择直接开局。
        const selection = await this.api.selectMap(pending.runId, run.mapChoice);
        this.beginGame({ ...store.pendingMapData(pending), ...selection }, null);
        this.ui.toast('已恢复本次远征的地图选择', 2400);
        return true;
      }
      const candidates = generateMapCandidates(run.seed, 3);
      if (!candidates.length) {
        store.clearPendingMap();
        return false;
      }
      this.showMapSelectFlow(store.pendingMapData(pending), candidates);
      this.ui.toast('已恢复地图选择', 2200);
      return true;
    } catch (error) {
      console.warn('[map restore]', error);
      if (error.status === 404 || error.status === 409) store.clearPendingMap();
      return false;
    }
  }

  async startRun(mode, difficulty) {
    if (this.state.starting) return;
    this.state.starting = true;
    try {
      const data = await this.api.startRun(mode, difficulty);
      this.store.clearSnapshot();
      this.state.mapChoosing = false;
      if (data.candidates?.length) {
        this.store.savePendingMap(data);
        this.showMapSelectFlow(data, data.candidates);
      } else {
        // 兼容旧服务端：直接返回 map
        this.beginGame(data, null);
      }
    } catch (error) {
      this.ui.toast(error.message, 3000);
    } finally {
      this.state.starting = false;
    }
  }

  // 新开局与刷新恢复共用同一套选图流程。
  showMapSelectFlow(data, candidates) {
    this.state.mapCandidates = candidates;
    this.ui.showMapSelect({
      candidates,
      onChoose: async (index) => {
        if (this.state.mapChoosing) return;
        this.state.mapChoosing = true;
        try {
          const selection = await this.api.selectMap(data.runId, index);
          this.ui.closeModal();
          this.beginGame({ ...data, ...selection }, null);
        } catch (error) {
          this.state.mapChoosing = false;
          this.ui.toast(error.message, 3000);
        }
      },
      onCancel: async () => {
        try {
          await this.api.abandonRun(data.runId);
        } catch {
          /* 忽略 */
        }
        this.store.clearPendingMap();
        this.state.mapCandidates = null;
        this.state.mapChoosing = false;
        this.ui.closeModal();
        this.game.session.showTitle();
      },
    });
  }

  beginGame(data, snapshot) {
    const state = this.state;
    if (state.app) state.app.destroy();

    const seed = data.seed || snapshot?.seed;
    const map = data.map || generateMap(seed);
    const relics = (data.relics || []).slice();

    const sim = new Simulation({
      map,
      seed,
      difficulty: data.difficulty || snapshot?.difficulty || 'standard',
      runId: data.runId || snapshot?.runId,
      mode: data.mode || snapshot?.mode || 'normal',
      gold: snapshot ? snapshot.gold : data.startingGold,
      baseHp: snapshot ? snapshot.baseHp : data.baseHp,
      maxBaseHp: snapshot ? snapshot.maxBaseHp : data.baseHp,
      relics,
      towers: snapshot?.towers || [],
      wave: snapshot?.clearedWave ?? snapshot?.wave ?? 0,
      clearedWave: data.clearedWaves ?? snapshot?.clearedWave ?? snapshot?.wave ?? 0,
      pendingDraft: snapshot?.pendingDraft ?? false,
      kills: snapshot?.kills || 0,
      startedAt: snapshot?.startedAt,
      restored: !!snapshot,
      unlockedTowers: data.towersUnlocked || ['arrow', 'cannon', 'frost'],
      onWaveClear: (wave, info) => this.game.combat.handleWaveClear(wave, info),
      onGameOver: (stats) => this.game.combat.handleGameOver(stats),
      onSave: (snap) => this.store.saveSnapshot(snap),
      onToast: (message) => this.ui.toast(message),
    });

    state.sim = sim;
    state.run = {
      id: data.runId || snapshot?.runId,
      seed,
      mode: data.mode || snapshot?.mode || 'normal',
      difficulty: sim.difficulty,
      day: data.day,
      maxRerolls: data.maxRerolls ?? 1,
      rerollsUsed: data.rerollsUsed ?? 0,
      clearedWaves: data.clearedWaves ?? sim.clearedWave,
      wavesServed: data.wavesServed ?? sim.clearedWave,
      mapChoice: data.mapChoice ?? sim.map.index ?? 0,
      mapMeta: data.mapMeta || sim.map.meta || null,
    };
    if (data.dailyAttemptsLeft != null) state.dailyLeft = data.dailyAttemptsLeft;

    const canvas = document.getElementById('game-canvas');
    state.app = new GameApp(sim, canvas, {
      onHud: (hud) => this.ui.updateHud(hud),
      settings: state.settings,
    });

    this.ui.showGame({ game: sim, profile: state.profile });
    this.game.input.bindCanvas(canvas);
    state.app.start();
    this.store.saveSnapshot(sim.toSnapshot());
    // 地图已选定且战斗快照已落盘，选图阶段记录不再需要。
    this.store.clearPendingMap();
    state.mapCandidates = null;
    state.mapChoosing = false;
  }

  async resumeRun() {
    const snap = this.store.loadSnapshot();
    if (!snap) return this.ui.toast('没有可继续的远征');

    try {
      const { run } = await this.api.getRun(snap.runId);
      if (run.status !== 'active') {
        this.store.clearSnapshot();
        this.ui.toast('该远征已结束');
        return;
      }
      const data = {
        runId: run.id,
        seed: run.seed,
        mode: run.mode,
        difficulty: run.difficulty,
        map: run.map || generateMap(run.seed),
        mapMeta: run.mapMeta || run.map?.meta || null,
        startingGold: snap.gold,
        baseHp: snap.baseHp,
        maxBaseHp: snap.maxBaseHp,
        relics: (snap.relics || [])
          .map((item) => {
            const id = typeof item === 'string' ? item : item.id;
            const def = RELIC_BY_ID[id];
            return def ? { ...def, level: Math.min(3, Math.max(1, item.level || 1)) } : null;
          })
          .filter(Boolean),
        towersUnlocked: run.towersUnlocked || ['arrow', 'cannon', 'frost'],
        maxRerolls: run.maxRerolls,
        rerollsUsed: run.rerollsUsed,
        clearedWaves: run.clearedWaves,
        wavesServed: run.wavesServed,
        day: run.day,
      };
      this.beginGame(data, snap);
      if (snap.pendingDraft && run.clearedWaves === run.wavesServed) {
        await this.restorePendingDraft();
      } else if (run.clearedWaves < run.wavesServed) {
        this.ui.toast(`恢复到第 ${run.wavesServed} 波开始前，可重新挑战本波`, 2800);
      } else {
        this.ui.toast('已恢复至上次波次结束', 2200);
      }
    } catch (error) {
      this.ui.toast(error.message, 3000);
    }
  }

  async restorePendingDraft() {
    const { state } = this;
    const sim = state.sim;
    if (!sim) return;
    state.app.setPaused(true);
    try {
      const data = await this.api.getRelics(state.run.id);
      data.offers = RelicOffers.normalize(data.offers, sim);
      state.run.maxRerolls = data.maxRerolls ?? state.run.maxRerolls;
      state.run.rerollsUsed = data.rerollsUsed ?? 0;
      if (data.picked) {
        sim.pendingDraft = false;
        sim.save();
        state.app.setPaused(false);
        this.ui.toast('本次遗物已经选择');
        return;
      }
      sim.pendingDraft = true;
      state.currentOffers = data.offers;
      this.ui.showDraft({
        wave: data.wave,
        offers: data.offers,
        rerolls: { used: state.run.rerollsUsed, max: state.run.maxRerolls },
        gold: sim.gold,
      });
    } catch (error) {
      console.warn('[draft restore]', error);
      sim.pendingDraft = false;
      sim.save();
      state.app.setPaused(false);
      this.ui.toast('未能恢复遗物选择，已跳过本次抽取', 2600);
    }
  }
}
