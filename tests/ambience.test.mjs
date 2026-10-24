// 环境音层（群系 / 天气联动）：独立总线、完整群系映射、隐藏暂停、低配关闭。
// 纯函数直接导入；总线行为在 Node 里用最小假 AudioContext 实例化验证。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  AMBIENCE_KINDS,
  AMBIENCE_PROFILES,
  AMBIENCE_VOLUME,
  AMBIENCE_WEATHER,
  AMBIENCE_ENABLED_KEY,
  MUSIC_VOLUME,
  ambienceFor,
} from '../public/js/audio.js';
import { BIOME_SCENES, WEATHER_IDS } from '../public/js/render/background-renderer.js';
import { DEFAULT_MUSIC_VOLUME } from '../public/js/settings.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readSource = (relative) => readFileSync(join(root, relative), 'utf8');

// ---------- 纯函数：群系 / 天气映射 ----------

test('六个群系全部有环境音映射，且覆盖风/低鸣/水滴三类音色', () => {
  const biomes = Object.keys(BIOME_SCENES);
  assert.deepEqual(Object.keys(AMBIENCE_PROFILES).sort(), biomes.sort(), '群系映射必须与背景场景一一对应');

  const kinds = new Set();
  for (const biome of biomes) {
    const spec = ambienceFor({ archetype: biome });
    assert.equal(spec.biome, biome);
    assert.ok(AMBIENCE_KINDS[spec.kind], `${biome} 的音色 ${spec.kind} 未定义`);
    assert.ok(spec.freqs.length >= 2, `${biome} 至少两个基频`);
    for (const freq of spec.freqs) {
      assert.ok(Number.isFinite(freq) && freq >= 20 && freq <= 4000, `${biome} 基频越界`);
    }
    assert.ok(spec.level > 0, `${biome} 电平必须为正`);
    kinds.add(spec.kind);
  }
  assert.deepEqual([...kinds].sort(), ['drone', 'water', 'wind'], '三类程序化音色都应被用到');
  assert.deepEqual(Object.keys(AMBIENCE_KINDS).sort(), ['drone', 'water', 'wind']);
});

test('天气覆盖音色，且只使用渲染层已有的天气 id', () => {
  assert.deepEqual(Object.keys(AMBIENCE_WEATHER).sort(), [...WEATHER_IDS].sort());
  const expected = { rain: 'water', fog: 'wind', meteor: 'drone' };
  for (const [weather, kind] of Object.entries(expected)) {
    const spec = ambienceFor({ archetype: 'canyon' }, weather);
    assert.equal(spec.weather, weather);
    assert.equal(spec.kind, kind, `${weather} 应覆盖为 ${kind}`);
    assert.equal(spec.biome, 'canyon', '天气不应改写群系');
  }
  // 未知天气忽略覆盖，保留群系音色。
  assert.equal(ambienceFor({ archetype: 'canyon' }, 'snow').kind, 'wind');
  assert.equal(ambienceFor({ archetype: 'canyon' }, 'snow').weather, null);
});

test('未知群系回退 canyon，空输入不抛错', () => {
  for (const meta of [null, undefined, {}, { archetype: 'unknown' }]) {
    const spec = ambienceFor(meta);
    assert.equal(spec.biome, 'canyon');
    assert.equal(spec.kind, 'wind');
  }
});

test('默认电平低于音乐，任一群系 × 天气组合也不越过音乐', () => {
  const musicalLevel = MUSIC_VOLUME * (DEFAULT_MUSIC_VOLUME / 100);
  assert.ok(AMBIENCE_VOLUME < musicalLevel, '环境音默认电平应低于音乐');
  for (const biome of Object.keys(AMBIENCE_PROFILES)) {
    for (const weather of [null, ...Object.keys(AMBIENCE_WEATHER)]) {
      const spec = ambienceFor({ archetype: biome }, weather);
      assert.ok(spec.level < musicalLevel, `${biome}/${weather} 电平越过了音乐`);
    }
  }
});

// ---------- 源码级：独立总线与低配开关 ----------

