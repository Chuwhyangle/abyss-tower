// 镜头反馈（AC-013）：hitstop / 定向震屏 / 缩放冲击的预算、上限、可复现性与模拟不变。
// 边界：表现层只读事件；模拟快照与 combatRng 序列在同 seed 下逐项不变。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';
import { RELIC_BY_ID } from '../public/js/shared/data.js';
import {
  IMPACT_EVENT_LIMIT,
  makeImpactEvent,
  pushImpactEvent,
} from '../public/js/shared/impact-events.js';
import {
  CAMERA_LIMITS,
  CameraFeedback,
  composeCameraTransform,
  hitstopFor,
  resolveMotionBudget,
  shakeImpulseFor,
} from '../public/js/render/camera-feedback.js';

const SOURCE = {
  camera: fs.readFileSync(
    new URL('../public/js/render/camera-feedback.js', import.meta.url),
    'utf8'
  ),
  render: fs.readFileSync(new URL('../public/js/render.js', import.meta.url), 'utf8'),
  gameApp: fs.readFileSync(new URL('../public/js/game-app.js', import.meta.url), 'utf8'),
};

const FULL_MOTION = { shake: true, decorations: 'full' };

function impact(overrides = {}) {
  return makeImpactEvent({
    t: 1,
    x: 3,
    y: 4,
    target: { id: 1, type: 'grunt' },
    weapon: 'arrow',
    source: 'tower',
    towerId: 1,
    amount: 20,
    armorAbsorbed: 0,
    shieldAbsorbed: 0,
    hpLost: 20,
    crit: false,
    lethal: false,
    ...overrides,
  });
}

function makeSim({ seed = 'hitstop-seed', relicIds = [] } = {}) {
  const map = generateMap(seed);
  const sim = new Simulation({
    map,
    seed,
    difficulty: 'standard',
    gold: 100000,
    baseHp: 50,
    maxBaseHp: 50,
    relics: relicIds.map((id) => ({ id, level: 1, ...RELIC_BY_ID[id] })),
    skill: null,
    towers: [],
    unlockedTowers: ['arrow', 'cannon', 'frost', 'arc', 'poison'],
    onToast: () => {},
  });
  return { sim, map };
}

// 记录一整局的 combatRng.float() 序列：beginWave 会按波次重建 RNG，需要重新挂钩。
function traceCombatRng(sim) {
  const sequence = [];
  const wrap = () => {
    const rng = sim.combatRng;
    if (!rng || rng.__traced) return;
    const original = rng.float;
    rng.float = function tracedFloat() {
      const value = original.call(this);
      sequence.push(value);
      return value;
    };
    rng.__traced = true;
  };
  wrap();
  const beginWave = sim.beginWave.bind(sim);
  sim.beginWave = (waveDef) => {
    const started = beginWave(waveDef);
    wrap();
    return started;
  };
  return sequence;
}

