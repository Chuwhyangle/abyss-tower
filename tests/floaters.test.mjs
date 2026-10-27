// 飘字分层与三档可见性（AC-016）：层模型、三档语义、合并规则、帧预算与绘制顺序。
// 纯函数由 public/js/shared/floaters.js 提供；接线由 Simulation / FloaterRenderer 实测。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CLUSTER_RADIUS,
  FLOATER_BUDGET,
  FLOATER_LAYERS,
  MERGE_RADIUS,
  MERGE_WINDOW,
  STACK_STEP,
  createFloater,
  floaterBudget,
  floaterLayer,
  floaterVisible,
  mergeFloaterText,
  planFloaterFrame,
  pushFloater,
} from '../public/js/shared/floaters.js';
import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

// 层序冻结表见 docs/PHASE_FEEL_ART.md §3.2：六层基础层 + AC-030 的三个类别层。
const LAYERS = ['damage', 'crit', 'reward', 'heal', 'penalty', 'status', 'armor', 'bossHit', 'shield'];

function makeSim(overrides = {}) {
  return new Simulation({
    map: generateMap('floaters-test-seed'),
    seed: 'floaters-test-seed',
    difficulty: 'standard',
    gold: 100000,
    baseHp: 20,
    maxBaseHp: 20,
    towers: [],
    unlockedTowers: ['arrow', 'cannon', 'frost'],
    onToast: () => {},
    ...overrides,
  });
}

function damageFloater(x, y, text = '35', extra = {}) {
  return createFloater({ x, y, text, color: '#eef3f8', ...extra });
}

// ---------- 层模型 ----------

test('FLOATER_LAYERS 恰含九层，字段齐备且 z 两两不同', () => {
  assert.deepEqual(Object.keys(FLOATER_LAYERS).sort(), [...LAYERS].sort());
  const zs = [];
  for (const name of LAYERS) {
    const layer = FLOATER_LAYERS[name];
    assert.ok(layer, `缺少层 ${name}`);
    assert.ok(layer.size > 0, `${name}.size 必须为正`);
    assert.ok(Number.isFinite(layer.weight), `${name}.weight 必须是有限数`);
    assert.equal(typeof layer.color, 'string');
    assert.ok(layer.color.startsWith('#'), `${name}.color 应为十六进制色`);
    zs.push(layer.z);
  }
  assert.equal(new Set(zs).size, zs.length, 'z 必须两两不同');
  // z 序：伤害最低、暴击最高。
  assert.equal(Math.min(...zs), FLOATER_LAYERS.damage.z);
  assert.equal(Math.max(...zs), FLOATER_LAYERS.crit.z);
});

test('floaterLayer 按六类真实调用签名判层', () => {
  // 六个签名原样取自 sim/combat-system、relic-system、enemy-system 的调用点。
  assert.equal(floaterLayer({ text: '120!', color: '#ffd36b', big: true }), 'crit');
  assert.equal(floaterLayer({ text: '35', color: '#eef3f8' }), 'damage');
  assert.equal(floaterLayer({ text: '+30', color: '#ffd36b', big: true }), 'reward');
  assert.equal(floaterLayer({ text: '+12', color: '#7ef0a5', big: true }), 'heal');
  assert.equal(floaterLayer({ text: '-8', color: '#ff6b6b', big: true, key: true }), 'penalty');
  assert.equal(floaterLayer({ text: '狂怒', color: '#ff6b6b', big: true, key: true }), 'status');
});

test('显式 layer 覆盖推导，类别层与未知 layer 分别按九层模型处理', () => {
  assert.equal(floaterLayer({ text: '35', layer: 'status' }), 'status');
  assert.equal(floaterLayer({ text: '狂怒', layer: 'heal' }), 'heal');
  // AC-030 追加的类别层是合法显式层；未知层仍回退 damage。
  assert.equal(floaterLayer({ text: '35', layer: 'armor' }), 'armor');
  assert.equal(floaterLayer({ text: '破盾 -12', layer: 'shield' }), 'shield');
  assert.equal(floaterLayer({ text: '-80', layer: 'bossHit' }), 'bossHit');
  assert.equal(floaterLayer({ text: '35', layer: 'unknown-layer' }), 'damage');
  assert.equal(floaterLayer({ text: '35', layer: '' }), 'damage');
  // 缺字段不抛错。
  assert.equal(floaterLayer({}), 'damage');
  assert.equal(floaterLayer({ text: '' }), 'damage');
});

