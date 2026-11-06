// AC-017 高潮演出：漏怪 / 清波 / 首领死亡三段独立签名 + reduced-motion 降级。
//
// 覆盖四层：
//   1. 规格（shared/culmination.js）：完整性、两两可辨识、降级规则；
//   2. 模拟（sim.js + 三个系统）：显式记录事件，且记录通道零接触结算；
//   3. 渲染（render/culmination-renderer.js）：三种画法各自的绘制与统计（stub canvas）；
//   4. 接线与文案：源文件调用点、i18n 六键、确定性边界（无 Math.random / 无模拟依赖）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  CULMINATION_KINDS,
  CULMINATION_SPECS,
  culminationPlan,
  culminationSpec,
} from '../public/js/shared/culmination.js';
import { CulminationRenderer } from '../public/js/render/culmination-renderer.js';
import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { t, setLocale } from '../public/js/i18n.js';
import zhCN from '../public/js/shared/i18n/zh-CN.js';
import enUS from '../public/js/shared/i18n/en-US.js';

const STEP = 1 / 60;
const SEED = 'feel-culmination-seed';

const readSource = (relative) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

const HEX = /^#[0-9a-f]{6}$/i;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

function makeSim(overrides = {}) {
  const map = generateMap(SEED);
  return new Simulation({
    map,
    seed: SEED,
    difficulty: 'standard',
    gold: 500,
    baseHp: 20,
    maxBaseHp: 20,
    ...overrides,
  });
}

// 进入指定波次的战斗态：waveDef 只带一条固定奖励，避免依赖波次生成器。
function enterWave(sim, wave, extra = {}) {
  sim.phase = 'wave';
  sim.wave = wave;
  sim.waveDef = { index: wave, hpMul: 1, speedMul: 1, reward: 40, groups: [], ...extra };
  sim.spawnQueue = [];
  sim.spawnIndex = 0;
}

function advance(sim, seconds) {
  const steps = Math.max(1, Math.round(seconds / STEP));
  for (let i = 0; i < steps; i++) sim.update(STEP);
}

// ---------- 1. 规格 ----------

test('规格完整性：三个 kind、字段齐全、未知 kind 返回 null', () => {
  assert.deepEqual([...CULMINATION_KINDS], ['leak', 'waveClear', 'bossKill']);
  assert.deepEqual(Object.keys(CULMINATION_SPECS), [...CULMINATION_KINDS]);
  assert.ok(Object.isFrozen(CULMINATION_SPECS), '规格表必须冻结');

  for (const kind of CULMINATION_KINDS) {
    const spec = culminationSpec(kind);
    assert.ok(spec, `${kind} 缺少规格`);
    assert.equal(spec.id, kind);
    assert.match(spec.accent, HEX, `${kind}.accent 必须是合法 hex`);
    assert.ok(spec.bannerKey.length > 0 && spec.detailKey.length > 0);
    assert.ok(spec.bannerKey.startsWith('feel.culmination.'), `${kind} 横幅键必须落在新命名空间`);
    assert.match(spec.flash.color, HEX, `${kind}.flash.color 必须是合法 hex`);
    assert.ok(finite(spec.flash.peak) && spec.flash.peak > 0);
    assert.ok(finite(spec.flash.duration) && spec.flash.duration > 0);
    assert.ok(finite(spec.duration) && spec.duration > 0);
    assert.ok(finite(spec.motion.timeScale) && spec.motion.timeScale > 0 && spec.motion.timeScale <= 1);
    assert.ok(finite(spec.motion.shake) && spec.motion.shake >= 0);
    assert.ok(finite(spec.motion.zoom) && spec.motion.zoom >= 0);
    assert.ok(typeof spec.pulse.shape === 'string' && spec.pulse.shape.length > 0);
    assert.ok(Number.isInteger(spec.pulse.rings) && spec.pulse.rings >= 1);
    assert.ok(Object.isFrozen(spec) && Object.isFrozen(spec.flash) && Object.isFrozen(spec.motion));
  }

  assert.equal(culminationSpec('unknown'), null);
  assert.equal(culminationSpec(undefined), null);
  assert.equal(culminationPlan('unknown'), null);
});

