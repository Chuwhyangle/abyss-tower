// 测试隔离审计脚本：样例命中 / 放行 / 抑制标记 / 报告格式与退出码。
// 本文件会被审计脚本自己扫描，所以夹具里的违规示例都带 isolation-audit-ignore 标记；
// fixture() 会先剥掉标记再交给扫描器，保证「命中」用例仍然能验证检测逻辑。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RULES, auditDirectory, formatReport, scanSources } from '../scripts/test-isolation-audit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'test-isolation-audit.mjs');
const MARKER = /[ \t]*\/\/[ \t]*isolation-audit-ignore\b[^\n]*/g;

function fixture(lines) {
  return lines.map((line) => line.replace(MARKER, '')).join('\n') + '\n';
}

function scan(source, file = 'tests/sample.test.mjs', options = {}) {
  return scanSources([{ file, source }], options);
}

const CLEAN = fixture([
  "import os from 'node:os';",
  'const PORT = await allocatePort();',
  'const DB = path.join(os.tmpdir(), `rtd-${process.pid}-${Date.now()}.db`);',
  "fs.mkdirSync(path.join(os.tmpdir(), `rtd-${process.pid}`), { recursive: true });",
  'const username = `u${Date.now().toString(36)}`;',
  "server.listen(0, '127.0.0.1');",
]);

test('放行：内核分配端口、临时目录 DB、临时目录写入、随机用户名', () => {
  const findings = scan(CLEAN);
  assert.deepEqual(findings, []);
});

test('命中：随机猜端口段', () => {
  const source = fixture([
    'const PORT = 19000 + Math.floor(Math.random() * 500); // isolation-audit-ignore',
    'const debugPort = 30000 + Math.floor(Math.random() * 1000); // isolation-audit-ignore',
  ]);
  const findings = scan(source);
  assert.deepEqual(findings.map((finding) => finding.rule), [RULES.RANDOM_PORT_GUESS, RULES.RANDOM_PORT_GUESS]);
  assert.deepEqual(findings.map((finding) => finding.line), [1, 2]);
});

test('命中：硬编码端口 / 固定 DB / 写仓库 / 共用用户名', () => {
  const source = fixture([
    'const PORT = 8123; // isolation-audit-ignore',
    "server.listen(7000, '127.0.0.1'); // isolation-audit-ignore",
    "const DB_PATH = 'server/data/game.db'; // isolation-audit-ignore",
    "fs.writeFileSync(path.join(ROOT, 'docs', 'x.md'), 'x'); // isolation-audit-ignore",
    "registerAndLogin(base, { username: 'alice' }); // isolation-audit-ignore",
  ]);
  const findings = scanSources([
    { file: 'tests/a.test.mjs', source },
    { file: 'tests/b.test.mjs', source: "registerAndLogin(base, { username: 'alice' });\n" },
  ]);
  const rules = findings.map((finding) => finding.rule);
  assert.ok(rules.includes(RULES.HARDCODED_PORT));
  assert.ok(rules.includes(RULES.FIXED_DB_PATH));
  assert.ok(rules.includes(RULES.REPO_WRITE));
  assert.equal(rules.filter((rule) => rule === RULES.SHARED_USERNAME).length, 2);
  const ports = findings.filter((finding) => finding.rule === RULES.HARDCODED_PORT).map((finding) => finding.line);
  assert.deepEqual(ports, [1, 2]);
  const db = findings.find((finding) => finding.rule === RULES.FIXED_DB_PATH);
  assert.equal(db.line, 3);
  assert.match(db.detail, /server\/data\/game\.db/);
});

test('注释里的示例不算违规，抑制标记可按行放行', () => {
  const commented = fixture([
    '// const PORT = 9000; // isolation-audit-ignore',
    '/* const DB_PATH = "server/data/x.db"; */ // isolation-audit-ignore',
    'const real = 1;',
  ]);
  assert.deepEqual(scan(commented), []);

  // 拼接第三行，避免审计扫描本测试文件时把夹具源码当成真实违规。
  const suppressed = [
    '// isolation-audit-ignore',
    'const PORT = 8123;',
    'const PORT' + ' = 8124;',
  ].join('\n');
  const findings = scan(suppressed);
  assert.deepEqual(findings.map((finding) => finding.line), [3]);
});

