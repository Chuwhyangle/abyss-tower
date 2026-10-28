// MAP-005 可破坏物 UI 层：命中检测、面板文案模型、视觉状态映射、低配渲染与快照恢复。
// 只测纯逻辑与可注入的渲染器；Canvas 用 Proxy 记录调用，不依赖真实 DOM。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Simulation } from '../public/js/sim.js';
import { DESTRUCTIBLE_BY_ID, DESTRUCTIBLE_TYPES } from '../public/js/shared/destructibles.js';
import { FIXED_MAPS, FIXED_MAP_BY_ID } from '../public/js/shared/maps/index.js';
import { QUALITY_PRESETS } from '../public/js/settings.js';
import { t, setLocale } from '../public/js/i18n.js';
import zhCN from '../public/js/shared/i18n/zh-CN.js';
import enUS from '../public/js/shared/i18n/en-US.js';
import {
  DEFAULT_TOUCH_SETTINGS,
  InputController,
  nearestDestructible,
  resolveDestructible,
} from '../public/js/app/input.js';
import {
  DESTRUCTIBLE_PROFILES,
  DestructibleRenderer,
  destructibleCostSpec,
  destructibleEffectSpec,
  destructibleFailureKey,
  destructibleProfile,
  destructibleShape,
  destructibleVisual,
  destructibleVisuals,
  destructibleWarningKey,
} from '../public/js/render/destructible-renderer.js';
import { modalMethods } from '../public/js/ui/modals.js';

const read = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const RENDER_SRC = read('public/js/render.js');
const MODAL_SRC = read('public/js/ui/modals.js');

function makeSim(overrides = {}) {
  return new Simulation({
    map: FIXED_MAP_BY_ID.canyon,
    seed: 'destructible-ui-seed',
    difficulty: 'standard',
    gold: 500,
    baseHp: 18,
    maxBaseHp: 20,
    relics: [],
    towers: [],
    ...overrides,
  });
}

// 命中检测用的最小 sim：只实现 destructibleAt / destructibles。
function hitSim(items) {
  return {
    destructibles: items,
    destructibleAt(c, r) {
      return this.destructibles.find((item) => !item.destroyed && item.c === c && item.r === r) || null;
    },
  };
}

// 记录调用的假 Canvas 2D 上下文：未显式实现的成员一律 no-op。
function makeCtx() {
  const calls = { fill: 0, stroke: 0, gradients: 0 };
  const gradient = { addColorStop() {} };
  const target = {};
  const proxy = new Proxy(target, {
    get(obj, prop) {
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        return () => {
          calls.gradients += 1;
          return gradient;
        };
      }
      if (prop === 'fill') return () => { calls.fill += 1; };
      if (prop === 'stroke') return () => { calls.stroke += 1; };
      if (prop in obj) return obj[prop];
      return () => {};
    },
    set(obj, prop, value) {
      obj[prop] = value;
      return true;
    },
  });
  return { ctx: proxy, calls };
}

// ---------- 命中检测 ----------

test('命中检测：鼠标精确点格，触屏吸附到最近的存活物件', () => {
  const sim = hitSim([
    { id: 'a', type: 'vein', c: 2, r: 2, destroyed: false },
    { id: 'b', type: 'obelisk', c: 6, r: 4, destroyed: false },
    { id: 'c', type: 'cache', c: 9, r: 9, destroyed: true },
  ]);

  assert.equal(resolveDestructible(sim, { c: 2, r: 2 }, 'mouse')?.id, 'a');
  assert.equal(resolveDestructible(sim, { c: 3, r: 2 }, 'mouse'), null, '鼠标不吸附');
  // 触屏：半径 1.2 内吸附；已拆除的不响应。
  assert.equal(resolveDestructible(sim, { c: 3, r: 2 }, 'touch')?.id, 'a');
  assert.equal(resolveDestructible(sim, { c: 4, r: 4 }, 'touch'), null);
  assert.equal(resolveDestructible(sim, { c: 9, r: 9 }, 'mouse'), null, '已拆除不可再点');
  assert.equal(resolveDestructible(sim, { c: 9, r: 9 }, 'touch')?.id ?? null, null);
  assert.equal(nearestDestructible(sim, 6, 5, 1.2)?.id, 'b');
  assert.equal(nearestDestructible(sim, 6, 5, 0), null, '半径 0 不吸附');
});

