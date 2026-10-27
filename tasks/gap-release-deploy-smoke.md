---
id: gap-release-deploy-smoke
title: v2.0.0 部署冒烟：18787 实例重启、版本断言与孤儿清理
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: node scripts/deploy-smoke.mjs --base http://127.0.0.1:18787
depends_on:
  - DOCS-003
goal_ac: AC-041
---
## Proposal

18787 上的游戏实例是手工启动的 `node --no-warnings server/index.mjs`（`PORT=18787 HOST=127.0.0.1`，日志 `server/data/serve.log`），没有 systemd 单元承接；历史上出现过实例停在旧代码、以及两个来自已删除 worktree 的孤儿 server（31985 / 22923）。v2.0.0 发布前需要一个可重复、可断言的部署冒烟：确认实例真的从最新 main 启动、版本面一致、静态资源可加载、核心流程可用，并清掉孤儿进程。本任务只做部署与冒烟，不改玩法。

## Plan

1. 新增 `scripts/deploy-smoke.mjs`：`--base` 指向实例；只读检查 `/api/health`、`/api/config` 的 `version` 与 `contentVersion`、首页与关键静态资源（`/js/main.js`、`/styles.css`、精灵 manifest）的 200；可选 `--expect-version 2.0.0`；可选 `--restart` 时先确认 18787 的监听 PID，再按文档命令重启到最新 main。
2. 检测并报告孤儿：监听端口不属于 18787、且 cwd 指向已删除 worktree 的 `server/index.mjs` 进程，`--cleanup-orphans` 时才结束它们。
3. 在 `deploy/rogue-td.service` 里补一条与手工启动一致的环境说明（PORT/HOST/日志路径），避免下次又起在 8787。
4. `docs/RELEASE.md` 增加「18787 部署与冒烟」小节：重启命令、健康断言、回滚命令。
5. 新增 `tests/deploy-smoke.test.mjs`：用桩 HTTP 服务覆盖 200/非 200、版本不匹配、缺静态资源、孤儿识别（不真的杀进程）。
6. 在最新 main 上执行一次真实部署与冒烟，记录输出到任务 Notes。

## AC

- [ ] `node scripts/deploy-smoke.mjs --base http://127.0.0.1:18787` exit 0
- [ ] `node --test tests/deploy-smoke.test.mjs` exit 0
- [ ] `npm run smoke` exit 0
- [ ] `npm test` exit 0

## DoD

- [ ] 18787 实例确实从最新 main 启动，`/api/config` 的 version/contentVersion 都是 2.0.0
- [ ] 首页、`/js/main.js`、`/styles.css`、精灵 manifest 都返回 200；浏览器 smoke 通过
- [ ] 两个孤儿 server 已清理，脚本能重复检测且不会误杀 18787
- [ ] `docs/RELEASE.md` 的重启/回滚命令可直接复制执行，日志落在 `server/data/serve.log`

## Touches

- `scripts/deploy-smoke.mjs` (new)
- `tests/deploy-smoke.test.mjs` (new)
- `deploy/rogue-td.service`
- `docs/RELEASE.md`
- `tasks/gap-release-deploy-smoke.md`

## Notes

重启是对外可见动作：脚本默认只读，`--restart` 必须显式传；重启会短暂断线。孤儿判定同时要求「监听端口 ≠ 18787」与「cwd 指向已删除 worktree」，避免误杀其他租户的 node 进程。18787 是用户指定的端口，不要改回 8787（8787 属于其他租户）。