test('createFloater 产出规范对象：层/关键标记/ttl 与旧行为一致', () => {
  const normal = createFloater({ x: 1, y: 2, text: '35', color: '#eef3f8' });
  assert.equal(normal.layer, 'damage');
  assert.equal(normal.big, false);
  assert.equal(normal.key, false);
  assert.equal(normal.ttl, 0.65);
  assert.equal(normal.maxTtl, 0.65);
  const big = createFloater({ x: 1, y: 2, text: '120!', color: '#ffd36b', big: true, key: true });
  assert.equal(big.layer, 'crit');
  assert.equal(big.ttl, 0.9);
  assert.equal(big.maxTtl, 0.9);
});

// ---------- 三档语义 ----------

test('floaterVisible：off 恒 false，key 只放行 key || big，all 恒 true', () => {
  for (const meta of [{}, { key: false, big: false }, { key: true }, { big: true }]) {
    assert.equal(floaterVisible('off', meta), false);
    assert.equal(floaterVisible('all', meta), true);
  }
  assert.equal(floaterVisible('key', { key: false, big: false }), false);
  assert.equal(floaterVisible('key', { key: true }), true);
  assert.equal(floaterVisible('key', { big: true }), true);
  // 未知档位按 all：不隐藏。
  assert.equal(floaterVisible('weird', { key: false, big: false }), true);
  assert.equal(floaterVisible(undefined, {}), true);
});

test('floaterBudget：0 / 12 / 28，未知档位取 all', () => {
  assert.equal(floaterBudget('off'), 0);
  assert.equal(floaterBudget('key'), 12);
  assert.equal(floaterBudget('all'), 28);
  assert.equal(floaterBudget('weird'), 28);
  assert.equal(FLOATER_BUDGET.all, 28);
});

test('Simulation 实测三档：key 档不含普通伤害、all 档含、off 档为 0 条', () => {
  const sim = makeSim();

  sim.setVisualQuality({ floaters: 'all' });
  sim.floaters = [];
  sim.addFloater(1, 1, '35', '#eef3f8', false);
  sim.addFloater(3, 1, '120!', '#ffd36b', true, { key: true });
  assert.equal(sim.floaters.length, 2, 'all 档应保留普通伤害与暴击');
  assert.deepEqual(sim.floaters.map((f) => f.layer), ['damage', 'crit']);

  sim.setVisualQuality({ floaters: 'key' });
  sim.floaters = [];
  sim.addFloater(1, 1, '35', '#eef3f8', false);
  assert.equal(sim.floaters.length, 0, 'key 档不生成普通伤害');
  sim.addFloater(3, 1, '120!', '#ffd36b', true, { key: true });
  sim.addFloater(5, 1, '狂怒', '#ff6b6b', true, { key: true });
  assert.equal(sim.floaters.length, 2, 'key 档保留暴击与首领状态');
  assert.deepEqual(sim.floaters.map((f) => f.layer), ['crit', 'status']);

  sim.setVisualQuality({ floaters: 'off' });
  sim.floaters = [];
  sim.addFloater(1, 1, '35', '#eef3f8', false);
  sim.addFloater(3, 1, '120!', '#ffd36b', true, { key: true });
  assert.equal(sim.floaters.length, 0, 'off 档在生成侧清空');
});

// ---------- 合并规则 ----------

test('mergeFloaterText：同符号累加、保留 ! 与非数字回退', () => {
  assert.equal(mergeFloaterText('35', '9'), '44');
  assert.equal(mergeFloaterText('12!', '8'), '20!');
  assert.equal(mergeFloaterText('+10', '+5'), '+15');
  assert.equal(mergeFloaterText('-6', '-4'), '-10');
  assert.equal(mergeFloaterText('狂怒', '狂怒'), null);
  assert.equal(mergeFloaterText('35', '塔被摧毁'), null);
  assert.equal(mergeFloaterText(undefined, '35'), null);
});

