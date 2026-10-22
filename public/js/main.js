// 页面编排：API 流程、难度选择、战斗输入、存档与续玩。
import { api } from './api.js';
import { generateMap } from './shared/mapgen.js';
import {
  RELIC_BY_ID,
  TOWER_ORDER,
  rollRelicOffers,
} from './shared/data.js';
import { Simulation } from './sim.js';
import { GameApp } from './game-app.js';
import { ui } from './ui.js';
import { audio } from './audio.js';
import { normalizeSnapshot } from './shared/save.js';
import { loadSettings, saveSettings } from './settings.js';

const SNAPSHOT_KEY = 'abyss-tower.snapshot.v2';

const state = {
  profile: null,
  dailyLeft: null,
  run: null,
  sim: null,
  app: null,
  currentOffers: null,
  settings: loadSettings(),
  starting: false,
  loadingWave: false,
};

const errorBox = document.createElement('div');
errorBox.id = 'boot-errors';
errorBox.style.display = 'none';
document.body.appendChild(errorBox);
window.__bootErrors = [];
function recordError(message) {
  window.__bootErrors.push(String(message));
  errorBox.textContent = window.__bootErrors.join('\n');
}
window.addEventListener('error', (event) => recordError(event.message || 'script error'));
window.addEventListener('unhandledrejection', (event) => recordError(event.reason || 'promise rejection'));

// ---------- 存档 ----------

function loadSnapshot() {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    return normalizeSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}

function saveSnapshot(snap) {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
  } catch (error) {
    console.warn('[snapshot] 保存失败', error);
  }
}

function clearSnapshot() {
  try {
    localStorage.removeItem(SNAPSHOT_KEY);
  } catch {
    /* ignore */
  }
}

// ---------- 启动 ----------

async function boot() {
  document.body.classList.toggle(
    'is-touch',
    navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches
  );
  ui.init({
    onPlay: () => ui.showDifficultySelect('normal', { dailyLeft: state.dailyLeft }),
    onDaily: () => {
      if (state.dailyLeft === 0) return ui.toast('今日挑战次数已用完');
      ui.showDifficultySelect('daily', { dailyLeft: state.dailyLeft });
    },
    onChooseDifficulty: (mode, difficulty) => {
      forceLandscape();
      ui.closeModal();
      startRun(mode, difficulty);
    },
    onResume: () => {
      forceLandscape();
      resumeRun();
    },
    onRename: () => renamePlayer(),
    onShop: () => openShop(),
    onBoard: (mode) => openBoard(mode),
    onHelp: () => ui.showHelp(),
    onSettings: () => openSettings(),
    onRelics: () => ui.showRelicsModal(),
    onFullscreen: () => toggleFullscreen(),
    onForceLandscape: () => forceLandscape(),
    onQuit: () => quitRun(),
    onNextWave: () => nextWave(),
    onSpeed: (value) => state.app?.setSpeed(value),
    onSound: () => {
      audio.setEnabled(!audio.enabled);
      ui.updateSoundIcon();
    },
    onSelectShop: (type) => selectShop(type),
    onUpgrade: (tower) => upgradeTower(tower),
    onSell: (tower) => sellTower(tower),
    onDeselect: () => selectTower(null),
    onPickOffer: (index) => pickOffer(index),
    onReroll: () => rerollRelics(),
    onRestart: (mode, difficulty) => {
      forceLandscape();
      clearSnapshot();
      startRun(mode, difficulty);
    },
    onHome: () => goHome(),
    onBuyUnlock: (id) => buyUnlock(id),
  });

  document.addEventListener('pointerdown', () => audio.ensure(), { once: true });
  window.addEventListener('keydown', handleKeydown);

  await refreshProfile();
  ui.showTitle(state.profile, {
    hasSnapshot: !!loadSnapshot(),
    dailyLeft: state.dailyLeft,
  });
  // 调试/冒烟测试入口（单机游戏，不涉及敏感状态）。
  window.__rtd = { state, ui, api };
  document.body.dataset.boot = 'ok';
}

