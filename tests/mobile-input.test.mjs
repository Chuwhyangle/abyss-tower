// 移动端输入：吸附、点击/拖动阈值、断点映射，以及触屏/鼠标共用的建造语义。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_TOUCH_SETTINGS,
  VIEWPORT_BREAKPOINTS,
  InputController,
  isTapGesture,
  layoutForViewport,
  nearestBuildable,
  nearestTower,
  resolvePointerTile,
  resolveTouchTile,
} from '../public/js/app/input.js';

function makeSim({ buildable = [], towers = [], placementType = 'arrow' } = {}) {
  const buildSet = new Set(buildable.map(([c, r]) => `${c},${r}`));
  return {
    phase: 'wave',
    placementType,
    towers: towers.map(([c, r]) => ({ c, r })),
    selectedTower: null,
    gold: 100,
    hover: null,
    canBuild(c, r) {
      return buildSet.has(`${c},${r}`);
    },
    towerAt(c, r) {
      return this.towers.find((tower) => tower.c === c && tower.r === r) || null;
    },
    placeTower(type, c, r) {
      this.placed = this.placed || [];
      this.placed.push({ type, c, r });
      return true;
    },
    towerCost() {
      return 10;
    },
    upgradeTower() {
      return true;
    },
    sellTower() {},
  };
}

function makeController(sim, tile) {
  const ui = {
    hasModal: () => false,
    updateShopState() {},
    hideTowerPanel() {},
    showTowerPanel() {},
    toast() {},
  };
  const game = {
    state: {
      sim,
      app: { renderer: { screenToTile: () => tile }, emitHud() {} },
    },
    ui,
  };
  return new InputController(game);
}

test('触控吸附在可建格边界上正确落点', () => {
  const sim = makeSim({ buildable: [[1, 0], [0, 1]] });
  // 不可建的中心格吸附到最近可建格（等距时按扫描顺序取先出现的）。
  assert.deepEqual(resolveTouchTile(sim, { c: 0, r: 0 }), { c: 1, r: 0 });
  // 直接命中可建格时保持原坐标。
  assert.deepEqual(resolveTouchTile(sim, { c: 0, r: 1 }), { c: 0, r: 1 });
  // 吸附半径内没有可建格：保持原始落点，不越界造塔。
  assert.deepEqual(resolveTouchTile(sim, { c: 2, r: 2 }), { c: 2, r: 2 });

  assert.deepEqual(nearestBuildable(makeSim({ buildable: [[3, 3]] }), 4, 3), { c: 3, r: 3 });
  assert.equal(nearestBuildable(makeSim({ buildable: [[3, 3]] }), 9, 9), null);
});

test('触控吸附到附近已有塔；半径可配置', () => {
  const sim = makeSim({ towers: [[4, 4]], placementType: null });
  assert.deepEqual(resolveTouchTile(sim, { c: 5, r: 4 }), { c: 4, r: 4 });
  assert.deepEqual(resolveTouchTile(sim, { c: 7, r: 4 }), { c: 7, r: 4 });
  assert.equal(nearestTower(sim, 5, 4, 1.2).c, 4);

  // 自定义设置（半径为 0）时完全不吸附。
  const noSnap = { ...DEFAULT_TOUCH_SETTINGS, snapRadius: 0, towerSnapRadius: 0 };
  assert.deepEqual(resolveTouchTile(sim, { c: 5, r: 4 }, noSnap), { c: 5, r: 4 });
  const buildSim = makeSim({ buildable: [[1, 0]] });
  assert.deepEqual(resolveTouchTile(buildSim, { c: 0, r: 0 }, noSnap), { c: 0, r: 0 });
  assert.ok(Object.isFrozen(DEFAULT_TOUCH_SETTINGS));
});

test('点击与拖动阈值判定可配置', () => {
  const start = { x: 100, y: 100 };
  assert.equal(isTapGesture(start, { x: 108, y: 107 }), true);
  assert.equal(isTapGesture(start, { x: 120, y: 100 }), false);
  assert.equal(isTapGesture(start, { x: 105, y: 100 }, 6), true);
  assert.equal(isTapGesture(start, { x: 105, y: 100 }, 4), false);
  assert.equal(isTapGesture(null, { x: 0, y: 0 }), true);
  assert.equal(DEFAULT_TOUCH_SETTINGS.tapSlopPx, 12);
});

