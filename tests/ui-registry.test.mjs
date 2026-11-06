// UI / 渲染面板注册表：单一入口、自注册清单、import-graph 无孤立自挂载入口。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyze } from '../scripts/import-graph.mjs';
import { registerPanel, mountPanels, panelIds, resetPanels } from '../public/js/ui/registry.js';
import { registerRenderer, createRenderer, rendererIds } from '../public/js/render/registry.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const INDEX_HTML = read('public/index.html');
const BOOTSTRAP = read('public/js/ui/bootstrap.js');
const RENDER_FACADE = read('public/js/render.js');
const RENDER_MANIFEST = read('public/js/render/renderers.js');

// 清单顺序即拆分前 index.html 的装载顺序（ui/bootstrap.js 的唯一事实源）。
const PANELS = [
  ['notifications', './notifications.js', 'public/js/ui/notifications.js'],
  ['season-pass', './season-pass.js', 'public/js/ui/season-pass.js'],
  ['meta-tree', './meta-tree.js', 'public/js/ui/meta-tree.js'],
  ['achievements', '../achievements-ui.js', 'public/js/achievements-ui.js'],
  ['bounties', '../bounties-ui.js', 'public/js/bounties-ui.js'],
  ['cosmetics', '../cosmetics-ui.js', 'public/js/cosmetics-ui.js'],
  ['stats', '../stats-ui.js', 'public/js/stats-ui.js'],
  ['leaderboard', '../leaderboard-ui.js', 'public/js/leaderboard-ui.js'],
  ['season', '../season-ui.js', 'public/js/season-ui.js'],
  ['relic-codex', '../relic-codex-ui.js', 'public/js/relic-codex-ui.js'],
  ['daily-history', '../daily-history-ui.js', 'public/js/daily-history-ui.js'],
  ['share', '../share-ui.js', 'public/js/share-ui.js'],
  ['replay', '../replay-ui.js', 'public/js/replay-ui.js'],
];

const RENDERERS = [
  ['glow', 'public/js/render/glow-renderer.js'],
  ['background', 'public/js/render/background-renderer.js'],
  ['portal', 'public/js/render/portal-renderer.js'],
  ['tower', 'public/js/render/tower-renderer.js'],
  ['enemy', 'public/js/render/enemy-renderer.js'],
  ['ally', 'public/js/render/ally-renderer.js'],
  ['projectile', 'public/js/render/projectile-renderer.js'],
  ['destructible', 'public/js/render/destructible-renderer.js'],
  ['effect', 'public/js/render/effect-renderer.js'],
  ['floater', 'public/js/render/floater-renderer.js'],
  ['overlay', 'public/js/render/overlay-renderer.js'],
  ['skill', 'public/js/render/skill-renderer.js'],
  ['culmination', 'public/js/render/culmination-renderer.js'],
];

const escapeRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('index.html 只留一个入口 script，面板不再各自挂载', () => {
  const scripts = [...INDEX_HTML.matchAll(/<script\b[^>]*>/g)].map((match) => match[0]);
  assert.equal(scripts.length, 1, `index.html 应只剩一个 script，实际 ${scripts.length}`);
  assert.match(scripts[0], /src="\/js\/main\.js"/, '入口应是 /js/main.js');
  for (const [, , modulePath] of PANELS) {
    const src = `/js/${modulePath.replace(/^public\/js\//, '')}`;
    assert.ok(!INDEX_HTML.includes(`src="${src}"`), `index.html 仍直接挂载 ${src}`);
  }
});

test('ui.js 经 bootstrap 统一装载面板，面板清单与注册 id 一一对应', async () => {
  assert.match(read('public/js/ui.js'), /bootstrapPanels\(\{ ui \}\)/, 'ui.js 缺少唯一的面板 bootstrap');

  const manifest = [...BOOTSTRAP.matchAll(/\{ id: '([^']+)', load: \(\) => import\('([^']+)'\) \}/g)].map(
    (match) => [match[1], match[2]]
  );
  assert.deepEqual(manifest, PANELS.map(([id, spec]) => [id, spec]), '面板清单与预期顺序不一致');

  for (const [id, , modulePath] of PANELS) {
    const source = read(modulePath);
    assert.match(source, new RegExp(`registerPanel\\('${escapeRe(id)}', install\\)`), `${modulePath} 未自注册`);
    assert.doesNotMatch(
      source,
      /document\.addEventListener\('DOMContentLoaded', install/,
      `${modulePath} 仍在自挂载`
    );
  }

  await Promise.all(PANELS.map(([, , modulePath]) => import(path.join(ROOT, modulePath))));
  assert.deepEqual([...panelIds()].sort(), PANELS.map(([id]) => id).sort());
});