test('独立可辨识：横幅键 / 闪光色 / 脉冲形态 / 慢动作倍率 / 时长两两不同', () => {
  const specs = CULMINATION_KINDS.map((kind) => CULMINATION_SPECS[kind]);
  const distinct = (pick) => new Set(specs.map(pick)).size;
  assert.equal(distinct((spec) => spec.bannerKey), 3, '三个横幅键必须不同');
  assert.equal(distinct((spec) => spec.flash.color), 3, '三个闪光颜色必须不同');
  assert.equal(distinct((spec) => spec.pulse.shape), 3, '三个脉冲形态必须不同');
  assert.equal(distinct((spec) => spec.motion.timeScale), 3, '三个慢动作倍率必须不同');
  assert.equal(distinct((spec) => spec.duration), 3, '三个演出时长必须不同');
  // 只有清波与首领死亡放慢动作；漏怪保持实时（它的仪式感来自基地脉冲）。
  assert.equal(culminationSpec('leak').motion.timeScale, 1);
  assert.ok(culminationSpec('waveClear').motion.timeScale < 1);
  assert.ok(culminationSpec('bossKill').motion.timeScale < 1);
});

test('降级规则：reduced-motion / 关闭震屏只取消运动，非运动反馈逐字段保留', () => {
  for (const kind of CULMINATION_KINDS) {
    const full = culminationPlan(kind);
    assert.equal(full.motion.mode, 'full');
    assert.equal(full.motion.pulse, true);
    assert.equal(full.motion.timeScale, culminationSpec(kind).motion.timeScale);

    for (const options of [{ reducedMotion: true }, { shake: false }]) {
      const plan = culminationPlan(kind, options);
      assert.equal(plan.motion.mode, 'reduced', `${kind} ${JSON.stringify(options)} 应降级`);
      assert.equal(plan.motion.pulse, false);
      assert.equal(plan.motion.timeScale, 1);
      assert.equal(plan.motion.shake, 0);
      assert.equal(plan.motion.zoom, 0);
      // 非运动反馈不降级：横幅键、副标题、强调色、闪光颜色与完整模式一致。
      assert.equal(plan.bannerKey, full.bannerKey);
      assert.equal(plan.detailKey, full.detailKey);
      assert.equal(plan.accent, full.accent);
      assert.equal(plan.flash.color, full.flash.color);
    }
  }
});

// ---------- 2. 模拟侧事件 ----------

test('漏怪事件：记录 kind/damage/漏怪后的基地生命，seq 严格递增且唯一', () => {
  const sim = makeSim();
  enterWave(sim, 1);
  sim.spawnEnemy('swarm', 0);
  const enemy = sim.enemies.at(-1);
  const before = sim.baseHp;
  sim.leak(enemy);

  const last = sim.culminations.at(-1);
  assert.equal(last.kind, 'leak');
  assert.ok(last.damage > 0, '漏怪伤害必须为正');
  assert.equal(last.baseHp, sim.baseHp, 'baseHp 必须是漏怪后的基地生命');
  assert.equal(last.baseHp, before - enemy.dmg);
  assert.equal(last.at, sim.time);

  // 再制造两次漏怪：seq 严格递增且全局唯一。
  for (let i = 0; i < 2; i++) {
    sim.spawnEnemy('swarm', 0);
    sim.leak(sim.enemies.at(-1));
  }
  const seqs = sim.culminations.map((event) => event.seq);
  assert.ok(seqs.length >= 2);
  for (let i = 1; i < seqs.length; i++) assert.ok(seqs[i] > seqs[i - 1], 'seq 必须严格递增');
  assert.equal(new Set(seqs).size, seqs.length, 'seq 必须唯一');
});

test('清波事件：kind/wave/reward/interest 与金币增量一致', () => {
  const sim = makeSim();
  enterWave(sim, 3, { reward: 40 });
  const before = sim.gold;
  sim.completeWave();

  const last = sim.culminations.at(-1);
  assert.equal(last.kind, 'waveClear');
  assert.equal(last.wave, 3);
  assert.ok(finite(last.reward), 'reward 必须是有限数');
  assert.ok(finite(last.interest), 'interest 必须是有限数');
  assert.equal(sim.clearedWave, 3);
  assert.equal(sim.gold - before, last.reward + last.interest, '事件数值必须与实际入账一致');
});

test('首领死亡事件：显式记录 bossKill；普通怪击杀不产生', () => {
  const sim = makeSim();
  enterWave(sim, 10);
  sim.spawnEnemy('boss', 0, 1);
  const boss = sim.enemies.at(-1);
  assert.equal(boss.boss, true);
  sim.killEnemy(boss);

  const last = sim.culminations.at(-1);
  assert.equal(last.kind, 'bossKill');
  assert.equal(last.type, 'boss');
  assert.ok(typeof last.name === 'string' && last.name.trim().length > 0, 'name 必须非空');

  const countBefore = sim.culminations.length;
  sim.spawnEnemy('swarm', 0);
  sim.killEnemy(sim.enemies.at(-1));
  assert.equal(sim.culminations.length, countBefore, '普通怪击杀不得产生 bossKill');
  assert.ok(!sim.culminations.some((event) => event.kind === 'bossKill' && event.type !== 'boss'));
});

