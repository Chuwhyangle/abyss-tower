// 远征生命周期：新开局、选图三选一、续玩恢复、遗物抽取恢复。
import { generateMap, generateMapCandidates } from '../shared/mapgen.js';
import { RELIC_BY_ID } from '../shared/data.js';
import { Simulation } from '../sim.js';
import { GameApp } from '../game-app.js';
import { RelicOffers } from './offers.js';
import { skillApi } from './skills.js';

export class RunController {
  constructor({
    state,
    api,
    ui,
    store,
    onWaveClear,
    onGameOver,
    onRequestError,
    onBindCanvas,
    onShowTitle,
    onPendingEvent,
  }) {
    this.state = state;
    this.api = api;
    this.ui = ui;
    this.store = store;
    this.onWaveClear = onWaveClear;
    this.onGameOver = onGameOver;
    this.onRequestError = onRequestError;
    this.onBindCanvas = onBindCanvas;
    this.onShowTitle = onShowTitle;
    this.onPendingEvent = onPendingEvent;
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
      // 规则集以服务端为准（技能等级在开局冻结），旧服务端无 ruleset 时沿用本地记录。
      const data = {
        ...store.pendingMapData(pending),
        ruleset: run.ruleset || pending.ruleset || null,
        skill: run.ruleset?.skill || pending.skill || null,
      };
      if (run.mapChoice >= 0) {
        // 地图已选定但快照未落盘（极端刷新时机）：沿用服务端选择直接开局。
        const selection = await this.api.selectMap(pending.runId, run.mapChoice);
        this.beginGame({ ...data, ...selection }, null);
        this.ui.toast('已恢复本次远征的地图选择', 2400);
        return true;
      }
      const candidates = generateMapCandidates(run.seed, 3);
      if (!candidates.length) {
        store.clearPendingMap();
        return false;
      }
      this.showMapSelectFlow(data, candidates);
      this.ui.toast('已恢复地图选择', 2200);
      return true;
    } catch (error) {
      console.warn('[map restore]', error);
      if (error.status === 404 || error.status === 409) store.clearPendingMap();
      return false;
    }
  }

  async startRun(mode, difficulty, mutations = null) {
    if (this.state.starting) return;
    this.state.starting = true;
    try {
      // 变异组合随建局一起提交；普通/每日/本周/无尽模式保持原有请求体。
      this.state.lastMutations = mutations;
      // 建局时携带本局技能；服务端按账号数据冻结等级并写入 ruleset_json。
      // 旧服务端若忽略该字段，后续会自动降级为“无技能局”。
      const skillId = this.state.selectedSkill || null;
      const data = skillId
        ? await skillApi.startRun(mode, difficulty, skillId, mutations)
        : await this.api.startRun(mode, difficulty, mutations);
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
      this.onRequestError(error, {
        title: '开始远征',
        onRetry: () => this.startRun(mode, difficulty, mutations),
      });
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
        this.onShowTitle();
      },
    });
  }

  beginGame(data, snapshot) {
    const state = this.state;
    if (state.app) state.app.destroy();

    const seed = data.seed || snapshot?.seed;
    const map = data.map || generateMap(seed);
    const relics = (data.relics || []).slice();

    // 技能：等级以服务端 ruleset（开局冻结）为准；续玩时用快照的剩余冷却恢复。
    const ruleset = data.ruleset || snapshot?.ruleset || null;
    // 刷新恢复的变异局也要能在结算后原组合再来一局。
    this.state.lastMutations = ruleset?.mutations?.ids || null;
    const skillBase = ruleset?.skill || data.skill || snapshot?.skill || null;
    let skill = null;
    if (skillBase?.id) {
      skill = { ...skillBase };
      if (snapshot?.skill?.cooldown != null) skill.cooldown = snapshot.skill.cooldown;
      if (snapshot?.skill?.readyAt != null) skill.readyAt = snapshot.skill.readyAt;
    }

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
      // 旧存档没有 events：按“无事件”恢复。
      events: snapshot?.events || [],
      kills: snapshot?.kills || 0,
      startedAt: snapshot?.startedAt,
      restored: !!snapshot,
      unlockedTowers: data.towersUnlocked || ['arrow', 'cannon', 'frost'],
      // sim 契约：skill = { id, level }（可选 cooldown/readyAt），无技能为 null。
      skill,
      skillReadyAt: skill?.readyAt ?? null,
      skillSpeed: skill?.speed ?? 1,
      ruleset,
      onWaveClear: (wave, info) => this.onWaveClear(wave, info),
      onGameOver: (stats) => this.onGameOver(stats),
      onSave: (snap) => this.store.saveSnapshot(this.stampSkillCooldown(snap)),
      // 只补写波前快照里的技能冷却，保留金币/波次等波前状态。
      onSkillCast: (snap) => {
        const cast = snap?.skill;
        if (!cast) return;
        const speed = Math.max(1, state.app?.speed || 1);
        this.store.patchSnapshotSkill(state.run?.id, {
          ...cast,
          speed,
          readyAt: Date.now() + ((Number(cast.cooldown) || 0) / speed) * 1000,
        });
      },
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
      skill: skill ? { id: skill.id, level: skill.level || 1 } : null,
    };
    if (data.dailyAttemptsLeft != null) state.dailyLeft = data.dailyAttemptsLeft;
    if (data.daily) state.daily = data.daily;

    const canvas = document.getElementById('game-canvas');
    state.app = new GameApp(sim, canvas, {
      onHud: (hud) => this.ui.updateHud(hud),
      settings: state.settings,
    });

    this.ui.showGame({ game: sim, profile: state.profile });
    this.onBindCanvas(canvas);
    state.app.start();
    this.store.saveSnapshot(this.stampSkillCooldown(sim.toSnapshot()));
    // 地图已选定且战斗快照已落盘，选图阶段记录不再需要。
    this.store.clearPendingMap();
    state.mapCandidates = null;
    state.mapChoosing = false;
  }

  // 快照里的 skill.cooldown 是“模拟秒”；同时记录 epoch readyAt，
  // 续玩时按真实时间扣减（并按当前倍速换算），避免刷新白赚冷却。
  stampSkillCooldown(snapshot) {
    if (!snapshot?.skill || !(snapshot.skill.cooldown > 0) || snapshot.skill.readyAt != null) {
      return snapshot;
    }
    const speed = Math.max(1, this.state.app?.speed || 1);
    snapshot.skill.speed = speed;
    snapshot.skill.readyAt = Date.now() + (snapshot.skill.cooldown / speed) * 1000;
    return snapshot;
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
        // 开局冻结的技能等级；旧局 ruleset 为 {} → 无技能、不显示按钮。
        ruleset: run.ruleset || null,
        skill: run.ruleset?.skill || null,
      };
      this.beginGame(data, snap);
      // 未结算的事件节点优先恢复（快照里只存事件历史，待办事件由波次推导）。
      if (this.state.sim?.pendingEvent) await this.onPendingEvent?.();
      if (snap.pendingDraft && run.clearedWaves === run.wavesServed) {
        await this.restorePendingDraft();
      } else if (run.clearedWaves < run.wavesServed) {
        this.ui.toast(`恢复到第 ${run.wavesServed} 波开始前，可重新挑战本波`, 2800);
      } else {
        this.ui.toast('已恢复至上次波次结束', 2200);
      }
    } catch (error) {
      this.onRequestError(error, {
        title: '恢复远征',
        onRetry: () => this.resumeRun(),
      });
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