// 同一 seed 的一局：沿路径建塔 → 开局 → 跑满固定步数；feed 为真时每步把事件喂给镜头反馈。
function playRun({ steps = 900, feed }) {
  const { sim, map } = makeSim({ seed: 'hitstop-determinism', relicIds: ['crit'] });
  sim.setVisualQuality({ effects: 'full', floaters: 'all' });
  // 取贴着路径的格子建塔，保证固定步数内真的打出命中事件。
  const pathCells = new Set((map.pathCells || []).map((cell) => `${cell.c},${cell.r}`));
  const cells = [];
  const neighbours = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
  for (let r = 0; r < map.rows && cells.length < 8; r += 1) {
    for (let c = 0; c < map.cols && cells.length < 8; c += 1) {
      if (!sim.canBuild(c, r)) continue;
      if (neighbours.some(([dc, dr]) => pathCells.has(`${c + dc},${r + dr}`))) cells.push([c, r]);
    }
  }
  const types = ['arrow', 'cannon', 'frost', 'arc', 'poison', 'arrow', 'cannon', 'arc'];
  for (let i = 0; i < Math.min(types.length, cells.length); i += 1) {
    sim.placeTower(types[i], cells[i][0], cells[i][1]);
  }
  const feedback = feed
    ? new CameraFeedback({
        settings: FULL_MOTION,
        seed: sim.seed,
        viewport: { width: map.cols, height: map.rows },
      })
    : null;
  const rngSequence = traceCombatRng(sim);
  const waveOptions = {
    portalCount: map.meta?.portalCount || 1,
    modifier: map.meta?.modifier || null,
  };
  const def = generateWave(sim.seed, 1, 'standard', waveOptions, { endless: false });
  assert.equal(sim.beginWave(def), true, '第 1 波应可开始');
  for (let step = 0; step < steps && sim.phase === 'wave'; step += 1) {
    sim.update(1 / 30);
    if (feedback) {
      feedback.consume(sim.impactEvents);
      feedback.update(1 / 30);
    }
  }
  const snapshot = sim.toSnapshot();
  delete snapshot.savedAt;
  delete snapshot.startedAt;
  return {
    snapshot: JSON.stringify(snapshot),
    rngSequence,
    eventCount: sim.impactEvents.length,
  };
}

test('① 运动预算：四种组合 + 最低画质，关闭运动时运动分量为 0 且保留闪光', () => {
  const on = resolveMotionBudget(FULL_MOTION, { reducedMotion: false });
  assert.equal(on.motion, true);
  assert.equal(on.shakeScale, 1);
  assert.equal(on.zoomScale, 1);
  assert.equal(on.hitstopScale, 1);
  assert.equal(on.flashScale, 1);

  const systemReduced = resolveMotionBudget(FULL_MOTION, { reducedMotion: true });
  assert.equal(systemReduced.motion, false);
  assert.equal(systemReduced.shakeScale, 0);
  assert.equal(systemReduced.zoomScale, 0);
  assert.equal(systemReduced.hitstopScale, 0.5, '冻结不是位移：降级后保留但减半');
  assert.equal(systemReduced.flashScale, 1, '非运动反馈不降级');

  const shakeOff = resolveMotionBudget({ shake: false, decorations: 'full' });
  assert.equal(shakeOff.motion, false);
  assert.equal(shakeOff.shakeScale, 0);
  assert.equal(shakeOff.zoomScale, 0);
  assert.ok(shakeOff.flashScale > 0);

  const decorationsOff = resolveMotionBudget({ shake: true, decorations: 'off' });
  assert.equal(decorationsOff.motion, false, '最低画质同样关闭运动');

  // 四组显式组合：只有「震屏开 + 未 reduced」允许运动。
  for (const shake of [true, false]) {
    for (const reducedMotion of [true, false]) {
      const budget = resolveMotionBudget({ shake, decorations: 'full' }, { reducedMotion });
      assert.equal(budget.motion, shake === true && reducedMotion === false);
      if (!budget.motion) {
        assert.equal(budget.shakeScale, 0);
        assert.equal(budget.zoomScale, 0);
        assert.ok(budget.flashScale > 0);
      }
    }
  }

  // 缺省设置（含 undefined）不抛错且按关闭运动处理。
  assert.equal(resolveMotionBudget().motion, false);
  assert.equal(resolveMotionBudget(null, { reducedMotion: false }).motion, false);
});

