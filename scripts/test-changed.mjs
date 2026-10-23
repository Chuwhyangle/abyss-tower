#!/usr/bin/env node
// 按改动文件选择测试的本地快筛。零依赖。
// 仅用于本地 / worker 内环提速；合并前门禁（npm test、fan-in）永远跑全量。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TEST_FILE = /^tests\/[^/]+\.test\.mjs$/;

// 共享文件：改动会影响面过广，直接回退全量。
export const SHARED_RULES = [
  { match: 'public/js/sim.js', reason: 'sim.js 是确定性战斗核心，影响面覆盖全量' },
  { match: 'public/js/shared/', reason: 'shared/ 为前后端共享模块，影响面覆盖全量' },
  { match: 'server/index.mjs', reason: '服务端入口，多个集成测试共同启动' },
  { match: 'server/data/', reason: '运行时数据目录被集成测试共用' },
  { match: 'package.json', reason: 'scripts 与依赖变化影响所有测试' },
  { match: '.github/', reason: 'CI 配置变化影响整个流水线' },
];

// 审计范围：这些目录下的源码文件必须有规则覆盖（测试、文档、配置不在范围内）。
export const SOURCE_ROOTS = ['public/', 'server/', 'scripts/'];
const SOURCE_FILE = /\.(?:js|mjs|css|html)$/;

