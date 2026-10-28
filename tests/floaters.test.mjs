// 飘字分层与三档可见性（AC-016）：层模型、三档语义、合并规则、帧预算与绘制顺序。
// 混战可读性（AC-020 子项）：伤害数字区域对比度、淡出下限与描边在渲染层生效。
// 纯函数由 public/js/shared/floaters.js 提供；接线由 Simulation / FloaterRenderer 实测。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CLUSTER_RADIUS,
  FLOATER_BUDGET,
  FLOATER_CASING,
  FLOATER_FADE_FLOOR,
  FLOATER_LAYERS,
  MERGE_RADIUS,
  MERGE_WINDOW,
  STACK_STEP,
  createFloater,
  floaterAlpha,
  floaterBudget,
  floaterLayer,
  floaterVisible,
  mergeFloaterText,
  planFloaterFrame,
  pushFloater,
} from '../public/js/shared/floaters.js';
import { FloaterRenderer } from '../public/js/render/floater-renderer.js';
import { biomePalette } from '../public/js/render/palette.js';
import { contrastRatio, parseCssColor } from '../scripts/lib/visual-metrics.mjs';
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

// ---------- 混战可读性：伤害数字区域对比度（AC-020） ----------
//
// 混战帧（combat-mixed）里伤害数字压在繁忙地表上，背景色取自战斗地表调色板
// （palette.js 是地表色的唯一定义处）：草地 grass1 与路径 pathInner 两档。
const CANYON_PALETTE = biomePalette('canyon');
const MIXED_FRAME_BACKGROUNDS = Object.freeze([
  Object.freeze({ name: '草地 grass1', rgb: parseCssColor(CANYON_PALETTE.grass1).slice(0, 3) }),
  Object.freeze({ name: '路径 pathInner', rgb: parseCssColor(CANYON_PALETTE.pathInner).slice(0, 3) }),
]);

// 不透明度合成：飘字（数字核心与描边）都按同一 globalAlpha 画在背景上。
function compositeOver(color, alpha, background) {
  return color.map((channel, index) => background[index] * (1 - alpha) + channel * alpha);
}

// 伤害数字区域对比度 = 数字核心（层色）与紧邻描边（casing）的 WCAG 对比度。
// 两者都向背景塌陷时数字就「变灰」——这正是 FEEL-001 观察到的回归。
// 返回两档地表的读数、较差值（worst）与核心与背景的分离度（worstOnBackground）。
function damageRegionContrast({ alpha, fill = FLOATER_LAYERS.damage.color, casing = FLOATER_CASING.color }) {
  const [cr, cg, cb, casingAlpha = 1] = parseCssColor(casing);
  const fillRgb = parseCssColor(fill).slice(0, 3);
  const samples = MIXED_FRAME_BACKGROUNDS.map(({ name, rgb }) => {
    const core = compositeOver(fillRgb, alpha, rgb);
    const edge = compositeOver([cr, cg, cb], alpha * casingAlpha, rgb);
    return { name, ratio: contrastRatio(core, edge), onBackground: contrastRatio(core, rgb) };
  });
  const worst = samples.reduce((min, sample) => Math.min(min, sample.ratio), Infinity);
  const worstOnBackground = samples.reduce((min, sample) => Math.min(min, sample.onBackground), Infinity);
  return { alpha, samples, worst, worstOnBackground };
}

// 基线（修复前）：#eef3f8 填充 + rgba(0,0,0,0.75) 描边 + 无淡出下限，
// 数字寿命尾段（不透明度 0.25）在混战地表上的最差对比度。2026-10-28 在 develop 上实测 2.30。
const PRE_FIX_STYLE = Object.freeze({ fill: '#eef3f8', casing: 'rgba(0, 0, 0, 0.75)' });
const BASELINE_REGION_CONTRAST = damageRegionContrast({ alpha: 0.25, ...PRE_FIX_STYLE }).worst;
const RECORDED_BASELINE = 2.3;