test('环境音层使用独立总线，不挂在 sfx / music 上', () => {
  const src = readSource('public/js/audio.js');
  assert.match(src, /this\.ambienceGain\s*=\s*this\.ctx\.createGain\(\)/, '缺少环境音总线');
  assert.match(src, /this\.ambienceGain\.connect\(this\.masterGain\)/, '环境音总线未接到 master');
  assert.doesNotMatch(
    src,
    /this\.ambienceGain\.connect\(this\.(?:sfx|music)Gain\)/,
    '环境音总线不得挂在 sfx/music 上'
  );
  assert.match(src, new RegExp(AMBIENCE_ENABLED_KEY.replace(/\./g, '\\.')), '缺少独立开关的存储键');
  assert.match(src, /setAmbienceEnabled\s*\(/, '缺少低配关闭入口');
  assert.match(src, /ambienceFor\(/, '缺少群系/天气映射入口');
});

test('环境音开关不改写 sfx / 音乐状态', () => {
  const src = readSource('public/js/audio.js');
  const body = src.match(/setAmbienceEnabled\(value\)\s*\{[\s\S]*?\n  \}/)?.[0] || '';
  assert.ok(body, '缺少 setAmbienceEnabled 实现');
  assert.doesNotMatch(body, /this\.enabled\s*=/, '环境音开关不得改写音效开关');
  assert.doesNotMatch(body, /this\.musicEnabled\s*=/, '环境音开关不得改写音乐开关');
  assert.doesNotMatch(body, /sfxGain|musicGain/, '环境音开关不得触碰 sfx/music 总线');
});

test('页面隐藏时暂停环境音层，恢复后续播', () => {
  const src = readSource('public/js/audio.js');
  const body = src.match(/handleVisibility\(\)\s*\{[\s\S]*?\n  \}/)?.[0] || '';
  assert.ok(body, '缺少 handleVisibility');
  assert.match(body, /pauseAmbience\(\)/, '后台未暂停环境音层');
  assert.match(body, /maybeBeginAmbience\(\)/, '恢复时未续播环境音层');
});

test('game-app 按 mapMeta（群系/天气）切换环境音', () => {
  const app = readSource('public/js/game-app.js');
  assert.match(app, /weatherFor\(/, '未复用渲染层的天气派生');
  assert.match(app, /sim\.mapMeta/, '未读取地图元数据');
  assert.match(app, /audio\.startAmbience\(/, '未启动环境音层');
  assert.match(app, /audio\.stopAmbience\(/, '离开对局未停止环境音层');
  assert.match(app, /setAmbienceEnabled\(/, '低画质未关闭环境音层');
});

// ---------- 运行时：用假 WebAudio 验证总线独立与低配关闭 ----------

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
    this.loop = false;
    this.started = 0;
  }
  start() {
    this.started += 1;
  }
  stop() {}
}

class FakeContext {
  constructor() {
    this.state = 'suspended';
    this.currentTime = 0;
    this.sampleRate = 8000;
    this.destination = new FakeNode(this);
  }
  createGain() {
    return new FakeGain(this);
  }
  createOscillator() {
    return new FakeOscillator(this);
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

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    dump: () => Object.fromEntries(data),
  };
}

function installBrowserGlobals() {
  globalThis.localStorage = memoryStorage();
  globalThis.window = { AudioContext: FakeContext };
  globalThis.document = {
    hidden: false,
    addEventListener() {},
    removeEventListener() {},
  };
}

async function freshAudio(storage, cacheKey) {
  globalThis.localStorage = storage;
  globalThis.window = { AudioContext: FakeContext };
  globalThis.document = {
    hidden: false,
    addEventListener() {},
    removeEventListener() {},
  };
  const url = new URL('../public/js/audio.js', import.meta.url);
  url.search = `?ambience=${cacheKey}`;
  return (await import(url.href)).audio;
}

test('运行时：环境音总线独立，关闭开关不影响 sfx / 音乐', async () => {
  installBrowserGlobals();
  const storage = memoryStorage();
  const audio = await freshAudio(storage, 'runtime');
  const ctx = audio.ensure();
  assert.ok(ctx instanceof FakeContext);

  assert.equal(audio.ambienceGain.outputs[0], audio.masterGain, '环境音应直连 master');
  assert.notEqual(audio.ambienceGain.outputs[0], audio.sfxGain);
  assert.notEqual(audio.ambienceGain.outputs[0], audio.musicGain);

  audio.setAmbienceEnabled(true);
  const spec = audio.startAmbience({ archetype: 'canyon' }, 'fog');
  await Promise.resolve();
  assert.equal(ctx.state, 'running');
  assert.ok(audio._ambienceNodes && audio._ambienceNodes.length > 0, '应构建环境音节点');
  assert.ok(Math.abs(audio.ambienceGain.gain.value - spec.level) < 1e-9, '总线应淡入到映射电平');

  const sfxBefore = audio.sfxGain.gain.value;
  const musicBefore = audio.musicGain.gain.value;
  const enabledBefore = audio.enabled;
  const musicEnabledBefore = audio.musicEnabled;

  assert.equal(audio.setAmbienceEnabled(false), false);
  assert.equal(audio.sfxGain.gain.value, sfxBefore, '关闭环境音不得改音效总线');
  assert.equal(audio.musicGain.gain.value, musicBefore, '关闭环境音不得改音乐总线');
  assert.equal(audio.enabled, enabledBefore, '关闭环境音不得改音效开关');
  assert.equal(audio.musicEnabled, musicEnabledBefore, '关闭环境音不得改音乐开关');
  assert.equal(audio._ambienceNodes, null, '关闭后应停止环境音节点');
  assert.ok(audio.ambienceGain.gain.value < 0.001, '关闭后环境音总线应淡出');
  assert.equal(storage.dump()[AMBIENCE_ENABLED_KEY], 'off', '低配关闭应持久化');

  // 新实例读回关闭状态。
  const reopened = await freshAudio(storage, 'runtime-reopen');
  assert.equal(reopened.ambienceEnabled, false);
});

test('运行时：页面隐藏暂停环境音节点，恢复后重新构建', async () => {
  const storage = memoryStorage();
  const audio = await freshAudio(storage, 'visibility');
  audio.setAmbienceEnabled(true);
  audio.startAmbience({ archetype: 'twin' }, 'rain');
  await Promise.resolve();
  assert.ok(audio._ambienceNodes, '应构建水滴环境音');

  globalThis.document.hidden = true;
  audio.handleVisibility();
  assert.equal(audio._ambienceNodes, null, '隐藏时应停止环境音节点');
  assert.ok(audio.ambienceGain.gain.value < 0.001, '隐藏时应淡出环境音总线');
  assert.equal(audio.ctx.state, 'suspended');

  globalThis.document.hidden = false;
  audio.handleVisibility();
  await Promise.resolve();
  assert.equal(audio.ctx.state, 'running');
  assert.ok(audio._ambienceNodes, '回到前台应重建环境音节点');

  audio.stopAmbience();
  assert.equal(audio._ambienceNodes, null);
  assert.equal(audio._ambienceTimer, null);
});
