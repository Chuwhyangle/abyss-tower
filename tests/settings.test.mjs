// 画质设置：默认自动档、预设识别、损坏/不可写存储回退自动解析。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_QUALITY_MODE,
  DEFAULT_SETTINGS,
  QUALITY_PRESETS,
  SETTINGS_KEY,
  normalizeSettings,
  detectPreset,
  presetSettings,
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

test('首次默认自动档，低配数值仍是逐字段归一化回退', () => {
  const { qualityMode, ...lowValues } = DEFAULT_SETTINGS;
  assert.equal(qualityMode, 'auto');
  assert.equal(DEFAULT_QUALITY_MODE, 'auto');
  // 逐字段归一化的回退仍是低配数值；「首次默认」由 loadSettings 的自动解析决定。
  assert.deepEqual(lowValues, QUALITY_PRESETS.low);
  assert.equal(resolveAutoQuality({}), 'high', '无能力信号时按高配解析');
  assert.equal(resolveAutoQuality({ mobile: true }), 'low');
  assert.equal(resolveAutoQuality({ coarsePointer: true }), 'low');
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
  assert.equal(saved.qualityMode, 'manual', '显式提交画质字段视为手动选择');
  assert.ok(storage.dump()[SETTINGS_KEY]);
  assert.deepEqual(loadSettings(storage), saved);

  // 损坏/不可写存储回退自动解析（不是固定低配）。
  const corrupt = memoryStorage({ [SETTINGS_KEY]: '{not json' });
  assert.deepEqual(loadSettings(corrupt), resolveDefaultSettings());

  const broken = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('quota');
    },
  };
  assert.deepEqual(loadSettings(broken), resolveDefaultSettings());
  assert.equal(saveSettings(QUALITY_PRESETS.high, broken).fps, 60);
});
