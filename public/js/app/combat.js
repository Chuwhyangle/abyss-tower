// 战斗流程：开波与清波同步、遗物三选一/刷新、结算上报。
import { rollRelicOffers } from '../shared/data.js';
import { isBossCoreWave } from '../shared/boss-core.js';
import { t } from '../i18n.js';
import { RelicOffers } from './offers.js';

export class CombatController {
  constructor({ state, api, ui, store, onRequestError, onRefreshProfile }) {
    this.state = state;
    this.api = api;
    this.ui = ui;
    this.store = store;
    this.onRequestError = onRequestError;
    this.onRefreshProfile = onRefreshProfile;
  }

  async nextWave() {
    const { state } = this;
    const sim = state.sim;
    if (!sim || state.loadingWave) return;
    // 事件节点未结算时先处理事件，避免跳过局内选择直接开下一波。
    if (sim.pendingEvent) {
      await this.resolvePendingEvent(sim.clearedWave);
      return;
    }
    if (sim.phase !== 'prep') return;
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
          this.ui.toast(t('combat.waveSyncFailedRetry'), 2600);
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
        if (data.replay) this.ui.toast(t('combat.replayWave', { wave: data.wave.index }), 2200);
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
      t('combat.waveClear', { wave, reward: info.reward }) +
        (info.interest ? t('combat.waveClearInterest', { interest: info.interest }) : ''),
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
      this.ui.toast(t('combat.waveSyncPending'), 2800);
    }

    sim.pendingDraft = true;
    // 清波未确认时不覆盖波前快照，避免刷新后重复领取奖励。
    if (clearOk) sim.save();

    // 每 5 波的事件节点先于遗物三选一结算。
    await this.resolvePendingEvent(wave);
    if (!state.sim || state.sim.phase === 'over') return;

    // 首领核心（5/10/15/20/25 波）在事件之后、遗物三选一之前发放。
    await this.resolveBossCore(wave);
    if (!state.sim || state.sim.phase === 'over') return;

    let data;
    try {
      data = await this.api.getRelics(state.run.id);
    } catch (error) {
      console.warn('[relics] 回退到本地抽取', error);
      data = {
        offers: rollRelicOffers(
          `${state.run.seed}:fallback:${wave}`,
          sim.relics,
          3,
          wave,
          state.run.mode
        ),
        rerollsUsed: 0,
        maxRerolls: 0,
      };
    }

    if (!state.sim || state.sim.phase === 'over') return;
    data.offers = RelicOffers.normalize(data.offers, sim);
    state.run.maxRerolls = data.maxRerolls ?? state.run.maxRerolls;
    state.run.rerollsUsed = data.rerollsUsed ?? 0;
    // 刷新费由服务端按主海克斯给（遗物吞噬者为 0）；旧响应没有该字段时沿用默认 25。
    if (Number.isFinite(Number(data.rerollCost))) state.run.rerollCost = Number(data.rerollCost);

    if (data.picked) {
      sim.pendingDraft = false;
      sim.save();
      state.app.setPaused(false);
      this.ui.toast(t('combat.relicAlreadyPicked'));
      return;
    }

    if (!data.offers || data.offers.length === 0) {
      sim.pendingDraft = false;
      sim.save();
      state.app.setPaused(false);
      this.ui.toast(t('combat.relicsExhausted'));
      return;
    }

