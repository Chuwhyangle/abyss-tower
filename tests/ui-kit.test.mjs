// UI kit 验收：面板骨架生命周期（打开/关闭/Esc/焦点/加载态/错误态）+ 静态门禁
// （模板转义只有一份实现、UI 面板不得裸 fetch '/api'）。零依赖，用极简 DOM 桩驱动。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { escapeHtml, html } from '../public/js/ui/kit/dom.js';
import { createPanel } from '../public/js/ui/kit/panel.js';
import { escapeHtml as sharedEscapeHtml } from '../public/js/ui/shared.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JS_ROOT = path.join(ROOT, 'public/js');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

function collect(dir, output = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, output);
    else if (entry.name.endsWith('.js')) output.push(full);
  }
  return output;
}

const SOURCES = collect(JS_ROOT).map((full) => ({
  relative: path.relative(ROOT, full).split(path.sep).join('/'),
  source: fs.readFileSync(full, 'utf8'),
}));

// ---------- 极简 DOM 桩（只实现 panel 骨架用到的接口） ----------

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    for (const name of names) this.values.add(name);
  }

  remove(...names) {
    for (const name of names) this.values.delete(name);
  }

  toggle(name, force) {
    const active = force === undefined ? !this.values.has(name) : force;
    if (active) this.values.add(name);
    else this.values.delete(name);
  }

  contains(name) {
    return this.values.has(name);
  }
}

function matchesSelector(element, selector) {
  if (selector.startsWith('#')) return element.id === selector.slice(1);
  const attribute = /^\[([\w-]+)\]$/.exec(selector);
  return attribute ? Object.hasOwn(element.attributes, attribute[1]) : false;
}

class FakeElement {
  constructor(tagName = 'div', ownerDocument = null) {
    this.tagName = tagName;
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.hidden = false;
    this.attributes = {};
    this.listeners = new Map();
    this.classList = new FakeClassList();
    this.id = '';
    this.innerHTML = '';
    this.textContent = '';
    this.tabIndex = -1;
    this.disabled = false;
    this.dataset = {};
    this.style = { setProperty() {}, removeProperty() {} };
  }

  appendChild(child) {
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null;
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  addEventListener(type, handler) {
    const entries = this.listeners.get(type) || [];
    entries.push(handler);
    this.listeners.set(type, entries);
  }

  removeEventListener(type, handler) {
    const entries = this.listeners.get(type) || [];
    this.listeners.set(
      type,
      entries.filter((entry) => entry !== handler)
    );
  }

  dispatchEvent(event) {
    const payload = {
      target: this,
      preventDefault() {},
      stopPropagation() {},
      stopImmediatePropagation() {},
      ...event,
    };
    for (const handler of this.listeners.get(event.type) || []) handler(payload);
    return true;
  }

  click() {
    return this.dispatchEvent({ type: 'click' });
  }

  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }

  querySelectorAll(selector) {
    const found = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (matchesSelector(child, selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

class FakeDocument {
  constructor() {
    this.head = new FakeElement('head', this);
    this.body = new FakeElement('body', this);
    this.nodes = new Map();
    this.listeners = new Map();
    this.activeElement = this.body;
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }

  getElementById(id) {
    return this.nodes.get(id) || null;
  }

  register(id, element) {
    element.id = id;
    this.nodes.set(id, element);
    return element;
  }

  addEventListener(type, handler) {
    const entries = this.listeners.get(type) || [];
    entries.push(handler);
    this.listeners.set(type, entries);
  }

  removeEventListener(type, handler) {
    const entries = this.listeners.get(type) || [];
    this.listeners.set(
      type,
      entries.filter((entry) => entry !== handler)
    );
  }

  pressEscape() {
    for (const handler of this.listeners.get('keydown') || []) {
      handler({ type: 'keydown', key: 'Escape', preventDefault() {}, stopPropagation() {} });
    }
  }
}

function setupPanel(options = {}) {
  const doc = new FakeDocument();
  const panel = doc.createElement('div');
  panel.hidden = true;
  doc.register('panel', panel);
  const trigger = doc.createElement('button');
  doc.register('trigger', trigger);
  const close = doc.createElement('button');
  if (options.closeSelector === '[data-panel-close]' || !options.closeSelector) {
    close.setAttribute('data-panel-close', '');
    panel.appendChild(close);
  } else {
    doc.register(options.closeSelector.replace('#', ''), close);
    panel.appendChild(close);
  }
  const controller = createPanel({ id: 'panel', trigger, document: doc, ...options });
  return { doc, panel, trigger, close, controller };
}

// ---------- 模板转义 ----------

test('模板转义只有一份实现，ui/shared.js 保持兼容转出', () => {
  const definitions = SOURCES.filter(({ source }) => /function\s+escapeHtml\s*\(/.test(source)).map(
    ({ relative }) => relative
  );
  assert.deepEqual(definitions, ['public/js/ui/kit/dom.js'], `转义实现分散：${definitions.join(', ')}`);
  assert.equal(sharedEscapeHtml, escapeHtml, 'shared.js 的 escapeHtml 必须与 kit 同一实现');
});

test('escapeHtml 覆盖五类字符，null/undefined 视为空串', () => {
  assert.equal(escapeHtml('<b>"x" & \'y\'</b>'), '&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(0), '0');
  assert.equal(escapeHtml('安全文本'), '安全文本');
});

test('html 模板只转义插值，静态片段原样保留', () => {
  assert.equal(html`<p class="x">${'<b>'}</p>`, '<p class="x">&lt;b&gt;</p>');
  assert.equal(html`<i>${null}</i>`, '<i></i>');
});

test('UI 面板不得裸 fetch /api，统一走 api.request', () => {
  const offenders = SOURCES.filter(
    ({ relative, source }) => relative !== 'public/js/api.js' && /fetch\(\s*[`'"]\/api/.test(source)
  ).map(({ relative }) => relative);
  assert.deepEqual(offenders, [], `以下文件仍在直接请求接口：${offenders.join(', ')}`);

  const apiSource = read('public/js/api.js');
  assert.match(apiSource, /credentials: 'same-origin'/, 'api.js 应统一携带同源凭据');
  assert.match(apiSource, /request\(path, options = \{\}\)/, 'api.js 应暴露通用 request');
});

// ---------- 面板生命周期 ----------

test('打开/关闭：触发器切换、aria-expanded 同步、关闭按钮生效', () => {
  const { panel, trigger, close, controller } = setupPanel();
  trigger.click();
  assert.equal(panel.hidden, false, '点击触发器应打开面板');
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(controller.isOpen, true);

  close.click();
  assert.equal(panel.hidden, true, '关闭按钮应关闭面板');
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');

  trigger.click();
  trigger.click();
  assert.equal(panel.hidden, true, '再次点击触发器应关闭面板');
});

test('Esc 关闭，关闭后把焦点还给触发元素', () => {
  const { doc, panel, trigger } = setupPanel();
  trigger.focus();
  trigger.click();
  assert.equal(doc.activeElement, panel, '打开后焦点应进入面板');

  doc.pressEscape();
  assert.equal(panel.hidden, true, 'Esc 应关闭面板');
  assert.equal(doc.activeElement, trigger, '关闭后焦点应回到触发器');
  assert.equal(doc.listeners.get('keydown')?.length || 0, 0, '关闭后应解绑 Esc');
});

test('加载态 → 渲染结果；失败态回调后仍可重试', async () => {
  const events = [];
  let attempt = 0;
  const { panel, controller } = setupPanel({
    loading: () => events.push('loading'),
    load: async () => {
      attempt += 1;
      events.push(`load:${attempt}`);
      if (attempt === 1) throw new Error('boom');
      return { total: 3 };
    },
    render: (node, data) => events.push(`render:${data.total}`),
    failed: (node, error) => events.push(`failed:${error.message}`),
  });

  controller.open();
  await controller.pendingLoad;
  assert.deepEqual(events, ['loading', 'load:1', 'failed:boom']);
  assert.equal(panel.getAttribute('aria-busy'), null, '失败后应清除 aria-busy');

  controller.reload();
  await controller.pendingLoad;
  assert.deepEqual(events.slice(3), ['loading', 'load:2', 'render:3']);
  assert.equal(panel.getAttribute('aria-busy'), null);
});

test('并发 reload 只发一次请求；未打开时不加载', async () => {
  let calls = 0;
  let release;
  const { controller } = setupPanel({
    load: () => {
      calls += 1;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
    render: () => {},
  });

  assert.equal(calls, 0, '面板未打开不应请求');
  controller.open();
  const first = controller.pendingLoad;
  const second = controller.reload();
  assert.equal(first, second, '进行中的加载应复用同一个 Promise');
  await Promise.resolve();
  assert.equal(calls, 1);
  release({});
  await first;
});

test('静态面板（骨架标记在 HTML 中）只绑定关闭，不覆盖既有内容', () => {
  const { panel, close, controller } = setupPanel({ closeSelector: '#close-btn' });
  const marker = new FakeElement('span');
  panel.appendChild(marker);
  // 重新 mount 一个使用静态骨架的控制器：html 为 null 时不得改写 innerHTML。
  const staticPanel = new FakeDocument();
  const node = staticPanel.createElement('div');
  node.innerHTML = '已有内容';
  staticPanel.register('static', node);
  const closeNode = staticPanel.createElement('button');
  staticPanel.register('close-btn', closeNode);
  node.appendChild(closeNode);
  const staticController = createPanel({
    id: 'static',
    document: staticPanel,
    closeSelector: '#close-btn',
  });
  assert.equal(node.innerHTML, '已有内容', '静态骨架不得被覆盖');
  node.hidden = false;
  staticController.close();
  assert.equal(node.hidden, true);
  assert.equal(panel.children.length, 2);
  assert.equal(close.id, 'close-btn');
  assert.equal(controller.isOpen, false);
});