test('② hitstop：dot 为 0、暴击/致死单调递增、永不超过上限', () => {
  assert.equal(hitstopFor(impact({ source: 'dot' })), 0, '持续伤害不冻结');

  const plain = hitstopFor(impact({ hpLost: 20 }));
  const crit = hitstopFor(impact({ hpLost: 20, crit: true }));
  const lethal = hitstopFor(impact({ hpLost: 20, lethal: true }));
  const lethalCrit = hitstopFor(impact({ hpLost: 20, crit: true, lethal: true }));
  assert.ok(plain >= CAMERA_LIMITS.hitstopMin, `普通命中 ${plain} 不低于下限`);
  assert.ok(crit > plain, `暴击 ${crit} 应大于普通 ${plain}`);
  assert.ok(lethal > crit, `致死 ${lethal} 应大于暴击 ${crit}`);
  assert.ok(lethalCrit >= lethal, '暴击 + 致死不应更短');

  for (const hpLost of [1, 5, 6, 15, 30, 999]) {
    for (const crit of [true, false]) {
      for (const lethal of [true, false]) {
        const duration = hitstopFor(
          impact({ hpLost, crit, lethal, shieldAbsorbed: 5 })
        );
        assert.ok(duration > 0, '有效命中都应有冻结');
        assert.ok(
          duration <= CAMERA_LIMITS.hitstopMax + 1e-12,
          `hpLost=${hpLost} crit=${crit} lethal=${lethal} 得到 ${duration}，超过上限`
        );
      }
    }
  }

  // 预算减半作用于 clamp 之后的结果。
  const reduced = resolveMotionBudget(FULL_MOTION, { reducedMotion: true });
  assert.equal(hitstopFor(impact({ hpLost: 20 }), reduced), plain * 0.5);
});

test('③ 定向冲量：方向由命中点指向屏幕中心，幅度不超过 shakeMax', () => {
  const viewport = { width: 30, height: 20 };
  const still = () => 0.5;

  const left = shakeImpulseFor(impact({ x: 2, y: 10 }), viewport, still);
  assert.ok(left.x > 0, `命中点在左侧时镜头应被推向右侧，实际 x=${left.x}`);
  assert.ok(Math.abs(left.y) < 1e-9, '同一水平线上不应有纵向分量');

  const top = shakeImpulseFor(impact({ x: 15, y: 1 }), viewport, still);
  assert.ok(top.y > 0, `命中点在上方时镜头应被推向下方，实际 y=${top.y}`);

  const right = shakeImpulseFor(impact({ x: 29, y: 10 }), viewport, still);
  assert.ok(right.x < 0, '命中点在右侧时方向应相反');

  for (const hpLost of [1, 10, 30, 500]) {
    for (const crit of [true, false]) {
      for (const lethal of [true, false]) {
        const impulse = shakeImpulseFor(
          impact({ x: 2, y: 2, hpLost, crit, lethal, shieldAbsorbed: 3 }),
          viewport,
          still
        );
        assert.ok(impulse.magnitude > 0);
        assert.ok(
          impulse.magnitude <= CAMERA_LIMITS.shakeMax + 1e-12,
          `幅度 ${impulse.magnitude} 超过上限 ${CAMERA_LIMITS.shakeMax}`
        );
        assert.ok(Math.hypot(impulse.x, impulse.y) <= CAMERA_LIMITS.shakeMax + 1e-9);
        assert.equal(impulse.ttl, CAMERA_LIMITS.window);
      }
    }
  }

  // 抖动只改方向不改幅度：同事件不同种子幅度一致、方向可不同。
  const a = shakeImpulseFor(impact({ x: 2, y: 2 }), viewport, () => 0.1);
  const b = shakeImpulseFor(impact({ x: 2, y: 2 }), viewport, () => 0.9);
  assert.equal(a.magnitude, b.magnitude);
  assert.ok(Math.abs(a.x - b.x) > 1e-6, '播种抖动应改变方向');
});