test('表现零接触模拟：recordCulminations 开/关两局状态逐字节一致', () => {
  const snapshot = (sim) =>
    JSON.stringify({
      gold: sim.gold,
      baseHp: sim.baseHp,
      kills: sim.kills,
      wave: sim.wave,
      clearedWave: sim.clearedWave,
      enemies: sim.enemies.map((e) => [e.id, e.hp, e.progress, e.dead]),
      floaters: sim.floaters.map((f) => [f.text, f.x, f.y, f.ttl, f.color, f.big, f.key, f.layer]),
      effects: sim.effects.map((e) => [e.kind, e.x, e.y, e.ttl, e.maxTtl]),
    });

  const script = (sim) => {
    enterWave(sim, 1);
    sim.spawnEnemy('swarm', 0);
    sim.leak(sim.enemies.at(-1));
    advance(sim, 0.5);
    enterWave(sim, 2);
    sim.spawnEnemy('boss', 0, 1);
    sim.killEnemy(sim.enemies.at(-1));
    advance(sim, 0.5);
    enterWave(sim, 3);
    sim.completeWave();
    advance(sim, 1);
    return snapshot(sim);
  };

  const records = script(makeSim({ recordCulminations: true }));
  const silent = script(makeSim({ recordCulminations: false }));
  assert.equal(records, silent, '表现层记录不得改变任何结算状态');

  const silentSim = makeSim({ recordCulminations: false });
  enterWave(silentSim, 1);
  silentSim.spawnEnemy('swarm', 0);
  silentSim.leak(silentSim.enemies.at(-1));
  assert.equal(silentSim.culminations.length, 0, 'recordCulminations=false 时不得积累事件');
  assert.equal(silentSim.addCulmination('leak', {}), null);
});

test('事件通道是环形缓冲：超过 16 条丢最旧，seq 仍递增', () => {
  const sim = makeSim();
  for (let i = 0; i < 20; i++) sim.addCulmination('leak', { damage: 1, baseHp: 20 - i });
  assert.equal(sim.culminations.length, 16);
  const seqs = sim.culminations.map((event) => event.seq);
  assert.deepEqual(seqs, seqs.slice().sort((a, b) => a - b));
  assert.equal(seqs.at(-1), sim.culminationSeq);
});

// ---------- 3. 渲染层（stub canvas，不启动浏览器） ----------

function stubCtx() {
  const calls = { fillText: [], strokeText: [], arcs: 0, fillRects: 0, strokeRects: 0 };
  const gradient = { addColorStop() {} };
  return {
    calls,
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
    lineJoin: '',
    globalCompositeOperation: 'source-over',
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    arc() {
      calls.arcs += 1;
    },
    fill() {},
    stroke() {},
    fillRect() {
      calls.fillRects += 1;
    },
    strokeRect() {
      calls.strokeRects += 1;
    },
    fillText(text) {
      calls.fillText.push(String(text));
    },
    strokeText(text) {
      calls.strokeText.push(String(text));
    },
    createLinearGradient() {
      return gradient;
    },
  };
}

function stubGame() {
  const map = generateMap(SEED);
  return { map, culminations: [] };
}

function pushEvent(game, seq, kind, meta = {}) {
  game.culminations.push({ seq, kind, at: 0, ...meta });
}

// 单个 kind 的独立渲染：每种演出用自己的渲染器，断言「画法」本身就是它的签名。
function renderKind(kind, meta, { reducedMotion = false, at = 0.4 } = {}) {
  const game = stubGame();
  const renderer = new CulminationRenderer(game, {
    width: game.map.cols * 48,
    height: game.map.rows * 48,
    text: (key, params) => `${key}:${Object.values(params).join('/')}`,
    settings: { shake: true },
    reducedMotion,
  });
  pushEvent(game, 1, kind, meta);
  renderer.update(game, 1 / 60);
  const spec = culminationSpec(kind);
  // 推进到演出中段再绘制：扩散环按进度依次出现。
  renderer.update(game, spec.duration * at);
  const ctx = stubCtx();
  const drawn = renderer.render(ctx);
  return { game, renderer, ctx, drawn };
}

