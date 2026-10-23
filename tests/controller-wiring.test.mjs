// 控制器依赖注入：子控制器不再通过 service-locator 透传，装配与开波迁移可用假依赖独立验证。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const APP_DIR = new URL('../public/js/app/', import.meta.url);
const appFile = (name) => new URL(name, APP_DIR);
const SUB_CONTROLLERS = ['run.js', 'combat.js', 'session.js', 'input.js'];

// controller.js 依赖浏览器模块（本地存储、音频、UI），导入前提供最小只读桩。
globalThis.localStorage ??= {
  getItem: () => null,
  setItem() {},
  removeItem() {},
};
globalThis.document ??= { addEventListener() {} };

test('public/js/app 中不再出现 this.game 透传（GameController 自身除外）', () => {
  for (const file of readdirSync(APP_DIR)) {
    if (!file.endsWith('.js') || file === 'controller.js') continue;
    const src = readFileSync(appFile(file), 'utf8');
    assert.doesNotMatch(src, /this\.game\b/, `${file} 仍在透传 this.game`);
  }
});

test('子控制器之间不直接引用彼此', () => {
  for (const file of SUB_CONTROLLERS) {
    const src = readFileSync(appFile(file), 'utf8');
    for (const peer of SUB_CONTROLLERS) {
      if (peer === file) continue;
      assert.ok(!src.includes(`./${peer}`), `${file} 直接引用了 ${peer}`);
    }
  }
});

test('每个子控制器的依赖在构造签名中显式可见', async () => {
  const { SessionController } = await import('../public/js/app/session.js');
  const { RunController } = await import('../public/js/app/run.js');
  const { CombatController } = await import('../public/js/app/combat.js');
  const { InputController } = await import('../public/js/app/input.js');

  const state = {};
  const api = {};
  const ui = {};
  const store = {};
  const noop = () => {};

  const session = new SessionController({ state, api, ui, store });
  assert.equal(session.state, state);
  assert.equal(session.api, api);
  assert.equal(session.ui, ui);
  assert.equal(session.store, store);

  const run = new RunController({
    state,
    api,
    ui,
    store,
    onWaveClear: noop,
    onGameOver: noop,
    onRequestError: noop,
    onBindCanvas: noop,
    onShowTitle: noop,
  });
  assert.equal(run.state, state);
  assert.equal(run.api, api);
  assert.equal(run.ui, ui);
  assert.equal(run.store, store);
  assert.equal(run.onWaveClear, noop);
  assert.equal(run.onGameOver, noop);

  const combat = new CombatController({ state, api, ui, store, onRequestError: noop, onRefreshProfile: noop });
  assert.equal(combat.state, state);
  assert.equal(combat.api, api);
  assert.equal(combat.ui, ui);
  assert.equal(combat.store, store);
  assert.equal(combat.onRequestError, noop);
  assert.equal(combat.onRefreshProfile, noop);

  const input = new InputController({ state, ui });
  assert.equal(input.state, state);
  assert.equal(input.ui, ui);

  for (const controller of [session, run, combat, input]) {
    assert.equal(controller.game, undefined, '子控制器不应持有 game service-locator');
  }
});

test('GameController 按注入依赖装配并完成一次开波状态迁移', async () => {
  const { GameController } = await import('../public/js/app/controller.js');

  const events = [];
  const api = {
    async startWave(runId) {
      events.push(['startWave', runId]);
      return { replay: false, wave: { index: 4 }, clearedWaves: 3, wavesServed: 4 };
    },
  };
  const ui = {
    closeModal: () => events.push(['closeModal']),
    toast: (message) => events.push(['toast', message]),
  };
  const audio = { enabled: true };
  const store = { loadSnapshot: () => null };

  const game = new GameController({ api, ui, audio, store });

  // 装配：子控制器拿到的是同一份 state 对象与注入的依赖，而不是 GameController 本身。
  assert.equal(game.session.state, game.state);
  assert.equal(game.run.state, game.state);
  assert.equal(game.combat.state, game.state);
  assert.equal(game.input.state, game.state);
  assert.equal(game.session.api, api);
  assert.equal(game.run.api, api);
  assert.equal(game.combat.api, api);
  assert.equal(game.session.store, store);
  assert.equal(game.combat.store, store);
  assert.equal(game.input.ui, ui);
  assert.notEqual(game.run.game, game);

  const sim = {
    phase: 'prep',
    clearedWave: 3,
    clearPending: true,
    save() {
      events.push(['save']);
    },
    beginWave(wave) {
      this.phase = 'wave';
      this.wave = wave;
      events.push(['beginWave', wave.index]);
      return true;
    },
  };
  const app = {
    paused: true,
    setPaused(value) {
      this.paused = value;
    },
    emitHud(value) {
      events.push(['emitHud', value]);
    },
  };
  game.state.sim = sim;
  game.state.run = { id: 'run-1', clearedWaves: 3, wavesServed: 3 };
  game.state.app = app;

  await game.combat.nextWave();

  assert.deepEqual(events, [
    ['startWave', 'run-1'],
    ['save'],
    ['closeModal'],
    ['beginWave', 4],
    ['emitHud', true],
  ]);
  assert.equal(sim.phase, 'wave');
  assert.equal(sim.wave.index, 4);
  assert.equal(sim.clearPending, false);
  assert.equal(game.state.run.clearedWaves, 3);
  assert.equal(game.state.run.wavesServed, 4);
  assert.equal(app.paused, false);
  assert.equal(game.state.loadingWave, false);
});