test('命中检测容错：缺 destructibleAt / 空布点的新旧模拟实现都不抛错', () => {
  assert.equal(resolveDestructible({}, { c: 0, r: 0 }, 'mouse'), null);
  assert.equal(resolveDestructible(null, { c: 0, r: 0 }, 'touch'), null);
  assert.equal(resolveDestructible(hitSim([]), { c: 0, r: 0 }, 'touch'), null);
  assert.equal(DEFAULT_TOUCH_SETTINGS.destructibleSnapRadius, 1.2);
});

// ---------- 面板文案 ----------

test('面板文案模型：五种类型的费用/效果/警告都能解析成双语文案', () => {
  const expectedEffects = {
    vein: { key: 'destructible.effect.gold', params: { gold: 110 } },
    obelisk: { key: 'destructible.effect.damage', params: { pct: 5, max: 3 } },
    cache: { key: 'destructible.effect.goldHp', params: { gold: 25, hp: 1 } },
    nest: { key: 'destructible.effect.spawn', params: { count: 6 } },
    totem: { key: 'destructible.effect.aura', params: { speed: 8, hp: 10 } },
  };

  for (const type of DESTRUCTIBLE_TYPES) {
    const effect = destructibleEffectSpec(type);
    assert.deepEqual(effect, expectedEffects[type.id], `${type.id} 效果文案模型`);

    const cost = destructibleCostSpec(type);
    assert.equal(cost.free, type.cost === 0, `${type.id} 免费标记`);
    if (!cost.free) assert.deepEqual(cost.params, { n: type.cost });

    const warning = destructibleWarningKey(type);
    assert.equal(warning, type.id === 'nest' || type.id === 'totem' ? `destructible.warn.${type.id}` : null);

    for (const locale of ['zh-CN', 'en-US']) {
      const dict = locale === 'zh-CN' ? zhCN : enUS;
      for (const key of ['name', 'desc']) {
        assert.ok(dict[`data.destructible.${type.id}.${key}`], `${locale} 缺少 ${type.id}.${key}`);
      }
      for (const spec of [effect, cost]) {
        assert.equal(typeof dict[spec.key], 'string', `${locale} 缺少 ${spec.key}`);
      }
      if (warning) assert.equal(typeof dict[warning], 'string', `${locale} 缺少 ${warning}`);
    }
  }

  // 文案真的能渲染（不会回退成裸 key），中英文不同。
  setLocale('zh-CN', { silent: true });
  assert.equal(t('destructible.effect.gold', { gold: 110 }), '获得 110 金');
  setLocale('en-US', { silent: true });
  assert.equal(t('destructible.effect.gold', { gold: 110 }), 'Gain 110 gold');
  setLocale('zh-CN', { silent: true });

  // 注册表中文描述与中文文案一致，英文描述独立维护。
  for (const type of DESTRUCTIBLE_TYPES) {
    assert.equal(zhCN[`data.destructible.${type.id}.desc`], type.desc);
    assert.notEqual(enUS[`data.destructible.${type.id}.desc`], type.desc);
  }
});

test('失败原因映射到双语 toast，未知原因回退通用失败文案', () => {
  assert.equal(destructibleFailureKey('gold-insufficient'), 'destructible.toast.noGold');
  assert.equal(destructibleFailureKey('already-destroyed'), 'destructible.toast.already');
  assert.equal(destructibleFailureKey('not-found'), 'destructible.toast.notFound');
  assert.equal(destructibleFailureKey('something-else'), 'destructible.toast.failed');
  for (const key of [
    'destructible.toast.done',
    'destructible.toast.noGold',
    'destructible.toast.already',
    'destructible.toast.notFound',
    'destructible.toast.failed',
    'destructible.confirm',
    'destructible.cancel',
  ]) {
    assert.equal(typeof zhCN[key], 'string', `zh-CN 缺少 ${key}`);
    assert.equal(typeof enUS[key], 'string', `en-US 缺少 ${key}`);
  }
});

// ---------- 状态映射与渲染 ----------

