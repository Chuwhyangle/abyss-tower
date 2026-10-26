// 测试服务器运行时：端口分配、启动就绪校验与「换端口重试」的共享起动器。
// 端口不再从固定段里猜：交给内核分配，再用租约文件避免同机测试进程重复选中同一个端口。
// 就绪判定必须闭环：子进程已退出就立刻失败，不能把「任意 200」当成自己拉起的服务。
// 内核临时端口段包含全部非特权端口，「先 listen(0) 再 close 再交给子进程」之间必然有
// TOCTOU 窗口：唯一可靠的办法是启动失败后换端口重试，因此所有自起服务的测试都必须走这里。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const LEASE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_ATTEMPTS = 20;
const DEFAULT_HEALTH_ATTEMPTS = 100;
const DEFAULT_HEALTH_INTERVAL_MS = 100;

export const DEFAULT_SERVER_ATTEMPTS = 20;
export const DEFAULT_SERVER_HEALTH_ATTEMPTS = 100;
export const DEFAULT_SERVER_HEALTH_INTERVAL_MS = 100;
export const DEFAULT_STOP_ATTEMPTS = 40;
export const DEFAULT_STOP_INTERVAL_MS = 50;

// 同机不同用户各用一份租约目录，避免 /tmp 权限与残留互相影响。
export function leaseDir() {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'user';
  return path.join(os.tmpdir(), `rtd-test-ports-${uid}`);
}

function listenOn(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', () => {
      const { port: actual } = probe.address();
      probe.close(() => resolve(actual));
    });
  });
}

function readLease(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

// 进程异常退出会留下租约：pid 已消失或租约过期即视为可回收。
export function pruneLeases(now = Date.now()) {
  let entries = [];
  try {
    entries = fs.readdirSync(leaseDir());
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(leaseDir(), name);
    const lease = readLease(file);
    if (lease && processAlive(lease.pid) && now - Number(lease.at) <= LEASE_TTL_MS) continue;
    try {
      fs.rmSync(file, { force: true });
      removed += 1;
    } catch {
      /* 其他用户的租约删不掉，留给它的主人回收 */
    }
  }
  return removed;
}

function claim(port, now) {
  const file = path.join(leaseDir(), `${port}.json`);
  const body = `${JSON.stringify({ pid: process.pid, at: now })}\n`;
  try {
    fs.mkdirSync(leaseDir(), { recursive: true });
    fs.writeFileSync(file, body, { flag: 'wx' });
    return true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const lease = readLease(file);
  if (lease && processAlive(lease.pid) && now - Number(lease.at) <= LEASE_TTL_MS) return false;
  try {
    fs.rmSync(file, { force: true });
    fs.writeFileSync(file, body, { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

// 分配到的端口在本次进程内不会被其他分配复用，也不会被同机其他测试进程抢走。
export async function allocatePort({ attempts = DEFAULT_ATTEMPTS, now = Date.now() } = {}) {
  pruneLeases(now);
  for (let i = 0; i < attempts; i += 1) {
    const port = await listenOn(0);
    if (claim(port, now)) return port;
  }
  throw new Error(`无法分配空闲端口：连续 ${attempts} 次候选端口都被占用`);
}

export function releasePort(port) {
  try {
    fs.rmSync(path.join(leaseDir(), `${port}.json`), { force: true });
  } catch {
    /* ignore */
  }
}

// 等自己的服务就绪：日志里出现本端口是绑定的直接证据；日志被改写时退化为存活校验。
export async function waitForHealth({
  base,
  port = null,
  child = null,
  log = () => '',
  attempts = DEFAULT_HEALTH_ATTEMPTS,
  intervalMs = DEFAULT_HEALTH_INTERVAL_MS,
  settleMs = 50,
}) {
  const ownsPort = () => port !== null && new RegExp(`:${port}(?!\\d)`).test(log());
  for (let i = 0; i < attempts; i += 1) {
    if (child && child.exitCode != null) break;
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) {
        if (ownsPort()) return;
        // 绑定失败的服务会在毫秒级退出；仍存活说明应答的就是我们拉起的进程。
        await sleep(settleMs);
        if (!child || child.exitCode == null) return;
        break;
      }
    } catch {
      /* 等待启动 */
    }
    await sleep(intervalMs);
  }
  const exit = child ? `exitCode=${child.exitCode ?? '运行中'}` : '无子进程';
  throw new Error(`测试服务未能启动（${base}，${exit}）：\n${log()}`);
}

function removeDbFiles(file) {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(`${file}${suffix}`, { force: true });
    } catch {
      /* ignore */
    }
  }
}

// 已启动的测试服务：对外暴露端口/基址/日志与停止能力，并保留子进程的 kill / exitCode，
// 让调用方原有的清理代码（server.kill('SIGTERM')、server.exitCode == null）语义不变。
export class TestServer {
  constructor({
    port,
    base,
    dbPath,
    child,
    log,
    attempts,
    stopAttempts = DEFAULT_STOP_ATTEMPTS,
    stopIntervalMs = DEFAULT_STOP_INTERVAL_MS,
  }) {
    this.port = port;
    this.base = base;
    this.dbPath = dbPath;
    this.child = child;
    this.attempts = attempts;
    this.log = log;
    this.stopAttempts = stopAttempts;
    this.stopIntervalMs = stopIntervalMs;
  }

  get exitCode() {
    return this.child.exitCode;
  }

  kill(signal = 'SIGTERM') {
    if (this.child.exitCode == null) this.child.kill(signal);
  }

  async stop() {
    const child = this.child;
    if (child.exitCode == null) child.kill('SIGTERM');
    for (let i = 0; i < this.stopAttempts && child.exitCode == null; i += 1) {
      await sleep(this.stopIntervalMs);
    }
    if (child.exitCode == null) child.kill('SIGKILL');
    releasePort(this.port);
    removeDbFiles(this.dbPath);
  }
}

// allocate → spawn → waitForHealth，失败就换端口重试；所有自起服务的测试共用这一条路径。
// `onAttempt({ attempt, port, dbPath })` 在每次 spawn 之前 await，供测试确定性地注入「端口被占」。
export async function startServer({
  cwd = REPO_ROOT,
  dbPath = null,
  seedHeader = false,
  env = {},
  attempts = DEFAULT_SERVER_ATTEMPTS,
  healthAttempts = DEFAULT_SERVER_HEALTH_ATTEMPTS,
  healthIntervalMs = DEFAULT_SERVER_HEALTH_INTERVAL_MS,
  stopAttempts = DEFAULT_STOP_ATTEMPTS,
  stopIntervalMs = DEFAULT_STOP_INTERVAL_MS,
  execPath = process.execPath,
  onAttempt = null,
} = {}) {
  let lastError = '';
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const port = await allocatePort();
    const databasePath =
      dbPath || path.join(os.tmpdir(), `rtd-test-${process.pid}-${Date.now()}-${port}.db`);
    if (onAttempt) await onAttempt({ attempt, port, dbPath: databasePath });
    const child = spawn(execPath, ['--no-warnings', 'server/index.mjs'], {
      cwd,
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
    try {
      await waitForHealth({ base, port, child, log: () => log, attempts: healthAttempts, intervalMs: healthIntervalMs });
    } catch {
      lastError = log;
      if (child.exitCode == null) child.kill('SIGKILL');
      releasePort(port);
      continue;
    }

    const server = new TestServer({
      port,
      base,
      dbPath: databasePath,
      child,
      log: () => log,
      attempts: attempt + 1,
      stopAttempts,
      stopIntervalMs,
    });
    return server;
  }
  throw new Error(`测试服务未能启动：${lastError}`);
}
