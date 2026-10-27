#!/usr/bin/env node
// v2.0.0 版本面一致性读数器（GOAL-008 / AC-040）。
//
// 只读、可重复执行；未收口时 exit 1。版本号的事实来源组合：
//   server/config.mjs 的 CONTENT_VERSION、CHANGELOG.md 顶部条目、docs/PRD.md 修订记录、
//   package.json 的 version、docs/RELEASE.md 的发布说明。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED = '2.0.0';

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function read(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) fail(`缺少文件 ${rel}`);
  return fs.readFileSync(abs, 'utf8');
}

const normalize = (version) => String(version).trim().replace(/^v/, '');

const config = read('server/config.mjs');
const contentMatch = config.match(/CONTENT_VERSION\s*=\s*(?:process\.env\.CONTENT_VERSION\s*\|\|\s*)?(['"])([^'"]+)\1/);
if (!contentMatch) fail('server/config.mjs 中找不到 CONTENT_VERSION');
const contentVersion = normalize(contentMatch[2]);
if (contentVersion !== EXPECTED) fail(`CONTENT_VERSION 是 ${contentVersion}，期望 ${EXPECTED}`);

const pkg = JSON.parse(read('package.json'));
if (normalize(pkg.version) !== EXPECTED) fail(`package.json version 是 ${pkg.version}，期望 ${EXPECTED}`);

const changelog = read('CHANGELOG.md');
const topHeading = changelog.match(/^##\s+(v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/m);
if (!topHeading) fail('CHANGELOG.md 顶部没有版本条目');
if (normalize(topHeading[1]) !== EXPECTED) fail(`CHANGELOG 顶部是 ${topHeading[1]}，期望 v${EXPECTED}`);
const sectionStart = changelog.indexOf(topHeading[0]);
const sectionEnd = changelog.indexOf('\n## ', sectionStart + topHeading[0].length);
const changelogSection = changelog.slice(sectionStart, sectionEnd === -1 ? undefined : sectionEnd);
for (const keyword of ['地图', '海克斯', '打击感', '视觉', '肉鸽']) {
  if (!changelogSection.includes(keyword)) fail(`CHANGELOG v${EXPECTED} 段落缺少「${keyword}」`);
}

const prd = read('docs/PRD.md');
if (!prd.includes(`v${EXPECTED}`)) fail(`docs/PRD.md 修订记录没有 v${EXPECTED}`);

const release = read('docs/RELEASE.md');
if (!release.includes(`v${EXPECTED}`)) fail(`docs/RELEASE.md 没有 v${EXPECTED}`);
if (!/回滚/.test(release)) fail('docs/RELEASE.md 没有回滚说明');

console.log(`PASS release ${EXPECTED}`);
