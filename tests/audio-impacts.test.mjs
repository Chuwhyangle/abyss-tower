// 命中音效层（AC-014）：八种武器可区分签名、并发限流、压缩/限幅总线、
// 确定性变调、战旗光环脉冲、静音与「模拟零接触」。
// 纯数据/纯逻辑用真模块验证；音频层在 Node 里用最小假 AudioContext 实例化（仿 audio-mix.test.mjs）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { TOWERS } from '../public/js/shared/data.js';
import {
  IMPACT_LIMITS,
  IMPACT_SIGNATURES,
  ImpactMixer,
  pitchCentsFor,
  supportAuraPulse,
} from '../public/js/audio-impacts.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readSource = (relative) => readFileSync(join(root, relative), 'utf8');
const TOWER_KEYS = Object.keys(TOWERS).sort();

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    dump: () => Object.fromEntries(data),
  };
}

// ---------- 假 WebAudio：足以让 audio.js 建总线、跑命中声 ----------

class FakeParam {
  constructor(value) {
    this.value = value;
  }
  setValueAtTime(value) {
    this.value = value;
    return this;
  }
  setTargetAtTime(value) {
    this.value = value;
    return this;
  }
  exponentialRampToValueAtTime(value) {
    this.value = value;
    return this;
  }
  cancelScheduledValues() {
    return this;
  }
}

class FakeNode {
  constructor(ctx) {
    this.ctx = ctx;
    this.outputs = [];
  }
  connect(node) {
    this.outputs.push(node);
    return node;
  }
  disconnect() {
    this.outputs = [];
  }
}

class FakeGain extends FakeNode {
  constructor(ctx) {
    super(ctx);
    this.gain = new FakeParam(1);
  }
}

class FakeOscillator extends FakeNode {
  constructor(ctx) {
    super(ctx);
    this.type = 'sine';
    this.frequency = new FakeParam(440);
    this.detune = new FakeParam(0);
  }
  start() {}
  stop() {}
}

class FakeFilter extends FakeNode {
  constructor(ctx) {
    super(ctx);
    this.type = 'lowpass';
    this.frequency = new FakeParam(1200);
  }
}

class FakeBufferSource extends FakeNode {
  constructor(ctx) {
    super(ctx);
    this.buffer = null;
  }
  start() {}
  stop() {}
}

// 压缩/限幅节点：参数是 FakeParam，测试可直接读 value 断言区间。
class FakeCompressor extends FakeNode {
  constructor(ctx) {
    super(ctx);
    this.threshold = new FakeParam(0);
    this.knee = new FakeParam(0);
    this.ratio = new FakeParam(1);
    this.attack = new FakeParam(0);
    this.release = new FakeParam(0);
  }
}