// 显式映射：源文件（或目录前缀，以 / 结尾）→ 覆盖它的测试。集中维护。
export const TEST_MAP = [
  // 浏览器应用层
  { match: 'public/auth.css', tests: ['tests/ui-styles.test.mjs'] },
  { match: 'public/js/achievements-ui.js', tests: [
    'tests/icon-system.test.mjs',
    'tests/panels-visual.test.mjs',
  ] },
  { match: 'public/js/audio.js', tests: [
    'tests/audio-events.test.mjs',
    'tests/audio-mix.test.mjs',
    'tests/music.test.mjs',
    'tests/music-variants.test.mjs',
    'tests/skill-audio.test.mjs',
  ] },
  { match: 'public/js/auth-ui.js', tests: ['tests/controller-wiring.test.mjs'] },
  { match: 'public/js/bounties-ui.js', tests: ['tests/bounties.test.mjs'] },
  { match: 'public/js/cosmetics-ui.js', tests: ['tests/cosmetics.test.mjs'] },
  { match: 'public/js/daily-history-ui.js', tests: [
    'tests/daily-history.test.mjs',
    'tests/icon-system.test.mjs',
  ] },
  { match: 'public/js/game-app.js', tests: [
    'tests/music-variants.test.mjs',
    'tests/skill-audio.test.mjs',
  ] },
  { match: 'public/js/main.js', tests: ['tests/api.test.mjs'] },
  { match: 'public/js/relic-codex-ui.js', tests: [
    'tests/i18n.test.mjs',
    'tests/relic-codex.test.mjs',
  ] },
  { match: 'public/js/replay-ui.js', tests: ['tests/replays.test.mjs'] },
  { match: 'public/js/season-ui.js', tests: [
    'tests/i18n.test.mjs',
    'tests/icon-system.test.mjs',
    'tests/season-ui.test.mjs',
  ] },
  { match: 'public/js/share-ui.js', tests: ['tests/share-ui.test.mjs'] },
  { match: 'public/js/stats-ui.js', tests: [
    'tests/icon-system.test.mjs',
    'tests/panels-visual.test.mjs',
  ] },
  { match: 'public/js/ui.js', tests: [
    'tests/a11y-color.test.mjs',
    'tests/i18n.test.mjs',
    'tests/icon-system.test.mjs',
    'tests/panels-visual.test.mjs',
    'tests/relic-codex.test.mjs',
    'tests/season-ui.test.mjs',
    'tests/share-ui.test.mjs',
  ] },
  { match: 'public/js/app/', tests: ['tests/controller-wiring.test.mjs'] },
  { match: 'public/js/app/boot-errors.js', tests: ['tests/api-errors.test.mjs'] },
  { match: 'public/js/app/input.js', tests: ['tests/mobile-input.test.mjs'] },
  { match: 'public/js/api.js', tests: ['tests/api-errors.test.mjs'] },
  { match: 'public/js/settings.js', tests: [
    'tests/settings.test.mjs',
    'tests/audio-mix.test.mjs',
    'tests/music.test.mjs',
    'tests/skill-audio.test.mjs',
  ] },
  { match: 'public/js/i18n.js', tests: ['tests/i18n.test.mjs'] },
  { match: 'public/js/leaderboard-ui.js', tests: ['tests/leaderboard.test.mjs'] },
  { match: 'public/index.html', tests: ['tests/ui-styles.test.mjs', 'tests/leaderboard.test.mjs'] },
  { match: 'public/styles.css', tests: ['tests/ui-styles.test.mjs'] },

  // 渲染层
  { match: 'public/js/render.js', tests: [
    'tests/render-visuals.test.mjs',
    'tests/skill-visuals.test.mjs',
  ] },
  { match: 'public/js/render/canvas-shapes.js', tests: ['tests/icon-system.test.mjs'] },
  { match: 'public/js/render/floater-renderer.js', tests: ['tests/render-visuals.test.mjs'] },
  { match: 'public/js/render/overlay-renderer.js', tests: ['tests/render-visuals.test.mjs'] },
  { match: 'public/js/render/tower-renderer.js', tests: ['tests/render-animations.test.mjs'] },
  { match: 'public/js/render/background-renderer.js', tests: [
    'tests/biome-visuals.test.mjs',
    'tests/render-visuals.test.mjs',
  ] },
  { match: 'public/js/render/palette.js', tests: [
    'tests/biome-visuals.test.mjs',
    'tests/render-visuals.test.mjs',
  ] },
  { match: 'public/js/render/effect-renderer.js', tests: [
    'tests/effect-variants.test.mjs',
    'tests/render-effects.test.mjs',
  ] },
  { match: 'public/js/render/glow-renderer.js', tests: [
    'tests/effect-variants.test.mjs',
    'tests/render-effects.test.mjs',
    'tests/render-budget.test.mjs',
  ] },
  { match: 'public/js/render/enemy-renderer.js', tests: ['tests/enemies-depth.test.mjs'] },
  { match: 'public/js/render/projectile-renderer.js', tests: ['tests/render-budget.test.mjs'] },
  { match: 'public/js/render/skill-renderer.js', tests: [
    'tests/render-budget.test.mjs',
    'tests/skill-visuals.test.mjs',
  ] },
  { match: 'public/js/render/portal-renderer.js', tests: ['tests/render-visuals.test.mjs'] },

  // 服务端
  { match: 'server/config.mjs', tests: [
    'tests/auth.test.mjs',
    'tests/check-version.test.mjs',
    'tests/leaderboard.test.mjs',
    'tests/runs-service.test.mjs',
  ] },
  { match: 'server/http/context.mjs', tests: ['tests/architecture.test.mjs'] },
  { match: 'server/http/error-log.mjs', tests: ['tests/error-log.test.mjs'] },
  { match: 'server/auth/', tests: ['tests/auth.test.mjs'] },
  { match: 'server/db/migrations/', tests: ['tests/migration.test.mjs'] },
  { match: 'server/db/', tests: [
    'tests/migration.test.mjs',
    'tests/leaderboard-season.test.mjs',
    'tests/stats.test.mjs',
    'tests/runs-service.test.mjs',
  ] },
  { match: 'server/db.mjs', tests: ['tests/migration.test.mjs'] },
  { match: 'server/http/respond.mjs', tests: [
    'tests/http-hardening.test.mjs',
    'tests/security-headers.test.mjs',
  ] },
  { match: 'server/http/static.mjs', tests: ['tests/http-hardening.test.mjs'] },
  { match: 'server/routes/', tests: [
    'tests/architecture.test.mjs',
    'tests/auth.test.mjs',
    'tests/leaderboard.test.mjs',
    'tests/leaderboard-season.test.mjs',
    'tests/stats.test.mjs',
    'tests/runs-service.test.mjs',
  ] },
  { match: 'server/services/', tests: [
    'tests/architecture.test.mjs',
    'tests/runs-service.test.mjs',
  ] },

  // 工具脚本
  { match: 'scripts/backup.mjs', tests: ['tests/ops-cli.test.mjs'] },
  { match: 'scripts/check-version.mjs', tests: ['tests/check-version.test.mjs'] },
  { match: 'scripts/coverage.mjs', tests: ['tests/coverage-script.test.mjs'] },
  { match: 'scripts/dead-exports.mjs', tests: ['tests/import-graph.test.mjs'] },
  { match: 'scripts/docs-preview.mjs', tests: ['tests/docs-preview.test.mjs'] },
  { match: 'scripts/import-graph.mjs', tests: ['tests/import-graph.test.mjs'] },
  { match: 'scripts/install-hooks.mjs', tests: ['tests/hooks.test.mjs'] },
  { match: 'scripts/memory-check.mjs', tests: ['tests/memory-check.test.mjs'] },
  { match: 'scripts/ops.mjs', tests: ['tests/ops-cli.test.mjs'] },
  { match: 'scripts/perf-budget.mjs', tests: ['tests/perf-budget.test.mjs'] },
  { match: 'scripts/release.mjs', tests: ['tests/release-script.test.mjs'] },
  { match: 'scripts/settle-seasons.mjs', tests: ['tests/settle-seasons.test.mjs'] },
  { match: 'scripts/style-check.mjs', tests: ['tests/style-check.test.mjs'] },
  { match: 'scripts/test-changed.mjs', tests: ['tests/test-changed.test.mjs'] },
];

