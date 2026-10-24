// 隔离测试环境：临时 SQLite、随机端口、独立 Chrome 配置与 CDP 封装。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 并行负载下服务启动与 CDP 连接受机器资源影响：时限可用环境变量覆盖，默认比历史值更宽松。
function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export const HARNESS_TIMEOUTS = Object.freeze({
  startAttempts: envNumber('HARNESS_START_ATTEMPTS', 8),
  healthAttempts: envNumber('HARNESS_HEALTH_ATTEMPTS', 150),
  healthIntervalMs: envNumber('HARNESS_HEALTH_INTERVAL_MS', 100),
  cdpAttempts: envNumber('HARNESS_CDP_ATTEMPTS', 160),
  cdpIntervalMs: envNumber('HARNESS_CDP_INTERVAL_MS', 120),
  bootTimeoutMs: envNumber('HARNESS_BOOT_TIMEOUT_MS', 20000),
  waitTimeoutMs: envNumber('HARNESS_WAIT_TIMEOUT_MS', 20000),
  stopAttempts: envNumber('HARNESS_STOP_ATTEMPTS', 40),
  stopIntervalMs: envNumber('HARNESS_STOP_INTERVAL_MS', 50),
  registerAttempts: envNumber('HARNESS_REGISTER_ATTEMPTS', 12),
  registerDelayMs: envNumber('HARNESS_REGISTER_DELAY_MS', 200),
});

function randomPort(min = 20000, max = 29999) {
  return min + Math.floor(Math.random() * (max - min));
}

export async function startTestServer({ seedHeader = false, dbPath = null, env = {} } = {}) {
  let lastError = '';
  for (let attempt = 0; attempt < HARNESS_TIMEOUTS.startAttempts; attempt++) {
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
    for (let i = 0; i < HARNESS_TIMEOUTS.healthAttempts; i++) {
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
              for (let j = 0; j < HARNESS_TIMEOUTS.stopAttempts && child.exitCode == null; j++) {
                await sleep(HARNESS_TIMEOUTS.stopIntervalMs);
              }
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
      await sleep(HARNESS_TIMEOUTS.healthIntervalMs);
    }
    lastError = log;
    if (child.exitCode == null) child.kill('SIGKILL');
  }
  throw new Error(`测试服务未能启动：${lastError}`);
}

export async function findPageTarget(debugPort) {
  for (let i = 0; i < HARNESS_TIMEOUTS.cdpAttempts; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      const target = list.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
      if (target) return target;
    } catch {
      /* wait */
    }
    await sleep(HARNESS_TIMEOUTS.cdpIntervalMs);
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
    this.retried = false;
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

  async waitFor(expression, label, timeout = HARNESS_TIMEOUTS.waitTimeoutMs) {
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
    await this.waitFor(`document.body.dataset.boot === 'ok'`, '页面启动', HARNESS_TIMEOUTS.bootTimeoutMs);
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


// 并行测试时本地服务可能刚起或短暂抖动：注册请求做有限重试，失败原因保持可见。
async function fetchWithRetry(
  url,
  options,
  { attempts = HARNESS_TIMEOUTS.registerAttempts, delayMs = HARNESS_TIMEOUTS.registerDelayMs } = {}
) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;
      await sleep(delayMs);
    }
  }
  throw lastError;
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
  const response = await fetchWithRetry(`${base}/api/auth/register`, {
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

// 环境类失败：与用例断言无关，可安全重试一次。断言失败不带这些 code，永不重试。
export const ENV_FAILURE_CODES = Object.freeze(['cdp', 'timeout']);

export class HarnessEnvError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'HarnessEnvError';
    this.code = code;
  }
}

export function classifyFailure(error) {
  return ENV_FAILURE_CODES.includes(error?.code) ? error.code : 'assertion';
}

export async function withRetry(fn, { retries = 1, onlyOn = ENV_FAILURE_CODES, onRetry = null } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      const code = classifyFailure(error);
      if (!onlyOn.includes(code) || attempt >= retries) throw error;
      if (onRetry) onRetry({ attempt: attempt + 1, retries, code, error });
      else console.warn(`[harness] retried:true（${code}，第 ${attempt + 1}/${retries} 次重试）：${error.message}`);
    }
  }
}

async function launchBrowserOnce({
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
    process.env.CHROME_BIN || 'google-chrome',
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
  let spawnError = null;
  chrome.once('error', (error) => { spawnError = error; });

  let browser = null;
  try {
    const target = await findPageTarget(debugPort);
    if (!target) {
      const reason = spawnError ? `Chrome 启动失败：${spawnError.message}` : '无法连接 Chrome CDP';
      throw new HarnessEnvError(reason, 'cdp');
    }
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new HarnessEnvError('WebSocket 连接失败', 'cdp'));
    });

    browser = new Browser(ws, chrome, profileDir, { onError });
    try {
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
      if (awaitBoot) {
        try {
          await browser.waitBoot();
        } catch (error) {
          throw new HarnessEnvError(`页面启动超时：${error.message}`, 'timeout');
        }
      }
      return browser;
    } catch (error) {
      await browser.close();
      browser = null;
      throw error instanceof HarnessEnvError
        ? error
        : new HarnessEnvError(`浏览器初始化失败：${error.message}`, 'cdp');
    }
  } catch (error) {
    if (browser) {
      await browser.close();
    } else {
      try { chrome.kill('SIGKILL'); } catch { /* ignore */ }
      try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    throw error;
  }
}

// 启动失败只在环境类错误（CDP / 启动超时）时重试一次；重试会通过 `retried:true` 留痕。
export async function launchBrowser(options = {}) {
  let retried = false;
  const browser = await withRetry(() => launchBrowserOnce(options), {
    retries: 1,
    onlyOn: ENV_FAILURE_CODES,
    onRetry: ({ attempt, retries, code, error }) => {
      retried = true;
      console.warn(
        `[harness] retried:true（${options.name || 'rtd-test'} ${attempt}/${retries}，${code}）：${error.message}`
      );
    },
  });
  browser.retried = retried;
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
