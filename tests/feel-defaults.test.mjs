// 首次进入的默认画质：桌面/强机解析高配，移动/弱机解析低配；30 FPS 只作显式选择。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_QUALITY_MODE,
  DEFAULT_SETTINGS,
  QUALITY_PRESETS,
  SETTINGS_KEY,
  autoQualityPreset,
  detectCapabilities,
  loadSettings,
  resolveAutoQuality,
  resolveDefaultSettings,
  saveSettings,
} from '../public/js/settings.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    dump: () => Object.fromEntries(data),
  };
}

// detectCapabilities 只读这几个信号；用能力集构造最小浏览器环境，测试不依赖真机。
function browserEnv(capabilities) {
  return {
    navigator: {
      userAgentData: { mobile: Boolean(capabilities.mobile) },
      maxTouchPoints: capabilities.maxTouchPoints ?? 0,
      hardwareConcurrency: capabilities.hardwareConcurrency ?? 8,
      deviceMemory: capabilities.deviceMemory ?? 8,
    },
    matchMedia: (query) => ({
      matches: query.includes('coarse') && Boolean(capabilities.coarsePointer),
    }),
    devicePixelRatio: 2,
  };
}

const DESKTOP = {
  mobile: false,
  coarsePointer: false,
  hardwareConcurrency: 8,
  deviceMemory: 8,
};
const MOBILE = {
  mobile: true,
  coarsePointer: true,
  maxTouchPoints: 5,
  hardwareConcurrency: 8,
  deviceMemory: 8,
};
const WEAK_CORES = {
  mobile: false,
  coarsePointer: false,
  hardwareConcurrency: 2,
  deviceMemory: 8,
};
const WEAK_MEMORY = {
  mobile: false,
  coarsePointer: false,
  hardwareConcurrency: 8,
  deviceMemory: 2,
};

function assertLowPreset(settings) {
  assert.equal(settings.fps, 30);
  assert.equal(settings.dpr, 1);
  assert.equal(settings.decorations, 'light');
  assert.equal(settings.floaters, 'key');
  assert.equal(settings.glow, false);
  assert.equal(settings.shake, false);
}

function assertHighPreset(settings) {
  assert.equal(settings.fps, 60);
  assert.equal(settings.dpr, 2);
  assert.equal(settings.decorations, 'full');
  assert.equal(settings.floaters, 'all');
  assert.equal(settings.glow, true);
  assert.equal(settings.shake, true);
}

test('能力信号：移动/粗指针/弱机判低配，桌面与无信号判高配', () => {
  const caps = detectCapabilities(browserEnv(MOBILE));
  assert.equal(caps.mobile, true);
  assert.equal(caps.coarsePointer, true);
  assert.equal(caps.maxTouchPoints, 5);

  assert.equal(resolveAutoQuality(DESKTOP), 'high');
  assert.equal(resolveAutoQuality(MOBILE), 'low');
  assert.equal(resolveAutoQuality({ ...MOBILE, mobile: false }), 'low', '粗指针单独也判低配');
  assert.equal(resolveAutoQuality(WEAK_CORES), 'low');
  assert.equal(resolveAutoQuality(WEAK_MEMORY), 'low');

  // Node 等无浏览器信号的环境：可预测的空能力集，按高配解析。
  const empty = detectCapabilities({});
  assert.deepEqual(
    {
      mobile: empty.mobile,
      coarsePointer: empty.coarsePointer,
      maxTouchPoints: empty.maxTouchPoints,
      hardwareConcurrency: empty.hardwareConcurrency,
      deviceMemory: empty.deviceMemory,
    },
    { mobile: false, coarsePointer: false, maxTouchPoints: 0, hardwareConcurrency: 0, deviceMemory: 0 }
  );
  assert.equal(resolveAutoQuality(empty), 'high');
  assert.equal(resolveAutoQuality({}), 'high');
});

test('桌面能力首入为高配：60fps / DPR2 / 光晕 / 震屏 / 全部飘字，不出现 30fps', () => {
  const settings = loadSettings(memoryStorage(), browserEnv(DESKTOP));
  assert.equal(settings.qualityMode, 'auto');
  assertHighPreset(settings);
  assert.notEqual(settings.fps, 30, '桌面首入不应是 30fps');
});

test('移动/弱机首入为低配：30fps / DPR1 / 无光晕 / 无震屏', () => {
  for (const caps of [MOBILE, WEAK_CORES, WEAK_MEMORY]) {
    const storage = memoryStorage();
    const settings = loadSettings(storage, browserEnv(caps));
    assert.equal(settings.qualityMode, 'auto', JSON.stringify(caps));
    assertLowPreset(settings);
  }
});

test('显式低配后重新加载仍为 30fps（不被自动解析覆盖）', () => {
  const storage = memoryStorage();
  saveSettings({ ...QUALITY_PRESETS.low, qualityMode: 'manual' }, storage);
  const reloaded = loadSettings(storage, browserEnv(DESKTOP));
  assert.equal(reloaded.qualityMode, 'manual');
  assertLowPreset(reloaded);

  // 只提交画质字段、不带 qualityMode 也算显式选择。
  const inferred = memoryStorage();
  saveSettings({ ...QUALITY_PRESETS.low }, inferred);
  const afterInfer = loadSettings(inferred, browserEnv(DESKTOP));
  assert.equal(afterInfer.qualityMode, 'manual');
  assert.equal(afterInfer.fps, 30);
});

test('损坏或不可写存储回退自动解析，而不是强制低配', () => {
  const corrupt = memoryStorage({ [SETTINGS_KEY]: '{not json' });
  assert.equal(loadSettings(corrupt, browserEnv(DESKTOP)).fps, 60);
  assert.equal(loadSettings(corrupt, browserEnv(DESKTOP)).qualityMode, 'auto');
  assert.equal(loadSettings(corrupt, browserEnv(MOBILE)).fps, 30);

  const blocked = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('quota');
    },
  };
  const fallback = loadSettings(blocked, browserEnv(DESKTOP));
  assert.equal(fallback.fps, 60);
  assert.equal(fallback.qualityMode, 'auto');
});

test('自动档只重算画质字段，音量/音乐/无障碍偏好保留', () => {
  const storage = memoryStorage({
    [SETTINGS_KEY]: JSON.stringify({
      ...QUALITY_PRESETS.low,
      qualityMode: 'auto',
      music: false,
      sfxVolume: 12,
      musicVolume: 34,
      colorBlind: 'tritanopia',
      highContrast: true,
    }),
  });
  const resolved = loadSettings(storage, browserEnv(DESKTOP));
  assertHighPreset(resolved);
  assert.equal(resolved.music, false);
  assert.equal(resolved.sfxVolume, 12);
  assert.equal(resolved.musicVolume, 34);
  assert.equal(resolved.colorBlind, 'tritanopia');
  assert.equal(resolved.highContrast, true);
});

test('默认档位常量与解析结果', () => {
  assert.equal(DEFAULT_QUALITY_MODE, 'auto');
  assert.equal(DEFAULT_SETTINGS.qualityMode, 'auto');
  assert.equal(resolveDefaultSettings(browserEnv(DESKTOP)).fps, 60);
  assert.equal(resolveDefaultSettings(browserEnv(MOBILE)).fps, 30);
  assert.equal(resolveDefaultSettings(browserEnv(DESKTOP)).qualityMode, 'auto');
  assert.equal(autoQualityPreset(browserEnv(DESKTOP)).fps, 60);
  assert.equal(autoQualityPreset(browserEnv(MOBILE)).fps, 30);
});
