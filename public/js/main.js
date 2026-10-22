// 页面编排：API 流程、难度选择、战斗输入、存档与续玩。
import { api } from './api.js';
import { generateMap } from './shared/mapgen.js';
import {
  RELIC_BY_ID,
  TOWER_ORDER,
  MAX_WAVE,
  rollRelics,
} from './shared/data.js';
import { Simulation } from './sim.js';
import { GameApp } from './game-app.js';
import { ui } from './ui.js';
import { audio } from './audio.js';

const SNAPSHOT_KEY = 'abyss-tower.snapshot.v2';

const state = {
  profile: null,
  dailyLeft: null,
  run: null,
  sim: null,
  app: null,
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
    const snap = JSON.parse(raw);
    return snap && snap.version === 2 ? snap : null;
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
  ui.init({
    onPlay: () => ui.showDifficultySelect('normal', { dailyLeft: state.dailyLeft }),
    onDaily: () => {
      if (state.dailyLeft === 0) return ui.toast('今日挑战次数已用完');
      ui.showDifficultySelect('daily', { dailyLeft: state.dailyLeft });
    },
    onChooseDifficulty: (mode, difficulty) => {
      ui.closeModal();
      startRun(mode, difficulty);
    },
    onResume: () => resumeRun(),
    onRename: () => renamePlayer(),
    onShop: () => openShop(),
    onBoard: (mode) => openBoard(mode),
    onHelp: () => ui.showHelp(),
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
    onPickRelic: (id) => pickRelic(id),
    onReroll: () => rerollRelics(),
    onRestart: (mode, difficulty) => {
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
    beginGame(data, null);
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
    wave: snapshot?.wave || 0,
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
  };
  if (data.dailyAttemptsLeft != null) state.dailyLeft = data.dailyAttemptsLeft;

  const canvas = document.getElementById('game-canvas');
  state.app = new GameApp(sim, canvas, {
    onHud: (hud) => ui.updateHud(hud),
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
      map: generateMap(run.seed),
      startingGold: snap.gold,
      baseHp: snap.baseHp,
      maxBaseHp: snap.maxBaseHp,
      relics: (snap.relics || []).map((id) => RELIC_BY_ID[id]).filter(Boolean),
      towersUnlocked: run.towersUnlocked || ['arrow', 'cannon', 'frost'],
      maxRerolls: run.maxRerolls,
      rerollsUsed: run.rerollsUsed,
      day: run.day,
    };
    beginGame(data, snap);
    ui.toast('已恢复至上次波次结束', 2200);
  } catch (error) {
    ui.toast(error.message, 3000);
  }
}

// ---------- 波次流程 ----------

async function nextWave() {
  const sim = state.sim;
  if (!sim || sim.phase !== 'prep' || state.loadingWave) return;
  state.loadingWave = true;
  try {
    const { wave } = await api.startWave(state.run.id);
    ui.closeModal();
    if (sim.beginWave(wave)) {
      state.app.setPaused(false);
      state.app.emitHud(true);
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

  let data;
  try {
    data = await api.getRelics(state.run.id);
  } catch (error) {
    console.warn('[relics] 回退到本地抽取', error);
    const offers = rollRelics(`${state.run.seed}:fallback:${wave}`, sim.relics.map((r) => r.id), 3);
    data = { offers: offers.map((r) => r.id), rerollsUsed: 0, maxRerolls: 0 };
  }

  if (!state.sim || state.sim.phase === 'over') return;
  state.run.maxRerolls = data.maxRerolls ?? state.run.maxRerolls;
  state.run.rerollsUsed = data.rerollsUsed ?? 0;

  if (!data.offers || data.offers.length === 0) {
    state.app.setPaused(false);
    ui.toast('遗物已收集完毕');
    return;
  }

  ui.showDraft({
    wave,
    offers: data.offers,
    rerolls: { used: state.run.rerollsUsed, max: state.run.maxRerolls },
    gold: sim.gold,
  });
}

async function pickRelic(relicId) {
  const sim = state.sim;
  const relic = RELIC_BY_ID[relicId];
  if (!sim || !relic) return;

  try {
    await api.pickRelic(state.run.id, relicId);
  } catch (error) {
    console.warn('[pick relic]', error);
    ui.toast('服务端校验失败，本次选择仅在本地生效', 2400);
  }

  sim.addRelic(relic);
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
    sim.gold -= cost;
    state.run.rerollsUsed = data.rerollsUsed;
    state.run.maxRerolls = data.maxRerolls;
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

function bindCanvas(canvas) {
  canvas.onmousemove = (event) => {
    const sim = state.sim;
    if (!sim) return;
    const tile = state.app.renderer.screenToTile(event);
    sim.hover = tile;
    const overTower = sim.towerAt(tile.c, tile.r);
    canvas.style.cursor = sim.placementType || overTower ? 'pointer' : 'default';
  };
  canvas.onmouseleave = () => {
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
  const tile = state.app.renderer.screenToTile(event);
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
