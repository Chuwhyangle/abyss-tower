// 测试服务器运行时：端口分配与启动就绪校验。
// 端口不再从固定段里猜：交给内核分配，再用租约文件避免同机测试进程重复选中同一个端口。
// 就绪判定必须闭环：子进程已退出就立刻失败，不能把「任意 200」当成自己拉起的服务。
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const LEASE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_ATTEMPTS = 20;
const DEFAULT_HEALTH_ATTEMPTS = 100;
const DEFAULT_HEALTH_INTERVAL_MS = 100;

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
