#!/usr/bin/env node
// 18787 部署冒烟读数器（GOAL-008 / AC-041）。
//
// 默认只读：只探测 /api/health、/api/config、首页与关键静态资源，并断言版本面。
// `--restart` 的重启动作由部署任务在显式调用时才执行；本仪器默认路径绝不写、不杀进程。
//
// 用法：
//   node scripts/deploy-smoke.mjs [--base http://127.0.0.1:18787] [--expect-version 2.0.0]
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = { base: 'http://127.0.0.1:18787', expectVersion: '2.0.0' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--base') args.base = argv[++i];
    else if (argv[i] === '--expect-version') args.expectVersion = argv[++i];
    else if (argv[i] === '--restart') args.restart = true;
  }
  return args;
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

async function getJson(base, route) {
  let response;
  try {
    response = await fetch(new URL(route, base), { signal: AbortSignal.timeout(5000) });
  } catch (error) {
    fail(`${route} 无法访问：${error.message}`);
  }
  if (!response.ok) fail(`${route} 返回 ${response.status}`);
  return response.json();
}

async function getOk(base, route) {
  let response;
  try {
    response = await fetch(new URL(route, base), { signal: AbortSignal.timeout(5000) });
  } catch (error) {
    fail(`${route} 无法访问：${error.message}`);
  }
  if (!response.ok) fail(`${route} 返回 ${response.status}`);
  return response;
}

const args = parseArgs(process.argv.slice(2));
if (args.restart) {
  fail('--restart 由部署任务实现并在显式部署时调用；本仪器默认只读，不执行重启');
}

const health = await getJson(args.base, '/api/health');
if (health.ok !== true) fail('/api/health 未返回 ok:true');

const config = await getJson(args.base, '/api/system/status');
const version = String(config.version ?? '').replace(/^v/, '');
const contentVersion = String(config.contentVersion ?? '').replace(/^v/, '');
if (version !== args.expectVersion) fail(`/api/system/status version 是 ${config.version}，期望 ${args.expectVersion}`);
if (contentVersion !== args.expectVersion) fail(`/api/system/status contentVersion 是 ${config.contentVersion}，期望 ${args.expectVersion}`);

for (const route of ['/', '/styles.css', '/js/main.js']) {
  await getOk(args.base, route);
  console.log(`PASS ${route}`);
}

const manifestRoutes = ['/assets/sprites/manifest.json'];
for (const route of manifestRoutes) {
  const response = await fetch(new URL(route, args.base), { signal: AbortSignal.timeout(5000) });
  if (response.status === 404) {
    console.log(`SKIP ${route}（该版本未使用精灵清单）`);
    continue;
  }
  if (!response.ok) fail(`${route} 返回 ${response.status}`);
  console.log(`PASS ${route}`);
}

console.log(`PASS deploy-smoke ${args.base} @ v${args.expectVersion}`);