export function normalizePath(file) {
  return String(file).trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

function matchesRule(rule, file) {
  return rule.match.endsWith('/') ? file.startsWith(rule.match) : file === rule.match;
}

export function listTestFiles(root = REPO_ROOT) {
  const dir = path.join(root, 'tests');
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.test.mjs'))
    .map((entry) => `tests/${entry.name}`)
    .sort();
}

export function listSourceFiles(root = REPO_ROOT) {
  const files = [];
  const walk = (dir, prefix) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relative = `${prefix}${entry.name}`;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), `${relative}/`);
      } else if (entry.isFile() && SOURCE_FILE.test(entry.name)) {
        files.push(relative);
      }
    }
  };
  for (const dir of SOURCE_ROOTS) walk(path.join(root, dir), dir);
  return files.sort();
}

// 审计映射完备性：每个源文件都应由共享规则或显式映射覆盖。
export function auditCoverage({ files = listSourceFiles(), sharedRules = SHARED_RULES, testMap = TEST_MAP } = {}) {
  const uncovered = files.filter((file) => {
    const normalized = normalizePath(file);
    return ![...sharedRules, ...testMap].some((rule) => matchesRule(rule, normalized));
  });
  return { checked: files.length, uncovered };
}

// 纯函数：给定改动文件与候选测试，返回选择结果。
export function selectTests(changedFiles, { testFiles = listTestFiles() } = {}) {
  const allTests = [...new Set(testFiles.map(normalizePath))].sort();
  const known = new Set(allTests);
  const decisions = [];
  const selected = new Set();
  const fullReasons = [];

  for (const raw of changedFiles) {
    const file = normalizePath(raw);
    if (!file) continue;

    if (TEST_FILE.test(file)) {
      if (known.has(file)) selected.add(file);
      decisions.push({ file, kind: 'test', tests: [file], reason: '测试文件自身改动' });
      continue;
    }

    const shared = SHARED_RULES.find((rule) => matchesRule(rule, file));
    if (shared) {
      fullReasons.push({ file, reason: shared.reason });
      decisions.push({ file, kind: 'shared', tests: [], reason: shared.reason });
      continue;
    }

    const mapped = TEST_MAP.filter((rule) => matchesRule(rule, file))
      .flatMap((rule) => rule.tests)
      .map(normalizePath)
      .filter((test) => known.has(test));
    if (mapped.length === 0) {
      const reason = '未覆盖映射，回退全量';
      fullReasons.push({ file, reason });
      decisions.push({ file, kind: 'unmapped', tests: [], reason });
      continue;
    }
    for (const test of mapped) selected.add(test);
    decisions.push({ file, kind: 'mapped', tests: [...new Set(mapped)].sort(), reason: '命中显式映射' });
  }

  if (changedFiles.length === 0) {
    return { mode: 'none', tests: [], decisions, fullReasons: [] };
  }
  if (fullReasons.length > 0) {
    return { mode: 'full', tests: allTests, decisions, fullReasons };
  }
  if (selected.size === 0) {
    return { mode: 'none', tests: [], decisions, fullReasons: [] };
  }
  return { mode: 'selected', tests: [...selected].sort(), decisions, fullReasons: [] };
}