test('render.js 不再逐个静态 import 渲染器，模板由注册清单声明', () => {
  for (const [, modulePath] of RENDERERS) {
    const file = path.basename(modulePath);
    assert.doesNotMatch(RENDER_FACADE, new RegExp(`from './render/${escapeRe(file)}'`), `render.js 仍静态 import ${file}`);
    assert.match(RENDER_MANIFEST, new RegExp(`'./${escapeRe(file)}'`), `渲染清单缺少 ${file}`);
  }
  assert.match(RENDER_FACADE, /from '\.\/render\/registry\.js'/, 'render.js 必须经注册表创建渲染器');

  for (const [id, modulePath] of RENDERERS) {
    const source = read(modulePath);
    assert.match(source, /import \{ registerRenderer \} from '\.\/registry\.js'/, `${modulePath} 未接入注册表`);
    assert.match(source, new RegExp(`registerRenderer\\('${escapeRe(id)}'`), `${modulePath} 未自注册`);
  }
});

test('渲染器注册表按 id 构造实例，未知 id 立即失败', async () => {
  await import(path.join(ROOT, 'public/js/render/renderers.js'));
  assert.deepEqual([...rendererIds()].sort(), RENDERERS.map(([id]) => id).sort());

  class StubRenderer {}
  registerRenderer('stub', StubRenderer);
  assert.ok(createRenderer('stub', 1, 2) instanceof StubRenderer);
  assert.throws(() => createRenderer('missing'), /unknown renderer: missing/);
  assert.throws(() => registerRenderer('', StubRenderer), /id required/);
  assert.throws(() => registerRenderer('bad', null), /class expected/);
});

test('面板注册表：按清单顺序挂载一次、注入 ui、单面板失败不阻断其它面板', () => {
  resetPanels();
  const calls = [];
  registerPanel('first', (context) => calls.push(['first', context.ui]));
  registerPanel('broken', () => {
    throw new Error('boom');
  });
  registerPanel('third', (context) => calls.push(['third', context.ui]));

  const originalError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args);
  globalThis.document = { readyState: 'complete' };
  try {
    assert.equal(mountPanels({ ui: 'UI' }, ['first', 'broken', 'third']), true);
    assert.deepEqual(calls, [
      ['first', 'UI'],
      ['third', 'UI'],
    ]);
    assert.equal(errors.length, 1, '失败面板应被记录且不影响后续面板');
    assert.equal(mountPanels({ ui: 'AGAIN' }, ['first']), false, '只允许挂载一次');
    assert.equal(calls.length, 2);
  } finally {
    console.error = originalError;
    delete globalThis.document;
    resetPanels();
  }
});

test('面板注册表：DOM 未就绪时挂到 DOMContentLoaded，Node 环境直接跳过', () => {
  resetPanels();
  const calls = [];
  registerPanel('deferred', () => calls.push('mounted'));

  assert.equal(mountPanels({}), false, '无 document 时不做任何挂载');
  resetPanels();
  registerPanel('deferred', () => calls.push('mounted'));

  const listeners = [];
  globalThis.document = {
    readyState: 'loading',
    addEventListener: (type, fn) => listeners.push([type, fn]),
  };
  try {
    assert.equal(mountPanels({}), true);
    assert.equal(calls.length, 0, 'DOMContentLoaded 之前不挂载');
    assert.equal(listeners.length, 1);
    assert.equal(listeners[0][0], 'DOMContentLoaded');
    listeners[0][1]();
    assert.deepEqual(calls, ['mounted']);
  } finally {
    delete globalThis.document;
    resetPanels();
  }
});

test('import-graph：面板与渲染器都有静态入边，没有 in-degree=0 的自挂载入口', () => {
  const graph = analyze(ROOT);
  const targets = new Set(graph.edges.map((edge) => edge.to));
  for (const [, , modulePath] of PANELS) {
    assert.ok(targets.has(path.join(ROOT, modulePath)), `${modulePath} 仍是孤立入口（in-degree=0）`);
  }
  for (const [, modulePath] of RENDERERS) {
    assert.ok(targets.has(path.join(ROOT, modulePath)), `${modulePath} 仍是孤立入口（in-degree=0）`);
  }
  assert.ok(targets.has(path.join(ROOT, 'public/js/ui/bootstrap.js')), 'bootstrap 必须被 ui.js import');
});