test('状态映射：五种类型五种几何图标，已拆除的映射为废墟', () => {
  const shapes = DESTRUCTIBLE_TYPES.map((type) => destructibleShape(type.id));
  assert.deepEqual(shapes, ['diamond', 'monolith', 'crate', 'nest', 'ring']);
  assert.equal(new Set(shapes).size, shapes.length, '每种类型图形必须不同');
  assert.equal(destructibleShape('unknown'), 'block', '未知类型回退方块');

  const alive = destructibleVisual({ id: 'v', type: 'vein', c: 1, r: 2, destroyed: false });
  assert.equal(alive.state, 'alive');
  assert.equal(alive.shape, 'diamond');
  assert.equal(alive.color, DESTRUCTIBLE_BY_ID.vein.color);
  assert.equal(alive.alpha, 1);

  const ruined = destructibleVisual({ id: 'v', type: 'vein', c: 1, r: 2, destroyed: true });
  assert.equal(ruined.state, 'ruined');
  assert.ok(ruined.alpha < 1);

  assert.equal(destructibleVisual({ id: 'x', type: 'unknown', c: 0, r: 0 }), null);
  assert.equal(destructibleVisual(null), null);
  assert.equal(destructibleVisual({ id: 'x', type: 'vein', c: 'a', r: 0 }), null);
});

test('画质档位：低配关闭光晕/脉冲，高配启用', () => {
  assert.equal(destructibleProfile(QUALITY_PRESETS.low).tier, 'low');
  assert.equal(destructibleProfile(QUALITY_PRESETS.high).tier, 'high');
  assert.equal(destructibleProfile({}).tier, 'low');
  assert.equal(destructibleProfile(null).tier, 'low');
  assert.equal(destructibleProfile({ glow: true, decorations: 'light' }).tier, 'low', '只有满装饰才走高配');
  assert.equal(DESTRUCTIBLE_PROFILES.low.pulse, 0);
  assert.ok(DESTRUCTIBLE_PROFILES.high.pulse > 0);
});

test('三张地图的物件数量/坐标与数据一致，低配与高配渲染都不报错', () => {
  for (const map of FIXED_MAPS) {
    const sim = makeSim({ map });
    const game = { destructibles: sim.destructibles, hover: null, settings: QUALITY_PRESETS.low };
    const renderer = new DestructibleRenderer(game);
    const visuals = renderer.visuals();
    assert.equal(visuals.length, map.destructibles.length, `${map.id} 绘制数量`);
    for (const placed of map.destructibles) {
      const visual = visuals.find((entry) => entry.id === placed.id);
      assert.ok(visual, `${map.id} 缺少 ${placed.id}`);
      assert.equal(visual.c, placed.c);
      assert.equal(visual.r, placed.r);
      assert.equal(visual.type, placed.type);
    }

    const low = makeCtx();
    assert.equal(renderer.render(low.ctx, 1.25, QUALITY_PRESETS.low), visuals.length);
    assert.equal(low.calls.gradients, 0, `${map.id} 低配不创建光晕渐变`);
    assert.ok(low.calls.fill > 0 && low.calls.stroke > 0, `${map.id} 低配仍有几何图形`);

    const high = makeCtx();
    assert.equal(renderer.render(high.ctx, 1.25, QUALITY_PRESETS.high), visuals.length);
    assert.ok(high.calls.gradients > 0, `${map.id} 高配绘制光晕`);
  }

  // 五张固定布点覆盖五种类型。
  const types = new Set(FIXED_MAPS.flatMap((map) => map.destructibles.map((item) => item.type)));
  for (const type of DESTRUCTIBLE_TYPES) assert.ok(types.has(type.id), `地图缺少 ${type.id}`);
});

test('点击物件打开确认面板；点空白处正常取消；已拆除的不再打开', () => {
  const sim = {
    phase: 'prep',
    placementType: 'arrow',
    selectedTower: null,
    towers: [],
    destructibles: [{ id: 'canyon-vein-1', type: 'vein', c: 2, r: 2, destroyed: false }],
    towerAt() {
      return null;
    },
    destructibleAt(c, r) {
      return this.destructibles.find((item) => !item.destroyed && item.c === c && item.r === r) || null;
    },
  };
  const events = { opened: [], hide: 0, shop: 0, hud: 0 };
  const ui = {
    hasModal: () => false,
    updateShopState() {
      events.shop += 1;
    },
    hideTowerPanel() {
      events.hide += 1;
    },
    showTowerPanel() {},
    toast() {},
    showDestructibleConfirm(args) {
      events.opened.push(args);
      return { opened: true };
    },
  };
  let tile = { c: 2, r: 2 };
  const controller = new InputController({
    state: {
      sim,
      app: {
        renderer: { screenToTile: () => tile },
        emitHud() {
          events.hud += 1;
        },
      },
    },
    ui,
  });
  controller.lastPointerType = 'mouse';

  controller.handleCanvasClick({});
  assert.equal(events.opened.length, 1);
  assert.equal(events.opened[0].item.id, 'canyon-vein-1');
  assert.equal(events.opened[0].sim, sim);
  assert.equal(sim.placementType, null, '打开面板前清掉建造选择');
  assert.equal(typeof events.opened[0].onResolved, 'function');
  const shopBefore = events.shop;
  events.opened[0].onResolved({ ok: true });
  assert.ok(events.shop > shopBefore, '结算回调整理商店状态');
  assert.ok(events.hud >= 1, '结算后刷新 HUD');

  // 点空白处：不打开面板，走原有取消选择路径。
  tile = { c: 8, r: 8 };
  controller.handleCanvasClick({});
  assert.equal(events.opened.length, 1);
  assert.ok(events.hide >= 1);
});