    state.currentOffers = data.offers;
    this.ui.showDraft({
      wave,
      offers: data.offers,
      rerolls: { used: state.run.rerollsUsed, max: state.run.maxRerolls },
      gold: sim.gold,
      cost: state.run.rerollCost,
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
        this.ui.toast(t('combat.relicAlreadyPicked'), 2400);
      } else {
        console.warn('[pick offer]', error);
        applyLocally = true;
        this.ui.toast(t('combat.pickServerRejected'), 2400);
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
    // 与草稿面板同源：服务端给的刷新费（遗物吞噬者免费），旧状态回退 25。
    const cost = Number.isFinite(Number(state.run.rerollCost)) ? Number(state.run.rerollCost) : 25;
    if (!sim) return;
    if (sim.gold < cost) return this.ui.toast(t('combat.rerollNoGold'));
    if (state.run.rerollsUsed >= state.run.maxRerolls) {
      return this.ui.toast(t('combat.rerollExhausted'));
    }

    try {
      const data = await this.api.getRelics(state.run.id, true);
      data.offers = RelicOffers.normalize(data.offers, sim);
      sim.gold -= cost;
      state.run.rerollsUsed = data.rerollsUsed;
      state.run.maxRerolls = data.maxRerolls;
      if (Number.isFinite(Number(data.rerollCost))) state.run.rerollCost = Number(data.rerollCost);
      state.currentOffers = data.offers;
      sim.save();
      state.app.emitHud(true);
      this.ui.showDraft({
        wave: data.wave,
        offers: data.offers,
        rerolls: { used: state.run.rerollsUsed, max: state.run.maxRerolls },
        gold: sim.gold,
        cost,
      });
    } catch (error) {
      this.ui.toast(error.message, 2800);
    }
  }

  // 事件节点：服务端只记录选择（幂等校验），效果由 sim 按共享纯函数本地结算。
  async resolvePendingEvent(wave = null) {
    const { state } = this;
    const sim = state.sim;
    if (!sim?.pendingEvent) return false;

    state.app?.setPaused(true);
    const event = sim.pendingEvent;
    const targetWave = wave ?? sim.clearedWave;

    await new Promise((resolve) => {
      const present = () => {
        this.ui.showEventModal({
          wave: targetWave,
          event,
          gold: sim.gold,
          baseHp: sim.baseHp,
          maxHp: sim.maxBaseHp,
          onChoose: async (index) => {
            const option = event.options[index];
            if (!option || !sim.pendingEvent) return;

            let chosen = index;
            try {
              await this.api.pickEvent(state.run.id, { index, optionId: option.id });
            } catch (error) {
              if (error.status === 409) {
                // 重复提交（例如另一标签页已选）：按服务端记录的选择结算。
                try {
                  const info = await this.api.getEvent(state.run.id);
                  const serverIndex = event.options.findIndex(
                    (item) => item.id === info?.choice?.optionId
                  );
                  if (serverIndex >= 0) chosen = serverIndex;
                } catch {
                  /* 网络失败时保留本地选择 */
                }
              } else {
                console.warn('[event]', error);
              }
            }

            const result = sim.applyEventOption(chosen);
            if (!result.ok) {
              this.ui.toast(t('combat.eventUnaffordable'), 2400);
              present();
              return;
            }
            this.ui.closeModal();
            this.ui.renderRelics();
            this.ui.updateShopState();
            state.app?.emitHud(true);
            if (result.gamble) {
              this.ui.toast(
                result.gamble.won ? t('combat.gambleWon') : t('combat.gambleLost'),
                2400
              );
            }
            resolve(true);
          },
        });
      };
      present();
    });
    return true;
  }

  // 首领核心（§4）：服务端确定性给候选并记录选择，效果在此按共享口径本地结算。
  // 升阶/搜寻复用遗物 offer 的 addRelic 路径（含生命加成的即时补发）；补给改金币/生命/刷新。
  async resolveBossCore(wave = null) {
    const { state } = this;
    const sim = state.sim;
    const targetWave = wave ?? sim?.clearedWave;
    if (!sim || !isBossCoreWave(targetWave)) return false;

    let data;
    try {
      data = await this.api.getBossCore(state.run.id);
    } catch (error) {
      console.warn('[boss core]', error);
      return false;
    }
    if (!data?.offers?.length || data.picked) return false;
    if (!state.sim || state.sim.phase === 'over') return false;

    state.app?.setPaused(true);
    await new Promise((resolve) => {
      this.ui.showBossCore({
        wave: targetWave,
        offers: data.offers,
        onChoose: async (kindIndex, optionIndex) => {
          const kindOffer = data.offers[kindIndex];
          const option = kindOffer?.options?.[optionIndex];
          if (!option || !state.sim) return;

          let applied = { kind: kindOffer?.kind, option };
          try {
            const result = await this.api.pickBossCore(state.run.id, {
              index: kindIndex,
              optionIndex,
            });
            applied = result.applied || applied;
            this.ui.closeModal();
            this.applyBossCoreLocally(applied);
            resolve(true);
          } catch (error) {
            if (error.status === 409) {
              // 重复提交（另一标签页已选）：按服务端记录的选择结算。
              try {
                const info = await this.api.getBossCore(state.run.id);
                if (info?.choice) {
                  applied = { kind: info.choice.kind, option: info.choice.option };
                  this.ui.closeModal();
                  this.applyBossCoreLocally(applied);
                  resolve(true);
                  return;
                }
              } catch {
                /* 网络失败时保留本地选择 */
              }
            } else {
              console.warn('[boss core pick]', error);
            }
            this.ui.toast(error.message, 2800);
          }
        },
      });
    });
    return true;
  }

  // 首领核心即时效果：只改客户端可模拟资源，不触碰敌人/波次（§4.3 红线）。
  applyBossCoreLocally(applied) {
    const { state } = this;
    const sim = state.sim;
    if (!sim) return;
    const kind = applied?.kind;
    const option = applied?.option;
    if (kind === 'upgrade' || kind === 'search') {
      if (option?.id) sim.applyOffer({ kind: 'relic', id: option.id, toLevel: option.toLevel });
    } else if (kind === 'supply') {
      const amount = Math.max(0, Math.floor(Number(option?.amount) || 0));
      if (option?.type === 'gold') sim.applyOffer({ kind: 'gold', amount });
      else if (option?.type === 'maxHp') {
        sim.maxBaseHp = Math.max(1, sim.maxBaseHp + amount);
        sim.baseHp = Math.min(sim.maxBaseHp, sim.baseHp + amount);
        sim.save();
      } else if (option?.type === 'reroll') {
        state.run.maxRerolls += amount;
      }
    }
    // 觉醒/教义：本任务只持久化不可逆引用，词条/觉醒效果由 AC-059/AC-060 落地。
    this.ui.renderRelics();
    this.ui.updateShopState();
    state.app?.emitHud(true);
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
        this.onRequestError(error, {
          title: t('combat.settleUpload'),
          onRetry: () => this.handleGameOver(stats),
        });
      }
    }

    this.store.clearSnapshot();
    await this.onRefreshProfile({ silent: true });
    this.ui.showResult({
      stats,
      res,
      mode: state.run?.mode || 'normal',
      dailyLeft: state.dailyLeft,
    });
  }
}
