// 无障碍配色：模式映射完整、稀有度/塔类型两两可区分、设置持久化，
// 以及"表现设置不改变战斗结果"的同种子回归。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COLOR_BLIND_MODES,
  DEFAULT_COLOR_BLIND_MODE,
  DEFAULT_SETTINGS,
  QUALITY_PRESETS,
  SETTINGS_KEY,
  applyAccessibilityTheme,
  loadSettings,
  normalizeSettings,
  saveSettings,
} from '../public/js/settings.js';
import {
  ACCESSIBILITY_MIN_DISTANCE,
  Palette,
  biomePalette,
} from '../public/js/render/palette.js';
import { ENEMIES, RARITY, TOWERS } from '../public/js/shared/data.js';
import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = fs.readFileSync(path.join(ROOT, 'public/styles.css'), 'utf8');
// UI 已拆分为门面 + 面板模块，源码级约束按整体读取。
const UI_SRC = [
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
  .map((relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8'))
  .join('\n');

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    dump: () => Object.fromEntries(data),
  };
}

function assertPairwiseDistinct(colors, label) {
  const entries = Object.entries(colors);
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [leftId, left] = entries[i];
      const [rightId, right] = entries[j];
      const distance = Palette.labDistance(left, right);
      assert.ok(
        distance >= ACCESSIBILITY_MIN_DISTANCE,
        `${label}: ${leftId}(${left}) 与 ${rightId}(${right}) 色差 ${distance.toFixed(1)} 低于 ${ACCESSIBILITY_MIN_DISTANCE}`
      );
    }
  }
}

test('色弱/高对比默认关闭，非法值回退默认', () => {
  assert.deepEqual(COLOR_BLIND_MODES, ['none', 'deuteranopia', 'protanopia', 'tritanopia']);
  assert.equal(DEFAULT_SETTINGS.colorBlind, DEFAULT_COLOR_BLIND_MODE);
  assert.equal(DEFAULT_SETTINGS.highContrast, false);
  assert.equal(QUALITY_PRESETS.low.colorBlind, 'none');
  assert.equal(QUALITY_PRESETS.high.colorBlind, 'none');

  const enabled = normalizeSettings({ colorBlind: 'tritanopia', highContrast: true });
  assert.equal(enabled.colorBlind, 'tritanopia');
  assert.equal(enabled.highContrast, true);

  const broken = normalizeSettings({ colorBlind: 'blind', highContrast: 'yes' });
  assert.equal(broken.colorBlind, 'none');
  assert.equal(broken.highContrast, false);
});

test('设置持久化：往返、损坏回退、应用画质不覆盖无障碍偏好', () => {
  const storage = memoryStorage();
  const saved = saveSettings(
    { ...QUALITY_PRESETS.high, colorBlind: 'deuteranopia', highContrast: true },
    storage
  );
  assert.equal(saved.colorBlind, 'deuteranopia');
  assert.equal(saved.highContrast, true);
  assert.ok(storage.dump()[SETTINGS_KEY]);
  assert.deepEqual(loadSettings(storage), saved);

  // 画质面板只提交画质字段，无障碍偏好沿用已存值。
  const afterPreset = saveSettings(
    { fps: 60, dpr: 2, decorations: 'full', floaters: 'all', glow: true, shake: true },
    storage
  );
  assert.equal(afterPreset.colorBlind, 'deuteranopia');
  assert.equal(afterPreset.highContrast, true);
  assert.equal(afterPreset.fps, 60);

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
});

test('每种色弱模式都覆盖全部稀有度、塔与敌人', () => {
  for (const mode of COLOR_BLIND_MODES) {
    const colors = Palette.colorsFor({ colorBlind: mode });
    assert.deepEqual(
      Object.keys(colors.rarity).sort(),
      Object.keys(RARITY).sort(),
      `${mode} 稀有度映射不完整`
    );
    assert.deepEqual(
      Object.keys(colors.towers).sort(),
      Object.keys(TOWERS).sort(),
      `${mode} 塔类型映射不完整`
    );
    assert.deepEqual(
      Object.keys(colors.enemies).sort(),
      Object.keys(ENEMIES).sort(),
      `${mode} 敌人映射不完整`
    );
    for (const [role, table] of Object.entries(colors)) {
      for (const [id, color] of Object.entries(table)) {
        assert.ok(Palette.lab(color), `${mode}.${role}.${id} 不是可解析颜色：${color}`);
      }
    }
  }
});

test('稀有度与塔类型在每种模式下两两可区分（CIE Lab）', () => {
  for (const mode of COLOR_BLIND_MODES) {
    for (const highContrast of [false, true]) {
      const colors = Palette.colorsFor({ colorBlind: mode, highContrast });
      assertPairwiseDistinct(colors.rarity, `${mode}/hc=${highContrast}/rarity`);
      assertPairwiseDistinct(colors.towers, `${mode}/hc=${highContrast}/towers`);
    }
  }
});

test('色弱模式保留明度差异，不只依赖色相', () => {
  for (const mode of COLOR_BLIND_MODES.filter((value) => value !== 'none')) {
    const lightness = Object.values(Palette.colorsFor({ colorBlind: mode }).towers)
      .map((color) => Palette.lab(color)[0]);
    const spread = Math.max(...lightness) - Math.min(...lightness);
    assert.ok(spread >= 40, `${mode} 塔类型明度跨度 ${spread.toFixed(1)} 过窄`);
  }
});

