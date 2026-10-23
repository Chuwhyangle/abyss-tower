#!/usr/bin/env node
// 版本一致性检查：CONTENT_VERSION / CHANGELOG / PRD 修订记录 / package.json。
// 只读、零依赖，可在 CI 与发布前直接调用。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const VERSION_TOKEN = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const CONTENT_VERSION_PATTERN = /\bCONTENT_VERSION\s*=\s*(?:process\.env\.CONTENT_VERSION\s*\|\|\s*)?(['"])([^'"]+)\1/;
const CHANGELOG_HEADING = /^##\s+(v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/m;

const normalize = (version) => version.replace(/^v/, '');

function readText(root, relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function readContentVersion(root) {
  const source = readText(root, 'server/config.mjs');
  const match = source.match(CONTENT_VERSION_PATTERN);
  return match ? match[2].trim() : null;
}

function readPackageVersion(root) {
  const source = readText(root, 'package.json');
  const parsed = JSON.parse(source);
  return typeof parsed.version === 'string' ? parsed.version.trim() : null;
}

function readChangelogVersions(root) {
  const source = readText(root, 'CHANGELOG.md');
  const versions = [];
  for (const line of source.split('\n')) {
    const match = line.match(/^##\s+(v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/);
    if (match) versions.push(match[1]);
  }
  return versions;
}

// 修订记录是「修订记录：」之后、缩进两个空格起的连续列表项。
function readPrdRevisionVersions(root) {
  const lines = readText(root, 'docs/PRD.md').split('\n');
  const start = lines.findIndex((line) => line.includes('修订记录'));
  if (start === -1) return null;
  const versions = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s{2,}-\s+/.test(line)) {
      const match = line.match(/^\s{2,}-\s+(v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/);
      if (match) versions.push(match[1]);
      continue;
    }
    if (line.trim() !== '') break;
  }
  return versions;
}

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function checkTag(root, tag, contentVersion, changelogVersions, errors, info) {
  let tagCommit = null;
  try {
    tagCommit = git(root, ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]);
  } catch {
    errors.push(`git: 找不到 tag ${tag}`);
    return;
  }
  const head = git(root, ['rev-parse', 'HEAD']);
  if (tagCommit !== head) {
    errors.push(`git: tag ${tag} 指向 ${tagCommit.slice(0, 7)}，当前 HEAD 为 ${head.slice(0, 7)}`);
  }
  const entry = changelogVersions.some((version) => normalize(version) === normalize(tag));
  if (!entry) {
    errors.push(`CHANGELOG.md: 缺少 tag ${tag} 对应的版本条目`);
  }
  if (contentVersion && normalize(tag) !== normalize(contentVersion)) {
    errors.push(`git: tag ${tag} 与 server/config.mjs 的 CONTENT_VERSION ${contentVersion} 不一致`);
  }
  info.push(`git: tag ${tag} 指向当前 HEAD，CHANGELOG 有对应条目`);
}

export function checkVersions(root, { tag = null } = {}) {
  const errors = [];
  const info = [];

  let contentVersion = null;
  try {
    contentVersion = readContentVersion(root);
  } catch (error) {
    errors.push(`server/config.mjs: 无法读取（${error.message}）`);
  }
  if (!contentVersion) {
    errors.push('server/config.mjs: 未找到 CONTENT_VERSION');
  } else if (!VERSION_TOKEN.test(contentVersion)) {
    errors.push(`server/config.mjs: CONTENT_VERSION ${contentVersion} 不是合法的 vX.Y.Z 版本号`);
  } else {
    info.push(`server/config.mjs: CONTENT_VERSION = ${contentVersion}`);
  }

  let changelogVersions = [];
  try {
    changelogVersions = readChangelogVersions(root);
  } catch (error) {
    errors.push(`CHANGELOG.md: 无法读取（${error.message}）`);
  }
  const changelogTop = changelogVersions[0] ?? null;
  if (!changelogTop) {
    errors.push('CHANGELOG.md: 未找到 ## vX.Y.Z 版本标题');
  } else if (contentVersion && normalize(changelogTop) !== normalize(contentVersion)) {
    errors.push(`CHANGELOG.md: 顶部版本 ${changelogTop} 与 server/config.mjs 的 CONTENT_VERSION ${contentVersion} 不一致`);
  } else {
    info.push(`CHANGELOG.md: 顶部版本 = ${changelogTop}`);
  }

  let prdVersions = null;
  try {
    prdVersions = readPrdRevisionVersions(root);
  } catch (error) {
    errors.push(`docs/PRD.md: 无法读取（${error.message}）`);
  }
  if (prdVersions === null) {
    errors.push('docs/PRD.md: 未找到「修订记录」');
  } else if (contentVersion && !prdVersions.some((version) => normalize(version) === normalize(contentVersion))) {
    const latest = prdVersions[0] ?? '无';
    errors.push(`docs/PRD.md: 修订记录缺少 ${contentVersion}（最新记录为 ${latest}）`);
  } else if (contentVersion) {
    info.push(`docs/PRD.md: 修订记录包含 ${contentVersion}`);
  }

  try {
    const packageVersion = readPackageVersion(root);
    if (!packageVersion) {
      errors.push('package.json: 缺少 version 字段');
    } else if (!SEMVER.test(packageVersion)) {
      errors.push(`package.json: version ${packageVersion} 不是合法的 semver`);
    } else if (contentVersion && normalize(packageVersion) === normalize(contentVersion)) {
      info.push(`package.json: version = ${packageVersion}（与内容版本对齐）`);
    } else {
      // 规则：package.json 允许是独立包版本，不强制与内容版本一致。
      info.push(`package.json: version = ${packageVersion}（独立包版本，不强制与内容版本一致）`);
    }
  } catch (error) {
    errors.push(`package.json: 无法读取（${error.message}）`);
  }

  if (tag) {
    checkTag(root, tag, contentVersion, changelogVersions, errors, info);
  }

  return { ok: errors.length === 0, errors, info };
}

function parseArgs(argv) {
  const options = { root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), tag: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') {
      options.root = path.resolve(argv[++i] ?? '');
    } else if (arg === '--tag') {
      options.tag = argv[++i] ?? null;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      options.error = `未知参数：${arg}`;
    }
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('用法：node scripts/check-version.mjs [--root <目录>] [--tag <tag>]');
    return 0;
  }
  if (options.error) {
    console.error(options.error);
    return 2;
  }
  const result = checkVersions(options.root, { tag: options.tag });
  if (result.ok) {
    console.log('版本一致性检查通过');
    for (const line of result.info) console.log(`  ✓ ${line}`);
    return 0;
  }
  console.error('版本一致性检查未通过：');
  for (const line of result.errors) console.error(`  ✗ ${line}`);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
