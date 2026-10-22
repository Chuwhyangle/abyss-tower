// 画质设置：默认低配、预设识别、损坏/不可写存储回退。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS,
  QUALITY_PRESETS,
  SETTINGS_KEY,
  normalizeSettings,
  detectPreset,
  presetSettings,
  loadSettings,
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

test('首次默认低配', () => {
  assert.deepEqual(DEFAULT_SETTINGS, QUALITY_PRESETS.low);
  assert.equal(DEFAULT_SETTINGS.fps, 30);
  assert.equal(DEFAULT_SETTINGS.dpr, 1);
  assert.equal(DEFAULT_SETTINGS.decorations, 'light');
  assert.equal(DEFAULT_SETTINGS.floaters, 'key');
  assert.equal(DEFAULT_SETTINGS.glow, false);
  assert.equal(DEFAULT_SETTINGS.shake, false);
});

test('非法值归一化与预设/自定义识别', () => {
  const normalized = normalizeSettings({
    fps: 45,
    dpr: 3,
    decorations: 'ultra',
    floaters: 'none',
    glow: 'yes',
    shake: 1,
    showFps: true,
  });
  assert.equal(normalized.fps, 30);
  assert.equal(normalized.dpr, 1);
  assert.equal(normalized.decorations, 'light');
  assert.equal(normalized.floaters, 'key');
  assert.equal(normalized.glow, false);
  assert.equal(normalized.shake, false);
  assert.equal(normalized.showFps, true);

  assert.equal(detectPreset(QUALITY_PRESETS.low), 'low');
  assert.equal(detectPreset(QUALITY_PRESETS.high), 'high');
  assert.equal(detectPreset({ ...QUALITY_PRESETS.high, showFps: true }), 'custom');
  assert.equal(presetSettings('missing').fps, 30);
});

test('保存/读取与损坏回退', () => {
  const storage = memoryStorage();
  const saved = saveSettings({ ...QUALITY_PRESETS.high, showFps: true }, storage);
  assert.equal(saved.fps, 60);
  assert.equal(saved.showFps, true);
  assert.ok(storage.dump()[SETTINGS_KEY]);
  assert.deepEqual(loadSettings(storage), saved);

  const corrupt = memoryStorage({ [SETTINGS_KEY]: '{not json' });
  assert.deepEqual(loadSettings(corrupt), DEFAULT_SETTINGS);

  const broken = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('quota');
    },
  };
  assert.deepEqual(loadSettings(broken), DEFAULT_SETTINGS);
  assert.equal(saveSettings(QUALITY_PRESETS.high, broken).fps, 60);
});
