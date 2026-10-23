// 程序化背景音乐与音乐/音效独立开关。
// Node 没有 AudioContext，因此音频层只做源码级一致性检查；设置层可直接运行。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  normalizeSettings,
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

test('audio.js 提供音乐接口与 menu/battle/boss 三套氛围', () => {
  const src = readSource('public/js/audio.js');
  assert.match(src, /startMusic\s*\(/, '缺少 startMusic');
  assert.match(src, /stopMusic\s*\(/, '缺少 stopMusic');
  assert.match(src, /setMusicEnabled\s*\(/, '缺少 setMusicEnabled');
  for (const mood of ['menu', 'battle', 'boss']) {
    assert.match(src, new RegExp(`\\b${mood}\\s*:\\s*\\{`), `缺少 ${mood} 氛围分支`);
  }
  // 音乐使用独立 GainNode，默认音量低于音效主增益 0.45。
  assert.match(src, /musicGain/, '音乐应走独立增益节点');
  const volumeMatch = src.match(/MUSIC_VOLUME\s*=\s*([\d.]+)/);
  assert.ok(volumeMatch, '缺少音乐音量常量');
  assert.ok(Number(volumeMatch[1]) < 0.45, '音乐默认音量应低于音效');
});

test('音乐遵守自动播放限制并在后台暂停', () => {
  const src = readSource('public/js/audio.js');
  assert.match(src, /visibilitychange/, '缺少页面可见性监听');
  assert.match(src, /document\.hidden/, '缺少后台判断');
  assert.match(src, /state\s*!==\s*'running'/, '未等待音频上下文就绪（首次手势限制）');
  assert.match(src, /\.resume\(\)/, '缺少恢复播放');
  assert.match(src, /\.suspend\(\)/, '缺少后台暂停');
});

test('settings.js 持久化 music 开关并回退默认值', () => {
  assert.equal(DEFAULT_SETTINGS.music, true);
  assert.equal(normalizeSettings({}).music, true);
  assert.equal(normalizeSettings({ music: false }).music, false);
  assert.equal(normalizeSettings({ music: 'yes' }).music, true);

  const storage = memoryStorage();
  saveSettings({ ...DEFAULT_SETTINGS, music: false }, storage);
  assert.equal(JSON.parse(storage.dump()[SETTINGS_KEY]).music, false);
  assert.equal(loadSettings(storage).music, false);

  const corrupt = memoryStorage({ [SETTINGS_KEY]: '{not json' });
  assert.equal(loadSettings(corrupt).music, true);

  const broken = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('quota');
    },
  };
  assert.equal(loadSettings(broken).music, true);

  assert.match(readSource('public/js/settings.js'), /music/, 'settings.js 缺少 music 键');
});

test('ui.js 设置面板有独立的音乐与音效开关', () => {
  const src = readSource('public/js/ui.js');
  assert.match(src, /id="set-music"/, '设置面板缺少音乐开关');
  assert.match(src, /id="set-sound"/, '设置面板缺少音效开关');
  assert.match(src, /audio\.setMusicEnabled/, '音乐开关未驱动音频层');
  assert.match(src, /audio\.startMusic\(/, '未接入场景音乐');
  assert.match(src, /audio\.stopMusic\(/, '未在结算时停止音乐');
});
