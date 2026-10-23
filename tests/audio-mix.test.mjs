// 混音总线：master / sfx / music 三层增益、环境音、音量设置持久化。
// 音频层在 Node 里用最小的假 AudioContext 直接实例化，设置层用纯函数验证。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  normalizeSettings,
  normalizeVolume,
  loadSettings,
  saveSettings,
} from '../public/js/settings.js';

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

// ---------- 假 WebAudio：足以让 audio.js 建总线、跑调度 ----------

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

class FakeContext {
  constructor() {
    this.state = 'suspended';
    this.currentTime = 0;
    this.sampleRate = 8000;
    this.destination = new FakeNode(this);
    this.created = { gain: [], oscillator: [] };
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
    return new FakeFilter(this);
  }
  createBuffer(channels, frames) {
    return { getChannelData: () => new Float32Array(frames) };
  }
  createBufferSource() {
    return new FakeBufferSource(this);
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

// audio.js 在模块加载时就实例化单例，因此先铺好浏览器全局再动态导入。
function installBrowserGlobals(storage) {
  globalThis.localStorage = storage;
  globalThis.window = { AudioContext: FakeContext };
  globalThis.document = {
    hidden: false,
    addEventListener() {},
    removeEventListener() {},
  };
}

async function freshAudio(storage, cacheKey) {
  installBrowserGlobals(storage);
  const url = new URL('../public/js/audio.js', import.meta.url);
  url.search = `?mix=${cacheKey}`;
  return (await import(url.href)).audio;
}

// ---------- 源码级：三条总线与环境音 ----------

test('audio.js 建立 master / sfx / music 三条总线', () => {
  const src = readSource('public/js/audio.js');
  assert.match(src, /this\.masterGain\s*=\s*this\.ctx\.createGain\(\)/, '缺少 master 总线');
  assert.match(src, /this\.sfxGain\s*=\s*this\.ctx\.createGain\(\)/, '缺少 sfx 总线');
  assert.match(src, /this\.musicGain\s*=\s*this\.ctx\.createGain\(\)/, '缺少 music 总线');
  assert.match(src, /this\.masterGain\.connect\(this\.ctx\.destination\)/, 'master 未接到输出');
  assert.match(src, /this\.sfxGain\.connect\(this\.masterGain\)/, 'sfx 未接到 master');
  assert.match(src, /this\.musicGain\.connect\(this\.masterGain\)/, 'music 未接到 master');
  // 音效与环境音走 sfx 总线，音乐走 music 总线。
  assert.match(src, /osc\.connect\(env\)\.connect\(this\.sfxGain\)/, '音效未走 sfx 总线');
  assert.match(src, /source\.connect\(filter\)\.connect\(env\)\.connect\(this\.sfxGain\)/, '噪声未走 sfx 总线');
  assert.match(src, /osc\.connect\(env\)\.connect\(this\.musicGain\)/, '音乐未走 music 总线');
  assert.match(src, /this\.ambientGain\.connect\(this\.sfxGain\)/, '环境音未挂在 sfx 总线');
});

test('环境音随场景切换且电平低于音效', () => {
  const src = readSource('public/js/audio.js');
  assert.match(src, /AMBIENT_TRACKS/, '缺少环境音音色表');
  for (const mood of ['menu', 'battle', 'boss']) {
    assert.match(src, new RegExp(`\\b${mood}\\s*:\\s*\\{`), `环境音缺少 ${mood} 分支`);
  }
  const level = Number(src.match(/AMBIENT_VOLUME\s*=\s*([\d.]+)/)?.[1]);
  assert.ok(Number.isFinite(level) && level > 0, '缺少环境音音量常量');
  assert.ok(level < 0.05, '环境音电平应明显低于常规音效');
  assert.match(src, /startMusic\([^)]*\)\s*\{[\s\S]*?this\.startAmbient\(next\)/, 'startMusic 未联动环境音');
  assert.match(src, /startAmbient\s*\(/, '缺少 startAmbient');
  assert.match(src, /stopAmbient\s*\(/, '缺少 stopAmbient');
});

// ---------- 运行时：总线增益、音量调节、持久化 ----------

test('音量设置默认 80/50 并夹在 0–100', () => {
  assert.equal(DEFAULT_SETTINGS.sfxVolume, 80);
  assert.equal(DEFAULT_SETTINGS.musicVolume, 50);
  assert.equal(normalizeSettings({}).sfxVolume, 80);
  assert.equal(normalizeSettings({}).musicVolume, 50);
  assert.equal(normalizeSettings({ sfxVolume: 35, musicVolume: 0 }).sfxVolume, 35);
  assert.equal(normalizeSettings({ musicVolume: 0 }).musicVolume, 0);
  // 越界数字夹断，非数字回退默认值。
  assert.equal(normalizeVolume(150, 80), 100);
  assert.equal(normalizeVolume(-20, 80), 0);
  assert.equal(normalizeVolume('42', 80), 42);
  assert.equal(normalizeVolume('loud', 80), 80);
  assert.equal(normalizeVolume(Number.NaN, 50), 50);
  assert.equal(normalizeVolume(null, 80), 80);
  assert.equal(normalizeVolume(Infinity, 80), 80);
});

test('音量设置持久化，画质面板提交时不会重置音量', () => {
  const storage = memoryStorage();
  saveSettings({ ...DEFAULT_SETTINGS, sfxVolume: 30, musicVolume: 65 }, storage);
  assert.equal(loadSettings(storage).sfxVolume, 30);
  assert.equal(loadSettings(storage).musicVolume, 65);

  // ui.js 的画质面板只提交画质字段：音量沿用已存值。
  saveSettings({ fps: 60, dpr: 2, decorations: 'full', floaters: 'all', glow: true, shake: true, showFps: false, music: true }, storage);
  const after = loadSettings(storage);
  assert.equal(after.fps, 60);
  assert.equal(after.sfxVolume, 30, '应用画质预设不应重置音效音量');
  assert.equal(after.musicVolume, 65, '应用画质预设不应重置音乐音量');

  const corrupt = memoryStorage({ [SETTINGS_KEY]: '{not json' });
  assert.equal(loadSettings(corrupt).sfxVolume, 80);
  assert.equal(loadSettings(corrupt).musicVolume, 50);

  const broken = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('quota');
    },
  };
  assert.equal(loadSettings(broken).sfxVolume, 80);
  assert.doesNotThrow(() => saveSettings({ sfxVolume: 20 }, broken));
});

test('音频层实例化总线并按设置换算增益', async () => {
  const storage = memoryStorage({
    [SETTINGS_KEY]: JSON.stringify({ sfxVolume: 60, musicVolume: 40, music: true }),
  });
  const audio = await freshAudio(storage, 'buses');
  const ctx = audio.ensure();
  assert.ok(ctx instanceof FakeContext, '应创建 AudioContext');

  assert.equal(audio.masterGain.gain.value, 0.45, 'master 总线增益');
  assert.equal(audio.sfxGain.gain.value, 0.6, 'sfx 总线应等于 sfxVolume/100');
  assert.equal(audio.ambientGain.outputs[0], audio.sfxGain, '环境音应接在 sfx 总线');

  audio.startMusic('battle');
  await Promise.resolve();
  assert.equal(audio.ctx.state, 'running');
  assert.equal(audio.musicGain.gain.value, 0.1 * 0.4, 'music 总线按 musicVolume 缩放');

  assert.equal(audio.setSfxVolume(25), 25);
  assert.equal(audio.sfxGain.gain.value, 0.25);
  assert.equal(audio.setMusicVolume(90), 90);
  assert.equal(audio.musicGain.gain.value, 0.1 * 0.9);

  // 非法值保留当前值，不把音量打成 0。
  assert.equal(audio.setSfxVolume('nope'), 25);
  assert.equal(audio.sfxGain.gain.value, 0.25);

  audio.stopMusic();
  await Promise.resolve();
});

test('音量刷新后保持：新实例从存储读回', async () => {
  const storage = memoryStorage();
  const first = await freshAudio(storage, 'first');
  first.ensure();
  first.setSfxVolume(15);
  first.setMusicVolume(5);

  const saved = JSON.parse(storage.dump()[SETTINGS_KEY]);
  assert.equal(saved.sfxVolume, 15);
  assert.equal(saved.musicVolume, 5);
  assert.equal(saved.fps, DEFAULT_SETTINGS.fps, '不应丢失其他设置');

  const second = await freshAudio(storage, 'second');
  assert.equal(second.sfxVolume, 15, '刷新后音效音量应保持');
  assert.equal(second.musicVolume, 5, '刷新后音乐音量应保持');
  second.ensure();
  assert.equal(second.sfxGain.gain.value, 0.15);
});

test('页面隐藏时暂停音乐与环境音，恢复后续播', () => {
  const src = readSource('public/js/audio.js');
  const body = src.match(/handleVisibility\(\)\s*\{[\s\S]*?\n  \}/)?.[0] || '';
  assert.match(body, /document\.hidden/, '缺少后台判断');
  assert.match(body, /pauseMusicLoop\(\)/, '后台未暂停音乐');
  assert.match(body, /pauseAmbient\(\)/, '后台未暂停环境音');
  assert.match(body, /\.suspend\(\)/, '后台未挂起上下文');
  assert.match(body, /\.resume\(\)/, '恢复时未唤回上下文');
  assert.match(body, /maybeBeginMusic\(\)/, '恢复时未续播音乐');
  assert.match(body, /maybeBeginAmbient\(\)/, '恢复时未续播环境音');
});

test('首次用户手势前不调度音符', () => {
  const src = readSource('public/js/audio.js');
  assert.match(src, /state\s*!==\s*'running'/, '未等待音频上下文就绪');
  assert.match(src, /maybeBeginAmbient\(\)\s*\{[\s\S]*?state !== 'running'/, '环境音未等待首次手势');
});
