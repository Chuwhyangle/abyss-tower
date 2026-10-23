import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyze, report } from '../scripts/import-graph.mjs';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'import-graph.mjs');
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const fixture = (t, files) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'import-graph-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
};

const run = (root) => spawnSync(process.execPath, ['--no-warnings', SCRIPT, '--root', root], {
  encoding: 'utf8',
});

test('合法分层样例通过', (t) => {
  const root = fixture(t, {
    'public/js/shared/base.js': 'export const BASE = 1;\n',
    'public/js/app/feature.js': "import { BASE } from '../shared/base.js';\nexport const FEATURE = BASE + 1;\n",
    'public/js/render/view.js': "import { BASE } from '../shared/base.js';\nexport const VIEW = BASE;\n",
    'server/db/store.mjs': "import { BASE } from '../../public/js/shared/base.js';\nexport const STORE = BASE;\n",
    'server/routes/api.mjs': "import { STORE } from '../db/store.mjs';\nexport const API = STORE;\n",
  });

  const result = analyze(root);
  assert.equal(result.violations.length, 0, report(result).join('\n'));
  assert.equal(result.cycles.length, 0);

  const cli = run(root);
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /import-graph: OK/);
});

test('越层 import 被报告并包含文件与行号', (t) => {
  const root = fixture(t, {
    'public/js/app/upper.js': 'export const UPPER = 1;\n',
    'public/js/shared/bad.js': "import { UPPER } from '../app/upper.js';\nexport const BAD = UPPER;\n",
  });

  const result = analyze(root);
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].kind, 'layer');
  assert.equal(result.violations[0].fromLayer, 'shared');
  assert.equal(result.violations[0].toLayer, 'app');

  const lines = report(result);
  assert.ok(lines.some((line) => line.includes(`public/js/shared/bad.js:1`)), lines.join('\n'));
  assert.ok(lines.some((line) => line.includes("import '../app/upper.js'")), lines.join('\n'));

  const cli = run(root);
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /public\/js\/shared\/bad\.js:1/);
});

test('server 只允许跨层依赖 shared', (t) => {
  const root = fixture(t, {
    'public/js/ui.js': 'export const UI = 1;\n',
    'server/index.mjs': "import { UI } from '../public/js/ui.js';\nexport const SERVER = UI;\n",
  });

  const result = analyze(root);
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].fromLayer, 'server');
  assert.equal(result.violations[0].toLayer, 'ui');
  assert.equal(run(root).status, 1);
});

test('循环依赖被检出', (t) => {
  const root = fixture(t, {
    'public/js/app/a.js': "import { B } from './b.js';\nexport const A = B;\n",
    'public/js/app/b.js': "import { A } from './a.js';\nexport const B = A;\n",
  });

  const result = analyze(root);
  assert.equal(result.cycles.length, 1);
  const chain = result.cycles[0].map((file) => path.relative(root, file));
  assert.deepEqual(chain, ['public/js/app/a.js', 'public/js/app/b.js', 'public/js/app/a.js']);

  const cli = run(root);
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /循环依赖/);
});

test('无法解析的相对 import 被报告', (t) => {
  const root = fixture(t, {
    'public/js/app/missing.js': "import { NOPE } from './nope.js';\nexport const VALUE = NOPE;\n",
  });

  const result = analyze(root);
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].kind, 'unresolved');
  assert.match(report(result).join('\n'), /public\/js\/app\/missing\.js:1/);
  assert.equal(run(root).status, 1);
});

test('当前仓库依赖图通过检查', () => {
  const result = analyze(REPO_ROOT);
  assert.equal(result.violations.length, 0, report(result).join('\n'));
  assert.equal(result.cycles.length, 0);

  const cli = run(REPO_ROOT);
  assert.equal(cli.status, 0, cli.stderr);
});
