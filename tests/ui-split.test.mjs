// UI 拆分（v1.20 重构）：
// 1) 门面 ui.js 保留拆分前全部公共方法，仍是同一个 UI 单例；
// 2) 每个 ui/ 模块职责单一，导出面固定；
// 3) 门面 < 300 行、子模块 < 400 行，模块间无循环依赖。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const lineCount = (relative) => read(relative).trimEnd().split('\n').length;

const FACADE = 'public/js/ui.js';
const UI_DIR = 'public/js/ui';

// 拆分前 UI 类的公共方法清单（回归基线，新增方法须同步此表）。
const FACADE_METHODS = [
  'init',
  'buildWeeklyEntry',
  'buildMutationEntry',
  'showWeeklySelect',
  'showTitle',
  'renderTitle',
  'refreshLocale',
  'showGame',
  'skillEntries',
  'resolveSelectedSkill',
  'renderTitleSkills',
  'updateSkillSelection',
  'skillBarHtml',
  'bindSkillChips',
  'showDifficultySelect',
  'showMutationSelect',
  'buildPortalHint',
  'bindClickSound',
  'bindTooltips',
  'moveTooltip',
  'updateSoundIcon',
  'setResumeAvailable',
  'playViewEnter',
  'showBossBanner',
  'hideBossBanner',
  'updateHud',
  'updateSkillButton',
  'updatePortalHint',
  'updateNextWave',
  'renderShop',
  'updateShopState',
  'renderRelics',
  'showTowerPanel',
  'updateTowerPanelState',
  'hideTowerPanel',
  'showEvolutionModal',
  'openModal',
  'closeModal',
  'closeModalIfClosable',
  'hasModal',
  'showDraft',
  'showMapSelect',
  'showEventModal',
  'showConfirm',
  'promptName',
  'toast',
  'showResult',
  '_animateResultScore',
  'showSettings',
  'showLeaderboard',
  'showUnlocks',
  'showRelicsModal',
  'showHelp',
];

// 每个面板模块只导出一个方法集合，避免面板之间互相耦合。
const METHOD_MODULES = {
  'title.js': 'titleMethods',
  'hud.js': 'hudMethods',
  'shop.js': 'shopMethods',
  'modals.js': 'modalMethods',
  'result.js': 'resultMethods',
  'settings-panel.js': 'settingsPanelMethods',
  'panels.js': 'panelMethods',
};

const SHARED_EXPORTS = [
  '$',
  'hydrateIcons',
  'fmt',
  'towerName',
  'enemyName',
  'diffName',
  'diffDesc',
  'modifierName',
  'modifierDesc',
  'ROMAN',
  'ROLE_LABELS',
  'EVOLUTION_LABELS',
  'evolutionEffectText',
  'CHOICE_LABELS',
  'choiceLabel',
  'skillName',
  'skillDesc',
  'skillRole',
  'skillUnlock',
  'skillSummary',
  'mapPreviewSvg',
  'escapeHtml',
];

test('门面保留拆分前的全部公共方法，且仍是同一个 UI 单例', async () => {
  const facade = await import('../public/js/ui.js');
  assert.deepEqual(Object.keys(facade), ['ui'], 'ui.js 只应导出 UI 单例');
  const { ui } = facade;
  for (const name of FACADE_METHODS) {
    assert.equal(typeof ui[name], 'function', `UI 缺少方法 ${name}`);
  }
});

test('门面低于 300 行，子模块低于 400 行', () => {
  assert.ok(lineCount(FACADE) < 300, `ui.js 为 ${lineCount(FACADE)} 行，超过 300 行上限`);
  for (const file of [...Object.keys(METHOD_MODULES), 'shared.js']) {
    const relative = `${UI_DIR}/${file}`;
    assert.ok(
      lineCount(relative) < 400,
      `${relative} 为 ${lineCount(relative)} 行，超过 400 行上限`
    );
  }
});

test('每个面板模块只导出单一方法集合', async () => {
  for (const [file, exportName] of Object.entries(METHOD_MODULES)) {
    const module = await import(`../${UI_DIR}/${file}`);
    assert.deepEqual(Object.keys(module), [exportName], `${file} 导出面应为 ${exportName}`);
    const methods = module[exportName];
    assert.ok(methods && typeof methods === 'object', `${file} 的 ${exportName} 不是对象`);
    for (const [name, fn] of Object.entries(methods)) {
      assert.equal(typeof fn, 'function', `${file} 的 ${name} 不是方法`);
    }
  }
});

test('shared.js 只暴露跨面板复用的工具函数', async () => {
  const shared = await import(`../${UI_DIR}/shared.js`);
  const actual = Object.keys(shared).sort();
  const expected = [...SHARED_EXPORTS].sort();
  assert.deepEqual(actual, expected, 'shared.js 导出面发生变化');
});

test('面板模块只依赖 shared.js，模块间无循环依赖', () => {
  for (const file of Object.keys(METHOD_MODULES)) {
    const source = read(`${UI_DIR}/${file}`);
    const intraUi = [...source.matchAll(/from\s+'(\.[^']+)'/g)]
      .map((match) => match[1])
      .filter((specifier) => specifier.startsWith('./'));
    assert.ok(
      intraUi.every((specifier) => specifier === './shared.js'),
      `${file} 只允许依赖 ./shared.js，实际为 ${intraUi.join(', ')}`
    );
  }

  const shared = read(`${UI_DIR}/shared.js`);
  assert.doesNotMatch(shared, /from\s+'\.\//, 'shared.js 不得依赖同级面板模块');
  assert.doesNotMatch(read(FACADE), /from\s+'\.\/ui\/ui\.js'/, '门面不得反向依赖自身');
});
