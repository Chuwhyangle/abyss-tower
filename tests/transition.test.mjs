// 大厅→战斗过场：阶段推进、跳过、reduced-motion 直达结束；外加源码级约束。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BATTLE_TRANSITION_DURATION,
  BATTLE_TRANSITION_PHASES,
  BATTLE_TRANSITION_SKIP_EVENTS,
  BattleTransitionPlayer,
  advanceTransition,
  createTransition,
  detectReducedMotion,
  skipTransition,
  transitionPhaseAt,
  transitionSnapshot,
} from '../public/js/render/transition.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const CSS = read('public/styles.css');
const UI_SRC = read('public/js/ui.js');
const TRANSITION_SRC = read('public/js/render/transition.js');

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function ruleBody(source, selector) {
  const pattern = new RegExp(`(?:^|\\n)\\s*${escapeRegExp(selector)}\\s*\\{`, 'm');
  const match = pattern.exec(source);
  assert.ok(match, `缺少选择器 ${selector}`);
  const start = match.index + match[0].length;
  let depth = 1;
  let index = start;
  while (index < source.length && depth > 0) {
    const char = source[index];
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    index += 1;
  }
  assert.equal(depth, 0, `选择器 ${selector} 的大括号未闭合`);
  return source.slice(start, index - 1);
}

// 最小 DOM 替身：只覆盖播放器实际用到的节点与事件接口。
function fakeDocument({ reduced = false } = {}) {
  const listeners = new Map();
  const makeNode = (tagName) => ({
    tagName,
    className: '',
    children: [],
    parentNode: null,
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
    appendChild(node) {
      node.parentNode = this;
      this.children.push(node);
      return node;
    },
    removeChild(node) {
      this.children = this.children.filter((child) => child !== node);
      node.parentNode = null;
    },
  });
  const body = makeNode('BODY');
  const view = {
    matchMedia: () => ({ matches: reduced }),
    addEventListener(type, fn, options) {
      listeners.set(`${type}:${options?.capture === true}`, { fn, options });
    },
    removeEventListener(type) {
      listeners.delete(`${type}:true`);
    },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
  };
  const doc = {
    body,
    defaultView: view,
    createElement: (tagName) => makeNode(tagName.toUpperCase()),
  };
  return { doc, body, listeners };
}

test('阶段按时长依次推进且不修改入参', () => {
  const start = createTransition();
  assert.equal(start.phase, 'fade');
  assert.equal(transitionPhaseAt(0), 'fade');
  assert.equal(transitionPhaseAt(BATTLE_TRANSITION_DURATION * 0.29), 'fade');
  assert.equal(transitionPhaseAt(BATTLE_TRANSITION_DURATION * 0.3), 'expand');
  assert.equal(transitionPhaseAt(BATTLE_TRANSITION_DURATION * 0.79), 'expand');
  assert.equal(transitionPhaseAt(BATTLE_TRANSITION_DURATION * 0.8), 'reveal');
  assert.equal(transitionPhaseAt(BATTLE_TRANSITION_DURATION), 'done');

  let state = start;
  const seen = [];
  for (let step = 0; step < 12; step += 1) {
    state = advanceTransition(state, 60);
    if (seen[seen.length - 1] !== state.phase) seen.push(state.phase);
  }
  assert.deepEqual(seen, ['fade', 'expand', 'reveal', 'done']);
  assert.equal(start.elapsed, 0, 'advanceTransition 不应修改入参');
  assert.equal(transitionSnapshot(state).done, true);
});

test('过场总时长不超过 800ms', () => {
  assert.ok(BATTLE_TRANSITION_DURATION > 0);
  assert.ok(BATTLE_TRANSITION_DURATION <= 800, `过场 ${BATTLE_TRANSITION_DURATION}ms 超过 800ms`);
  assert.deepEqual([...BATTLE_TRANSITION_PHASES], ['fade', 'expand', 'reveal', 'done']);
});

test('跳过立即结束，且不可再次跳过', () => {
  const running = createTransition();
  const skipped = skipTransition(running);
  assert.equal(skipped.phase, 'done');
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.elapsed, skipped.duration);
  assert.deepEqual(transitionSnapshot(skipped), {
    phase: 'done',
    progress: 1,
    done: true,
    skippable: false,
  });
  assert.equal(skipTransition(skipped), skipped, '已结束的状态保持原样');
  assert.equal(transitionSnapshot(running).skippable, true);
});

