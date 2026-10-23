// 战斗流程：开波与清波同步、遗物三选一/刷新、结算上报。
import { rollRelicOffers } from '../shared/data.js';
import { RelicOffers } from './offers.js';

export class CombatController {
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

  async nextWave() {
    const { state } = this;
    const sim = state.sim;
    if (!sim || sim.phase !== 'prep' || state.loadingWave) return;
    state.loadingWave = true;
    try {
      let data = await this.api.startWave(state.run.id);
      // 本地已清波但服务端没记录（清波请求失败/刷新）：先补同步，避免重放已清波次重复领奖。
      if (data.replay && sim.clearedWave >= data.wave.index) {
        try {
          await this.api.clearWave(state.run.id, sim.clearedWave);
          data = await this.api.startWave(state.run.id);
        } catch (error) {
          console.warn('[wave sync]', error);
          this.ui.toast('清波同步失败，请检查网络后重试', 2600);
          return;
        }
      }
      if (!data.replay) {
        sim.clearPending = false;
        sim.save();
      }
      state.run.clearedWaves = data.clearedWaves ?? state.run.clearedWaves;
      state.run.wavesServed = data.wavesServed ?? state.run.wavesServed;
      this.ui.closeModal();
      if (sim.beginWave(data.wave)) {
        state.app.setPaused(false);
        state.app.emitHud(true);
        if (data.replay) this.ui.toast(`重新挑战第 ${data.wave.index} 波`, 2200);
      }
    } catch (error) {
      this.ui.toast(error.message, 2800);
    } finally {
      state.loadingWave = false;
    }
  }

  async handleWaveClear(wave, info) {
    const { state } = this;
    const sim = state.sim;
    if (!sim || sim.phase === 'over') return;
    state.app.setPaused(true);
    this.ui.toast(
      `第 ${wave} 波清除 · +${info.reward} 金币${info.interest ? ` · 利息 +${info.interest}` : ''}`,
      2400
    );

    // 先让服务端记录清波，再落快照；刷新续玩时才能区分“已清”与“进行中”。
    let clearOk = false;
    try {
      const cleared = await this.api.clearWave(state.run.id, wave);
      state.run.clearedWaves = cleared.clearedWaves;
      state.run.wavesServed = cleared.wavesServed;
      clearOk = true;
      sim.clearPending = false;
    } catch (error) {
      console.warn('[clear]', error);
      sim.clearPending = true;
      this.ui.toast('清波同步失败，续玩时将重放本波', 2800);
    }

    sim.pendingDraft = true;
    // 清波未确认时不覆盖波前快照，避免刷新后重复领取奖励。
    if (clearOk) sim.save();

    let data;
    try {
      data = await this.api.getRelics(state.run.id);
    } catch (error) {
      console.warn('[relics] 回退到本地抽取', error);
      data = {
        offers: rollRelicOffers(`${state.run.seed}:fallback:${wave}`, sim.relics, 3, wave),
        rerollsUsed: 0,
        maxRerolls: 0,
      };
    }

    if (!state.sim || state.sim.phase === 'over') return;
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

    if (!data.offers || data.offers.length === 0) {
      sim.pendingDraft = false;
      sim.save();
      state.app.setPaused(false);
      this.ui.toast('遗物已收集完毕');
      return;
    }

    state.currentOffers = data.offers;
    this.ui.showDraft({
      wave,
      offers: data.offers,
      rerolls: { used: state.run.rerollsUsed, max: state.run.maxRerolls },
      gold: sim.gold,
    });
  }

  async pickOffer(index) {
    const { state } = this;
    const sim = state.sim;
    const offer = state.currentOffers?.[index];
    if (!sim || !offer) return;

    let applyLocally = false;
    try {
      await this.api.pickRelic(state.run.id, { index });
      applyLocally = true;
    } catch (error) {
      if (error.status === 409) {
        this.ui.toast('本次遗物已经选择', 2400);
      } else {
        console.warn('[pick offer]', error);
        applyLocally = true;
        this.ui.toast('服务端校验失败，本次选择仅在本地生效', 2400);
      }
    }

    if (applyLocally) sim.applyOffer(offer);
    sim.pendingDraft = false;
    state.currentOffers = null;
    sim.save();
    this.ui.closeModal();
    state.app.setPaused(false);
    this.ui.renderRelics();
    this.ui.updateShopState();
    state.app.emitHud(true);
  }

  async rerollRelics() {
    const { state } = this;
    const sim = state.sim;
    const cost = 25;
    if (!sim) return;
    if (sim.gold < cost) return this.ui.toast('金币不足，无法刷新');
    if (state.run.rerollsUsed >= state.run.maxRerolls) return this.ui.toast('刷新次数已用完');

    try {
      const data = await this.api.getRelics(state.run.id, true);
      data.offers = RelicOffers.normalize(data.offers, sim);
      sim.gold -= cost;
      state.run.rerollsUsed = data.rerollsUsed;
      state.run.maxRerolls = data.maxRerolls;
      state.currentOffers = data.offers;
      sim.save();
      state.app.emitHud(true);
      this.ui.showDraft({
        wave: data.wave,
        offers: data.offers,
        rerolls: { used: state.run.rerollsUsed, max: state.run.maxRerolls },
        gold: sim.gold,
      });
    } catch (error) {
      this.ui.toast(error.message, 2800);
    }
  }

  async handleGameOver(stats) {
    const { state } = this;
    const sim = state.sim;
    if (sim) state.app?.setPaused(true);
    this.ui.closeModal();

    let res = null;
    if (state.run?.id) {
      try {
        res = await this.api.finishRun(state.run.id, {
          // 服务端只接受“已清波次”，避免在第 30 波中途死亡被误判为通关。
          waveReached: stats.clearedWave ?? Math.max(0, stats.wave - 1),
          kills: stats.kills,
          goldLeft: Math.floor(stats.gold),
          baseHp: Math.ceil(stats.baseHp),
        });
      } catch (error) {
        console.error('[finish]', error);
      }
    }

    this.store.clearSnapshot();
    await this.game.session.refreshProfile({ silent: true });
    this.ui.showResult({
      stats,
      res,
      mode: state.run?.mode || 'normal',
      dailyLeft: state.dailyLeft,
    });
  }
}
