// 首领变体 BGM：变体→曲目映射、66% / 33% 阶段强度层、总线电平约束与关闭音乐设置。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  BOSS_INTENSITY_LAYERS,
  BOSS_MUSIC_TRACKS,
  BOSS_PHASE_THRESHOLDS,
  CROSSFADE_SECONDS,
  MUSIC_VOLUME,
  bossLayer,
  bossLayerGain,
  bossMusicPhase,
  pickBossMusicTrack,
} from '../public/js/audio.js';
import { BOSS_VARIANT_ROTATION } from '../public/js/shared/data/enemies.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readSource = (relative) => readFileSync(join(root, relative), 'utf8');

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

// ---------- 假 WebAudio：记录振荡器数量与总线连接 ----------

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
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  suspend() {
    this.state = 'suspended';
    return Promise.resolve();
  }
}

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
  url.search = `?boss=${cacheKey}`;
  return (await import(url.href)).audio;
}

// ---------- 曲目与变体映射 ----------

test('三种首领变体都有专属曲目，映射集中且完整', () => {
  assert.deepEqual(Object.keys(BOSS_MUSIC_TRACKS).sort(), [...BOSS_VARIANT_ROTATION].sort());
  const ids = new Set();
  for (const variant of BOSS_VARIANT_ROTATION) {
    const track = BOSS_MUSIC_TRACKS[variant];
    assert.ok(track, `缺少变体 ${variant} 的曲目`);
    assert.equal(pickBossMusicTrack(variant), track, `${variant} 未走专属曲目`);
    assert.match(track.id, /^boss-/, `${variant} 曲目 id 不规范`);
    assert.ok(!ids.has(track.id), `曲目 id 重复：${track.id}`);
    ids.add(track.id);
    assert.ok(track.chordDur > 0, `${variant} 缺少和弦时长`);
    assert.ok(track.chords.length >= 2, `${variant} 和弦进行过短`);
    for (const chord of track.chords) {
      assert.ok(chord.length >= 3, `${variant} 和弦声部不足`);
      assert.ok(chord.every((freq) => Number.isFinite(freq) && freq > 0), `${variant} 和弦频率非法`);
    }
  }
  // 没有变体信息时回退到通用 boss 曲目，而不是抛错。
  assert.equal(pickBossMusicTrack('unknown'), null);
  assert.equal(pickBossMusicTrack(null), null);
});

test('曲目集中定义在 audio.js，不引入音频素材', () => {
  const src = readSource('public/js/audio.js');
  assert.match(src, /export const BOSS_MUSIC_TRACKS/);
  for (const variant of BOSS_VARIANT_ROTATION) {
    assert.match(src, new RegExp(`\\b${variant}\\s*:\\s*\\{`), `缺少 ${variant} 曲目骨架`);
  }
  assert.doesNotMatch(src, /\.(mp3|ogg|wav|m4a|flac)\b/i, '不应引用音频素材');
});

// ---------- 阶段阈值与强度层 ----------

test('阶段阈值与 sim 的 66% / 33% 阶段线一致', () => {
  assert.deepEqual([...BOSS_PHASE_THRESHOLDS], [0.66, 0.33]);
  assert.equal(bossMusicPhase(1), 1);
  assert.equal(bossMusicPhase(0.67), 1);
  assert.equal(bossMusicPhase(0.66), 2);
  assert.equal(bossMusicPhase(0.5), 2);
  assert.equal(bossMusicPhase(0.34), 2);
  assert.equal(bossMusicPhase(0.33), 3);
  assert.equal(bossMusicPhase(0.1), 3);
  assert.equal(bossMusicPhase(0), 3);
  // 非数值按满血处理，避免缺数据时直接跳到最高强度。
  assert.equal(bossMusicPhase(Number.NaN), 1);
  assert.equal(bossMusicPhase(undefined), 1);

  const sim = readSource('public/js/sim.js');
  assert.match(sim, /ratio <= 0\.66/, 'sim 阶段线变更后需要同步音频阈值');
  assert.match(sim, /ratio <= 0\.33/, 'sim 阶段线变更后需要同步音频阈值');
});

