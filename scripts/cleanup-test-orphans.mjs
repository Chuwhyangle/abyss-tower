#!/usr/bin/env node
// 测试残留回收：扫描 /proc，找出本仓库测试自起的预览服、无头 Chrome 和卡死的测试脚本里
// 已经被「父进程已不存在或已被 systemd/init 收养」的孤儿进程。测试进程被 SIGKILL 时
// finally 来不及执行，这些孤儿会一直占内存——本脚本是那一刻之后唯一的回收手段。
//
// 识别依据（任一，且进程 cwd 必须在本仓库或其 worktree 内）：
//   - 预览服：环境变量 DB_PATH 指向 /tmp/rtd-test-* 临时库（test-server.mjs 自起的服务）；
//   - 无头 Chrome：命令行含 --headless=new 且 --user-data-dir 指向 /tmp/rtd-*；
//   - 测试脚本：命令行是仓库内的 tests/scripts 测试工具或 npm run 测试入口。
// 默认 dry-run 只列出；确认后加 --force 才发送 SIGKILL。只处理当前用户。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const force = process.argv.includes('--force');
const uid = typeof process.getuid === 'function' ? process.getuid() : null;

const TEST_TOOL = /(scripts\/visual-parity\.mjs|scripts\/visual-check\.mjs|tests\/dynamic-perf\.mjs|tests\/visual-scenes\.mjs|tests\/browser-[\w-]+\.mjs|npm run (?:perf:budget|visual:parity|test:sprites|smoke))/;

function read(pid, name) {
  try { return fs.readFileSync(`/proc/${pid}/${name}`); } catch { return null; }
}

function cmdlineOf(pid) {
  const raw = read(pid, 'cmdline');
  return raw ? raw.toString('utf8').split('\0').filter(Boolean).join(' ') : '';
}

function environOf(pid) {
  const raw = read(pid, 'environ');
  return raw ? raw.toString('utf8').split('\0').filter(Boolean) : [];
}

// /proc/<pid>/stat 的 comm 可能含空格/括号，从最后一个 ')' 之后再切字段。
function statFields(pid) {
  const stat = read(pid, 'stat')?.toString('utf8');
  if (!stat) return null;
  const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  return { state: rest[0], ppid: Number(rest[1]), pgrp: Number(rest[2]) };
}

function commOf(pid) {
  return read(pid, 'comm')?.toString('utf8').trim() ?? '';
}

function isOrphan(ppid) {
  if (!Number.isInteger(ppid) || ppid <= 0) return true;
  if (ppid === 1) return true;
  if (!fs.existsSync(`/proc/${ppid}`)) return true;
  // systemd --user 作为 subreaper 会把孤儿收养到自己名下。
  return commOf(ppid) === 'systemd';
}

function insideRepo(cwd) {
  return cwd === ROOT || cwd.startsWith(`${ROOT}${path.sep}.worktrees${path.sep}`);
}

function classify(pid, cmdline, env, cwd) {
  if (!insideRepo(cwd)) return null;
  if (env.some((entry) => entry.startsWith('DB_PATH=') && path.basename(entry.slice(8)).startsWith('rtd-test-'))) {
    return '测试预览服';
  }
  if (/--headless=new/.test(cmdline) && /--user-data-dir=\/tmp\/rtd-/.test(cmdline)) {
    return '无头 Chrome';
  }
  if (TEST_TOOL.test(cmdline)) return '测试脚本';
  return null;
}

function collect() {
  const found = [];
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (pid === process.pid) continue;
    let stat;
    try { stat = fs.statSync(`/proc/${pid}`); } catch { continue; }
    if (uid !== null && stat.uid !== uid) continue;
    const fields = statFields(pid);
    if (!fields || !isOrphan(fields.ppid)) continue;
    const cmdline = cmdlineOf(pid);
    if (!cmdline) continue;
    let cwd = '';
    try { cwd = fs.readlinkSync(`/proc/${pid}/cwd`); } catch { continue; }
    const kind = classify(pid, cmdline, environOf(pid), cwd);
    if (!kind) continue;
    const rss = Number(/^VmRSS:\s+(\d+)/m.exec(read(pid, 'status')?.toString('utf8') || '')?.[1] || 0);
    found.push({ pid, kind, rss, pgrp: fields.pgrp, cmdline });
  }
  return found;
}

function killOne(pid, pgrp) {
  try {
    if (pgrp === pid) process.kill(-pid, 'SIGKILL');
    else process.kill(pid, 'SIGKILL');
    return true;
  } catch {
    return false;
  }
}

const found = collect();
const total = found.reduce((sum, proc) => sum + proc.rss, 0);
const byKind = new Map();
for (const proc of found) byKind.set(proc.kind, (byKind.get(proc.kind) || 0) + 1);

if (!found.length) {
  console.log('[cleanup-orphans] 没有发现测试残留孤儿进程');
  process.exit(0);
}

console.log(`[cleanup-orphans] 发现 ${found.length} 个测试残留孤儿进程，合计 ${(total / 1048576).toFixed(2)} GiB：`);
console.log(`  ${[...byKind].map(([kind, count]) => `${kind} ${count} 个`).join('，')}`);
for (const proc of found) {
  console.log(`  ${proc.pid}  ${(proc.rss / 1048576).toFixed(2)} GiB  ${proc.kind}  ${proc.cmdline.slice(0, 100)}`);
}

if (!force) {
  console.log('[cleanup-orphans] dry-run，未发送信号；确认后加 --force 回收');
  process.exit(0);
}

const killed = found.filter((proc) => killOne(proc.pid, proc.pgrp)).length;
console.log(`[cleanup-orphans] 已发送 SIGKILL：${killed}/${found.length}`);