test('确认面板 → destroyDestructible：成功扣费/加金/变废墟/格子可建，失败提示原因', () => {
  setLocale('zh-CN', { silent: true });
  const buttons = new Map();
  const toasts = [];
  const self = {
    openModal: () => ({
      querySelector: (selector) => {
        if (!buttons.has(selector)) buttons.set(selector, {});
        return buttons.get(selector);
      },
    }),
    closeModal() {},
    toast: (message) => toasts.push(message),
  };

  const sim = makeSim({ gold: 100 });
  const vein = sim.destructibles.find((item) => item.type === 'vein');
  assert.equal(vein.cost, 50);
  modalMethods.showDestructibleConfirm.call(self, { sim, item: vein });
  buttons.get('#btn-destructible-yes').onclick();
  assert.equal(vein.destroyed, true);
  assert.equal(sim.gold, 160, '扣 50 金后获得 110 金');
  assert.equal(toasts.at(-1), '已拆除金脉');
  assert.equal(sim.canBuild(vein.c, vein.r), true, '拆除后同格可建造');
  assert.equal(destructibleVisual(vein).state, 'ruined');

  const poor = makeSim({ gold: 10 });
  const poorVein = poor.destructibles.find((item) => item.type === 'vein');
  modalMethods.showDestructibleConfirm.call(self, { sim: poor, item: poorVein });
  buttons.get('#btn-destructible-yes').onclick();
  assert.equal(poorVein.destroyed, false, '金币不足不扣费也不标记');
  assert.equal(poor.gold, 10);
  assert.equal(toasts.at(-1), '金币不足，无法拆除');
});

test('渲染层与 UI 层已接入：注册渲染器、确认面板调用 destroyDestructible 并播放拆除音效', () => {
  assert.match(RENDER_SRC, /import \{ DestructibleRenderer \} from '\.\/render\/destructible-renderer\.js'/);
  assert.match(RENDER_SRC, /new DestructibleRenderer\(game\)/);
  assert.match(RENDER_SRC, /this\.destructibleRenderer\.render\(g, this\.time, this\.settings\)/);
  assert.equal(typeof modalMethods.showDestructibleConfirm, 'function');
  assert.match(MODAL_SRC, /sim\.destroyDestructible\?\.\(item\.id\)/);
  assert.match(MODAL_SRC, /audio\.play\('destructible'\)/);
  assert.match(MODAL_SRC, /t\('destructible\.toast\.done', \{ name \}\)/);
  assert.match(read('public/js/audio-synth.js'), /case 'destructible':/);
});

// ---------- 刷新恢复 ----------

test('刷新后已拆除物件不复活，腾出的格子可建造', () => {
  const sim = makeSim({ gold: 500 });
  const item = sim.destructibles.find((entry) => entry.type === 'cache');
  assert.ok(item);
  assert.equal(sim.destroyDestructible(item.id).ok, true);
  assert.equal(sim.canBuild(item.c, item.r), true, '拆除后同格可建造');

  const snapshot = JSON.parse(JSON.stringify(sim.toSnapshot()));
  const restored = makeSim({
    gold: snapshot.gold,
    baseHp: snapshot.baseHp,
    maxBaseHp: snapshot.maxBaseHp,
    destructibleState: snapshot.destructibles,
  });
  assert.equal(restored.canBuild(item.c, item.r), true, '恢复后同格仍可建造');
  const visuals = destructibleVisuals(restored.destructibles);
  assert.equal(visuals.find((entry) => entry.id === item.id)?.state, 'ruined', '恢复后画废墟');
  const others = visuals.filter((entry) => entry.id !== item.id);
  assert.ok(others.every((entry) => entry.state === 'alive'), '其余物件保持存活');
});
