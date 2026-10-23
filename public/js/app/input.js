// 输入层：Canvas 指针命中、建造/选择、塔面板操作与键盘快捷键。
import { TOWER_ORDER } from '../shared/data.js';

// 触屏吸附与点击判定参数；纯函数与运行时共用同一份配置。
export const DEFAULT_TOUCH_SETTINGS = Object.freeze({
  snapRadius: 1,
  towerSnapRadius: 1.2,
  tapSlopPx: 12,
});

// 与 styles.css 的移动端断点保持一致（宽 900 / 高 520）。
export const VIEWPORT_BREAKPOINTS = Object.freeze({
  compactWidth: 900,
  compactHeight: 520,
});

// 手指位移不超过 slop 才算点击，超过即视为拖动/滚动，不触发建造。
export function isTapGesture(start, end, slopPx = DEFAULT_TOUCH_SETTINGS.tapSlopPx) {
  if (!start || !end) return true;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return dx * dx + dy * dy <= slopPx * slopPx;
}

export function layoutForViewport(width, height) {
  return {
    orientation: width >= height ? 'landscape' : 'portrait',
    compact:
      width <= VIEWPORT_BREAKPOINTS.compactWidth || height <= VIEWPORT_BREAKPOINTS.compactHeight,
  };
}

export function nearestBuildable(sim, c, r, radius = DEFAULT_TOUCH_SETTINGS.snapRadius) {
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

export function nearestTower(sim, c, r, radius = DEFAULT_TOUCH_SETTINGS.towerSnapRadius) {
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

// 触屏落点吸附：已命中的塔优先，其次吸附到附近可建格；边界外只认 sim.canBuild 的格子。
export function resolveTouchTile(sim, tile, settings = DEFAULT_TOUCH_SETTINGS) {
  if (!sim || !tile) return tile;
  if (sim.towerAt(tile.c, tile.r)) return tile;
  if (sim.placementType) {
    return sim.canBuild(tile.c, tile.r)
      ? tile
      : nearestBuildable(sim, tile.c, tile.r, settings.snapRadius) || tile;
  }
  const tower = nearestTower(sim, tile.c, tile.r, settings.towerSnapRadius);
  return tower ? { c: tower.c, r: tower.r } : tile;
}

// 鼠标与触控共用同一条落点解析路径：鼠标不吸附，触控才吸附。
export function resolvePointerTile(
  sim,
  tile,
  pointerType,
  settings = DEFAULT_TOUCH_SETTINGS
) {
  if (!tile) return tile;
  return pointerType === 'touch' ? resolveTouchTile(sim, tile, settings) : tile;
}

export class InputController {
  constructor({ state, ui }, touchSettings = DEFAULT_TOUCH_SETTINGS) {
    this.state = state;
    this.ui = ui;
    this.lastPointerType = 'mouse';
    this.touchSettings = touchSettings;
    this.gestureStart = null;
    this.gestureDragged = false;
  }

  bindCanvas(canvas) {
    const updateHover = (event) => {
      const sim = this.state.sim;
      if (!sim) return;
      const tile = resolvePointerTile(
        sim,
        this.state.app.renderer.screenToTile(event),
        event.pointerType || this.lastPointerType,
        this.touchSettings
      );
      sim.hover = tile;
      const overTower = sim.towerAt(tile.c, tile.r);
      canvas.style.cursor = sim.placementType || overTower ? 'pointer' : 'default';
    };

    const trackGesture = (event) => {
      this.lastPointerType = event.pointerType || 'mouse';
      this.gestureStart =
        this.lastPointerType === 'touch' ? { x: event.clientX, y: event.clientY } : null;
      this.gestureDragged = false;
    };
    // 手指移动超过点击阈值后标记为拖动：抬起产生的 click 不再建造，避免滚动误触。
    const finishGesture = (event) => {
      if (this.lastPointerType !== 'touch' || !this.gestureStart) return;
      const end = { x: event.clientX, y: event.clientY };
      if (!isTapGesture(this.gestureStart, end, this.touchSettings.tapSlopPx)) {
        this.gestureDragged = true;
      }
    };

    canvas.onpointermove = (event) => {
      this.lastPointerType = event.pointerType || 'mouse';
      if (event.pointerType === 'touch') {
        finishGesture(event);
        return;
      }
      this.gestureStart = null;
      updateHover(event);
    };
    // 触屏没有 hover：按下时先给出射程/合法性预览，抬起后的 click 完成建造。
    canvas.onpointerdown = (event) => {
      trackGesture(event);
      if (event.pointerType === 'touch') updateHover(event);
    };
    canvas.onpointerup = (event) => finishGesture(event);
    canvas.onpointercancel = () => {
      this.gestureStart = null;
      this.gestureDragged = false;
    };
    canvas.onpointerleave = () => {
      if (this.state.sim) this.state.sim.hover = null;
      canvas.style.cursor = 'default';
    };
    canvas.onclick = (event) => this.handleCanvasClick(event);
    canvas.oncontextmenu = (event) => {
      event.preventDefault();
      this.cancelSelection();
    };
  }

  handleCanvasClick(event) {
    const sim = this.state.sim;
    if (!sim || sim.phase === 'over' || this.ui.hasModal()) return;
    // 本次触屏手势是拖动/滚动：吞掉 click，既不建造也不改选中。
    if (this.lastPointerType === 'touch' && this.gestureDragged) {
      this.gestureDragged = false;
      return;
    }
    const tile = resolvePointerTile(
      sim,
      this.state.app.renderer.screenToTile(event),
      this.lastPointerType,
      this.touchSettings
    );
    const tower = sim.towerAt(tile.c, tile.r);

    if (sim.placementType && !tower) {
      if (sim.placeTower(sim.placementType, tile.c, tile.r)) {
        if (sim.gold < sim.towerCost(sim.placementType)) sim.placementType = null;
        this.ui.updateShopState();
        this.state.app.emitHud(true);
      }
      return;
    }

    this.selectTower(tower === sim.selectedTower ? null : tower);
  }

  selectShop(type) {
    const sim = this.state.sim;
    if (!sim || sim.phase === 'over') return;
    if (!sim.unlockedTowers.includes(type)) return this.ui.toast('该防御塔尚未解锁');
    sim.placementType = sim.placementType === type ? null : type;
    sim.selectedTower = null;
    this.ui.hideTowerPanel();
    this.ui.updateShopState();
  }

  selectTower(tower) {
    const sim = this.state.sim;
    if (!sim) return;
    sim.selectedTower = tower || null;
    if (tower) {
      sim.placementType = null;
      this.ui.showTowerPanel(tower);
    } else {
      this.ui.hideTowerPanel();
    }
    this.ui.updateShopState();
  }

  cancelSelection() {
    const sim = this.state.sim;
    if (!sim) return;
    sim.placementType = null;
    sim.selectedTower = null;
    this.ui.hideTowerPanel();
    this.ui.updateShopState();
  }

  upgradeTower(tower) {
    const sim = this.state.sim;
    if (!sim) return;
    if (sim.upgradeTower(tower)) {
      this.ui.showTowerPanel(tower);
      this.state.app.emitHud(true);
    }
  }

  sellTower(tower) {
    const sim = this.state.sim;
    if (!sim) return;
    sim.sellTower(tower);
    this.ui.hideTowerPanel();
    this.ui.updateShopState();
    this.state.app.emitHud(true);
  }

  handleKeydown(event) {
    const tag = event.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (this.ui.hasModal()) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.ui.closeModalIfClosable();
      }
      return;
    }

    const sim = this.state.sim;
    if (!sim) return;

    if (event.key === 'Escape') {
      this.cancelSelection();
      return;
    }
    if (event.code === 'Space') {
      event.preventDefault();
      this.state.app?.setSpeed(0);
      return;
    }
    const index = Number(event.key);
    if (index >= 1 && index <= 5) {
      this.selectShop(TOWER_ORDER[index - 1]);
      return;
    }
    if (event.key === 'q' || event.key === 'Q') {
      event.preventDefault();
      this.castSkill();
      return;
    }
    if (event.key === 'u' || event.key === 'U') {
      if (sim.selectedTower) this.upgradeTower(sim.selectedTower);
      return;
    }
    if (event.key === 's' || event.key === 'S') {
      if (sim.selectedTower) this.sellTower(sim.selectedTower);
    }
  }

  // 主动技能：只在战斗中、无弹窗、未暂停且冷却就绪时释放。
  // sim.castSkill 的冷却递减由模拟负责；这里只做入口校验与反馈。
  castSkill() {
    const sim = this.state.sim;
    if (!sim) return false;
    if (this.ui.hasModal()) return false;
    if (!sim.skill || typeof sim.castSkill !== 'function') {
      this.ui.toast('本局未携带主动技能');
      return false;
    }
    if (sim.phase !== 'wave') {
      this.ui.toast('战斗中可用');
      return false;
    }
    if (sim.paused || this.state.app?.paused) {
      this.ui.toast('暂停中无法释放技能');
      return false;
    }
    const cooldown = Number(sim.skill.cooldown ?? sim.skill.cd ?? 0);
    if (cooldown > 0) {
      this.ui.toast(`技能冷却中 · ${Math.ceil(cooldown)} 秒`, 1400);
      return false;
    }
    const ok = !!sim.castSkill();
    if (ok) this.state.app?.emitHud(true);
    else this.ui.toast('技能当前不可用');
    return ok;
  }

  nearestBuildable(sim, c, r, radius = this.touchSettings.snapRadius) {
    return nearestBuildable(sim, c, r, radius);
  }

  nearestTower(sim, c, r, radius = this.touchSettings.towerSnapRadius) {
    return nearestTower(sim, c, r, radius);
  }

  resolveTouchTile(sim, tile) {
    return resolveTouchTile(sim, tile, this.touchSettings);
  }
}
