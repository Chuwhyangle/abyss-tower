// 前端请求错误处理测试：500 / 超时 / 坏 JSON / 离线，断言错误码与玩家文案。
// 通过注入 fetch 模拟故障，不启动服务端，也不依赖浏览器。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ApiError,
  API_ERROR,
  createApi,
  errorMessage,
  isRetryableError,
} from '../public/js/api.js';
import { BootErrorReporter, reportRetryableError } from '../public/js/app/boot-errors.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function countingFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return handler(calls.length, url, options);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

function assertPlayerMessage(message) {
  assert.equal(typeof message, 'string');
  assert.ok(message.length > 0);
  assert.ok(!message.includes('\n'), '玩家文案不应包含堆栈换行');
  assert.ok(!/\bat .+:\d+/.test(message), '玩家文案不应包含堆栈');
}

test('500 响应保留服务端错误码与文案，GET 最多自动重试一次', async () => {
  const fetchImpl = countingFetch(() =>
    jsonResponse({ error: '数据库暂时不可用', code: 'INTERNAL_ERROR' }, 500)
  );
  const client = createApi({ fetchImpl, retryDelayMs: 0 });

  await assert.rejects(client.profile(), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, 'INTERNAL_ERROR');
    assert.equal(error.status, 500);
    assert.equal(error.message, '数据库暂时不可用');
    assertPlayerMessage(error.message);
    return true;
  });
  assert.equal(fetchImpl.calls.length, 2, '幂等 GET 只重试一次');
});

test('GET 首次 503、第二次成功时自动恢复', async () => {
  const fetchImpl = countingFetch((attempt) =>
    attempt === 1 ? jsonResponse({ error: 'busy' }, 503) : jsonResponse({ ok: true })
  );
  const client = createApi({ fetchImpl, retryDelayMs: 0 });

  const data = await client.profile();
  assert.deepEqual(data, { ok: true });
  assert.equal(fetchImpl.calls.length, 2);
});

test('非幂等 POST 失败不自动重试', async () => {
  const fetchImpl = countingFetch(() => jsonResponse({ error: '服务异常' }, 500));
  const client = createApi({ fetchImpl, retryDelayMs: 0 });

  await assert.rejects(client.startRun('normal', 'standard'), (error) => {
    assert.equal(error.status, 500);
    assert.equal(error.message, '服务异常');
    return true;
  });
  assert.equal(fetchImpl.calls.length, 1);
});

test('4xx 响应不自动重试，并保留服务端业务码', async () => {
  const fetchImpl = countingFetch(() =>
    jsonResponse({ error: '今日挑战次数已用完', code: 'RATE_LIMITED' }, 429)
  );
  const client = createApi({ fetchImpl, retryDelayMs: 0 });

  await assert.rejects(client.leaderboard('daily'), (error) => {
    assert.equal(error.code, 'RATE_LIMITED');
    assert.equal(error.status, 429);
    assert.equal(error.message, '今日挑战次数已用完');
    return true;
  });
  assert.equal(fetchImpl.calls.length, 1);
});

test('请求超时给出超时错误码，且最多重试一次', async () => {
  const fetchImpl = countingFetch(
    (attempt, url, options) =>
      new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        );
      })
  );
  const client = createApi({ fetchImpl, timeoutMs: 20, retryDelayMs: 0 });

  await assert.rejects(client.profile(), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, API_ERROR.TIMEOUT);
    assert.match(error.message, /超时/);
    assertPlayerMessage(error.message);
    return true;
  });
  assert.equal(fetchImpl.calls.length, 2);
});

test('响应不是合法 JSON 时报解析错误，不重试', async () => {
  const fetchImpl = countingFetch(
    () => new Response('<html>bad gateway</html>', { status: 200 })
  );
  const client = createApi({ fetchImpl, retryDelayMs: 0 });

  await assert.rejects(client.profile(), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, API_ERROR.PARSE);
    assert.match(error.message, /响应格式异常/);
    assertPlayerMessage(error.message);
    return true;
  });
  assert.equal(fetchImpl.calls.length, 1);
});