async function refreshProfile() {
  try {
    const res = await api.session();
    state.profile = res.profile;
    state.dailyLeft = res.dailyAttemptsLeft;
  } catch (error) {
    console.error('[session]', error);
    ui.toast(`无法连接服务器：${error.message}`, 3200);
  }
}

// ---------- 开局 / 续玩 ----------

async function startRun(mode, difficulty) {
  if (state.starting) return;
  state.starting = true;
  try {
    const data = await api.startRun(mode, difficulty);
    clearSnapshot();
    if (data.candidates?.length) {
      let choosing = false;
      ui.showMapSelect({
        candidates: data.candidates,
        onChoose: async (index) => {
          if (choosing) return;
          choosing = true;
          try {
            const selection = await api.selectMap(data.runId, index);
            ui.closeModal();
            beginGame({ ...data, ...selection }, null);
          } catch (error) {
            choosing = false;
            ui.toast(error.message, 3000);
          }
        },
        onCancel: async () => {
          try {
            await api.abandonRun(data.runId);
          } catch {
            /* 忽略 */
          }
          ui.closeModal();
          ui.showTitle(state.profile, {
            hasSnapshot: !!loadSnapshot(),
            dailyLeft: state.dailyLeft,
          });
        },
      });
    } else {
      // 兼容旧服务端：直接返回 map
      beginGame(data, null);
    }
  } catch (error) {
    ui.toast(error.message, 3000);
  } finally {
    state.starting = false;
  }
}

function beginGame(data, snapshot) {
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
    onWaveClear: handleWaveClear,
    onGameOver: handleGameOver,
    onSave: (snap) => saveSnapshot(snap),
    onToast: (message) => ui.toast(message),
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
    onHud: (hud) => ui.updateHud(hud),
    settings: state.settings,
  });

  ui.showGame({ game: sim, profile: state.profile });
  bindCanvas(canvas);
  state.app.start();
  saveSnapshot(sim.toSnapshot());
}