test('pushFloater：同层同窗口合并，跨层/超窗不合并，重复非数字丢弃', () => {
  const list = [];
  assert.ok(MERGE_RADIUS > 0 && MERGE_WINDOW > 0);

  // 同层 + 半径内 + 窗口内 → 累加。
  const first = pushFloater(list, damageFloater(1, 1, '35'), 0);
  assert.ok(first);
  const merged = pushFloater(list, damageFloater(1.1, 1.1, '9'), 0.05);
  assert.equal(list.length, 1, '窗口内近邻应合并而不是新增');
  assert.equal(merged.text, '44');

  // 超出窗口 → 入列新项。
  pushFloater(list, damageFloater(1.1, 1.1, '7'), MERGE_WINDOW + 0.2);
  assert.equal(list.length, 2, '超窗口不合并');

  // 跨层 → 即使位置重合也不合并。
  const before = list.length;
  pushFloater(list, createFloater({ x: 1, y: 1, text: '+5', color: '#ffd36b', big: true }), 0.05);
  assert.equal(list.length, before + 1, '跨层不合并');

  // 重复非数字文案在同层同窗口内被丢弃。
  const statusList = [];
  pushFloater(statusList, createFloater({ x: 2, y: 2, text: '狂怒', color: '#ff6b6b', big: true, key: true }), 0);
  const dropped = pushFloater(
    statusList,
    createFloater({ x: 2, y: 2, text: '狂怒', color: '#ff6b6b', big: true, key: true }),
    0.03
  );
  assert.equal(dropped, null);
  assert.equal(statusList.length, 1);
});

// ---------- 不刷屏 ----------

test('36 敌混战近邻 60 条数字：draw 不超预算且吞掉数 = visible - draw', () => {
  const floaters = [];
  for (let i = 0; i < 60; i += 1) {
    floaters.push(damageFloater(2 + (i % 6) * 0.05, 3 + (i % 5) * 0.05, String(12 + i)));
  }
  const { draw, suppressed, visible } = planFloaterFrame(floaters, {
    mode: 'all',
    budget: floaterBudget('all'),
  });
  assert.equal(visible, 60);
  assert.ok(draw.length <= floaterBudget('all'), `draw=${draw.length} 超过预算`);
  assert.equal(suppressed, visible - draw.length);
});

test('20 个互不相邻位置：低于预算不吞信息', () => {
  const floaters = [];
  for (let i = 0; i < 20; i += 1) floaters.push(damageFloater(i * 2, 5, String(20 + i)));
  const { draw, suppressed, visible } = planFloaterFrame(floaters, { mode: 'all', budget: 28 });
  assert.equal(visible, 20);
  assert.equal(draw.length, 20);
  assert.equal(suppressed, 0);
  // 相邻间距 2 格远超聚类半径，确认没有误合并。
  assert.ok(CLUSTER_RADIUS < 2);
});

test('预算不足时先丢 damage，crit/penalty/status 全部保留', () => {
  const floaters = [];
  for (let i = 0; i < 20; i += 1) floaters.push(damageFloater(i * 2, 5, String(20 + i)));
  floaters.push(createFloater({ x: 0.5, y: 10, text: '120!', color: '#ffd36b', big: true, key: true }));
  floaters.push(createFloater({ x: 4.5, y: 10, text: '-8', color: '#ff6b6b', big: true, key: true }));
  floaters.push(createFloater({ x: 8.5, y: 10, text: '狂怒', color: '#ff6b6b', big: true, key: true }));

  const { draw } = planFloaterFrame(floaters, { mode: 'all', budget: 12 });
  assert.equal(draw.length, 12);
  const layers = draw.map((item) => item.layer);
  for (const layer of ['crit', 'penalty', 'status']) {
    assert.ok(layers.includes(layer), `预算不足时 ${layer} 不应被裁掉`);
  }
  assert.equal(layers.filter((layer) => layer === 'damage').length, 9);
});

// ---------- 绘制顺序 ----------

