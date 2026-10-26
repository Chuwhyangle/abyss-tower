// 架构约束（全域口径）：
//   routes   —— 只做 HTTP 适配：解析请求、调用领域服务/仓储、组装响应；不内联 SQL，也不直接 prepare/exec。
//   services —— 持有领域规则（校验、归一、边界计算与流程编排）；不反向依赖路由，不内联 SQL。
//   db       —— 只做 SQL 查询/写入原语与仓储函数；不持有 HTTP 语义。
// 本文件从 runs 这一个域扩展到全域：所有路由与鉴权层都受同一口径约束。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const SQL = /\b(?:SELECT\s+|INSERT\s+INTO\b|UPDATE\s+\w+\s+SET\b|DELETE\s+FROM\b|BEGIN\s+IMMEDIATE)/i;
const DB_CALL = /\bdb\s*\.\s*(?:prepare|exec)\s*\(/;

// 逐文件列出 server/ 下的模块，供全局面扫描使用。
function listModules(relative) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.mjs')) files.push(full);
    }
  };
  walk(path.join(ROOT, relative));
  return files.sort();
}

// 领域路由 → 对应 service 的唯一映射；新增领域路由时在此登记。
const DOMAIN_ROUTES = {
  'server/routes/leaderboard.mjs': 'leaderboard-service',
  'server/routes/season-pass.mjs': 'season-pass-service',
  'server/routes/notifications.mjs': 'notifications-service',
};

test('全域路由与鉴权层不内联 SQL，也不直接操作数据库', () => {
  const violations = [];
  for (const file of [...listModules('server/routes'), ...listModules('server/auth')]) {
    const source = fs.readFileSync(file, 'utf8');
    const relative = path.relative(ROOT, file);
    if (SQL.test(source)) violations.push(`${relative}：包含 SQL 字面量`);
    if (DB_CALL.test(source)) violations.push(`${relative}：直接调用 db.prepare/exec`);
  }
  assert.deepEqual(violations, []);
});

test('领域路由依赖 service，而不是直接依赖 db 模块', () => {
  for (const [route, service] of Object.entries(DOMAIN_ROUTES)) {
    const source = read(route);
    assert.match(
      source,
      new RegExp(`from '\\.\\./services/${service}\\.mjs'`),
      `${route} 未依赖领域服务 ${service}`
    );
    assert.doesNotMatch(source, /from '\.\.\/db(?:\.mjs|\/)/, `${route} 仍直接依赖 db 模块`);
  }
});

test('领域 service 存在，且不反向依赖路由、不内联 SQL', () => {
  for (const service of Object.values(DOMAIN_ROUTES)) {
    const file = `server/services/${service}.mjs`;
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} 不存在`);
    const source = read(file);
    assert.doesNotMatch(source, /from '\.\.\/routes\//, `${service} 反向依赖路由`);
    assert.doesNotMatch(source, DB_CALL, `${service} 直接调用 db.prepare/exec`);
    assert.doesNotMatch(source, SQL, `${service} 内联 SQL`);
  }
});

test('runs 路由不再内联 SQL', () => {
  const source = read('server/routes/runs.mjs');
  assert.doesNotMatch(source, DB_CALL);
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
  assert.doesNotMatch(service, DB_CALL);
  assert.doesNotMatch(service, SQL);
  assert.doesNotMatch(service, /from '\.\.\/routes\//);
});