async function resumeRun() {
  const snap = loadSnapshot();
  if (!snap) return ui.toast('没有可继续的远征');

  try {
    const { run } = await api.getRun(snap.runId);
    if (run.status !== 'active') {
      clearSnapshot();
      ui.toast('该远征已结束');
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
    beginGame(data, snap);
    if (snap.pendingDraft && run.clearedWaves === run.wavesServed) {
      await restorePendingDraft();
    } else if (run.clearedWaves < run.wavesServed) {
      ui.toast(`恢复到第 ${run.wavesServed} 波开始前，可重新挑战本波`, 2800);
    } else {
      ui.toast('已恢复至上次波次结束', 2200);
    }
  } catch (error) {
    ui.toast(error.message, 3000);
  }
}

async function restorePendingDraft() {
  const sim = state.sim;
  if (!sim) return;
  state.app.setPaused(true);
  try {
    const data = await api.getRelics(state.run.id);
    data.offers = normalizeOffers(data.offers, sim);
    state.run.maxRerolls = data.maxRerolls ?? state.run.maxRerolls;
    state.run.rerollsUsed = data.rerollsUsed ?? 0;
    if (data.picked) {
      sim.pendingDraft = false;
      sim.save();
      state.app.setPaused(false);
      ui.toast('本次遗物已经选择');
      return;
    }
    sim.pendingDraft = true;
    state.currentOffers = data.offers;
    ui.showDraft({
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
    ui.toast('未能恢复遗物选择，已跳过本次抽取', 2600);
  }
}

// 兼容旧服务端返回的遗物 ID 列表（尚未重启线上进程时）。
function normalizeOffers(raw, sim) {
  return (raw || [])
    .map((item) => {
      if (typeof item === 'string' && RELIC_BY_ID[item]) {
        const fromLevel = sim.getRelicLevel(item) || 0;
        return {
          kind: 'relic',
          id: item,
          fromLevel,
          toLevel: Math.min(3, fromLevel + 1),
        };
      }
      if (item && item.kind) return item;
      if (item && item.id && RELIC_BY_ID[item.id]) {
        const fromLevel = item.fromLevel ?? (sim.getRelicLevel(item.id) || 0);
        return {
          kind: 'relic',
          id: item.id,
          fromLevel,
          toLevel: Math.min(3, item.toLevel || fromLevel + 1),
        };
      }
      return null;
    })
    .filter(Boolean);
}

// ---------- 波次流程 ----------

async function nextWave() {
  const sim = state.sim;
  if (!sim || sim.phase !== 'prep' || state.loadingWave) return;
  state.loadingWave = true;
  try {
    let data = await api.startWave(state.run.id);
    // 本地已清波但服务端没记录（清波请求失败/刷新）：先补同步，避免重放已清波次重复领奖。
    if (data.replay && sim.clearedWave >= data.wave.index) {
      try {
        await api.clearWave(state.run.id, sim.clearedWave);
        data = await api.startWave(state.run.id);
      } catch (error) {
        console.warn('[wave sync]', error);
        ui.toast('清波同步失败，请检查网络后重试', 2600);
        return;
      }
    }
    if (!data.replay) {
      sim.clearPending = false;
      sim.save();
    }
    state.run.clearedWaves = data.clearedWaves ?? state.run.clearedWaves;
    state.run.wavesServed = data.wavesServed ?? state.run.wavesServed;
    ui.closeModal();
    if (sim.beginWave(data.wave)) {
      state.app.setPaused(false);
      state.app.emitHud(true);
      if (data.replay) ui.toast(`重新挑战第 ${data.wave.index} 波`, 2200);
    }
  } catch (error) {
    ui.toast(error.message, 2800);
  } finally {
    state.loadingWave = false;
  }
}

async function handleWaveClear(wave, info) {
  const sim = state.sim;
  if (!sim || sim.phase === 'over') return;
  state.app.setPaused(true);
  ui.toast(
    `第 ${wave} 波清除 · +${info.reward} 金币${info.interest ? ` · 利息 +${info.interest}` : ''}`,
    2400
  );

  // 先让服务端记录清波，再落快照；刷新续玩时才能区分"已清"与"进行中"。
  let clearOk = false;
  try {
    const cleared = await api.clearWave(state.run.id, wave);
    state.run.clearedWaves = cleared.clearedWaves;
    state.run.wavesServed = cleared.wavesServed;
    clearOk = true;
    sim.clearPending = false;
  } catch (error) {
    console.warn('[clear]', error);
    sim.clearPending = true;
    ui.toast('清波同步失败，续玩时将重放本波', 2800);
  }

  sim.pendingDraft = true;
  // 清波未确认时不覆盖波前快照，避免刷新后重复领取奖励。
  if (clearOk) sim.save();

  let data;
  try {
    data = await api.getRelics(state.run.id);
  } catch (error) {
    console.warn('[relics] 回退到本地抽取', error);
    data = {
      offers: rollRelicOffers(`${state.run.seed}:fallback:${wave}`, sim.relics, 3, wave),
      rerollsUsed: 0,
      maxRerolls: 0,
    };
  }

  if (!state.sim || state.sim.phase === 'over') return;
  data.offers = normalizeOffers(data.offers, sim);
  state.run.maxRerolls = data.maxRerolls ?? state.run.maxRerolls;
  state.run.rerollsUsed = data.rerollsUsed ?? 0;

  if (data.picked) {
    sim.pendingDraft = false;
    sim.save();
    state.app.setPaused(false);
    ui.toast('本次遗物已经选择');
    return;
  }

  if (!data.offers || data.offers.length === 0) {
    sim.pendingDraft = false;
    sim.save();
    state.app.setPaused(false);
    ui.toast('遗物已收集完毕');
    return;
  }

  state.currentOffers = data.offers;
  ui.showDraft({
    wave,
    offers: data.offers,
    rerolls: { used: state.run.rerollsUsed, max: state.run.maxRerolls },
    gold: sim.gold,
  });
}

async function pickOffer(index) {
  const sim = state.sim;
  const offer = state.currentOffers?.[index];
  if (!sim || !offer) return;

  let applyLocally = false;
  try {
    await api.pickRelic(state.run.id, { index });
    applyLocally = true;
  } catch (error) {
    if (error.status === 409) {
      ui.toast('本次遗物已经选择', 2400);
    } else {
      console.warn('[pick offer]', error);
      applyLocally = true;
      ui.toast('服务端校验失败，本次选择仅在本地生效', 2400);
    }
  }

  if (applyLocally) sim.applyOffer(offer);
  sim.pendingDraft = false;
  state.currentOffers = null;
  sim.save();
  ui.closeModal();
  state.app.setPaused(false);
  ui.renderRelics();
  ui.updateShopState();
  state.app.emitHud(true);
}

async function rerollRelics() {
  const sim = state.sim;
  const cost = 25;
  if (!sim) return;
  if (sim.gold < cost) return ui.toast('金币不足，无法刷新');
  if (state.run.rerollsUsed >= state.run.maxRerolls) return ui.toast('刷新次数已用完');

  try {
    const data = await api.getRelics(state.run.id, true);
    data.offers = normalizeOffers(data.offers, sim);
    sim.gold -= cost;
    state.run.rerollsUsed = data.rerollsUsed;
    state.run.maxRerolls = data.maxRerolls;
    state.currentOffers = data.offers;
    sim.save();
    state.app.emitHud(true);
    ui.showDraft({
      wave: data.wave,
      offers: data.offers,
      rerolls: { used: state.run.rerollsUsed, max: state.run.maxRerolls },
      gold: sim.gold,
    });
  } catch (error) {
    ui.toast(error.message, 2800);
  }
}

async function handleGameOver(stats) {
  const sim = state.sim;
  if (sim) state.app?.setPaused(true);
  ui.closeModal();

  let res = null;
  if (state.run?.id) {
    try {
      res = await api.finishRun(state.run.id, {
        // 服务端只接受"已清波次"，避免在第 30 波中途死亡被误判为通关。
        waveReached: stats.clearedWave ?? Math.max(0, stats.wave - 1),
        kills: stats.kills,
        goldLeft: Math.floor(stats.gold),
        baseHp: Math.ceil(stats.baseHp),
      });
    } catch (error) {
      console.error('[finish]', error);
    }
  }

  clearSnapshot();
  try {
    const session = await api.session();
    state.profile = session.profile;
    state.dailyLeft = session.dailyAttemptsLeft;
  } catch {
    /* 离线时忽略 */
  }
  ui.showResult({
    stats,
    res,
    mode: state.run?.mode || 'normal',
    dailyLeft: state.dailyLeft,
  });
}

// ---------- 建造 / 选择 ----------

let lastPointerType = 'mouse';

function nearestBuildable(sim, c, r, radius = 1) {
  let best = null;
  let bestDist = Infinity;
  for (let dr = -radius; dr <= radius; dr++) {
    for (let dc = -radius; dc <= radius; dc++) {
      const nc = c + dc;
      const nr = r + dr;
      if (!sim.canBuild(nc, nr)) continue;
      const dist = dc * dc + dr * dr;
      if (dist < bestDist) {
        bestDist = dist;
        best = { c: nc, r: nr };
      }
    }
  }
  return best;
}

function nearestTower(sim, c, r, radius = 1.2) {
  let best = null;
  let bestDist = radius * radius;
  for (const tower of sim.towers) {
    const dc = tower.c - c;
    const dr = tower.r - r;
    const dist = dc * dc + dr * dr;
    if (dist <= bestDist) {
      bestDist = dist;
      best = tower;
    }
  }
  return best;
}

function resolveTouchTile(sim, tile) {
  if (sim.towerAt(tile.c, tile.r)) return tile;
  if (sim.placementType) {
    return sim.canBuild(tile.c, tile.r)
      ? tile
      : nearestBuildable(sim, tile.c, tile.r, 1) || tile;
  }
  const tower = nearestTower(sim, tile.c, tile.r, 1.2);
  return tower ? { c: tower.c, r: tower.r } : tile;
}

function bindCanvas(canvas) {
  const updateHover = (event) => {
    const sim = state.sim;
    if (!sim) return;
    let tile = state.app.renderer.screenToTile(event);
    if (event.pointerType === 'touch') tile = resolveTouchTile(sim, tile);
    sim.hover = tile;
    const overTower = sim.towerAt(tile.c, tile.r);
    canvas.style.cursor = sim.placementType || overTower ? 'pointer' : 'default';
  };

  canvas.onpointermove = (event) => {
    lastPointerType = event.pointerType || 'mouse';
    if (event.pointerType === 'touch') return;
    updateHover(event);
  };
  // 触屏没有 hover：按下时先给出射程/合法性预览，抬起后的 click 完成建造。
  canvas.onpointerdown = (event) => {
    lastPointerType = event.pointerType || 'mouse';
    if (event.pointerType === 'touch') updateHover(event);
  };
  canvas.onpointerleave = () => {
    if (state.sim) state.sim.hover = null;
    canvas.style.cursor = 'default';
  };
  canvas.onclick = (event) => handleCanvasClick(event);
  canvas.oncontextmenu = (event) => {
    event.preventDefault();
    cancelSelection();
  };
}

function handleCanvasClick(event) {
  const sim = state.sim;
  if (!sim || sim.phase === 'over' || ui.hasModal()) return;
  let tile = state.app.renderer.screenToTile(event);
  if (lastPointerType === 'touch') tile = resolveTouchTile(sim, tile);
  const tower = sim.towerAt(tile.c, tile.r);

  if (sim.placementType && !tower) {
    if (sim.placeTower(sim.placementType, tile.c, tile.r)) {
      if (sim.gold < sim.towerCost(sim.placementType)) sim.placementType = null;
      ui.updateShopState();
      state.app.emitHud(true);
    }
    return;
  }

  selectTower(tower === sim.selectedTower ? null : tower);
}

function selectShop(type) {
  const sim = state.sim;
  if (!sim || sim.phase === 'over') return;
  if (!sim.unlockedTowers.includes(type)) return ui.toast('该防御塔尚未解锁');
  sim.placementType = sim.placementType === type ? null : type;
  sim.selectedTower = null;
  ui.hideTowerPanel();
  ui.updateShopState();
}

function selectTower(tower) {
  const sim = state.sim;
  if (!sim) return;
  sim.selectedTower = tower || null;
  if (tower) {
    sim.placementType = null;
    ui.showTowerPanel(tower);
  } else {
    ui.hideTowerPanel();
  }
  ui.updateShopState();
}

function cancelSelection() {
  const sim = state.sim;
  if (!sim) return;
  sim.placementType = null;
  sim.selectedTower = null;
  ui.hideTowerPanel();
  ui.updateShopState();
}

function upgradeTower(tower) {
  const sim = state.sim;
  if (!sim) return;
  if (sim.upgradeTower(tower)) {
    ui.showTowerPanel(tower);
    state.app.emitHud(true);
  }
}

function sellTower(tower) {
  const sim = state.sim;
  if (!sim) return;
  sim.sellTower(tower);
  ui.hideTowerPanel();
  ui.updateShopState();
  state.app.emitHud(true);
}

// ---------- 键盘 ----------

function handleKeydown(event) {
  const tag = event.target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;

  if (ui.hasModal()) {
    if (event.key === 'Escape') {
      event.preventDefault();
      ui.closeModalIfClosable();
    }
    return;
  }

  const sim = state.sim;
  if (!sim) return;

  if (event.key === 'Escape') {
    cancelSelection();
    return;
  }
  if (event.code === 'Space') {
    event.preventDefault();
    state.app?.setSpeed(0);
    return;
  }
  const index = Number(event.key);
  if (index >= 1 && index <= 5) {
    selectShop(TOWER_ORDER[index - 1]);
    return;
  }
  if (event.key === 'u' || event.key === 'U') {
    if (sim.selectedTower) upgradeTower(sim.selectedTower);
    return;
  }
  if (event.key === 's' || event.key === 'S') {
    if (sim.selectedTower) sellTower(sim.selectedTower);
  }
}

// ---------- 大厅功能 ----------

function isTouchDevice() {
  return document.body.classList.contains('is-touch');
}

// 手机端进入战斗时自动尝试全屏 + 横屏锁定。
// 必须在用户点击手势内调用；Safari/iOS 不支持时只能保留强制旋转提示。
async function forceLandscape() {
  if (!isTouchDevice()) return;
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

async function toggleFullscreen() {
  if (!isTouchDevice()) return;
  if (!document.fullscreenElement) {
    await forceLandscape();
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
    ui.toast('退出全屏失败', 2000);
  }
}

function openSettings() {
  if (ui.hasModal()) {
    ui.toast('请先完成当前的遗物选择或结算');
    return;
  }
  const inGame = !!state.app;
  const wasPaused = state.app?.paused || false;
  if (inGame) state.app.setPaused(true);

  ui.showSettings({
    settings: state.settings,
    inGame,
    onApply: (next) => {
      state.settings = saveSettings(next);
      state.app?.applySettings(state.settings);
      if (inGame) state.app?.setPaused(wasPaused);
      ui.toast('画质设置已应用', 1800);
    },
    onCancel: () => {
      if (inGame) state.app?.setPaused(wasPaused);
    },
  });
}

async function openBoard(mode = 'normal') {
  try {
    const data = await api.leaderboard(mode);
    ui.showLeaderboard({ mode: data.mode, entries: data.entries, day: data.day });
  } catch (error) {
    ui.toast(error.message, 2800);
  }
}

function openShop() {
  ui.showUnlocks(state.profile);
}

async function buyUnlock(id) {
  try {
    const { profile } = await api.unlock(id);
    state.profile = profile;
    ui.showUnlocks(profile);
    ui.toast('解锁成功');
  } catch (error) {
    ui.toast(error.message, 2800);
  }
}

function renamePlayer() {
  ui.promptName(state.profile?.name || '', async (name) => {
    try {
      const res = await api.session(name);
      state.profile = res.profile;
      state.dailyLeft = res.dailyAttemptsLeft;
      ui.showTitle(state.profile, {
        hasSnapshot: !!loadSnapshot(),
        dailyLeft: state.dailyLeft,
      });
    } catch (error) {
      ui.toast(error.message, 2800);
    }
  });
}

function quitRun() {
  if (!state.sim) return goHome();
  ui.showConfirm({
    title: '退出远征',
    text: '当前波次进度将丢失，本局不会计入每日结算。',
    confirmText: '退出',
    danger: true,
    onConfirm: async () => {
      if (state.run?.id) {
        try {
          await api.abandonRun(state.run.id);
        } catch {
          /* 离线时仍允许本地退出 */
        }
      }
      clearSnapshot();
      goHome();
    },
  });
}

async function goHome() {
  if (state.app) state.app.destroy();
  state.app = null;
  state.sim = null;
  state.run = null;
  await refreshProfile();
  ui.showTitle(state.profile, {
    hasSnapshot: !!loadSnapshot(),
    dailyLeft: state.dailyLeft,
  });
}

boot();