export function formatReport(selection, { base = 'develop' } = {}) {
  const lines = [];
  const changed = selection.decisions.length;
  if (selection.mode === 'none') {
    lines.push(`test-changed: 相对 ${base} 无改动，跳过。`);
    return lines;
  }
  if (selection.mode === 'full') {
    lines.push(`test-changed: 回退全量（${changed} 个改动文件，${selection.fullReasons.length} 个原因）`);
    for (const { file, reason } of selection.fullReasons) lines.push(`  ✗ ${file}：${reason}`);
    lines.push(`test-changed: 将运行全部 ${selection.tests.length} 个测试；门禁仍以 npm test 全量为准。`);
    return lines;
  }
  lines.push(`test-changed: 选中 ${selection.tests.length} 个测试（${changed} 个改动文件，本地快筛）`);
  for (const decision of selection.decisions) {
    const target = decision.tests.length > 0 ? decision.tests.join(', ') : '（无）';
    lines.push(`  ✓ ${decision.file} → ${target}`);
  }
  return lines;
}

function parseArgs(argv) {
  let base = 'develop';
  let run = false;
  let audit = false;
  let root = REPO_ROOT;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--base' && argv[i + 1]) {
      base = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--root' && argv[i + 1]) {
      root = path.resolve(argv[i + 1]);
      i += 1;
    } else if (argv[i] === '--run') {
      run = true;
    } else if (argv[i] === '--audit') {
      audit = true;
    }
  }
  return { base, run, audit, root };
}

function runAudit(root) {
  const { checked, uncovered } = auditCoverage({ files: listSourceFiles(root) });
  if (uncovered.length === 0) {
    console.log(`test-changed: 审计通过，${checked} 个源文件均被规则覆盖。`);
    return;
  }
  console.log(`test-changed: 审计发现 ${uncovered.length} 个源文件未被任何规则覆盖：`);
  for (const file of uncovered) console.log(`  ✗ ${file}`);
  console.log('test-changed: 这些文件改动会回退全量；请补充 SHARED_RULES 或 TEST_MAP。');
  process.exitCode = 1;
}

function changedFilesFor(base) {
  const result = spawnSync('git', ['-C', REPO_ROOT, 'diff', '--name-only', `${base}...HEAD`], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.error?.message || '').trim();
    throw new Error(`无法与基准分支 ${base} 比较（用 --base <branch> 指定）${detail ? `：${detail}` : ''}`);
  }
  return result.stdout.split('\n').map(normalizePath).filter(Boolean);
}

function main() {
  const { base, run, audit, root } = parseArgs(process.argv.slice(2));
  if (audit) {
    runAudit(root);
    return;
  }
  let changed;
  try {
    changed = changedFilesFor(base);
  } catch (error) {
    console.error(`test-changed: ${error.message}`);
    process.exitCode = 2;
    return;
  }

  const selection = selectTests(changed, { testFiles: listTestFiles(REPO_ROOT) });
  console.log(formatReport(selection, { base }).join('\n'));

  if (selection.mode === 'none') return;
  if (!run) {
    const hint = selection.mode === 'full' ? '（等价于 npm test）' : `：node --test ${selection.tests.join(' ')}`;
    console.log(`test-changed: 加 --run 执行${hint}`);
    return;
  }

  const result = spawnSync(process.execPath, ['--no-warnings', '--test', ...selection.tests], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
