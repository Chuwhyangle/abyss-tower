---
id: gap-browser-server-teardown-leak
title: 浏览器测试 server 泄漏：崩溃路径不回收 server/index.mjs，补 teardown 兜底
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

之前清出 ~670 个泄漏的 `server/index.mjs`：浏览器测试在断言失败/崩溃路径没走到 `server.stop()`，server 进程变成孤儿。这是 bug，必须修——teardown 必须在**任何退出路径**都回收 server。

## Plan

1. 定位浏览器测试的 server 启动/停止逻辑（`tests/*.test.mjs` / `tests/browser-*.mjs` 里 `server.stop()` 的调用点）。
2. 优先做**中心化兜底**：`server/index.mjs` 在父进程退出（stdin EOF）或收到断开信号时自杀，一处修复覆盖所有测试；若不可行则回退到每个浏览器测试 try/finally 包 `server.stop()`。
3. 验证：跑一轮浏览器验收后 `pgrep -f 'server/index.mjs'` 计数不增（对照跑前跑后）。

## AC

- [ ] `npm test` exit 0
- [ ] 跑浏览器验收后 `pgrep -f 'server/index.mjs'` 无新增残留（跑前跑后计数不变）

## DoD

- [ ] 任何退出路径（断言失败 / 超时 / 崩溃）下 server 都被回收；复跑浏览器验收进程数不涨
- [ ] 修法写明在 Notes（中心化自杀还是 per-test finally），不靠手工 kill 兜底

## Touches

- `server/index.mjs`
- `tasks/gap-browser-server-teardown-leak.md`