test('④ 同 seed 同事件流逐帧一致；不同 seed 抖动不同', () => {
  const makeFeed = () => [
    impact({ x: 2, y: 3, hpLost: 8 }),
    impact({ x: 5, y: 9, hpLost: 25, crit: true }),
    impact({ x: 20, y: 15, hpLost: 80, lethal: true }),
  ];
  const frame = () => new CameraFeedback({ settings: FULL_MOTION, seed: 'camera-a', viewport: { width: 30, height: 20 } });

  const run = (feedback) => {
    const events = makeFeed();
    feedback.consume(events);
    const frames = [];
    for (let i = 0; i < 90; i += 1) {
      const out = feedback.update(1 / 60);
      frames.push([out.offsetX, out.offsetY, out.zoom, out.hitstopRemaining, out.flash]);
      if (i === 10) feedback.consume([impact({ x: 12, y: 4, hpLost: 12 })]);
    }
    return frames;
  };

  const first = run(frame());
  const second = run(frame());
  assert.deepEqual(second, first, '同 seed 同事件流的逐帧镜头状态应完全一致');

  const other = run(new CameraFeedback({ settings: FULL_MOTION, seed: 'camera-b', viewport: { width: 30, height: 20 } }));
  assert.notDeepEqual(other, first, '不同 seed 的抖动序列应不同');

  // 至少有一帧真的产生了位移与缩放，否则上面的比较没有意义。
  assert.ok(first.some(([x, y]) => Math.abs(x) > 1e-9 || Math.abs(y) > 1e-9));
  assert.ok(first.some(([, , zoom]) => zoom > 1 + 1e-9));
});

test('⑤ 去重：同一事件对象重复 consume 不重复触发；环形缓冲裁掉旧事件后仍正确', () => {
  const feedback = new CameraFeedback({ settings: FULL_MOTION, seed: 7, viewport: { width: 30, height: 20 } });
  const event = impact({ hpLost: 40 });
  assert.equal(feedback.consume([event]), 1);
  assert.equal(feedback.consume([event]), 0, '同一对象第二次不应再触发');
  const stats = feedback.stats();
  assert.equal(stats.hitstops, 1);
  assert.equal(stats.shakeImpulses, 1);

  // 环形缓冲：超过上限后最旧的事件被裁掉，新的对象照常消费。
  const { sim } = makeSim({ seed: 'ring-buffer' });
  for (let i = 0; i < IMPACT_EVENT_LIMIT + 12; i += 1) {
    pushImpactEvent(sim, { t: i, x: i % 10, y: i % 7, hpLost: 10, target: { id: i } });
  }
  assert.equal(sim.impactEvents.length, IMPACT_EVENT_LIMIT, '环形缓冲裁到上限');
  const before = feedback.stats();
  const consumed = feedback.consume(sim.impactEvents);
  assert.equal(consumed, IMPACT_EVENT_LIMIT, '首轮消费整段缓冲');
  const after = feedback.stats();
  assert.equal(after.hitstops - before.hitstops, IMPACT_EVENT_LIMIT);

  // 旧对象已被裁掉、新对象继续入队：只消费新增的那几条。
  for (let i = 0; i < 5; i += 1) {
    pushImpactEvent(sim, { t: 1000 + i, x: 1, y: 1, hpLost: 10, target: { id: 1000 + i } });
  }
  assert.equal(feedback.consume(sim.impactEvents), 5, '只消费新增事件');

  // 并发上限：同帧大量冲量只保留 maxImpulses 条。
  const burst = new CameraFeedback({ settings: FULL_MOTION, seed: 3, viewport: { width: 30, height: 20 } });
  burst.consume(Array.from({ length: 20 }, (_, i) => impact({ x: i, y: 1, hpLost: 50 })));
  const out = burst.update(1 / 60);
  assert.ok(Math.hypot(out.offsetX, out.offsetY) <= CAMERA_LIMITS.shakeMax + 1e-9, '合成位移受 shakeMax 约束');
  assert.ok(burst.stats().shakeImpulses > 0);
});