test('横屏/竖屏断点映射与移动端样式一致', () => {
  assert.deepEqual(layoutForViewport(844, 390), { orientation: 'landscape', compact: true });
  assert.deepEqual(layoutForViewport(390, 844), { orientation: 'portrait', compact: true });
  assert.deepEqual(layoutForViewport(1280, 800), { orientation: 'landscape', compact: false });
  assert.equal(VIEWPORT_BREAKPOINTS.compactWidth, 900);
  assert.equal(VIEWPORT_BREAKPOINTS.compactHeight, 520);

  const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(max-width: 900px\), \(max-height: 520px\)/);
  assert.match(css, /@media \(orientation: landscape\) and \(max-height: 520px\)/);
  assert.match(css, /@media \(orientation: portrait\) and \(max-width: 900px\)/);

  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /viewport-fit=cover/);
});

test('iOS 安全区与 ≥44px 触控目标在样式表中生效', () => {
  const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  for (const inset of ['top', 'right', 'bottom', 'left']) {
    assert.match(css, new RegExp(`env\\(safe-area-inset-${inset}`), `缺少 safe-area-inset-${inset}`);
  }

  const touchTargets = css.match(/body\.is-touch \.btn,[\s\S]*?min-height:\s*44px;/);
  assert.ok(touchTargets, '触屏关键按钮缺少统一 44px 触控目标');
  for (const selector of ['body.is-touch .btn', 'body.is-touch .icon-btn', 'body.is-touch .speed-btn', 'body.is-touch .tower-card']) {
    assert.ok(touchTargets[0].includes(selector), `触控目标未覆盖 ${selector}`);
  }
  assert.match(css, /\.tp-actions \.btn \{\s*min-height: 44px;/);
});

test('鼠标与触控共用同一套建造语义', () => {
  const buildSim = makeSim({ buildable: [[1, 0]] });
  const exact = { c: 1, r: 0 };
  const offGrid = { c: 0, r: 0 };

  // 鼠标：精确落点。
  assert.equal(resolvePointerTile(buildSim, exact, 'mouse'), exact);
  // 触控：先吸附，再交给同一个 handleCanvasClick 建造。
  assert.deepEqual(resolvePointerTile(buildSim, offGrid, 'touch'), { c: 1, r: 0 });

  const mouseCtrl = makeController(makeSim({ buildable: [[1, 0]] }), exact);
  mouseCtrl.lastPointerType = 'mouse';
  mouseCtrl.handleCanvasClick({});
  assert.deepEqual(mouseCtrl.state.sim.placed, [{ type: 'arrow', c: 1, r: 0 }]);

  const touchCtrl = makeController(makeSim({ buildable: [[1, 0]] }), offGrid);
  touchCtrl.lastPointerType = 'touch';
  touchCtrl.handleCanvasClick({});
  assert.deepEqual(touchCtrl.state.sim.placed, [{ type: 'arrow', c: 1, r: 0 }]);

  const src = readFileSync(new URL('../public/js/app/input.js', import.meta.url), 'utf8');
  assert.equal((src.match(/placeTower\(/g) || []).length, 1, '建造入口应唯一');
  assert.match(src, /resolvePointerTile\(/);
});

test('触屏拖动/滚动不会误触建造', () => {
  const ctrl = makeController(makeSim({ buildable: [[1, 0]] }), { c: 1, r: 0 });
  ctrl.lastPointerType = 'touch';
  ctrl.gestureDragged = true;
  ctrl.handleCanvasClick({});
  assert.deepEqual(ctrl.state.sim.placed, undefined);
  assert.equal(ctrl.gestureDragged, false);

  ctrl.lastPointerType = 'touch';
  ctrl.gestureDragged = false;
  ctrl.handleCanvasClick({});
  assert.deepEqual(ctrl.state.sim.placed, [{ type: 'arrow', c: 1, r: 0 }]);
});
