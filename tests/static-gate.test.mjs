// 静态检查链（GOAL-009 AC-045）的漂移钉子。
//
// 三处必须机械对齐：
//   1. `docs/PHASE_REFACTOR.md` §7 表里的 AC-045 判据单元格；
//   2. `package.json` 的 `check:static`（四命令的唯一执行入口）；
//   3. `.github/workflows/ci.yml` 里调用它的那一步。
// 另有一条子集断言：`verify:local` 必须仍然覆盖 `check:static` 的每一段。
//
// 全部是纯结构断言 + 临时 fixture 负对照，不执行任何扫描命令（毫秒级）；
// 真正的执行验证是 `npm run check:static` 本身。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const FILES = {
  package: 'package.json',
  ci: '.github/workflows/ci.yml',
  phase: 'docs/PHASE_REFACTOR.md',
};

// AC-045 判据的组成部分与顺序（判据本体，测试的对照基线）。
export const AC_045_CHECKS = [
  'npm run check:syntax',
  'npm run check:imports',
  'npm run check:style',
  'npm run check:docs',
];

const CRITERION_AC = 'AC-045';
const STATIC_ENTRY = 'check:static';
const STATIC_STEP = 'npm run check:static';
// CI 里旧的自写语法检查实现；收敛后全文不得再出现。
const LEGACY_SYNTAX_CHECK = '--input-type=module --check';

// 把 "npm run a && npm run b" 拆成 ['npm run a', 'npm run b']；空/非法 → []。
export function splitChain(command) {
  if (typeof command !== 'string') return [];
  return command
    .split('&&')
    .map((segment) => segment.trim())
    .filter(Boolean);
}