test('角色色解析：默认取原色，未知值安全回退', () => {
  assert.equal(Palette.towerColor('arrow'), TOWERS.arrow.color);
  assert.equal(Palette.enemyColor('boss'), ENEMIES.boss.color);
  assert.equal(Palette.rarityColor('epic'), RARITY.epic.color);
  assert.equal(Palette.towerColor('missing'), null);
  assert.equal(Palette.enemyColor('missing'), null);
  assert.equal(Palette.rarityColor('missing'), null);
  assert.equal(Palette.normalizeMode('nope'), 'none');
  assert.equal(Palette.normalizeMode({ colorBlind: 'protanopia' }), 'protanopia');
});

test('高对比预设提升路径与边缘的对比', () => {
  for (const archetype of ['canyon', 'twin', 'triple', 'ring', 'cross']) {
    const base = biomePalette({ archetype });
    const high = biomePalette({ archetype }, { highContrast: true });
    const baseDistance = Palette.labDistance(base.path, base.pathEdge);
    const highDistance = Palette.labDistance(high.path, high.pathEdge);
    assert.ok(
      highDistance > baseDistance,
      `${archetype} 高对比路径色差 ${highDistance.toFixed(1)} 未高于默认 ${baseDistance.toFixed(1)}`
    );
    assert.ok(
      Palette.contrastRatio(high.path, high.pathEdge) >
        Palette.contrastRatio(base.path, base.pathEdge)
    );
  }

  assert.match(CSS, /:root\[data-contrast="high"\]/, '缺少高对比度 CSS 预设');
  assert.match(CSS, /--line:\s*#b9ccd6/, '高对比度未提高边框对比');
  assert.match(CSS, /--text:\s*#ffffff/, '高对比度未提高文字对比');
  assert.match(CSS, /:root\[data-colorblind\]/, '缺少色弱模式的非颜色标识');
});

test('设置写入根元素属性，供 CSS 高对比规则使用', () => {
  const root = { dataset: {} };
  applyAccessibilityTheme({ colorBlind: 'protanopia', highContrast: true }, root);
  assert.equal(root.dataset.colorblind, 'protanopia');
  assert.equal(root.dataset.contrast, 'high');

  applyAccessibilityTheme({ colorBlind: 'none', highContrast: false }, root);
  assert.equal(root.dataset.colorblind, 'none');
  assert.equal(root.dataset.contrast, 'normal');

  assert.doesNotThrow(() => applyAccessibilityTheme({ highContrast: true }, null));
});

test('稀有度除颜色外仍有文字与图形标识', () => {
  for (const rarity of Object.values(RARITY)) {
    assert.ok(rarity.name && rarity.name.trim(), `${rarity.id} 缺少名称`);
  }
  // 抽卡/遗物面板都直接展示稀有度名称；色弱模式再叠加图形前缀。
  assert.match(UI_SRC, /<span class="rarity">\$\{rarity\.name\}/);
  assert.match(UI_SRC, /class="rarity-tag"[^>]*>\$\{rarity\.name\}/);
});

function stateHash(settings) {
  const seed = 'a11y-color-determinism';
  const map = generateMap(seed);
  const sim = new Simulation({
    map,
    seed,
    difficulty: 'standard',
    gold: 300,
    baseHp: 20,
    maxBaseHp: 20,
    relics: [],
    towers: [],
    unlockedTowers: ['arrow'],
    onSave: () => {},
    onToast: () => {},
  });
  sim.setVisualQuality({ effects: 'full', floaters: 'all' });
  const meta = map.meta || {};
  const def = generateWave(seed, 1, 'standard', {
    portalCount: meta.portalCount || 1,
    modifier: meta.modifier || null,
  });
  sim.beginWave(def);
  for (let i = 0; i < 600; i++) {
    // 每帧解析表现颜色，证明这条路径只读且不触碰模拟状态。
    biomePalette(map, settings);
    Palette.towerColor('arrow', settings);
    Palette.enemyColor('grunt', settings);
    sim.update(1 / 60);
    sim.updateVisuals(1 / 60);
  }
  return JSON.stringify({
    gold: Math.floor(sim.gold),
    baseHp: sim.baseHp,
    kills: sim.kills,
    phase: sim.phase,
    wave: sim.wave,
    enemies: sim.enemies.map((enemy) => [
      enemy.type,
      Math.round(enemy.hp * 1e6),
      enemy.x.toFixed(6),
      enemy.y.toFixed(6),
    ]),
  });
}

test('同种子战斗状态哈希不受色弱/高对比设置影响', () => {
  const baseline = stateHash({ colorBlind: 'none', highContrast: false });
  assert.equal(stateHash({ colorBlind: 'deuteranopia', highContrast: false }), baseline);
  assert.equal(stateHash({ colorBlind: 'protanopia', highContrast: true }), baseline);
  assert.equal(stateHash({ colorBlind: 'tritanopia', highContrast: true }), baseline);
  assert.equal(stateHash({ colorBlind: 'none', highContrast: true }), baseline);
});
