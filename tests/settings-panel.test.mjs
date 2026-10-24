// 设置页分区：四个分区完整、逐项重置回默认、损坏值回退、语言切换即时生效。
import test from 'node:test';
import assert from 'node:assert/strict';
import { settingsPanelMethods } from '../public/js/ui/settings-panel.js';
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  loadSettings,
  normalizeSettings,
  saveSettings,
} from '../public/js/settings.js';
import { getLocale, setLocale } from '../public/js/i18n.js';
import { audio } from '../public/js/audio.js';

const SECTION_ITEMS = {
  display: ['fps', 'dpr', 'decorations', 'floaters', 'glow', 'shake', 'showFps'],
  audio: ['music', 'sound', 'sfxVolume', 'musicVolume'],
  accessibility: ['colorBlind', 'highContrast'],
  account: ['language', 'notifications', 'account'],
};
const STATIC_ITEMS = new Set(['notifications', 'account']);

function selectValue(html, id) {
  const block = new RegExp(`<select[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</select>`).exec(html);
  const body = block ? block[1] : '';
  const selected = /<option value="([^"]*)"\s+selected>/.exec(body);
  if (selected) return selected[1];
  const first = /<option value="([^"]*)"/.exec(body);
  return first ? first[1] : '';
}

// 最小 DOM 桩：只覆盖设置面板用到的查询与控件读写。
function makeModal(html) {
  const elements = new Map();
  const outputs = new Map();
  const resets = [];
  for (const match of html.matchAll(/<([a-zA-Z]+)\b([^>]*)>/g)) {
    const tag = match[1].toLowerCase();
    const attrs = match[2];
    const idMatch = /\bid="([^"]+)"/.exec(attrs);
    if (idMatch) {
      const id = idMatch[1];
      const element = {
        tag,
        id,
        textContent: '',
        value: '',
        checked: false,
        listeners: {},
        addEventListener(type, fn) {
          this.listeners[type] = fn;
        },
      };
      if (tag === 'input') {
        const type = /\btype="([^"]+)"/.exec(attrs);
        element.type = type ? type[1] : 'text';
        const value = /\bvalue="([^"]*)"/.exec(attrs);
        element.value = value ? value[1] : '';
        element.checked = /\bchecked\b/.test(attrs);
      } else if (tag === 'select') {
        element.value = selectValue(html, id);
      }
      elements.set(id, element);
    }
    const output = /\bdata-output="([^"]+)"/.exec(attrs);
    if (output) outputs.set(output[1], { textContent: '' });
    const reset = /\bdata-reset="([^"]+)"/.exec(attrs);
    if (reset) resets.push({ dataset: { reset: reset[1] }, onclick: null });
  }
  return {
    elements,
    resets,
    modal: {
      querySelector(selector) {
        if (selector.startsWith('#')) return elements.get(selector.slice(1)) || null;
        const output = /\[data-output="([^"]+)"\]/.exec(selector);
        if (output) return outputs.get(output[1]) || null;
        return null;
      },
      querySelectorAll(selector) {
        const all = [...elements.values()];
        if (selector === 'select, input') {
          return all.filter((element) => element.tag === 'select' || element.tag === 'input');
        }
        if (selector === 'input[type="range"]') {
          return all.filter((element) => element.tag === 'input' && element.type === 'range');
        }
        if (selector === '[data-reset]') return resets;
        return [];
      },
    },
  };
}

function openPanel(settings) {
  const captured = {
    html: '',
    dom: null,
    closed: false,
    applied: [],
    profile: { name: '测试玩家', username: 'tester' },
  };
  const host = {
    profile: captured.profile,
    openModal(html) {
      captured.html = html;
      captured.dom = makeModal(html);
      return captured.dom.modal;
    },
    closeModal() {
      captured.closed = true;
    },
    updateSoundIcon() {},
    showSettings(options) {
      return settingsPanelMethods.showSettings.call(this, options);
    },
  };
  settingsPanelMethods.showSettings.call(host, {
    settings,
    inGame: false,
    onApply: (next) => captured.applied.push(next),
  });
  return captured;
}