class FakeContext {
  constructor({ compressor = true } = {}) {
    this.state = 'suspended';
    this.currentTime = 0;
    this.sampleRate = 8000;
    this.destination = new FakeNode(this);
    this.withCompressor = compressor;
    this.created = { gain: [], oscillator: [], filter: [], bufferSource: [], compressor: [] };
  }
  createGain() {
    const node = new FakeGain(this);
    this.created.gain.push(node);
    return node;
  }
  createOscillator() {
    const node = new FakeOscillator(this);
    this.created.oscillator.push(node);
    return node;
  }
  createBiquadFilter() {
    const node = new FakeFilter(this);
    this.created.filter.push(node);
    return node;
  }
  createBuffer(channels, frames) {
    return { getChannelData: () => new Float32Array(frames) };
  }
  createBufferSource() {
    const node = new FakeBufferSource(this);
    this.created.bufferSource.push(node);
    return node;
  }
  createDynamicsCompressor() {
    if (!this.withCompressor) return undefined;
    const node = new FakeCompressor(this);
    this.created.compressor.push(node);
    return node;
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  suspend() {
    this.state = 'suspended';
    return Promise.resolve();
  }
}

// audio.js 在模块加载时就实例化单例：先铺浏览器全局，再用查询串拿新实例。
async function freshAudio(storage, cacheKey, { compressor = true } = {}) {
  const contexts = [];
  class Context extends FakeContext {
    constructor() {
      super({ compressor });
      contexts.push(this);
    }
  }
  globalThis.localStorage = storage;
  globalThis.window = { AudioContext: Context };
  globalThis.document = {
    hidden: false,
    addEventListener() {},
    removeEventListener() {},
  };
  const url = new URL('../public/js/audio.js', import.meta.url);
  url.search = `?impacts=${cacheKey}`;
  return { audio: (await import(url.href)).audio, contexts };
}

// 与 shared/impact-events.js 同形状的命中事件。
let eventSeq = 1;
function impactEvent(overrides = {}) {
  return {
    t: 1,
    x: 0.5,
    y: 0.5,
    target: { id: eventSeq++, type: 'grunt' },
    weapon: 'arrow',
    source: 'tower',
    towerId: 1,
    amount: 10,
    armorAbsorbed: 0,
    shieldAbsorbed: 0,
    hpLost: 10,
    crit: false,
    lethal: false,
    ...overrides,
  };
}

// ---------- 签名表 ----------

test('签名表：8 种武器与 TOWERS 键集合一致，逐对可分辨且电平/时长有上限', () => {
  assert.equal(TOWER_KEYS.length, 8, 'TOWERS 应有八种武器');
  assert.deepEqual(Object.keys(IMPACT_SIGNATURES).sort(), TOWER_KEYS, '签名表必须覆盖全部武器（含战旗）');

  const WAVES = new Set(['square', 'sine', 'triangle', 'sawtooth']);
  for (const [weapon, signature] of Object.entries(IMPACT_SIGNATURES)) {
    assert.ok(WAVES.has(signature.type), `${weapon} 波形非法：${signature.type}`);
    assert.ok(signature.freq > 0, `${weapon} 缺少基频`);
    assert.ok(signature.gain > 0 && signature.gain <= 0.06, `${weapon} 主音增益应 ≤ 0.06`);
    assert.ok(signature.duration > 0 && signature.duration <= 0.3, `${weapon} 时长应 ≤ 0.3s`);
    if (signature.noise) {
      assert.ok(['lowpass', 'highpass', 'bandpass'].includes(signature.noise.filter), `${weapon} 噪声滤波类型非法`);
      assert.ok(signature.noise.gain > 0 && signature.noise.gain <= 0.06, `${weapon} 噪声增益应 ≤ 0.06`);
      assert.ok(signature.noise.cutoff > 0, `${weapon} 缺少噪声截止频率`);
    }
  }

  // 五维可分辨：波形 / 基频比 ≥1.2 / 噪声滤波类型 / 截止频率比 ≥1.4 / 时长比 ≥1.5，至少差 2 维。
  const keys = Object.keys(IMPACT_SIGNATURES);
  const ratio = (a, b) => Math.max(a, b) / Math.min(a, b);
  for (let i = 0; i < keys.length; i += 1) {
    for (let j = i + 1; j < keys.length; j += 1) {
      const left = IMPACT_SIGNATURES[keys[i]];
      const right = IMPACT_SIGNATURES[keys[j]];
      let dims = 0;
      if (left.type !== right.type) dims += 1;
      if (ratio(left.freq, right.freq) >= 1.2) dims += 1;
      const leftFilter = left.noise ? left.noise.filter : 'none';
      const rightFilter = right.noise ? right.noise.filter : 'none';
      if (leftFilter !== rightFilter) dims += 1;
      if (left.noise && right.noise && ratio(left.noise.cutoff, right.noise.cutoff) >= 1.4) dims += 1;
      if (ratio(left.duration, right.duration) >= 1.5) dims += 1;
      assert.ok(dims >= 2, `${keys[i]} vs ${keys[j]} 仅 ${dims} 维可分辨`);
    }
  }
});

// ---------- 限流 ----------

test('限流：120ms 窗口注入 200 条事件，发声数受窗口/单帧上限约束', () => {
  const voiceCalls = [];
  const mixer = new ImpactMixer({ voice: (signature, opts) => voiceCalls.push(opts) });
  const events = [];
  for (let i = 0; i < 200; i += 1) {
    events.push(impactEvent({ weapon: TOWER_KEYS[i % TOWER_KEYS.length], hpLost: (i % 5) + 1, t: i / 100 }));
  }
  const result = mixer.handle(events, 5000);

  assert.ok(result.played <= IMPACT_LIMITS.maxVoicesPerWindow, `窗口内发声 ${result.played} 超过上限`);
  assert.ok(result.played <= IMPACT_LIMITS.maxPerFrame, `单帧发声 ${result.played} 超过 maxPerFrame`);
  assert.equal(result.played, voiceCalls.length, '发声回调次数应与计划数一致');
  // 事件守恒：簇音覆盖的事件 + 被抑制的事件 = 全部注入事件。
  const voiced = result.plans.reduce((total, plan) => total + plan.cluster, 0);
  assert.equal(voiced + result.suppressed, 200, '发声与抑制的事件数应覆盖全部注入事件');
  assert.ok(result.suppressed > 0, '超额事件应被抑制并计数');
  // 全部计划落在同一个 120ms 窗口内，且窗口内不超过上限。
  const times = result.plans.map((plan) => plan.at);
  assert.ok(times.every((at) => at - 5000 < IMPACT_LIMITS.windowMs), '计划发声点应落在窗口内');
  assert.ok(times.length <= IMPACT_LIMITS.maxVoicesPerWindow);
});

test('限流：同武器 60ms 内重复被抑制，间隔足够后恢复', () => {
  const mixer = new ImpactMixer();
  assert.equal(mixer.handle([impactEvent({ weapon: 'arrow', t: 1 })], 100).played, 1);
  assert.equal(mixer.handle([impactEvent({ weapon: 'arrow', t: 1.02 })], 130).played, 0, '30ms 内应被抑制');
  assert.equal(mixer.handle([impactEvent({ weapon: 'arrow', t: 1.07 })], 170).played, 1, '70ms 后应恢复');
});

test('限流：单帧最多 maxPerFrame 声（不同武器同帧也受限）', () => {
  const mixer = new ImpactMixer();
  const batch = ['arrow', 'cannon', 'frost', 'arc', 'poison'].map((weapon, i) =>
    impactEvent({ weapon, hpLost: 5 + i, t: i })
  );
  const result = mixer.handle(batch, 1000);
  assert.equal(result.played, IMPACT_LIMITS.maxPerFrame);
  assert.equal(result.plans.length, IMPACT_LIMITS.maxPerFrame);
});

test('限流：超额时按 lethal > crit > 普通（同级 hpLost 降序）保留', () => {
  const mixer = new ImpactMixer();
  const events = [
    impactEvent({ weapon: 'arrow', hpLost: 9 }),
    impactEvent({ weapon: 'cannon', hpLost: 30 }),
    impactEvent({ weapon: 'frost', hpLost: 4, crit: true }),
    impactEvent({ weapon: 'arc', hpLost: 2, lethal: true }),
    impactEvent({ weapon: 'poison', hpLost: 12, lethal: true }),
  ];
  const result = mixer.handle(events, 2000);
  const plans = result.plans.map((plan) => plan.weapon);
  assert.deepEqual(plans, ['poison', 'arc', 'frost'], '保留集合应为两条致死 + 一条暴击');
  // 节点预算不足时只降级装饰层，不丢整声（暴击亮度层被摘掉，声音仍在）。
  assert.equal(result.plans[0].accent, false);
  assert.equal(result.plans[0].lethal, true);
  assert.equal(result.plans[2].accent, false, '第三个暴击声的亮度层应被预算降级');
});

test('簇音：同武器同窗口合并为一次，增益按命中数抬升并封顶', () => {
  const mixer = new ImpactMixer();
  const events = Array.from({ length: 5 }, (_, i) => impactEvent({ weapon: 'sniper', t: 1 + i * 0.001 }));
  const result = mixer.handle(events, 3000);
  assert.equal(result.played, 1, '五连击应合并为一簇音');
  assert.equal(result.plans[0].cluster, 5);
  const expected = 1 + IMPACT_LIMITS.clusterStep * (IMPACT_LIMITS.clusterCap - 1);
  assert.ok(Math.abs(result.plans[0].gainMul - expected) < 1e-9, `簇音增益应为 ${expected}`);
});

test('去重：同一事件对象重复喂入只发声一次；环形缓冲缩水后身份集合清空重来', () => {
  const mixer = new ImpactMixer();
  const arc = impactEvent({ weapon: 'arc' });
  const shock = impactEvent({ weapon: 'shock' });
  const frost = impactEvent({ weapon: 'frost' });
  assert.equal(mixer.handle([arc, shock, frost], 0).played, 3);
  assert.equal(mixer.handle([arc, shock, frost], 100).played, 0, '同一对象第二次不应发声');

  // 缓冲缩水（旧事件被裁）：身份集合清空，当前数组按新事件重新扫描。
  const shrunk = [frost, impactEvent({ weapon: 'sniper' })];
  assert.equal(mixer.handle(shrunk, 5000).played, 2, '缩水后当前数组应重新发声');
});

// ---------- 变调确定性 ----------

test('变调：同一事件两次相等且落在 ±jitterCents；不同目标至少 3 种取值', () => {
  const event = impactEvent({ weapon: 'arc', t: 12.5 });
  const first = pitchCentsFor(event);
  assert.equal(pitchCentsFor(event), first, '同一事件必须同音高');
  assert.ok(Math.abs(first) <= IMPACT_LIMITS.jitterCents, `音分 ${first} 越界`);

  const values = new Set();
  for (let id = 1; id <= 8; id += 1) {
    values.add(pitchCentsFor(impactEvent({ weapon: 'arc', t: 3, target: { id, type: 'grunt' } })));
  }
  assert.ok(values.size >= 3, `不同目标只产生 ${values.size} 种音分`);
});

// ---------- 压缩/限幅总线 ----------

test('压缩总线：impactGain → compressor → sfxGain，sfxGain 仍直连 master', async () => {
  const { audio } = await freshAudio(memoryStorage(), 'compressor');
  const ctx = audio.ensure();
  assert.ok(ctx, '应创建 AudioContext');
  assert.ok(audio.impactCompressor, '应创建压缩节点');
  assert.ok(audio.impactGain.outputs.includes(audio.impactCompressor), 'impactGain 应接压缩节点');
  assert.ok(audio.impactCompressor.outputs.includes(audio.sfxGain), '压缩节点应接 sfxGain');
  assert.ok(audio.sfxGain.outputs.includes(audio.masterGain), 'sfxGain 仍直连 masterGain');

  const { threshold, ratio, attack, release } = audio.impactCompressor;
  assert.ok(threshold.value >= -40 && threshold.value <= -6, `threshold ${threshold.value} 越界`);
  assert.ok(ratio.value >= 4, `ratio ${ratio.value} 过小`);
  assert.ok(attack.value > 0 && attack.value <= 0.01, `attack ${attack.value} 过慢`);
  assert.ok(release.value >= 0.1 && release.value <= 1, `release ${release.value} 越界`);

  // 播放一次命中：新建振荡器的输出链最终到达 impactGain（不是直连 sfxGain）。
  const before = ctx.created.oscillator.length;
  assert.equal(audio.impactVoice(IMPACT_SIGNATURES.arrow, {}), true);
  const osc = ctx.created.oscillator[before];
  assert.ok(osc, '未创建振荡器');
  const env = osc.outputs[0];
  assert.ok(env instanceof FakeGain, '振荡器应先接包络增益');
  assert.equal(env.outputs[0], audio.impactGain, '命中声必须走 impactGain');

  // 噪声层沿用签名的滤波类型（frost 用 highpass）。
  audio.impactVoice(IMPACT_SIGNATURES.frost, {});
  assert.ok(ctx.created.filter.some((filter) => filter.type === 'highpass'), '缺少 highpass 噪声层');
});

test('降级：无 createDynamicsCompressor 时 impactGain 直连 sfxGain 且不抛错', async () => {
  const { audio } = await freshAudio(memoryStorage(), 'nocompressor', { compressor: false });
  const ctx = audio.ensure();
  assert.ok(ctx);
  assert.equal(audio.impactCompressor, null, '不支持压缩时应为 null');
  assert.ok(audio.impactGain.outputs.includes(audio.sfxGain), '降级路径应直连 sfxGain');
  assert.doesNotThrow(() => audio.impactVoice(IMPACT_SIGNATURES.cannon, {}));
  assert.ok(ctx.created.oscillator.length > 0, '降级路径仍应发声');
});

// ---------- 战旗光环脉冲 ----------

test('战旗光环脉冲：0ms 发声、600ms 冷却、1300ms 再发声', () => {
  const sim = {
    phase: 'wave',
    towers: [
      { id: 1, type: 'banner', x: 1, y: 1, stats: { range: 3 } },
      { id: 2, type: 'arrow', x: 2, y: 1, stats: { range: 3 } },
    ],
  };
  const state = {};
  const first = supportAuraPulse(sim, 0, state);
  assert.ok(first, '0ms 应发声');
  assert.equal(first.weapon, 'banner');
  assert.equal(first.source, 'aura');
  assert.equal(supportAuraPulse(sim, 600, state), null, '1200ms 冷却内不应发声');
  assert.ok(supportAuraPulse(sim, 1300, state), '1300ms 应再次发声');
});

test('战旗光环脉冲：非战斗阶段或范围内无攻击塔时永不发声', () => {
  const towers = [
    { id: 1, type: 'banner', x: 1, y: 1, stats: { range: 2 } },
    { id: 2, type: 'arrow', x: 9, y: 9, stats: { range: 3 } },
  ];
  assert.equal(supportAuraPulse({ phase: 'prep', towers }, 0, {}), null, '非战斗阶段不发声');
  assert.equal(supportAuraPulse({ phase: 'wave', towers }, 0, {}), null, '范围外攻击塔不算覆盖');
  assert.equal(
    supportAuraPulse({ phase: 'wave', towers: [{ id: 1, type: 'banner', x: 1, y: 1, stats: { range: 5 } }] }, 0, {}),
    null,
    '没有攻击塔时战旗也不发声'
  );
});

test('followCombatImpacts：命中事件与光环脉冲共用同一混音器与声预算', async () => {
  const { audio } = await freshAudio(memoryStorage(), 'follow');
  audio.ensure();
  const sim = {
    phase: 'wave',
    towers: [
      { id: 1, type: 'banner', x: 1, y: 1, stats: { range: 3 } },
      { id: 2, type: 'arrow', x: 2, y: 1, stats: { range: 3 } },
    ],
    impactEvents: [impactEvent({ weapon: 'arrow', t: 1 })],
  };
  const first = audio.followCombatImpacts(sim, 0);
  assert.ok(first.played >= 1, '首个命中应发声');
  assert.ok(first.plans.some((plan) => plan.event.source === 'aura'), '同帧应包含光环脉冲');
  assert.equal(audio.followCombatImpacts(sim, 100).played, 0, '事件去重 + 光环冷却');
  const third = audio.followCombatImpacts(sim, 1300);
  assert.equal(third.played, 1, '冷却结束后只应有光环脉冲');
  assert.equal(third.plans[0].weapon, 'banner');
});

// ---------- 静音与模拟零接触 ----------

test('关闭音效：followCombatImpacts 返回 played 0 且不创建上下文/节点', async () => {
  const storage = memoryStorage({ 'abyss-tower.sound': 'off' });
  const { audio, contexts } = await freshAudio(storage, 'muted');
  const sim = {
    phase: 'wave',
    towers: [],
    impactEvents: [impactEvent({ weapon: 'arrow', t: 1 })],
  };
  const result = audio.followCombatImpacts(sim, 0);
  assert.equal(result.played, 0);
  assert.equal(result.suppressed, 0);
  assert.equal(audio.ctx, null, '静音时不应创建 AudioContext');
  assert.equal(contexts.length, 0, '静音时不应实例化上下文');
});

test('模拟零接触：audio-impacts 不 import 模拟层、不含 Math.random；game-app 已接线', () => {
  const src = readSource('public/js/audio-impacts.js');
  assert.equal(/from\s+['"][^'"]*sim(?:\.js)?['"]/.test(src), false, '不得 import 模拟层');
  assert.equal(src.includes('sim.js'), false, '文件内不得出现 sim.js 依赖');
  assert.equal(/Math\.random/.test(src), false, '表现层不得使用未播种随机');

  const gameApp = readSource('public/js/game-app.js');
  assert.match(gameApp, /audio\.followCombatImpacts\(sim,\s*performance\.now\(\)\)/, 'game-app 未接管命中音效');
});
