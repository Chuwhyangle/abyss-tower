#!/usr/bin/env node
// 发布自动化：prepare / build / verify。
// 默认 dry-run，写操作必须显式 --yes；只依赖 Node 内置模块。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
const VERSION_TOKEN = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const CONTENT_VERSION_PATTERN =
  /\bCONTENT_VERSION\s*=\s*(?:process\.env\.CONTENT_VERSION\s*\|\|\s*)?(['"])([^'"]+)\1/;
const CHANGELOG_HEADING_LINE = /^##\s+(v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/;

// 发布树只保留代码与文档；任务板属于本地工作流，不进发布产物。
export const RELEASE_EXCLUDED_PATHS = Object.freeze(['tasks', 'goals', '.quay']);

const normalizeVersion = (version) => version.replace(/^v/, '');

export function parseVersion(input) {
  const raw = String(input ?? '').trim();
  if (!VERSION_TOKEN.test(raw)) {
    throw new Error(`版本号 ${raw || '(空)'} 不合法，应为 vX.Y.Z 或 X.Y.Z`);
  }
  const semver = normalizeVersion(raw);
  const match = semver.match(SEMVER);
  return {
    input: raw,
    version: `v${semver}`,
    semver,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

function compareCore(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

export function isExcludedFromRelease(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
  return RELEASE_EXCLUDED_PATHS.some(
    (entry) => normalized === entry || normalized.startsWith(`${entry}/`),
  );
}

function errorSummary(error) {
  const text = String(error?.stderr || error?.message || error).trim();
  return text.split('\n')[0] || '未知错误';
}

function runGit(root, args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 10 * 1024 * 1024,
  }).trim();
}

function isGitRepository(root) {
  try {
    runGit(root, ['rev-parse', '--is-inside-work-tree']);
    return true;
  } catch {
    return false;
  }
}

const readDirectoryFile = (root) => (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const readGitFile = (root, ref) => (relative) => runGit(root, ['show', `${ref}:${relative}`]);

function readVersionSources(readFile) {
  const sources = {
    contentVersion: null,
    changelogVersions: null,
    prdVersions: null,
    packageVersion: null,
    readErrors: [],
  };

  try {
    const source = readFile('server/config.mjs');
    const match = source.match(CONTENT_VERSION_PATTERN);
    sources.contentVersion = match ? match[2].trim() : null;
  } catch (error) {
    sources.readErrors.push(`server/config.mjs: 无法读取（${errorSummary(error)}）`);
  }

  try {
    const source = readFile('CHANGELOG.md');
    const versions = [];
    for (const line of source.split('\n')) {
      const match = line.match(CHANGELOG_HEADING_LINE);
      if (match) versions.push(match[1]);
    }
    sources.changelogVersions = versions;
  } catch (error) {
    sources.readErrors.push(`CHANGELOG.md: 无法读取（${errorSummary(error)}）`);
  }

  try {
    const lines = readFile('docs/PRD.md').split('\n');
    const start = lines.findIndex((line) => line.includes('修订记录'));
    if (start === -1) {
      sources.prdVersions = null;
      sources.readErrors.push('docs/PRD.md: 未找到「修订记录」');
    } else {
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
      sources.prdVersions = versions;
    }
  } catch (error) {
    sources.readErrors.push(`docs/PRD.md: 无法读取（${errorSummary(error)}）`);
  }

  try {
    const parsed = JSON.parse(readFile('package.json'));
    sources.packageVersion = typeof parsed.version === 'string' ? parsed.version.trim() : null;
  } catch (error) {
    sources.readErrors.push(`package.json: 无法读取（${errorSummary(error)}）`);
  }

  return sources;
}

export function collectSourceErrors(sources, expected, label, errors, info) {
  const prefix = label ? `${label}：` : '';
  const target = expected ? normalizeVersion(expected) : null;

  for (const message of sources.readErrors) errors.push(`${prefix}${message}`);

  if (sources.contentVersion) {
    if (!VERSION_TOKEN.test(sources.contentVersion)) {
      errors.push(
        `${prefix}server/config.mjs: CONTENT_VERSION ${sources.contentVersion} 不是合法的 vX.Y.Z 版本号`,
      );
    } else if (target && normalizeVersion(sources.contentVersion) !== target) {
      errors.push(
        `${prefix}server/config.mjs: CONTENT_VERSION ${sources.contentVersion} ≠ ${expected}`,
      );
    } else {
      info.push(`${prefix}server/config.mjs: CONTENT_VERSION = ${sources.contentVersion}`);
    }
  }

  if (sources.changelogVersions) {
    const top = sources.changelogVersions[0] ?? null;
    if (!top) {
      errors.push(`${prefix}CHANGELOG.md: 未找到 ## vX.Y.Z 版本标题`);
    } else if (target && normalizeVersion(top) !== target) {
      errors.push(`${prefix}CHANGELOG.md: 顶部版本 ${top} ≠ ${expected}`);
    } else {
      info.push(`${prefix}CHANGELOG.md: 顶部版本 = ${top}`);
    }
  }

  if (sources.prdVersions === null) {
    // readErrors 已记录「未找到修订记录」。
  } else if (target && !sources.prdVersions.some((v) => normalizeVersion(v) === target)) {
    const latest = sources.prdVersions[0] ?? '无';
    errors.push(`${prefix}docs/PRD.md: 修订记录缺少 ${expected}（最新记录为 ${latest}）`);
  } else if (target) {
    info.push(`${prefix}docs/PRD.md: 修订记录包含 ${expected}`);
  }

  if (sources.packageVersion === null) {
    if (!sources.readErrors.some((message) => message.startsWith('package.json'))) {
      errors.push(`${prefix}package.json: 缺少 version 字段`);
    }
  } else if (!SEMVER.test(sources.packageVersion)) {
    errors.push(`${prefix}package.json: version ${sources.packageVersion} 不是合法的 semver`);
  } else {
    info.push(`${prefix}package.json: version = ${sources.packageVersion}`);
  }
}

export function verifyRelease(root, versionArg) {
  const errors = [];
  const info = [];

  let parsed;
  try {
    parsed = parseVersion(versionArg);
  } catch (error) {
    return { ok: false, errors: [error.message], info };
  }
  const target = parsed.version;

  collectSourceErrors(readVersionSources(readDirectoryFile(root)), target, '', errors, info);

  if (!isGitRepository(root)) {
    errors.push(`git: ${root} 不是 git 仓库，无法校验 tag ${target}`);
    return { ok: false, errors, info };
  }

  let tagCommit = null;
  try {
    tagCommit = runGit(root, ['rev-parse', '--verify', `refs/tags/${target}^{commit}`]);
  } catch {
    errors.push(`git: 找不到 tag ${target}`);
  }

  if (tagCommit) {
    info.push(`git: tag ${target} → ${tagCommit.slice(0, 7)}`);
    const tagSources = readVersionSources(readGitFile(root, target));
    collectSourceErrors(tagSources, target, `tag ${target} 提交`, errors, info);
  }

  return { ok: errors.length === 0, errors, info };
}

function today() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function replaceContentVersion(source, target) {
  if (!CONTENT_VERSION_PATTERN.test(source)) return null;
  return source.replace(CONTENT_VERSION_PATTERN, (match, quote) =>
    match.replace(/(['"])([^'"]+)\1$/, `${quote}${target}${quote}`),
  );
}

function insertChangelogSection(source, target, date) {
  const lines = source.split('\n');
  const sectionLines = [`## ${target} — ${date}`, '', '- 待补充。', ''];
  const headingIndex = lines.findIndex((line) => CHANGELOG_HEADING_LINE.test(line));
  if (headingIndex === -1) {
    return `${source.replace(/\s*$/, '')}\n\n${sectionLines.join('\n')}\n`;
  }
  lines.splice(headingIndex, 0, ...sectionLines);
  return lines.join('\n');
}

function insertPrdRevision(source, target) {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line.includes('修订记录'));
  if (start === -1) return null;
  lines.splice(start + 1, 0, `  - ${target} 待补充。`);
  return lines.join('\n');
}

export function prepareRelease(root, versionArg, { write = false, date = today() } = {}) {
  const errors = [];
  const info = [];
  const updates = [];

  let parsed;
  try {
    parsed = parseVersion(versionArg);
  } catch (error) {
    return { ok: false, errors: [error.message], info, updates };
  }
  const target = parsed.version;

  const dirReader = readDirectoryFile(root);
  const current = readVersionSources(dirReader);
  const baselineErrors = [];
  collectSourceErrors(current, current.contentVersion, '', baselineErrors, []);
  if (baselineErrors.length) {
    return { ok: false, errors: baselineErrors, info, updates };
  }

  const currentVersion = current.contentVersion;
  if (compareCore(parsed, parseVersion(currentVersion)) < 0) {
    return {
      ok: false,
      errors: [`目标版本 ${target} 低于当前版本 ${currentVersion}`],
      info,
      updates,
    };
  }

  const texts = {
    'server/config.mjs': dirReader('server/config.mjs'),
    'CHANGELOG.md': dirReader('CHANGELOG.md'),
    'docs/PRD.md': dirReader('docs/PRD.md'),
    'package.json': dirReader('package.json'),
  };

  if (normalizeVersion(currentVersion) !== parsed.semver) {
    const next = replaceContentVersion(texts['server/config.mjs'], target);
    if (next === null) {
      errors.push('server/config.mjs: 未找到 CONTENT_VERSION，无法更新');
    } else {
      texts['server/config.mjs'] = next;
      updates.push(`server/config.mjs: CONTENT_VERSION ${currentVersion} → ${target}`);
    }
  }

  if (normalizeVersion(current.changelogVersions[0]) !== parsed.semver) {
    texts['CHANGELOG.md'] = insertChangelogSection(texts['CHANGELOG.md'], target, date);
    updates.push(`CHANGELOG.md: 新增 ## ${target} — ${date} 条目`);
  }

  if (!current.prdVersions.some((version) => normalizeVersion(version) === parsed.semver)) {
    const next = insertPrdRevision(texts['docs/PRD.md'], target);
    if (next === null) {
      errors.push('docs/PRD.md: 未找到「修订记录」，无法更新');
    } else {
      texts['docs/PRD.md'] = next;
      updates.push(`docs/PRD.md: 修订记录新增 ${target}`);
    }
  }

  if (errors.length) {
    return { ok: false, errors, info, updates };
  }

  const simulatedErrors = [];
  const simulatedInfo = [];
  collectSourceErrors(
    readVersionSources((relative) => texts[relative]),
    target,
    '',
    simulatedErrors,
    simulatedInfo,
  );
  if (simulatedErrors.length) {
    return { ok: false, errors: simulatedErrors, info, updates };
  }

  if (!updates.length) {
    info.push(`无需修改：版本标记已经是 ${target}`);
    return { ok: true, dryRun: !write, errors, info, updates };
  }

  if (write) {
    for (const relative of ['server/config.mjs', 'CHANGELOG.md', 'docs/PRD.md']) {
      if (texts[relative] !== dirReader(relative)) {
        fs.writeFileSync(path.join(root, relative), texts[relative]);
      }
    }
    const after = readVersionSources(dirReader);
    const afterErrors = [];
    collectSourceErrors(after, target, '', afterErrors, []);
    if (afterErrors.length) {
      return { ok: false, errors: afterErrors, info, updates };
    }
    info.push(`已写入 ${updates.length} 处版本标记`);
  }

  return { ok: true, dryRun: !write, errors, info, updates };
}

export function defaultReleaseDir(root, version) {
  return path.resolve(root, '..', `${path.basename(root)}-release`, version);
}

export function buildRelease(
  root,
  versionArg,
  { out = null, ref = 'develop', write = false } = {},
) {
  const errors = [];
  const info = [];

  let parsed;
  try {
    parsed = parseVersion(versionArg);
  } catch (error) {
    return { ok: false, errors: [error.message], info };
  }
  const target = parsed.version;

  if (!isGitRepository(root)) {
    return { ok: false, errors: [`git: ${root} 不是 git 仓库，无法创建发布树`], info };
  }

  let refCommit = null;
  try {
    refCommit = runGit(root, ['rev-parse', '--verify', `${ref}^{commit}`]);
  } catch {
    errors.push(`git: 找不到分支或提交 ${ref}`);
  }

  if (refCommit) {
    const sourceErrors = [];
    collectSourceErrors(readVersionSources(readGitFile(root, ref)), target, ref, sourceErrors, info);
    errors.push(...sourceErrors);
  }

  const outDir = out ? path.resolve(out) : defaultReleaseDir(root, target);
  if (fs.existsSync(outDir) && fs.readdirSync(outDir).length > 0) {
    errors.push(`输出目录 ${outDir} 已存在且非空，请换用 --out`);
  }

  if (errors.length) {
    return { ok: false, errors, info, outDir, ref };
  }

  if (!write) {
    info.push(`将基于 ${ref}（${refCommit.slice(0, 7)}）创建发布树：${outDir}`);
    info.push(`排除路径：${RELEASE_EXCLUDED_PATHS.join('、')}`);
    info.push('dry-run：未创建任何目录。使用 --yes 实际生成。');
    return { ok: true, dryRun: true, errors, info, outDir, ref, refCommit };
  }

  fs.mkdirSync(path.dirname(outDir), { recursive: true });
  try {
    runGit(root, ['worktree', 'add', '--detach', outDir, refCommit]);
  } catch (error) {
    return {
      ok: false,
      errors: [`git: 创建发布树失败（${errorSummary(error)}）`],
      info,
      outDir,
      ref,
    };
  }

  for (const entry of RELEASE_EXCLUDED_PATHS) {
    fs.rmSync(path.join(outDir, entry), { recursive: true, force: true });
  }
  // 发布树是独立产物，不保留指向源仓库的 .git 文件。
  fs.rmSync(path.join(outDir, '.git'), { force: true });
  try {
    runGit(root, ['worktree', 'prune']);
  } catch {
    // 清理元数据失败不影响发布树本身。
  }

  info.push(`发布树已生成：${outDir}`);
  info.push(`来源：${ref}（${refCommit.slice(0, 7)}）`);
  info.push(`已排除：${RELEASE_EXCLUDED_PATHS.join('、')}`);
  return { ok: true, dryRun: false, errors, info, outDir, ref, refCommit };
}

const USAGE = `用法：node scripts/release.mjs <命令> <version> [选项]

命令：
  prepare <version>  校验版本一致性，并更新 CONTENT_VERSION / CHANGELOG / PRD
  build <version>    从 --ref（默认 develop）生成仅代码的发布树
  verify <version>   校验 tag / CHANGELOG / 版本号三者一致

选项：
  --root <目录>      仓库根目录（默认脚本所在仓库）
  --out <目录>       build 的输出目录（默认 <仓库名>-release/<version>）
  --ref <ref>        build 的来源分支或提交（默认 develop）
  --date <日期>      prepare 写入 CHANGELOG 的日期（默认今天，YYYY-MM-DD）
  --yes              实际写入或创建（默认 dry-run）
  --help             显示本帮助
`;

function parseArgs(argv) {
  const options = {
    root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    out: null,
    ref: 'develop',
    date: today(),
    yes: false,
    help: false,
    command: null,
    version: null,
  };
  const positionals = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--yes') {
      options.yes = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--root' || arg === '--out' || arg === '--ref' || arg === '--date') {
      const value = argv[i + 1];
      if (value === undefined) {
        options.error = `参数 ${arg} 缺少取值`;
        return options;
      }
      i += 1;
      options[arg.slice(2)] = value;
    } else if (arg.startsWith('-')) {
      options.error = `未知参数：${arg}`;
      return options;
    } else {
      positionals.push(arg);
    }
  }

  [options.command, options.version] = positionals;
  if (positionals.length > 2) options.error = `多余的参数：${positionals.slice(2).join(' ')}`;
  options.root = path.resolve(options.root);
  return options;
}

function printResult(result) {
  for (const line of result.info ?? []) console.log(`  ✓ ${line}`);
  for (const line of result.errors ?? []) console.error(`  ✗ ${line}`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  if (options.error) {
    console.error(options.error);
    console.error(USAGE);
    return 2;
  }
  if (!options.command || !options.version) {
    console.error('缺少命令或版本号');
    console.error(USAGE);
    return 2;
  }

  if (options.command === 'verify') {
    const result = verifyRelease(options.root, options.version);
    if (result.ok) {
      console.log(`发布校验 ${options.version} 通过`);
      printResult(result);
      return 0;
    }
    console.error(`发布校验 ${options.version} 未通过：`);
    printResult(result);
    return 1;
  }

  if (options.command === 'prepare') {
    const result = prepareRelease(options.root, options.version, {
      write: options.yes,
      date: options.date,
    });
    if (!result.ok) {
      console.error(`准备发布 ${options.version} 未通过：`);
      printResult(result);
      return 1;
    }
    console.log(`准备发布 ${options.version}：`);
    for (const line of result.updates) console.log(`  → ${line}`);
    printResult(result);
    if (result.updates.length && result.dryRun) {
      console.log('dry-run：未写入任何文件。使用 --yes 实际写入。');
    }
    return 0;
  }

  if (options.command === 'build') {
    const result = buildRelease(options.root, options.version, {
      out: options.out,
      ref: options.ref,
      write: options.yes,
    });
    if (!result.ok) {
      console.error(`生成发布树 ${options.version} 未通过：`);
      printResult(result);
      return 1;
    }
    console.log(`生成发布树 ${options.version}：`);
    printResult(result);
    return 0;
  }

  console.error(`未知命令：${options.command}`);
  console.error(USAGE);
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
