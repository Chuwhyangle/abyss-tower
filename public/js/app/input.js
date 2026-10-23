// 输入层：Canvas 指针命中、建造/选择、塔面板操作与键盘快捷键。
import { TOWER_ORDER } from '../shared/data.js';

export class InputController {
  constructor(game) {
    this.game = game;
    this.lastPointerType = 'mouse';
  }

  get state() {
    return this.game.state;
  }

  get ui() {
    return this.game.ui;
  }

  bindCanvas(canvas) {
    const updateHover = (event) => {
      const sim = this.state.sim;
      if (!sim) return;
      let tile = this.state.app.renderer.screenToTile(event);
      if (event.pointerType === 'touch') tile = this.resolveTouchTile(sim, tile);
      sim.hover = tile;
      const overTower = sim.towerAt(tile.c, tile.r);
      canvas.style.cursor = sim.placementType || overTower ? 'pointer' : 'default';
    };

    canvas.onpointermove = (event) => {
      this.lastPointerType = event.pointerType || 'mouse';
      if (event.pointerType === 'touch') return;
      updateHover(event);
    };
    // 触屏没有 hover：按下时先给出射程/合法性预览，抬起后的 click 完成建造。
    canvas.onpointerdown = (event) => {
      this.lastPointerType = event.pointerType || 'mouse';
      if (event.pointerType === 'touch') updateHover(event);
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
    let tile = this.state.app.renderer.screenToTile(event);
    if (this.lastPointerType === 'touch') tile = this.resolveTouchTile(sim, tile);
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
    if (event.key === 'u' || event.key === 'U') {
      if (sim.selectedTower) this.upgradeTower(sim.selectedTower);
      return;
    }
    if (event.key === 's' || event.key === 'S') {
      if (sim.selectedTower) this.sellTower(sim.selectedTower);
    }
  }

  nearestBuildable(sim, c, r, radius = 1) {
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

  nearestTower(sim, c, r, radius = 1.2) {
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

  resolveTouchTile(sim, tile) {
    if (sim.towerAt(tile.c, tile.r)) return tile;
    if (sim.placementType) {
      return sim.canBuild(tile.c, tile.r)
        ? tile
        : this.nearestBuildable(sim, tile.c, tile.r, 1) || tile;
    }
    const tower = this.nearestTower(sim, tile.c, tile.r, 1.2);
    return tower ? { c: tower.c, r: tower.r } : tile;
  }
}
