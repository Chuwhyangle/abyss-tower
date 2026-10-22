// 隔离测试环境：临时 SQLite、随机端口、独立 Chrome 配置与 CDP 封装。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function randomPort(min = 20000, max = 29999) {
  return min + Math.floor(Math.random() * (max - min));
}

export async function startTestServer({ seedHeader = false, dbPath = null, env = {} } = {}) {
  let lastError = '';
  for (let attempt = 0; attempt < 8; attempt++) {
    const port = randomPort();
    const databasePath =
      dbPath || path.join(os.tmpdir(), `rtd-test-${process.pid}-${Date.now()}-${port}.db`);
    const child = spawn(process.execPath, ['--no-warnings', 'server/index.mjs'], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(port),
        HOST: '127.0.0.1',
        DB_PATH: databasePath,
        ALLOW_TEST_SEED: seedHeader ? '1' : '0',
        AUTH_ENABLED: '1',
        REGISTRATION_MODE: 'open',
        DB_BACKUP: '0',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    child.stdout.on('data', (chunk) => { log += chunk; });
    child.stderr.on('data', (chunk) => { log += chunk; });

    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 80; i++) {
      if (child.exitCode != null) break;
      try {
        const response = await fetch(`${base}/api/health`);
        if (response.ok) {
          return {
            base,
            port,
            dbPath: databasePath,
            log: () => log,
            async stop() {
              if (child.exitCode == null) child.kill('SIGTERM');
              for (let j = 0; j < 30 && child.exitCode == null; j++) await sleep(50);
              if (child.exitCode == null) child.kill('SIGKILL');
              for (const suffix of ['', '-wal', '-shm']) {
                try { fs.rmSync(`${databasePath}${suffix}`, { force: true }); } catch { /* ignore */ }
              }
            },
          };
        }
      } catch {
        /* wait */
      }
      await sleep(100);
    }
    lastError = log;
    if (child.exitCode == null) child.kill('SIGKILL');
  }
  throw new Error(`测试服务未能启动：${lastError}`);
}

export async function findPageTarget(debugPort) {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      const target = list.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
      if (target) return target;
    } catch {
      /* wait */
    }
    await sleep(120);
  }
  return null;
}

export class Browser {
  constructor(ws, chrome, profileDir, { onError } = {}) {
    this.ws = ws;
    this.chrome = chrome;
    this.profileDir = profileDir;
    this.nextId = 0;
    this.pending = new Map();
    this.pageErrors = [];
    this.onError = onError;
    ws.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
        return;
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const detail = message.params?.exceptionDetails;
        const text = detail?.exception?.description || detail?.text || 'unknown exception';
        this.pageErrors.push(text);
        this.onError?.(text);
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
        const text = (message.params.args || [])
          .map((arg) => arg.value ?? arg.description ?? '')
          .join(' ');
        this.pageErrors.push(text);
        this.onError?.(text);
      }
    };
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ||
          result.exceptionDetails.text ||
          'evaluate failed'
      );
    }
    return result.result?.value;
  }

  async waitFor(expression, label, timeout = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        if (await this.evaluate(expression)) return;
      } catch {
        /* page busy */
      }
      await sleep(120);
    }
    throw new Error(`等待超时：${label}`);
  }

  async waitBoot() {
    await this.waitFor(`document.body.dataset.boot === 'ok'`, '页面启动');
  }

  async screenshot(file) {
    const result = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
    return file;
  }

  async heapUsage() {
    return this.send('Runtime.getHeapUsage');
  }

  async collectGarbage() {
    try {
      await this.send('HeapProfiler.collectGarbage');
    } catch {
      /* optional */
    }
  }

  async close() {
    try { this.ws.close(); } catch { /* ignore */ }
    if (this.chrome && this.chrome.exitCode == null) {
      this.chrome.kill('SIGKILL');
      await sleep(100);
    }
    try { fs.rmSync(this.profileDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

export function testUsername(prefix = 'u') {
  const stamp = Date.now().toString(36).slice(-8);
  const random = Math.random().toString(36).slice(2, 6);
  return `${prefix}${stamp}${random}`.slice(0, 16);
}

// 注册一个隔离测试账号，返回可直接放进 Cookie 头的字符串。
export async function registerAndLogin(base, { username, password } = {}) {
  const user = username || testUsername();
  const pass = password || 'rtd-test-password';
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: user, password: pass }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`测试账号注册失败：${response.status} ${data?.error || ''}`);
  }
  const setCookies = response.headers.getSetCookie?.() || [];
  const rawSetCookie = setCookies[0] || response.headers.get('set-cookie') || '';
  const rawCookie = rawSetCookie.split(';')[0];
  if (!rawCookie) throw new Error('测试账号注册成功但没有返回会话 Cookie');
  const [cookieName, cookieValue] = rawCookie.split('=');
  return {
    username: user,
    password: pass,
    data,
    rawCookie,
    cookie: { name: cookieName, value: cookieValue },
  };
}

export async function launchBrowser({
  base,
  name = 'rtd-test',
  initScript = null,
  width = 1440,
  height = 1000,
  onError = null,
  cookie = null,
  awaitBoot = true,
} = {}) {
  const debugPort = randomPort(30000, 39999);
  const profileDir = path.join(os.tmpdir(), `${name}-${process.pid}-${Date.now()}-${debugPort}`);
  fs.rmSync(profileDir, { recursive: true, force: true });
  const chrome = spawn(
    'google-chrome',
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--hide-scrollbars',
      '--autoplay-policy=no-user-gesture-required',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profileDir}`,
      `--window-size=${width},${height}`,
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  const target = await findPageTarget(debugPort);
  if (!target) {
    chrome.kill('SIGKILL');
    throw new Error('无法连接 Chrome CDP');
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('WebSocket 连接失败'));
  });

  const browser = new Browser(ws, chrome, profileDir, { onError });
  await browser.send('Page.enable');
  await browser.send('Runtime.enable');
  await browser.send('Network.enable');
  if (cookie) {
    await browser.send('Network.setExtraHTTPHeaders', { headers: { Cookie: cookie } });
  }
  if (initScript) {
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: initScript });
  }
  await browser.send('Page.navigate', { url: `${base}/` });
  if (awaitBoot) await browser.waitBoot();
  return browser;
}

// 新开局流程：难度卡片点击后需要从三张地图中选一张。
export async function chooseFirstMap(browser) {
  await browser.waitFor(`!!document.querySelector('.map-modal')`, '地图选择弹窗');
  await browser.evaluate(`document.querySelector('.map-card').click()`);
  await browser.waitFor(`!!(window.__rtd && window.__rtd.state.sim)`, '地图加载完成');
}

// 让页面里的 fetch 带上固定测试种子（仅在隔离服务的 ALLOW_TEST_SEED=1 时生效）。
export const TEST_SEED_SCRIPT = `
  (() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      const headers = new Headers(init.headers || {});
      headers.set('x-test-seed', 'rtd-perf-fixed-seed');
      return originalFetch(input, { ...init, headers });
    };
  })();
`;