test('⑥ 运动关闭：连续 60 帧位移/缩放恒为 0，命中闪光仍 > 0', () => {
  for (const [settings, reducedMotion] of [
    [FULL_MOTION, true],
    [{ shake: false, decorations: 'full' }, false],
    [{ shake: true, decorations: 'off' }, false],
  ]) {
    const feedback = new CameraFeedback({ settings, reducedMotion, seed: 11, viewport: { width: 30, height: 20 } });
    feedback.consume([impact({ hpLost: 60, crit: true }), impact({ x: 24, y: 16, hpLost: 99, lethal: true })]);
    let sawFlash = false;
    for (let i = 0; i < 60; i += 1) {
      const out = feedback.update(1 / 60);
      assert.equal(out.offsetX, 0, '运动关闭时 offsetX 必须精确为 0');
      assert.equal(out.offsetY, 0, '运动关闭时 offsetY 必须精确为 0');
      assert.equal(out.zoom, 1, '运动关闭时 zoom 必须精确为 1');
      assert.equal(out.motion, false);
      if (out.flash > 0) sawFlash = true;
    }
    assert.ok(sawFlash, '运动关闭时命中闪光仍应可见');
    const stats = feedback.stats();
    assert.ok(stats.flashes > 0);
    assert.ok(stats.suppressed > 0, '被护栏压掉的运动分量应计数');
    assert.ok(stats.hitstops > 0, '冻结不是位移：reduced-motion 下仍保留（减半）');
  }

  // composeCameraTransform 在运动关闭时返回精确恒等，不返回「极小值」。
  const transform = composeCameraTransform({
    feedback: { offsetX: 3, offsetY: -2, zoom: 1.02, flash: 0.4, focusX: 1, focusY: 2, flashX: 1, flashY: 2 },
    budget: resolveMotionBudget(FULL_MOTION, { reducedMotion: true }),
  });
  assert.equal(transform.x, 0);
  assert.equal(transform.y, 0);
  assert.equal(transform.zoom, 1);
  assert.equal(transform.flash, 0.4, '闪光字段照常返回');
});

test('⑦ 同 seed 900 步：喂不喂镜头反馈，快照与 combatRng 序列逐项一致', () => {
  const withFeedback = playRun({ steps: 900, feed: true });
  const without = playRun({ steps: 900, feed: false });

  assert.ok(withFeedback.eventCount > 0, '整局应产出命中事件');
  assert.ok(without.eventCount > 0);
  assert.equal(withFeedback.snapshot, without.snapshot, '模拟快照应逐字节一致');
  assert.deepEqual(withFeedback.rngSequence, without.rngSequence, 'combatRng 调用序列应逐项相等');
});

test('⑧ 源码级约束：无未播种随机、不触达模拟 RNG、步进累积用 timeScale', () => {
  assert.ok(!/Math\.random/.test(SOURCE.camera), 'camera-feedback.js 不得出现 Math.random');
  assert.ok(!/Math\.random/.test(SOURCE.render), 'render.js 不得出现 Math.random');
  assert.ok(
    !/from\s+['"]\.\.\/sim(\.js|\/)/.test(SOURCE.camera),
    'camera-feedback.js 不得 import 模拟层'
  );
  assert.ok(!/\bsim\.(combatRng|rng)\b/.test(SOURCE.camera), 'camera-feedback.js 不得触碰模拟 RNG');
  assert.ok(!/\bsim\.(combatRng|rng)\b/.test(SOURCE.render), 'render.js 不得触碰模拟 RNG');
  assert.ok(!/\bsim\.(combatRng|rng)\b/.test(SOURCE.gameApp), 'game-app.js 不得触碰模拟 RNG');

  assert.match(
    SOURCE.gameApp,
    /this\.acc\s*\+=\s*raw\s*\*\s*this\.speed\s*\*\s*frame\.timeScale/,
    'game-app.js 的累积行必须乘 frame.timeScale'
  );
  assert.match(SOURCE.gameApp, /feedback\.consume\(sim\.impactEvents/);
  assert.match(SOURCE.render, /render\(dt,\s*feedback\s*=\s*null\)/);
});