test('渲染层：漏怪 = 红边框 + 基地脉冲 + 上方横幅，不慢动作', () => {
  const { renderer, ctx, drawn } = renderKind('leak', { damage: 3, baseHp: 17 });
  assert.equal(drawn, 1);
  assert.equal(renderer.stats.drawn.leak, 1);
  assert.equal(renderer.timeScale(), 1, '漏怪不慢动作');
  assert.ok(ctx.calls.strokeRects >= 1, '漏怪必须有静态边框');
  assert.ok(ctx.calls.arcs >= 1, '完整模式必须画基地脉冲环');
  assert.ok(ctx.calls.fillText.some((line) => line.startsWith('feel.culmination.leak.title')));
  assert.ok(ctx.calls.fillText.some((line) => line.startsWith('feel.culmination.leak.detail')));
});

test('渲染层：清波 = 金色横扫 + 居中横幅，中速慢动作', () => {
  const { renderer, ctx, drawn } = renderKind('waveClear', { wave: 3, reward: 40, interest: 2 });
  assert.equal(drawn, 1);
  assert.equal(renderer.stats.drawn.waveClear, 1);
  assert.equal(renderer.timeScale(), culminationSpec('waveClear').motion.timeScale);
  assert.ok(renderer.timeScale() < 1 && renderer.timeScale() > culminationSpec('bossKill').motion.timeScale);
  assert.equal(ctx.calls.arcs, 0, '清波用扫光而不是圆环');
  assert.ok(ctx.calls.fillRects >= 2, '金色扫光与上下描边');
  assert.ok(ctx.calls.fillText.some((line) => line.startsWith('feel.culmination.waveClear.title')));
});

test('渲染层：首领死亡 = 白闪 + 多层扩散环 + 首领名横幅，最慢', () => {
  const { renderer, ctx, drawn } = renderKind('bossKill', { type: 'boss', name: '渊主' });
  assert.equal(drawn, 1);
  assert.equal(renderer.stats.drawn.bossKill, 1);
  assert.equal(renderer.timeScale(), culminationSpec('bossKill').motion.timeScale);
  assert.ok(renderer.timeScale() < culminationSpec('waveClear').motion.timeScale);
  assert.ok(
    ctx.calls.arcs >= culminationSpec('bossKill').pulse.rings,
    '首领死亡必须画多层扩散环'
  );
  assert.ok(ctx.calls.strokeRects >= 2, '双重静态细边框');
  assert.ok(ctx.calls.fillText.some((line) => line.startsWith('feel.culmination.bossKill.title')));
  assert.ok(ctx.calls.fillText.some((line) => line.includes('渊主')), '副标题带入首领名');
});

test('渲染层：reduced-motion 下保留横幅/色块/边框，去掉脉冲与慢动作', () => {
  const game = stubGame();
  const renderer = new CulminationRenderer(game, {
    width: game.map.cols * 48,
    height: game.map.rows * 48,
    text: (key) => key,
    settings: { shake: true },
    reducedMotion: true,
  });

  pushEvent(game, 1, 'leak', { damage: 3, baseHp: 17 });
  pushEvent(game, 2, 'waveClear', { wave: 3, reward: 40, interest: 2 });
  pushEvent(game, 3, 'bossKill', { type: 'boss', name: '渊主' });
  renderer.update(game, 1 / 60);
  assert.equal(renderer.stats.reducedFallbacks, 3);
  assert.equal(renderer.timeScale(), 1, '降级时不得慢动作');

  const ctx = stubCtx();
  assert.equal(renderer.render(ctx), 3, '三类横幅都要照常绘制');
  assert.equal(renderer.stats.drawn.leak, 1);
  assert.equal(renderer.stats.drawn.waveClear, 1);
  assert.equal(renderer.stats.drawn.bossKill, 1);
  assert.equal(ctx.calls.arcs, 0, '降级时不画扩散环/基地脉冲');
  assert.ok(ctx.calls.strokeRects >= 3, '降级时静态边框必须保留');
  assert.ok(ctx.calls.fillRects >= 3, '降级时色块/底板必须保留');
  assert.ok(ctx.calls.fillText.length >= 3, '降级时横幅文字必须保留');
});