test('listen(0) 与变量基点写目录不误报', () => {
  const source = fixture([
    "server.listen(0, '127.0.0.1');",
    "fs.writeFileSync(path.join(root, 'docs/GUIDE.md'), 'x');",
    'fs.writeFileSync(path.join(dir, `rtd-${process.pid}`, \'a.txt\'), \'x\');',
  ]);
  assert.deepEqual(scan(source), []);
});

test('手工 CLI 默认不判 repo-write，加 --include-tools 后判', () => {
  const source = fixture(["fs.writeFileSync(path.join(ROOT, 'docs', 'PERFORMANCE.md'), 'x'); // isolation-audit-ignore"]);
  assert.deepEqual(scan(source, 'tests/dynamic-perf.mjs'), []);
  const findings = scan(source, 'tests/dynamic-perf.mjs', { includeTools: true });
  assert.deepEqual(findings.map((finding) => finding.rule), [RULES.REPO_WRITE]);
});

test('固定用户名只在跨文件复用时才算共享', () => {
  const twiceInOneFile = fixture([
    "registerAndLogin(base, { username: 'alice' }); // isolation-audit-ignore",
    "registerAndLogin(base, { username: 'alice' }); // isolation-audit-ignore",
  ]);
  assert.deepEqual(scan(twiceInOneFile), []);
  const acrossFiles = scanSources([
    { file: 'tests/a.test.mjs', source: twiceInOneFile },
    { file: 'tests/b.test.mjs', source: "registerAndLogin(base, { username: 'alice' });\n" },
  ]);
  assert.equal(acrossFiles.filter((finding) => finding.rule === RULES.SHARED_USERNAME).length, 3);
});

test('报告含文件与行号；无风险时明确说明', () => {
  const dirty = formatReport({
    scanned: 2,
    findings: [{ file: 'tests/x.test.mjs', line: 7, rule: RULES.HARDCODED_PORT, detail: '端口 9000 写死' }],
  });
  assert.match(dirty, /tests\/x\.test\.mjs:7\s+\[hardcoded-port\]/);
  assert.match(dirty, /共 1 处隔离风险/);
  const clean = formatReport({ scanned: 3, findings: [] });
  assert.match(clean, /扫描 3 个测试文件/);
  assert.match(clean, /未发现隔离风险/);
});

function withTempRoot(files, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rtd-isolation-'));
  fs.mkdirSync(path.join(root, 'tests'));
  for (const [name, source] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, 'tests', name), source);
  }
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('CLI：违规退出 1 并输出清单，干净退出 0', () => {
  withTempRoot(
    {
      'a.test.mjs': fixture(['const PORT = 8123; // isolation-audit-ignore', "const DB_PATH = 'server/data/a.db';"]),
    },
    (root) => {
      const dirty = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
      assert.equal(dirty.status, 1, dirty.stderr);
      assert.match(dirty.stdout, /tests\/a\.test\.mjs:1\s+\[hardcoded-port\]/);
      assert.match(dirty.stdout, /共 2 处隔离风险/);
    }
  );

  withTempRoot({ 'b.test.mjs': CLEAN }, (root) => {
    const clean = spawnSync(process.execPath, [SCRIPT, '--root', root, '--json'], { encoding: 'utf8' });
    assert.equal(clean.status, 0, clean.stderr);
    const report = JSON.parse(clean.stdout);
    assert.equal(report.scanned, 1);
    assert.deepEqual(report.findings, []);
  });

  const usage = spawnSync(process.execPath, [SCRIPT, '--nope'], { encoding: 'utf8' });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /未知参数/);
});

test('当前仓库通过隔离审计', () => {
  const result = auditDirectory(ROOT);
  assert.ok(result.scanned > 0);
  assert.deepEqual(result.findings, []);
  const run = spawnSync(process.execPath, [SCRIPT, '--root', ROOT], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});
