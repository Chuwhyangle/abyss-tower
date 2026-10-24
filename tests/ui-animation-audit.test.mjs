// UI 动效预算审计（源码级约束）：
// 1) 命中 layout 属性动画与超时动效，输出行号与属性名；
// 2) 无限循环只允许 transform/opacity，且总数受预算约束；
// 3) reduced-motion 覆盖缺失会被拦下；当前仓库审计零违规。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditCss, formatViolation } from '../scripts/ui-animation-audit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REDUCED = [
  '@media (prefers-reduced-motion: reduce) {',
  '  *, *::before, *::after {',
  '    animation-duration: 0.01ms !important;',
  '    transition-duration: 0.01ms !important;',
  '  }',
  '}',
  '',
].join('\n');

const lineOf = (source, needle) => {
  const index = source.split('\n').findIndex((line) => line.includes(needle));
  assert.ok(index >= 0, `fixture 缺少 ${needle}`);
  return index + 1;
};

test('keyframes 驱动 layout 属性：命中并带行号与属性名', () => {
  const css = `${REDUCED}.bad { animation: bad 400ms ease; }
@keyframes bad {
  from {
    left: 0;
  }
  to {
    left: 40px;
  }
}
`;
  const { violations } = auditCss(css);
  const hits = violations.filter((item) => item.rule === 'layout-animation');
  assert.equal(hits.length, 2, '两个 left 声明都应命中');
  assert.ok(hits.every((hit) => hit.property === 'left'));
  assert.equal(hits[0].line, lineOf(css, 'left: 0'));
  assert.match(formatViolation('demo.css', hits[0]), /demo\.css:\d+: \[layout-animation\] left/);
});

test('transition 驱动 layout 属性：命中 width', () => {
  const css = `${REDUCED}.mover {
  transition: width 200ms ease;
}
`;
  const hit = auditCss(css).violations.find((item) => item.rule === 'layout-transition');
  assert.ok(hit, 'width transition 应命中');
  assert.equal(hit.property, 'width');
  assert.equal(hit.line, lineOf(css, 'transition: width'));
});

test('transform/opacity 动画放行', () => {
  const css = `${REDUCED}.ok { animation: ok 300ms ease; }
@keyframes ok {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}
`;
  assert.deepEqual(auditCss(css).violations, []);
});

test('一次性动效超过 800ms 被标记，显式预算豁免可放行', () => {
  const keyframes = '@keyframes slow { from { opacity: 0; } to { opacity: 1; } }\n';
  const long = `${REDUCED}.slow { animation: slow 900ms ease; }
${keyframes}`;
  const hit = auditCss(long).violations.find((item) => item.rule === 'long-animation');
  assert.ok(hit, '900ms 一次性动效应命中');
  assert.equal(hit.property, 'animation');
  assert.equal(hit.line, lineOf(long, 'animation: slow'));

  const allowed = `${REDUCED}.slow {
  /* ui-motion-budget: allow-long — 需要完整展示文案 */
  animation: slow 900ms ease;
}
${keyframes}`;
  assert.deepEqual(auditCss(allowed).violations, []);

  const noReason = `${REDUCED}.slow {
  /* ui-motion-budget: allow-long */
  animation: slow 900ms ease;
}
${keyframes}`;
  const flagged = auditCss(noReason).violations.find((item) => item.rule === 'long-animation');
  assert.ok(flagged, '无理由的预算豁免不应放行');
  assert.match(flagged.message, /缺少理由/);
});

test('无限循环不受时长约束，但非合成属性被标记', () => {
  const css = `${REDUCED}.glow { animation: glow 1.9s ease infinite; }
@keyframes glow {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; box-shadow: 0 0 20px red; }
}
`;
  const { violations } = auditCss(css);
  assert.equal(violations.filter((item) => item.rule === 'long-animation').length, 0, 'infinite 不应按 800ms 判超时');
  const paint = violations.find((item) => item.rule === 'paint-infinite');
  assert.ok(paint, '无限循环的 box-shadow 应命中');
  assert.equal(paint.property, 'box-shadow');
  assert.equal(paint.line, lineOf(css, 'box-shadow'));
});

test('无限循环动效总数受预算约束', () => {
  let css = REDUCED;
  for (let index = 0; index < 5; index += 1) {
    css += `.inf${index} { animation: spin${index} 1s linear infinite; }
@keyframes spin${index} { from { opacity: 0; } to { opacity: 1; } }
`;
  }
  const hits = auditCss(css).violations.filter((item) => item.rule === 'infinite-budget');
  assert.equal(hits.length, 1, '第 5 个无限动效应命中预算');
  assert.equal(hits[0].property, 'animation');
});

test('缺少 reduced-motion 覆盖被标记', () => {
  const css = `.a { animation: ok 200ms ease; }
@keyframes ok { from { opacity: 0; } to { opacity: 1; } }
`;
  const hits = auditCss(css).violations.filter((item) => item.rule === 'reduced-motion');
  assert.equal(hits.length, 1, '缺少覆盖应命中一次');
  assert.equal(hits[0].property, 'prefers-reduced-motion');
  assert.match(hits[0].message, /prefers-reduced-motion/);
});

test('reduced-motion 只关 animation 不关 transition 也会被标记', () => {
  const css = `@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
  }
}
.a { animation: ok 200ms ease; }
@keyframes ok { from { opacity: 0; } to { opacity: 1; } }
`;
  const hits = auditCss(css).violations.filter((item) => item.rule === 'reduced-motion');
  assert.equal(hits.length, 1, '只关 animation 时 transition 仍应命中');
  assert.equal(hits[0].property, 'transition');
});

test('当前仓库 public/styles.css 审计零违规', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public/styles.css'), 'utf8');
  assert.deepEqual(auditCss(css).violations, []);
});

test('CLI：当前仓库退出码 0，违规 fixture 退出码 1 且输出行号与属性名', () => {
  const cli = path.join(ROOT, 'scripts/ui-animation-audit.mjs');
  const passing = spawnSync(process.execPath, [cli], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(passing.status, 0, passing.stderr);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-animation-audit-'));
  try {
    const file = path.join(dir, 'bad.css');
    fs.writeFileSync(file, '.bad { animation: bad 400ms ease; }\n@keyframes bad { from { left: 0; } to { left: 9px; } }\n');
    const failing = spawnSync(process.execPath, [cli, file], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(failing.status, 1, '存在违规时应退出 1');
    assert.match(failing.stderr, /bad\.css:2: \[layout-animation\] left/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
