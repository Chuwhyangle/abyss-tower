// 结算音效与动效：胜败音效走 sfx 总线、尊重静音；减少动效时直接呈现；
// 音频异常不阻塞结算展示。音频层用最小假 WebAudio 直接实例化。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readSource = (relative) => readFileSync(join(root, relative), 'utf8');

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    dump: () => Object.fromEntries(data),
  };
}

// ---------- 假 WebAudio：足以让 audio.js 建总线并调度结算音效 ----------

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
  constructor() {
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
  constructor() {
    super();
    this.gain = new FakeParam(1);
  }
}

class FakeOscillator extends FakeNode {
  constructor() {
    super();
    this.type = 'sine';
    this.frequency = new FakeParam(440);
    this.detune = new FakeParam(0);
  }
  start() {}
  stop() {}
}

class FakeFilter extends FakeNode {
  constructor() {
    super();
    this.type = 'lowpass';
    this.frequency = new FakeParam(1200);
  }
}

class FakeBufferSource extends FakeNode {
  constructor() {
    super();
    this.buffer = null;
  }
  start() {}
  stop() {}
}

class FakeContext {
  constructor() {
    this.state = 'suspended';
    this.currentTime = 0;
    this.sampleRate = 8000;
    this.destination = new FakeNode();
    this.created = { gain: [], oscillator: [] };
  }
  createGain() {
    const node = new FakeGain();
    this.created.gain.push(node);
    return node;
  }
  createOscillator() {
    const node = new FakeOscillator();
    this.created.oscillator.push(node);
    return node;
  }
  createBiquadFilter() {
    return new FakeFilter();
  }
  createBuffer(channels, frames) {
    return { getChannelData: () => new Float32Array(frames) };
  }
  createBufferSource() {
    return new FakeBufferSource();
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

function installBrowserGlobals(storage, AudioContextClass = FakeContext) {
  globalThis.localStorage = storage;
  globalThis.window = { AudioContext: AudioContextClass };
  globalThis.document = {
    hidden: false,
    addEventListener() {},
    removeEventListener() {},
  };
}

async function freshAudio(storage, cacheKey) {
  installBrowserGlobals(storage);
  const url = new URL('../public/js/audio.js', import.meta.url);
  url.search = `?result-audio=${cacheKey}`;
  return (await import(url.href)).audio;
}

// ---------- 源码级：两个结算音效存在且为合成音效 ----------

test('audio.js 提供 resultVictory / resultDefeat 合成音效', () => {
  const src = readSource('public/js/audio.js');
  for (const name of ['resultVictory', 'resultDefeat']) {
    const body = src.match(new RegExp(`case '${name}':([\\s\\S]*?)break;`))?.[1] || '';
    assert.ok(body, `audio.js 缺少 ${name} case`);
    assert.match(body, /this\.tone\(/, `${name} 应由振荡器合成`);
  }
  // 无外部音频素材：音效层不允许加载音频文件。
  assert.doesNotMatch(src, /new Audio\(|fetch\([^)]*\.(mp3|wav|ogg|m4a)/i, '结算音效应为纯合成，不引入素材');
});

// ---------- 源码级：结算页触发音效并保持动效时长约束 ----------

test('结算页按胜败触发结果音效，失败时静默跳过', () => {
  const src = readSource('public/js/ui/result.js');
  assert.match(src, /audio\.play\(victory \? 'resultVictory' : 'resultDefeat'\)/, '结算音效未按胜败映射');
  const helper = src.match(/function playResultSound\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(helper, /try\s*\{[\s\S]*audio\.play/, '音效调用未包在 try 中');
  assert.match(helper, /catch\s*\{/, '音效失败缺少兜底');
  // 音效在弹窗渲染之后触发，失败也不影响结算内容出现。
  const callIndex = src.indexOf('playResultSound(victory);');
  const modalIndex = src.indexOf('this.openModal(');
  assert.ok(modalIndex > -1 && callIndex > modalIndex, '结算音效应在弹窗创建之后触发');
});

test('减少动效时分数直接落定，动效不超过 600ms', () => {
  const src = readSource('public/js/ui/result.js');
  const body = src.match(/_animateResultScore\(modal, target\)\s*\{[\s\S]*?\n  \}/)?.[0] || '';
  assert.match(body, /prefers-reduced-motion: reduce/, '缺少 prefers-reduced-motion 判断');
  assert.match(body, /node\.textContent = fmt\(target\)/, '减少动效时应直接显示终值');

  const duration = Number(src.match(/RESULT_SCORE_DURATION\s*=\s*(\d+)/)?.[1]);
  assert.ok(Number.isFinite(duration), '缺少分数滚动时长常量');
  assert.ok(duration > 0 && duration <= 600, '分数滚动时长应 ≤600ms');
});

test('结算动效在系统减少动效时关闭且不超过 600ms', () => {
  const css = readSource('public/styles.css');

  const fadeMs = Number(css.match(/animation:\s*result-fade\s+(\d+)ms/)?.[1]);
  assert.ok(Number.isFinite(fadeMs) && fadeMs <= 600, '结算入场动效应 ≤600ms');

  const recordBlock = css.match(/\.result-record\s*\{[^}]*\}/)?.[0] || '';
  assert.match(recordBlock, /animation:\s*result-record-highlight\s+(\d+)ms/, '新纪录高亮应有一次性的短动效');
  const recordMs = Number(recordBlock.match(/result-record-highlight\s+(\d+)ms/)?.[1]);
  assert.ok(Number.isFinite(recordMs) && recordMs <= 600, '新纪录高亮应 ≤600ms');
  assert.doesNotMatch(recordBlock, /infinite/, '新纪录高亮不应无限循环');

  // 轻微镜头推进：入场关键帧包含缩放。
  const fadeKeyframes = css.match(/@keyframes result-fade\s*\{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(fadeKeyframes, /scale\(/, '结算入场缺少轻微推进');

  const reduceBlock = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  for (const selector of ['.result-fade', '.result-record', '.result-hero', '.result-score']) {
    assert.ok(reduceBlock.includes(selector), `减少动效时应关闭 ${selector}`);
  }
});

// ---------- 运行时：静音不发声，开启时走 sfx 总线 ----------

const RESULT_STATS = {
  victory: true,
  wave: 10,
  clearedWave: 10,
  kills: 3,
  gold: 5,
  baseHp: 2,
  score: 1234,
};

// 结算页只依赖 openModal / hideBossBanner / toast / _animateResultScore。
function fakeUi(resultMethods) {
  const modal = {
    classList: { add() {} },
    querySelector() {
      return { onclick: null, click() {}, scrollIntoView() {}, textContent: '' };
    },
    isConnected: true,
  };
  return {
    profile: null,
    handlers: {},
    opened: false,
    hideBossBanner() {},
    toast() {},
    _animateResultScore: resultMethods._animateResultScore,
    openModal() {
      this.opened = true;
      return modal;
    },
  };
}

test('静音设置下结算音效不创建音频上下文', async () => {
  const muteStorage = memoryStorage({ 'abyss-tower.sound': 'off' });
  const muted = await freshAudio(muteStorage, 'muted');
  assert.equal(muted.enabled, false);
  muted.play('resultVictory');
  muted.play('resultDefeat');
  assert.equal(muted.ctx, null, '静音时不应创建 AudioContext');

  // 结算页入口同样尊重静音开关。
  const { audio } = await import('../public/js/audio.js');
  const { resultMethods } = await import('../public/js/ui/result.js');
  audio.enabled = false;
  audio.ctx = null;
  for (const victory of [true, false]) {
    const ui = fakeUi(resultMethods);
    resultMethods.showResult.call(ui, { stats: { ...RESULT_STATS, victory }, res: null, mode: 'normal', dailyLeft: null });
    assert.equal(ui.opened, true, '结算弹窗应照常打开');
  }
  assert.equal(audio.ctx, null, '静音时结算入口不应创建 AudioContext');
});

test('开启声音时结算音效经 sfx 总线合成', async () => {
  const loud = await freshAudio(memoryStorage(), 'loud');
  loud.play('resultVictory');
  assert.ok(loud.ctx instanceof FakeContext);
  assert.ok(loud.ctx.created.oscillator.length > 0, 'resultVictory 应调度振荡器');
  for (const osc of loud.ctx.created.oscillator) {
    assert.deepEqual(osc.outputs[0].outputs[0], loud.sfxGain, '结算音效应经过 sfx 总线');
  }

  loud.ctx.created.oscillator.length = 0;
  loud.play('resultDefeat');
  assert.ok(loud.ctx.created.oscillator.length > 0, 'resultDefeat 应调度振荡器');
});

// ---------- 运行时：音频异常不阻塞结算展示 ----------

test('音频上下文创建失败时结算页仍正常展示', async () => {
  const { audio } = await import('../public/js/audio.js');
  const { resultMethods } = await import('../public/js/ui/result.js');

  class BrokenContext {
    constructor() {
      throw new Error('audio unavailable');
    }
  }
  installBrowserGlobals(memoryStorage(), BrokenContext);
  audio.ctx = null;
  audio.enabled = true;

  for (const victory of [true, false]) {
    const ui = fakeUi(resultMethods);
    const stats = { ...RESULT_STATS, victory };
    assert.doesNotThrow(
      () => resultMethods.showResult.call(ui, { stats, res: null, mode: 'normal', dailyLeft: null }),
      '音效失败不应抛出'
    );
    assert.equal(ui.opened, true, '结算弹窗应照常打开');
  }
});