test('阶段强度层逐级增强且不超音乐总线', () => {
  const gains = [1, 2, 3].map((phase) => bossLayerGain(phase));
  assert.ok(gains[0] < gains[1], '第二阶段应强于第一阶段');
  assert.ok(gains[1] < gains[2], '第三阶段应强于第二阶段');

  for (const phase of [1, 2, 3]) {
    const layer = bossLayer(phase);
    assert.ok(bossLayerGain(phase) <= MUSIC_VOLUME, `第 ${phase} 阶段合成电平越过音乐总线`);
    for (const key of ['chord', 'bass', 'drum']) {
      assert.ok(layer[key] >= 0 && layer[key] <= MUSIC_VOLUME, `第 ${phase} 阶段 ${key} 电平非法`);
    }
  }
  assert.equal(BOSS_INTENSITY_LAYERS[1].drums, 0, '第一阶段不应有鼓点');
  assert.ok(BOSS_INTENSITY_LAYERS[3].drums > BOSS_INTENSITY_LAYERS[2].drums, '阶段越高鼓点越密');
  // 越界阶段回退到第一阶段，不产生 undefined 声部。
  assert.equal(bossLayer(99), BOSS_INTENSITY_LAYERS[1]);
});

// ---------- 运行时调度 ----------

test('首领阶段切换逐级增加鼓点，同一首曲目内不换总线', async () => {
  const audio = await freshAudio(memoryStorage(), 'layers');
  const ctx = audio.ensure();
  assert.ok(ctx instanceof FakeContext);

  audio.startMusic('boss');
  await Promise.resolve();
  audio.setBossContext('armored', 1);
  assert.ok(audio._crossfadeUntil > 0, '变体换曲应触发交叉淡化');
  const bus = audio.musicGain;
  audio.clearMusicTimer();

  const scheduledOscillators = (ratio) => {
    audio.setBossContext('armored', ratio);
    const before = ctx.created.oscillator.length;
    audio.scheduleMusicStep();
    audio.clearMusicTimer();
    return ctx.created.oscillator.length - before;
  };

  assert.equal(scheduledOscillators(1), 4, '第一阶段：三和弦 + 低音');
  assert.equal(scheduledOscillators(0.5), 5, '第二阶段：多一层鼓点');
  assert.equal(scheduledOscillators(0.2), 6, '第三阶段：两层鼓点');
  assert.equal(audio.musicGain, bus, '同一首曲目内的阶段变化不应切换总线');

  audio.stopMusic();
  await Promise.resolve();
});

test('变体切换走交叉淡化，避免硬切爆音', async () => {
  const audio = await freshAudio(memoryStorage(), 'crossfade');
  audio.ensure();
  audio.startMusic('boss');
  await Promise.resolve();

  const first = audio.musicGain;
  audio.setBossContext('armored', 1);
  const second = audio.musicGain;
  assert.notEqual(second, first, '换曲应把新音符写入备用总线');
  assert.ok(CROSSFADE_SECONDS > 0);
  assert.ok(audio._crossfadeUntil >= CROSSFADE_SECONDS, '旧总线应有淡出窗口');
  audio.clearMusicTimer();

  audio.stopMusic();
  await Promise.resolve();
});

test('关闭音乐（reduced）时首领强度层静音', async () => {
  const audio = await freshAudio(memoryStorage(), 'muted');
  audio.setMusicEnabled(false);
  const ctx = audio.ensure();
  assert.ok(ctx);

  audio.startMusic('boss');
  await Promise.resolve();
  audio.setBossContext('berserk', 0.2);
  const before = ctx.created.oscillator.length;
  audio.scheduleMusicStep();
  assert.equal(ctx.created.oscillator.length, before, '关闭音乐后不应再调度首领层');
  assert.equal(audio._musicTimer, null, '关闭音乐后不应留下调度计时器');

  audio.stopMusic();
});

// ---------- 接线与暂停 ----------

test('game-app 在首领波按变体与血量比例切换强度层', () => {
  const src = readSource('public/js/game-app.js');
  assert.match(src, /waveDef\.bossVariant/, '未读取首领变体');
  assert.match(src, /setBossContext\(variant, this\._bossHpRatio\)/, '未把变体/阶段传给音频层');
  assert.match(src, /enemy\.boss\s*&&\s*!enemy\.dead/, '未按存活首领计算血量比例');
});

test('页面隐藏时暂停首领音乐并挂起上下文', () => {
  const src = readSource('public/js/audio.js');
  const body = src.match(/handleVisibility\(\)\s*\{[\s\S]*?\n  \}/)?.[0] || '';
  assert.match(body, /document\.hidden/, '缺少后台判断');
  assert.match(body, /pauseMusicLoop\(\)/, '后台未暂停首领音乐');
  assert.match(body, /\.suspend\(\)/, '后台未挂起上下文');
});
