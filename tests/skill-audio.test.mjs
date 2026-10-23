// 技能音效与场景化音乐：aurora / meteor / chrono 专属音效、menu/battle/boss 音乐切换。
// 音频层在 Node 里用最小的假 AudioContext 直接实例化，其余做源码级一致性检查。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SETTINGS_KEY } from '../public/js/settings.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(join(root, relative), 'utf8');

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

// ---------- 假 WebAudio：足够让 audio.js 建总线、发声 ----------

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
  url.search = `?skill=${cacheKey}`;
  return (await import(url.href)).audio;
}

function caseBlock(source, name) {
  const match = source.match(new RegExp(`case '${name}':([\\s\\S]*?)break;`));
  return match ? match[1] : '';
}

const SKILLS = ['aurora', 'meteor', 'chrono'];

// ---------- 源码级：技能音效 ----------

test('audio.js 为三种技能提供合成音效', () => {
  const src = read('public/js/audio.js');
  for (const id of SKILLS) {
    const block = caseBlock(src, `skill_${id}`);
    assert.ok(block, `缺少 ${id} 技能音效`);
    assert.match(block, /this\.(tone|noise)\(/, `${id} 音效未合成`);
    assert.doesNotMatch(block, /musicTone/, `${id} 音效不应走音乐层`);
  }
});

test('技能音效走 sfx 总线而非 music 总线', () => {
  const src = read('public/js/audio.js');
  // 音效合成器 tone / noise 的输出都接到 sfxGain。
  assert.match(src, /osc\.connect\(env\)\.connect\(this\.sfxGain\)/, '音效未走 sfx 总线');
  assert.match(src, /source\.connect\(filter\)\.connect\(env\)\.connect\(this\.sfxGain\)/, '噪声未走 sfx 总线');
});

// ---------- 源码级：音乐场景切换 ----------

test('startMusic 支持 menu / battle / boss 三套音轨', () => {
  const src = read('public/js/audio.js');
  assert.match(src, /startMusic\(mood = 'menu'\)/, '缺少 startMusic(mood)');
  for (const mood of ['menu', 'battle', 'boss']) {
    assert.match(src, new RegExp(`\\b${mood}\\s*:\\s*\\{`), `音乐缺少 ${mood} 分支`);
  }
  assert.match(src, /osc\.connect\(env\)\.connect\(this\.musicGain\)/, '音乐未走 music 总线');
});

test('音乐调用点覆盖大厅、战斗与首领波', () => {
  // UI 已拆分为门面 + 面板模块，按整体读取。
  const ui = [
    'public/js/ui.js',
    'public/js/ui/shared.js',
    'public/js/ui/title.js',
    'public/js/ui/hud.js',
    'public/js/ui/shop.js',
    'public/js/ui/modals.js',
    'public/js/ui/result.js',
    'public/js/ui/settings-panel.js',
    'public/js/ui/panels.js',
  ]
    .map(read)
    .join('\n');
  assert.match(ui, /audio\.startMusic\('menu'\)/, '大厅未使用 menu 音乐');

  const app = read('public/js/game-app.js');
  assert.match(app, /syncAudio\(\)\s*\{/, '缺少场景音频同步函数');
  assert.match(app, /sim\.phase === 'wave'/, '未按战斗阶段判定音乐');
  assert.match(app, /waveDef\.boss \|\| waveDef\.finalBoss/, '未识别首领波');
  assert.match(app, /'boss'\s*:\s*'battle'/, '首领波结束后未恢复战斗音乐');
  assert.match(app, /audio\.startMusic\(mood\)/, '未调用音乐切换');
  // 与 HUD 共用 0.1s 节流。
  assert.match(app, /this\._hudTimer >= 0\.1[\s\S]*?this\.syncAudio\(\)/, '音频未与 HUD 节流同处调用');
});

test('game-app 转发技能音效', () => {
  const app = read('public/js/game-app.js');
  assert.match(app, /sim\.skillCastCount/, '未监听技能释放次数');
  assert.match(app, /audio\.play\(`skill_\$\{sim\.skill\.id\}`\)/, '未播放技能音效');
});

test('音频完全合成，不引用素材或第三方依赖', () => {
  const src = read('public/js/audio.js');
  assert.doesNotMatch(src, /new Audio\(|\bfetch\(|\.mp3|\.ogg|\.wav|https?:\/\//, '音频层不应依赖素材或网络');
});

// ---------- 运行时：总线与开关 ----------

test('三种技能音效实际发声且全部落在 sfx 总线', async () => {
  const storage = memoryStorage({
    [SETTINGS_KEY]: JSON.stringify({ sfxVolume: 60, musicVolume: 40, music: true }),
  });
  const audio = await freshAudio(storage, 'bus');
  audio.ensure();
  const gainBase = audio.ctx.created.gain.length;
  const oscBase = audio.ctx.created.oscillator.length;

  for (const id of SKILLS) audio.play(`skill_${id}`);

  const gains = audio.ctx.created.gain.slice(gainBase);
  const oscs = audio.ctx.created.oscillator.slice(oscBase);
  assert.ok(oscs.length >= SKILLS.length, '三种技能音效都应创建振荡器');
  assert.ok(gains.length >= SKILLS.length, '三种技能音效都应创建包络');
  for (const env of gains) {
    assert.deepEqual(env.outputs, [audio.sfxGain], '技能音效包络应直连 sfx 总线');
  }
  assert.ok(!gains.some((gain) => gain.outputs.includes(audio.musicGain)), '技能音效不应串到 music 总线');
});

test('音乐在 menu / battle / boss 之间切换，波后可恢复', async () => {
  const audio = await freshAudio(memoryStorage(), 'moods');
  assert.equal(audio.mood, null);

  audio.startMusic('menu');
  assert.equal(audio.mood, 'menu');
  audio.startMusic('battle');
  assert.equal(audio.mood, 'battle');
  audio.startMusic('boss');
  assert.equal(audio.mood, 'boss', '首领波应切到 boss 音乐');
  audio.startMusic('battle');
  assert.equal(audio.mood, 'battle', '首领波结束应恢复 battle 音乐');

  audio.stopMusic();
  assert.equal(audio.mood, null);
});

test('音乐与音效开关互相独立', async () => {
  const audio = await freshAudio(memoryStorage(), 'switches');
  audio.ensure();

  // 关掉音效：技能音效不再发声，但音乐仍能切换。
  audio.setEnabled(false);
  const silentBase = audio.ctx.created.oscillator.length;
  audio.play('skill_chrono');
  assert.equal(audio.ctx.created.oscillator.length, silentBase, '音效关闭后不应发声');
  audio.startMusic('boss');
  assert.equal(audio.mood, 'boss', '音效关闭不应阻止音乐切换');
  assert.equal(audio.musicEnabled, true);

  // 关掉音乐：音乐不再调度，但音效仍能发声。
  audio.setEnabled(true);
  audio.setMusicEnabled(false);
  audio.startMusic('menu');
  const sfxBase = audio.ctx.created.oscillator.length;
  audio.play('skill_chrono');
  assert.ok(audio.ctx.created.oscillator.length > sfxBase, '音乐关闭不应阻止音效');
  assert.equal(audio.musicEnabled, false);
});

test('首次手势前不调度音乐，页面隐藏时暂停', async () => {
  const audio = await freshAudio(memoryStorage(), 'gesture');
  audio.startMusic('battle');

  // 模拟浏览器首次手势前：上下文处于 suspended，只排队不调度。
  audio.pauseMusicLoop();
  audio.ctx.state = 'suspended';
  audio.maybeBeginMusic();
  assert.equal(audio._musicTimer, null, '首次手势前不应调度音乐');

  // 手势后开始调度；页面隐藏时暂停并挂起上下文。
  audio.ctx.state = 'running';
  audio.maybeBeginMusic();
  globalThis.document.hidden = true;
  audio.handleVisibility();
  assert.equal(audio._musicTimer, null, '页面隐藏后应停止音乐调度');
  assert.equal(audio.ctx.state, 'suspended', '页面隐藏应挂起上下文');

  globalThis.document.hidden = false;
  audio.stopMusic();
});