function stubCanvas() {
  const calls = [];
  return {
    calls,
    ctx: {
      textAlign: '',
      textBaseline: '',
      globalAlpha: 1,
      font: '',
      lineWidth: 0,
      strokeStyle: '',
      fillStyle: '',
      strokeText(text, x, y) {
        calls.push({ kind: 'stroke', text, alpha: this.globalAlpha, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, font: this.font, x, y });
      },
      fillText(text, x, y) {
        calls.push({ kind: 'fill', text, alpha: this.globalAlpha, fillStyle: this.fillStyle, font: this.font, x, y });
      },
    },
  };
}

function renderFloaters(floaters, mode = 'all') {
  const renderer = new FloaterRenderer({ floatersMode: mode, floaters });
  const { ctx, calls } = stubCanvas();
  renderer.render(ctx);
  return { renderer, calls };
}

test('混战帧伤害数字区域对比度 ≥ 基线（测试输出基线与当前数值）', (t) => {
  // 基线与记录值同源：基线漂移（调色板或度量口径变了）必须显式暴露。
  assert.ok(
    Math.abs(BASELINE_REGION_CONTRAST - RECORDED_BASELINE) < 0.02,
    `基线漂移：实测 ${BASELINE_REGION_CONTRAST.toFixed(3)}，记录值 ${RECORDED_BASELINE}`
  );

  // 混战帧里同时有刚生成、半程与接近过期的数字：按寿命比逐档采样。
  const measured = [1, 0.75, 0.5, 0.25, 0].map((ratio) =>
    damageRegionContrast({ alpha: floaterAlpha({ ttl: ratio, maxTtl: 1 }) })
  );
  const worst = measured.reduce((min, item) => Math.min(min, item.worst), Infinity);

  t.diagnostic(`基线（修复前 #eef3f8 / rgba(0,0,0,0.75) / 无淡出下限 @ 不透明度 0.25）= ${BASELINE_REGION_CONTRAST.toFixed(2)}`);
  for (const item of measured) {
    const detail = item.samples.map((sample) => `${sample.name} ${sample.ratio.toFixed(2)}`).join(' · ');
    t.diagnostic(`不透明度 ${item.alpha.toFixed(2)} → 数字/描边对比度 ${item.worst.toFixed(2)}（${detail}）· 数字/背景 ${item.worstOnBackground.toFixed(2)}`);
  }
  t.diagnostic(`当前最差对比度 = ${worst.toFixed(2)}（要求 ≥ 基线 ${BASELINE_REGION_CONTRAST.toFixed(2)} 且 ≥ 4.5）`);

  assert.ok(
    worst >= BASELINE_REGION_CONTRAST,
    `混战帧伤害数字区域对比度 ${worst.toFixed(2)} 低于基线 ${BASELINE_REGION_CONTRAST.toFixed(2)}`
  );
  // 基线只说明「不比回归前差」；可读性另有 WCAG 常规文本 4.5:1 的硬下限。
  assert.ok(worst >= 4.5, `尾段数字对比度 ${worst.toFixed(2)} 低于 WCAG 4.5:1，混战里读不出`);

  // 修复不靠字号膨胀：伤害层字号与帧预算原样。
  assert.equal(FLOATER_LAYERS.damage.size, 13, '伤害层字号不得膨胀');
  assert.equal(FLOATER_BUDGET.all, 28, '帧预算不得扩大（不靠刷屏）');
});

test('淡出下限：floaterAlpha 按寿命比淡出且不低于下限，异常输入不抛错', () => {
  assert.ok(FLOATER_FADE_FLOOR > 0.25 && FLOATER_FADE_FLOOR < 1, '下限必须落在「仍可读」区间');
  assert.equal(floaterAlpha({ ttl: 0.65, maxTtl: 0.65 }), 1);
  assert.equal(floaterAlpha({ ttl: 0, maxTtl: 0.65 }), FLOATER_FADE_FLOOR);
  // 寿命比单调：ttl 越小越暗，但永不低于下限。
  let previous = Infinity;
  for (const ttl of [0.65, 0.5, 0.3, 0.1, 0]) {
    const alpha = floaterAlpha({ ttl, maxTtl: 0.65 });
    assert.ok(alpha <= previous + 1e-9, '寿命越短不透明度不得反升');
    assert.ok(alpha >= FLOATER_FADE_FLOOR, '不得低于淡出下限');
    previous = alpha;
  }
  // 缺字段 / 非法值按满寿 / 无下限处理，不抛错。
  assert.equal(floaterAlpha({}), 1);
  assert.equal(floaterAlpha({ ttl: 5, maxTtl: 0 }), FLOATER_FADE_FLOOR + (1 - FLOATER_FADE_FLOOR) * 1);
  assert.equal(floaterAlpha(undefined), 1);
  assert.equal(floaterAlpha({ ttl: 0.5, maxTtl: 1 }, 0), 0.5, '显式下限 0 = 旧行为');
});