test('reduced-motion 直接结束，不挂载遮罩', () => {
  const reduced = createTransition({ reducedMotion: true });
  assert.equal(reduced.phase, 'done');
  assert.equal(reduced.skipped, false);
  assert.equal(transitionSnapshot(reduced).done, true);

  const { doc, body } = fakeDocument({ reduced: true });
  assert.equal(detectReducedMotion(doc), true);

  const player = new BattleTransitionPlayer({ doc });
  let done = 0;
  player.play({ onDone: () => { done += 1; } });
  assert.equal(player.active, false);
  assert.equal(player.phase, 'done');
  assert.equal(done, 1);
  assert.equal(body.children.length, 0, 'reduced-motion 不应创建遮罩');
});

test('播放器按帧推进，结束时移除遮罩', () => {
  const { doc, body } = fakeDocument();
  let clock = 0;
  let pending = null;
  const player = new BattleTransitionPlayer({
    doc,
    now: () => clock,
    frame: (callback) => {
      pending = callback;
      return 1;
    },
  });
  let done = 0;
  player.play({ onDone: () => { done += 1; } });

  assert.equal(player.phase, 'fade');
  assert.equal(body.children.length, 1);
  const overlay = body.children[0];
  assert.equal(overlay.className, 'battle-transition');
  assert.equal(overlay.children[0].className, 'battle-transition-map');
  assert.equal(overlay.getAttribute('data-phase'), 'fade');

  clock = 240;
  pending(clock);
  assert.equal(player.phase, 'expand');
  assert.equal(overlay.getAttribute('data-phase'), 'expand');

  clock = 620;
  pending(clock);
  assert.equal(player.phase, 'reveal');

  clock = BATTLE_TRANSITION_DURATION;
  pending(clock);
  assert.equal(player.phase, 'done');
  assert.equal(done, 1);
  assert.equal(body.children.length, 0, '结束后遮罩应被移除');
});

test('任意输入跳过且不拦截原绑定', () => {
  const { doc, body, listeners } = fakeDocument();
  const player = new BattleTransitionPlayer({ doc, frame: () => 1, now: () => 0 });
  let done = 0;
  player.play({ onDone: () => { done += 1; } });

  for (const type of BATTLE_TRANSITION_SKIP_EVENTS) {
    const entry = listeners.get(`${type}:true`);
    assert.ok(entry, `${type} 应以捕获阶段监听`);
    assert.equal(entry.options.passive, true, `${type} 监听应 passive，不阻塞输入`);
  }

  listeners.get('keydown:true').fn({ type: 'keydown' });
  assert.equal(player.phase, 'done');
  assert.equal(done, 1);
  assert.equal(body.children.length, 0);
  assert.equal(listeners.size, 0, '结束后应解绑全部输入监听');

  // 源码级：过场只观察输入，不 preventDefault / stopPropagation。
  assert.doesNotMatch(TRANSITION_SRC, /preventDefault|stopPropagation/);
});

test('遮罩为纯程序化绘制且不拦截点击', () => {
  const body = ruleBody(CSS, '.battle-transition');
  assert.match(body, /position:\s*fixed/);
  assert.match(body, /pointer-events:\s*none/, '遮罩不得拦截指针事件');
  assert.match(CSS, /\.battle-transition-map\s*\{/, '缺少地图轮廓层');
  assert.doesNotMatch(TRANSITION_SRC, /https?:|url\(|\.png|\.jpe?g|\.webp|\.svg/i, '过场不得引入素材');
});

test('门面在进入战斗时播放并允许跳过，开波前先结束过场', () => {
  assert.match(UI_SRC, /battleTransition\.play\(\)/, '进入战斗时未播放过场');
  assert.match(UI_SRC, /battleTransition\.cancel\(\)/, '返回大厅时未取消过场');

  const handler = /this\.el\.nextWave\.onclick = \(\) => \{([\s\S]*?)\};/.exec(UI_SRC);
  assert.ok(handler, '缺少开波按钮绑定');
  const body = handler[1];
  const skipAt = body.indexOf('battleTransition.skip()');
  const nextAt = body.indexOf('onNextWave');
  assert.ok(skipAt >= 0, '开波按钮未提供跳过入口');
  assert.ok(nextAt > skipAt, '必须先结束过场再开波');
});