// 从 AC 映射表里取某条 AC 的命令单元格（最后一列，去掉反引号）。
export function criterionCommand(markdown, ac = CRITERION_AC) {
  const row = markdown
    .split('\n')
    .find((line) => new RegExp(`^\\|\\s*${ac}\\s*\\|`).test(line));
  if (!row) return null;
  const cells = row
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());
  const command = (cells.at(-1) || '').replace(/`/g, '').trim();
  return command || null;
}

const sameList = (left, right) =>
  left.length === right.length && left.every((item, index) => item === right[index]);

const formatValue = (segments) => (segments.length ? segments.join(' → ') : '（空）');

/**
 * 纯判定：返回漂移清单（空数组 = 三处一致）。
 * @param {{pkg: object, ci: string, phaseDoc: string}} sources 已读入内存的三份文本
 */
export function analyzeStaticGate({ pkg, ci, phaseDoc }) {
  const errors = [];
  const push = (code, message) => errors.push({ code, message });
  const scripts = (pkg && pkg.scripts) || {};

  // (a) 判据 ↔ check:static：判据可以逐字写四命令（当前冻结表），
  //     也可以只引用唯一入口（收口后），两种写法都必须与 AC-045 的组成一致。
  const criterion = criterionCommand(phaseDoc || '');
  if (!criterion) {
    push('criterion-missing', `${FILES.phase} 的 AC 表缺少 ${CRITERION_AC} 的命令单元格`);
  } else {
    const criterionSegments = splitChain(criterion);
    const collapsed = criterionSegments.length === 1 && criterionSegments[0] === STATIC_STEP;
    if (!collapsed && !sameList(criterionSegments, AC_045_CHECKS)) {
      push(
        'criterion-drift',
        `${CRITERION_AC} 判据应为 ${formatValue(AC_045_CHECKS)}，实际为 ${formatValue(criterionSegments)}`,
      );
    }
  }

  // (a') check:static 自身的组成、顺序与引用完整性
  const chain = scripts[STATIC_ENTRY];
  const staticSegments = splitChain(chain);
  if (typeof chain !== 'string' || !chain.trim()) {
    push('static-missing', `${FILES.package} 缺少 scripts["${STATIC_ENTRY}"]`);
  } else if (!sameList(staticSegments, AC_045_CHECKS)) {
    push(
      'static-drift',
      `check:static 应逐字为 ${formatValue(AC_045_CHECKS)}，实际为 ${formatValue(staticSegments)}`,
    );
  } else {
    for (const segment of staticSegments) {
      const key = segment.replace(/^npm run\s+/, '');
      if (!segment.startsWith('npm run ') || !(key in scripts)) {
        push('static-unknown', `check:static 引用了不存在的脚本：${segment}`);
      }
    }
  }

  // (b) 子集：verify:local 必须覆盖 check:static 的每一段（防止只改一处留下缺口）
  const verifySegments = splitChain(scripts['verify:local']);
  for (const segment of staticSegments) {
    if (!verifySegments.includes(segment)) {
      push('verify-gap', `verify:local 不再覆盖 ${segment}`);
    }
  }

  // (c) CI 接线：调用唯一入口，且不再保留第二套语法检查实现
  const ciText = ci || '';
  if (!ciText.includes(STATIC_STEP)) {
    push('ci-missing-step', `${FILES.ci} 缺少 "${STATIC_STEP}" 步骤`);
  }
  if (ciText.includes(LEGACY_SYNTAX_CHECK)) {
    push('ci-legacy-syntax', `${FILES.ci} 仍含第二套语法检查 "${LEGACY_SYNTAX_CHECK}"`);
  }

  return errors;
}

export function formatErrors(errors) {
  return errors.map(({ code, message }) => `[${code}] ${message}`).join('\n');
}

function readSources(root) {
  const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
  return {
    pkg: JSON.parse(read(FILES.package)),
    ci: read(FILES.ci),
    phaseDoc: read(FILES.phase),
  };
}

// 把三份真实文件复制进临时目录、施加文本改动，再按「读文件 → 判定」的同一路径分析。
// 负对照因此走的是和真实检查完全相同的读取与解析代码，不是对字符串做弱匹配。
function fixture(t, mutate) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'static-gate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const files = Object.fromEntries(
    Object.values(FILES).map((relative) => [relative, fs.readFileSync(path.join(ROOT, relative), 'utf8')]),
  );
  const mutated = (mutate ? mutate(files) : null) || files;
  for (const [relative, text] of Object.entries(mutated)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  }
  return readSources(root);
}

const editScripts = (mutator) => (files) => {
  const pkg = JSON.parse(files[FILES.package]);
  mutator(pkg.scripts);
  files[FILES.package] = `${JSON.stringify(pkg, null, 2)}\n`;
  return files;
};

const codes = (errors) => errors.map((error) => error.code);

test('真实仓库三处一致：AC-045 判据 / check:static / CI 步骤无漂移', (t) => {
  const errors = analyzeStaticGate(readSources(ROOT));
  assert.deepEqual(errors, [], formatErrors(errors));

  const sources = fixture(t);
  assert.deepEqual(analyzeStaticGate(sources), []);
});

test('负对照：删掉 check:static 的任一段 → 漂移钉子转红', (t) => {
  const sources = fixture(t, editScripts((scripts) => {
    scripts[STATIC_ENTRY] = splitChain(scripts[STATIC_ENTRY])
      .filter((segment) => segment !== 'npm run check:imports')
      .join(' && ');
  }));

  const errors = analyzeStaticGate(sources);
  assert.ok(errors.length > 0, '删掉一段后仍判绿');
  assert.ok(codes(errors).includes('static-drift'), formatErrors(errors));
});

test('负对照：调换 check:static 的段顺序 → 漂移钉子转红', (t) => {
  const sources = fixture(t, editScripts((scripts) => {
    scripts[STATIC_ENTRY] = [
      'npm run check:syntax',
      'npm run check:style',
      'npm run check:imports',
      'npm run check:docs',
    ].join(' && ');
  }));

  const errors = analyzeStaticGate(sources);
  assert.ok(codes(errors).includes('static-drift'), formatErrors(errors));
});

test('负对照：删掉 verify:local 的 check:imports → 子集断言转红', (t) => {
  const sources = fixture(t, editScripts((scripts) => {
    scripts['verify:local'] = splitChain(scripts['verify:local'])
      .filter((segment) => segment !== 'npm run check:imports')
      .join(' && ');
  }));

  const errors = analyzeStaticGate(sources);
  assert.ok(codes(errors).includes('verify-gap'), formatErrors(errors));
});

test('负对照：从 ci.yml 删掉静态检查步骤 → CI 接线断言转红', (t) => {
  const sources = fixture(t, (files) => {
    files[FILES.ci] = files[FILES.ci].replace(`      - name: 静态检查（语法 + 导入图 + 风格 + 文档）\n        run: ${STATIC_STEP}\n`, '');
    return files;
  });

  const errors = analyzeStaticGate(sources);
  assert.ok(codes(errors).includes('ci-missing-step'), formatErrors(errors));
});

test('负对照：ci.yml 退回自写语法检查 → 「只有一套实现」断言转红', (t) => {
  const sources = fixture(t, (files) => {
    files[FILES.ci] += [
      '      - name: 自写语法检查',
      '        run: |',
      "          node --input-type=module --check < server/index.mjs",
      '',
    ].join('\n');
    return files;
  });

  const errors = analyzeStaticGate(sources);
  assert.ok(codes(errors).includes('ci-legacy-syntax'), formatErrors(errors));
});

test('负对照：AC-045 判据被改写 → 判据对齐断言转红', (t) => {
  const sources = fixture(t, (files) => {
    const criterion = criterionCommand(files[FILES.phase]);
    assert.ok(criterion, '真实文档里应能找到 AC-045 的命令单元格');
    const truncated = splitChain(criterion).slice(1).join(' && ');
    files[FILES.phase] = files[FILES.phase].replace(criterion, truncated);
    return files;
  });

  const errors = analyzeStaticGate(sources);
  assert.ok(
    codes(errors).some((code) => code === 'criterion-drift' || code === 'criterion-missing'),
    formatErrors(errors),
  );
});

test('AC-045 判据单元格可被机械解析为四段', () => {
  const command = criterionCommand(fs.readFileSync(path.join(ROOT, FILES.phase), 'utf8'));
  assert.ok(command, '未找到 AC-045 行');
  const segments = splitChain(command);
  const collapsed = segments.length === 1 && segments[0] === STATIC_STEP;
  assert.ok(collapsed || sameList(segments, AC_045_CHECKS), formatValue(segments));
});