test('渲染层：按 seq 增量消费、未知 kind 跳过、关闭震屏即时降级', () => {
  const game = stubGame();
  const renderer = new CulminationRenderer(game, {
    width: 960,
    height: 576,
    text: (key) => key,
    settings: { shake: true },
  });

  pushEvent(game, 1, 'leak', { damage: 1, baseHp: 19 });
  renderer.update(game, 1 / 60);
  renderer.update(game, 1 / 60);
  assert.equal(renderer.stats.leak, 1, '同一 seq 不得重复消费');

  pushEvent(game, 2, 'notAKind');
  renderer.update(game, 1 / 60);
  assert.equal(renderer.stats.skipped, 1);
  assert.equal(renderer.active.length, 1);

  // 关闭震屏：已生成的演出立即转静态降级，不等下一次事件。
  renderer.setSettings({ shake: false });
  assert.equal(renderer.active[0].plan.motion.mode, 'reduced');
  assert.equal(renderer.timeScale(), 1);

  // duration 到期后自动收起。
  renderer.update(game, 5);
  assert.equal(renderer.active.length, 0);
  assert.equal(renderer.timeScale(), 1);
});

// ---------- 4. 确定性 / 接线 / 文案 ----------

test('确定性源码：规格与渲染器不含随机源、不依赖模拟层或 DOM', () => {
  for (const file of [
    'public/js/shared/culmination.js',
    'public/js/render/culmination-renderer.js',
  ]) {
    const source = readSource(file);
    assert.ok(!/Math\.random/.test(source), `${file} 不得出现 Math.random`);
    assert.ok(!/from\s+['"][^'"]*\/sim(\.js|\/)/.test(source), `${file} 不得 import 模拟层`);
    assert.ok(!/from\s+['"][^'"]*shared\/rng\.js/.test(source), `${file} 不得 import 随机源`);
    assert.ok(!/\bdocument\.|\bwindow\./.test(source), `${file} 不得直接访问 DOM`);
  }
});

test('接线源码：三处事件、渲染层与视觉 dt 缩放都已接上', () => {
  const enemySystem = readSource('public/js/sim/enemy-system.js');
  assert.match(enemySystem, /addCulmination\('leak'/, 'leak() 必须记录漏怪演出');

  const combatSystem = readSource('public/js/sim/combat-system.js');
  assert.match(combatSystem, /addCulmination\('bossKill'/, '首领分支必须记录 bossKill');

  const waveDirector = readSource('public/js/sim/wave-director.js');
  assert.match(waveDirector, /addCulmination\('waveClear'/, 'completeWave() 必须记录清波');

  const render = readSource('public/js/render.js');
  assert.match(render, /createRenderer\('culmination'/, 'render.js 必须经注册表构造 CulminationRenderer');
  assert.match(readSource('public/js/render/culmination-renderer.js'), /registerRenderer\('culmination', CulminationRenderer\)/);
  assert.match(render, /this\.culmination\.update\(/, 'render.js 必须在渲染中推进演出');
  assert.match(render, /this\.culmination\.render\(/, 'render.js 必须在渲染中绘制演出');
  assert.match(render, /get visualTimeScale\(\)/, 'render.js 必须暴露 visualTimeScale');

  const gameApp = readSource('public/js/game-app.js');
  assert.match(gameApp, /renderer\??\.visualTimeScale/, 'game-app 必须读取演出时间倍率');
  assert.match(gameApp, /sim\.updateVisuals\(visualDt\)/, 'updateVisuals 必须用缩放后的视觉 dt');
  assert.match(gameApp, /setReducedMotion\(/, 'game-app 必须把 reduced-motion 同步给演出层');
});

test('i18n 完整性：六键在中英字典都存在、非空且插值后无残留占位符', () => {
  const params = {
    leak: { damage: 3, baseHp: 17 },
    waveClear: { wave: 3, reward: 40, interest: 2 },
    bossKill: { name: '渊主' },
  };
  for (const kind of CULMINATION_KINDS) {
    for (const field of ['title', 'detail']) {
      const key = `feel.culmination.${kind}.${field}`;
      for (const [locale, dictionary] of [
        ['zh-CN', zhCN],
        ['en-US', enUS],
      ]) {
        assert.ok(Object.prototype.hasOwnProperty.call(dictionary, key), `${locale} 缺少 ${key}`);
        assert.ok(String(dictionary[key]).trim().length > 0, `${locale}.${key} 不得为空`);
      }
      for (const locale of ['zh-CN', 'en-US']) {
        setLocale(locale, { silent: true });
        const rendered = t(key, params[kind]);
        assert.ok(!/\{\w+\}/.test(rendered), `${locale}.${key} 插值后仍含占位符：${rendered}`);
        assert.ok(rendered !== key, `${locale}.${key} 未解析到文案`);
      }
    }
  }
  setLocale('zh-CN', { silent: true });
});