test('后端不可达时报离网错误，完整原因挂在 cause 上', async () => {
  const cause = new TypeError('fetch failed');
  const fetchImpl = countingFetch(() => {
    throw cause;
  });
  const client = createApi({ fetchImpl, retryDelayMs: 0 });

  await assert.rejects(client.profile(), (error) => {
    assert.equal(error.code, API_ERROR.OFFLINE);
    assert.match(error.message, /无法连接服务器/);
    assert.equal(error.cause, cause, '控制台排查所需的原始错误不被吞掉');
    assertPlayerMessage(error.message);
    return true;
  });
  assert.equal(fetchImpl.calls.length, 2);
});

test('204 空响应视为成功而非解析失败', async () => {
  const fetchImpl = countingFetch(() => new Response(null, { status: 204 }));
  const client = createApi({ fetchImpl, retryDelayMs: 0 });

  const result = await client.logout();
  assert.equal(result, null);
  assert.equal(fetchImpl.calls.length, 1);
});

test('isRetryableError 只认可网络、超时与 5xx', () => {
  assert.equal(isRetryableError(new ApiError('x', { code: API_ERROR.OFFLINE })), true);
  assert.equal(isRetryableError(new ApiError('x', { code: API_ERROR.TIMEOUT })), true);
  assert.equal(isRetryableError(new ApiError('x', { status: 502 })), true);
  assert.equal(isRetryableError(new ApiError('x', { code: API_ERROR.PARSE, status: 200 })), false);
  assert.equal(isRetryableError(new ApiError('x', { code: 'CONFLICT', status: 409 })), false);
  assert.equal(isRetryableError(null), false);
});

test('errorMessage 对未知错误回退为中文提示', () => {
  assert.equal(errorMessage(null), '操作失败，请稍后重试');
  assert.equal(errorMessage(new Error('boom')), 'boom');
  assert.equal(errorMessage({}), '操作失败，请稍后重试');
});

// 最小 DOM 桩：只实现错误条用到的接口，测试不依赖浏览器。
function fakeDom() {
  const makeElement = () => ({
    style: {},
    children: [],
    hidden: false,
    textContent: '',
    onclick: null,
    setAttribute() {},
    appendChild(node) {
      this.children.push(node);
      return node;
    },
    append(...nodes) {
      this.children.push(...nodes);
    },
  });
  const body = makeElement();
  const listeners = new Map();
  const win = {
    __bootErrors: undefined,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatchEvent(event) {
      for (const fn of listeners.get(event.type) || []) fn(event);
      return true;
    },
  };
  return {
    win,
    doc: { body, createElement: () => makeElement() },
    dispatch(type, event = { type }) {
      win.dispatchEvent({ ...event, type });
    },
  };
}

test('未捕获异常与离线状态显示为顶部错误条，且不暴露原始堆栈', () => {
  const dom = fakeDom();
  const reporter = new BootErrorReporter(dom.win, dom.doc);
  reporter.install();

  assert.equal(reporter.bar.style.display, 'none');

  dom.dispatch('unhandledrejection', {
    reason: new Error('TypeError: boom at app.js:42'),
  });
  assert.equal(dom.win.__bootErrors.length, 1);
  assert.equal(reporter.bar.style.display, 'flex', '未捕获异常必须可见');
  assert.match(reporter.text.textContent, /页面出现异常/);
  assert.ok(!reporter.text.textContent.includes('app.js'), '界面不展示堆栈');

  dom.dispatch('rtd:offline');
  assert.match(reporter.text.textContent, /网络连接已断开/);
  dom.dispatch('rtd:online');
  assert.equal(reporter.bar.style.display, 'none', '恢复在线后自动收起');
});

test('关键请求失败的错误条提供重试按钮并执行回调', () => {
  const dom = fakeDom();
  const reporter = new BootErrorReporter(dom.win, dom.doc);
  reporter.install();

  let retried = 0;
  reportRetryableError('无法连接服务器，请检查网络后重试', () => {
    retried += 1;
  });

  assert.equal(reporter.bar.style.display, 'flex');
  assert.equal(reporter.retryButton.hidden, false);
  assert.equal(reporter.text.textContent, '无法连接服务器，请检查网络后重试');

  reporter.retryButton.onclick();
  assert.equal(retried, 1);
  assert.equal(reporter.bar.style.display, 'none', '点击重试后收起错误条');
});