test('draw 按 z 非降排列，同层近邻 stack 两两不同', () => {
  const floaters = [
    damageFloater(1, 1, '12'),
    damageFloater(1.25, 1, '9'),
    createFloater({ x: 1, y: 1, text: '120!', color: '#ffd36b', big: true, key: true }),
    createFloater({ x: 5, y: 5, text: '+5', color: '#ffd36b', big: true }),
  ];
  const { draw } = planFloaterFrame(floaters, { mode: 'all', budget: floaterBudget('all') });
  assert.equal(draw.length, 4, '0.25 格 > CLUSTER_RADIUS，两条伤害都应保留');
  for (let i = 1; i < draw.length; i += 1) {
    assert.ok(draw[i].z >= draw[i - 1].z, 'draw 必须按 z 非降');
  }
  const damageStacks = draw.filter((item) => item.layer === 'damage').map((item) => item.stack);
  assert.equal(damageStacks.length, 2);
  assert.notEqual(damageStacks[0], damageStacks[1], '同层近邻 stack 必须错开');
  assert.ok(STACK_STEP > 0);
});

test('planFloaterFrame 不修改输入数组与其中对象', () => {
  const floaters = [
    damageFloater(1, 1, '35'),
    damageFloater(1.1, 1.1, '9'),
    createFloater({ x: 3, y: 3, text: '120!', color: '#ffd36b', big: true, key: true }),
  ];
  const snapshot = JSON.parse(JSON.stringify(floaters));
  planFloaterFrame(floaters, { mode: 'all', budget: 28 });
  assert.deepEqual(JSON.parse(JSON.stringify(floaters)), snapshot);
});

// ---------- 接线与纯度 ----------

test('接线源码断言：sim 用 floaterVisible/pushFloater，渲染层用 planFloaterFrame/floaterBudget', () => {
  const sim = read('public/js/sim.js');
  const addFloater = sim.slice(sim.indexOf('addFloater('));
  assert.match(addFloater, /floaterVisible\(/, 'addFloater 必须前置 floaterVisible');
  assert.match(addFloater, /pushFloater\(/, 'addFloater 必须经 pushFloater 入列');

  const renderer = read('public/js/render/floater-renderer.js');
  assert.match(renderer, /planFloaterFrame\(/, '渲染层必须用 planFloaterFrame');
  assert.match(renderer, /floaterBudget\(/, '渲染层必须用 floaterBudget');
});

test('shared/floaters.js 无随机源、不依赖 sim/render/DOM', () => {
  const source = read('public/js/shared/floaters.js');
  assert.doesNotMatch(source, /Math\.random/);
  assert.doesNotMatch(source, /from\s+['"][^'"]*\/(?:sim|render)(?:[.\/'"])/, '不得 import 模拟或渲染层');
  assert.doesNotMatch(source, /\bdocument\.|\bwindow\.|\bglobalThis\./, '不得触碰 DOM/全局对象');
});

// ---------- 表现不改变模拟 ----------

test('同一 seed：飘字 off 与 all 两局推进 3600 步后结算状态逐字节一致', () => {
  const seed = 'floaters-determinism';
  const run = (mode) => {
    const map = generateMap(seed);
    const sim = new Simulation({
      map,
      seed,
      difficulty: 'standard',
      gold: 300,
      baseHp: 20,
      maxBaseHp: 20,
      relics: [],
      towers: [],
      unlockedTowers: ['arrow', 'cannon', 'frost'],
      onSave: () => {},
      onToast: () => {},
    });
    sim.setVisualQuality({ floaters: mode });
    const meta = sim.mapMeta || {};
    sim.beginWave(
      generateWave(seed, 1, 'standard', {
        portalCount: meta.portalCount || 1,
        modifier: meta.modifier || null,
      })
    );
    let maxFloaters = 0;
    for (let i = 0; i < 3600; i += 1) {
      sim.update(1 / 60);
      sim.updateVisuals(1 / 60);
      maxFloaters = Math.max(maxFloaters, sim.floaters.length);
    }
    return { sim, maxFloaters };
  };

  const off = run('off');
  const all = run('all');
  assert.equal(off.maxFloaters, 0, 'off 档不生成任何飘字对象');
  assert.ok(all.maxFloaters > 0, 'all 档应生成飘字（漏怪惩罚等）');
  assert.equal(all.sim.floaters.length, 0, '末帧飘字已过期清空');

  const state = (sim) =>
    JSON.stringify({
      gold: sim.gold,
      baseHp: sim.baseHp,
      kills: sim.kills,
      wave: sim.wave,
      clearedWave: sim.clearedWave,
      enemies: sim.enemies.map((enemy) => [enemy.type, enemy.x, enemy.y, enemy.hp]),
    });
  assert.equal(state(off.sim), state(all.sim), '飘字档位不得影响模拟结算');
});