test('渲染层实测：尾段数字仍按淡出下限绘制，描边取自 FLOATER_CASING', () => {
  const floaters = [createFloater({ x: 2, y: 3, text: '20' })];
  floaters[0].ttl = 0.01;
  const { renderer, calls } = renderFloaters(floaters);
  assert.equal(renderer.stats.drawn, 1);

  const fill = calls.find((call) => call.kind === 'fill');
  const stroke = calls.find((call) => call.kind === 'stroke');
  assert.ok(fill && stroke, '每个飘字都要先描边后填充');
  assert.equal(calls[0].kind, 'stroke', '描边先画，填充盖在上面');
  assert.ok(fill.alpha >= FLOATER_FADE_FLOOR - 1e-9, `尾段不透明度 ${fill.alpha} 低于下限`);
  assert.equal(stroke.strokeStyle, FLOATER_CASING.color);
  assert.equal(stroke.lineWidth, FLOATER_CASING.width);
  assert.match(stroke.font, /^700 13px /, '伤害层字重 700 / 字号 13px');

  // 刚生成的数字满不透明。
  const fresh = renderFloaters([createFloater({ x: 2, y: 3, text: '20' })]);
  assert.equal(fresh.calls.find((call) => call.kind === 'fill').alpha, 1);
});

test('混战样本：三档可见集合与合并行为冻结不回归', () => {
  const sample = [
    damageFloater(2, 3, '20'),
    damageFloater(2.05, 3.05, '15'), // 同层 + 0.3 格内 + 0.12s 窗口内 → 累加
    damageFloater(6, 4, '33'),
    createFloater({ x: 9, y: 2, text: '120!', color: '#ffd36b', big: true, key: true }),
    createFloater({ x: 9.4, y: 2, text: '狂怒', color: '#ff6b6b', big: true, key: true }),
    createFloater({ x: 4, y: 8, text: '-8', color: '#ff6b6b', big: true, key: true }),
  ];
  const layersOf = (result) => result.draw.map((item) => item.layer);
  const textsOf = (result) => result.draw.map((item) => `${item.layer}:${item.text}`).sort();

  const all = planFloaterFrame(sample, { mode: 'all', budget: floaterBudget('all') });
  assert.deepEqual(textsOf(all), ['crit:120!', 'damage:33', 'damage:35', 'penalty:-8', 'status:狂怒']);
  assert.equal(all.visible, 6, '全部档看到全部 6 条');
  assert.equal(all.suppressed, 1, '同层近邻两条合并成一条：6 → 5');

  const key = planFloaterFrame(sample, { mode: 'key', budget: floaterBudget('key') });
  assert.deepEqual(textsOf(key), ['crit:120!', 'penalty:-8', 'status:狂怒'], '仅关键档不含普通伤害');
  assert.deepEqual(layersOf(key).sort(), ['crit', 'penalty', 'status']);

  const off = planFloaterFrame(sample, { mode: 'off', budget: floaterBudget('off') });
  assert.deepEqual(off.draw, [], '关闭档不绘制');
  assert.equal(off.visible, 0);

  // 合并参数与入列合并语义是冻结契约：本次只改绘制表现，不改这些数值。
  assert.equal(MERGE_RADIUS, 0.3);
  assert.equal(MERGE_WINDOW, 0.12);
  assert.equal(CLUSTER_RADIUS, 0.22);
  const list = [];
  pushFloater(list, damageFloater(2, 3, '20'), 0);
  pushFloater(list, damageFloater(2.05, 3.05, '15'), 0.05);
  assert.equal(list.length, 1, '同层近邻仍合并');
  assert.equal(list[0].text, '35', '数字文案仍按求和合并');
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