function control(panel, id) {
  return panel.dom.elements.get(id);
}

test('设置项按画面/音频/辅助/账号分区，每项带说明与重置', () => {
  const panel = openPanel(DEFAULT_SETTINGS);
  let previous = -1;
  for (const section of Object.keys(SECTION_ITEMS)) {
    const index = panel.html.indexOf(`data-section="${section}"`);
    assert.ok(index > previous, `缺少分区或顺序错误：${section}`);
    previous = index;
  }

  const rows = Object.values(SECTION_ITEMS).flat();
  assert.equal(
    [...panel.html.matchAll(/data-setting="/g)].length,
    rows.length,
    '设置项数量与分区定义不一致'
  );
  assert.equal(
    [...panel.html.matchAll(/class="setting-desc"/g)].length,
    rows.length,
    '每项设置都必须带说明'
  );
  for (const section of Object.keys(SECTION_ITEMS)) {
    for (const key of SECTION_ITEMS[section]) {
      assert.ok(panel.html.includes(`data-setting="${key}"`), `${section} 缺少设置项 ${key}`);
      if (STATIC_ITEMS.has(key)) {
        assert.ok(!panel.html.includes(`data-reset="${key}"`), `只读项 ${key} 不应可重置`);
      } else {
        assert.ok(panel.html.includes(`data-reset="${key}"`), `${section}.${key} 缺少重置按钮`);
      }
    }
  }
  assert.match(panel.html, /测试玩家 · @tester/, '账号分区未展示当前账号');
});

test('逐项重置回默认，全部重置与应用都不触碰账号数据', () => {
  audio.setEnabled(false);
  const panel = openPanel({
    ...DEFAULT_SETTINGS,
    fps: 60,
    dpr: 2,
    decorations: 'full',
    floaters: 'all',
    glow: true,
    shake: true,
    showFps: true,
    music: false,
    sfxVolume: 20,
    musicVolume: 30,
    colorBlind: 'protanopia',
    highContrast: true,
  });
  assert.equal(control(panel, 'set-fps').value, '60');
  assert.equal(control(panel, 'set-colorblind').value, 'protanopia');
  assert.equal(control(panel, 'set-sound').checked, false);

  const reset = (key) => panel.dom.resets.find((button) => button.dataset.reset === key).onclick();
  reset('fps');
  reset('glow');
  reset('music');
  reset('sfxVolume');
  reset('colorBlind');
  reset('highContrast');
  reset('sound');
  assert.equal(control(panel, 'set-fps').value, '30');
  assert.equal(control(panel, 'set-glow').checked, false);
  assert.equal(control(panel, 'set-music').checked, true);
  assert.equal(control(panel, 'set-sfx-volume').value, '80');
  assert.equal(control(panel, 'set-colorblind').value, 'none');
  assert.equal(control(panel, 'set-contrast').checked, false);
  assert.equal(control(panel, 'set-sound').checked, true);

  control(panel, 'settings-reset-all').onclick();
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    const input = panel.dom.elements.get(
      {
        fps: 'set-fps',
        dpr: 'set-dpr',
        decorations: 'set-decorations',
        floaters: 'set-floaters',
        glow: 'set-glow',
        shake: 'set-shake',
        showFps: 'set-showfps',
        music: 'set-music',
        sfxVolume: 'set-sfx-volume',
        musicVolume: 'set-music-volume',
        colorBlind: 'set-colorblind',
        highContrast: 'set-contrast',
      }[key]
    );
    assert.equal(
      typeof value === 'boolean' ? input.checked : input.value,
      typeof value === 'boolean' ? value : String(value),
      `全部重置后 ${key} 未回到默认值`
    );
  }
  assert.equal(control(panel, 'set-locale').value, 'zh-CN');

  const profileBefore = JSON.stringify(panel.profile);
  control(panel, 'settings-apply').onclick();
  assert.equal(panel.closed, true);
  assert.equal(panel.applied.length, 1);
  const applied = panel.applied[0];
  assert.deepEqual(applied, normalizeSettings(DEFAULT_SETTINGS));
  assert.deepEqual(Object.keys(applied).sort(), Object.keys(DEFAULT_SETTINGS).sort());
  assert.equal('profile' in applied, false, '设置结果不得携带账号数据');
  assert.equal('username' in applied, false, '设置结果不得携带账号数据');
  assert.equal(JSON.stringify(panel.profile), profileBefore, '重置/应用不得改动账号数据');

  audio.setEnabled(true);
  audio.setMusicEnabled(true);
});

test('损坏设置渲染回退默认值，音量夹到 0–100', () => {
  const panel = openPanel({
    fps: 999,
    dpr: 3,
    decorations: 'bogus',
    floaters: 'none',
    glow: 'yes',
    shake: 1,
    showFps: 'yes',
    music: 'loud',
    sfxVolume: 'abc',
    musicVolume: -5,
    colorBlind: 'blind',
    highContrast: 'yes',
  });
  assert.equal(control(panel, 'set-fps').value, '30');
  assert.equal(control(panel, 'set-dpr').value, '1');
  assert.equal(control(panel, 'set-decorations').value, 'light');
  assert.equal(control(panel, 'set-floaters').value, 'key');
  assert.equal(control(panel, 'set-glow').checked, false);
  assert.equal(control(panel, 'set-shake').checked, false);
  assert.equal(control(panel, 'set-showfps').checked, false);
  assert.equal(control(panel, 'set-music').checked, true);
  assert.equal(control(panel, 'set-sfx-volume').value, '80');
  assert.equal(control(panel, 'set-music-volume').value, '0');
  assert.equal(control(panel, 'set-colorblind').value, 'none');
  assert.equal(control(panel, 'set-contrast').checked, false);

  const empty = openPanel(null);
  assert.equal(control(empty, 'set-fps').value, '30');
  assert.equal(control(empty, 'set-colorblind').value, 'none');
});

test('语言切换即时生效，分区标题与说明同步翻译', () => {
  try {
    setLocale('zh-CN', { silent: true });
    const panel = openPanel(DEFAULT_SETTINGS);
    assert.match(panel.html, /画面/);
    assert.match(panel.html, /目标帧率/);
    assert.match(panel.html, /通知偏好/);

    const locale = control(panel, 'set-locale');
    locale.value = 'en-US';
    locale.listeners.change({ target: { value: 'en-US' } });
    assert.equal(getLocale(), 'en-US');
    assert.match(panel.html, /Display/);
    assert.match(panel.html, /Audio/);
    assert.match(panel.html, /Accessibility/);
    assert.match(panel.html, /Account/);
    assert.match(panel.html, /Target FPS/);
    assert.match(panel.html, /Notification preferences/);
    assert.doesNotMatch(panel.html, /目标帧率/);
  } finally {
    setLocale('zh-CN', { silent: true });
  }
});

test('应用结果可持久化往返，画质字段之外保留原有值', () => {
  const data = new Map();
  const storage = {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  };
  const panel = openPanel({
    ...DEFAULT_SETTINGS,
    sfxVolume: 35,
    musicVolume: 65,
    colorBlind: 'deuteranopia',
    highContrast: true,
  });
  control(panel, 'settings-apply').onclick();
  const saved = saveSettings(panel.applied[0], storage);
  assert.equal(saved.sfxVolume, 35);
  assert.equal(saved.musicVolume, 65);
  assert.equal(saved.colorBlind, 'deuteranopia');
  assert.equal(saved.highContrast, true);
  assert.ok(storage.getItem(SETTINGS_KEY));
  assert.deepEqual(loadSettings(storage), saved);
  audio.setEnabled(true);
  audio.setMusicEnabled(true);
});
