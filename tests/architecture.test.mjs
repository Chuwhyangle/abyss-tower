// 架构约束：runs 路由只做 HTTP 适配，SQL 与状态迁移分别在仓储层与领域服务。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const SQL = /\b(?:SELECT\s+|INSERT\s+INTO\b|UPDATE\s+\w+\s+SET\b|DELETE\s+FROM\b|BEGIN\s+IMMEDIATE)/i;

test('runs 路由不再内联 SQL', () => {
  const source = read('server/routes/runs.mjs');
  assert.doesNotMatch(source, /\bdb\s*\.\s*(?:prepare|exec)\s*\(/);
  assert.doesNotMatch(source, SQL);
});

test('runs 路由保持在薄路由尺寸', () => {
  const lines = read('server/routes/runs.mjs').trimEnd().split('\n').length;
  assert.ok(lines < 180, `runs 路由 ${lines} 行，超过 180 行上限`);
});

test('runs 路由依赖领域服务而不是数据库', () => {
  const source = read('server/routes/runs.mjs');
  assert.match(source, /from '\.\.\/services\/run-service\.mjs'/);
  assert.doesNotMatch(source, /from '\.\.\/db(?:\.mjs|\/)/);
  assert.doesNotMatch(source, /from '\.\/support\.mjs'/);
});

test('仓储层承接 runs SQL，领域服务不直接操作数据库', () => {
  const repository = read('server/db/runs.mjs');
  assert.match(repository, /INSERT INTO runs/);
  assert.match(repository, /UPDATE runs/);
  assert.match(repository, /FROM runs/);

  const service = read('server/services/run-service.mjs');
  assert.doesNotMatch(service, /\bdb\s*\.\s*(?:prepare|exec)\s*\(/);
  assert.doesNotMatch(service, SQL);
  assert.doesNotMatch(service, /from '\.\.\/routes\//);
});
