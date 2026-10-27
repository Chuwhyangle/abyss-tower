---
id: gap-release-deploy-smoke
title: v2.0.0 部署冒烟：18787 实例重启、版本断言与孤儿清理
status: superseded
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

18787 上的游戏实例是手工启动的 `node --no-warnings server/index.mjs`（`PORT=18787 HOST=127.0.0.1`，日志 `server/data/serve.log`），没有 systemd 单元承接；历史上出现过实例停在旧代码、以及两个来自已删除 worktree 的孤儿 server（31985 / 22923）。v2.0.0 发布前需要一个可重复、可断言的部署冒烟：确认实例真的从最新 main 启动、版本面一致、静态资源可加载、核心流程可用，并清掉孤儿进程。仓库已有默认只读的 `scripts/deploy-smoke.mjs`（AC-041 的判据仪器），本任务加固它并真正完成一次部署。

## Plan

1. 加固已有 `scripts/deploy-smoke.mjs`：保持默认只读（health、`/api/system/status` 的 version/contentVersion、首页/`/js/main.js`/`/styles.css`/精灵清单）；新增 `--restart`（确认 18787 监听 PID 后按文档命令重启到最新 main）与 `--cleanup-orphans`（端口 ≠18787 且 cwd 指向已删除 worktree 的 `server/index.mjs`）。
2. 在 `deploy/rogue-td.service` 里补一条与手工启动一致的环境说明（PORT/HOST/日志路径），避免下次又起在 8787。
3. `docs/RELEASE.md` 增加「18787 部署与冒烟」小节：重启命令、健康断言、回滚命令。
4. 新增 `tests/deploy-smoke.test.mjs`：用桩 HTTP 服务覆盖 200/非 200、版本不匹配、缺静态资源、孤儿识别（不真的杀进程）。
5. 在最新 main 上执行一次真实部署：`node scripts/deploy-smoke.mjs --base http://127.0.0.1:18787 --restart`，再跑一次默认只读断言；记录输出到任务 Notes。
6. 清理两个孤儿 server；确认 18787 仍健康。

## AC

- [ ] `node scripts/deploy-smoke.mjs --base http://127.0.0.1:18787` exit 0
- [ ] `node --test tests/deploy-smoke.test.mjs` exit 0
- [ ] `npm run smoke` exit 0
- [ ] `npm test` exit 0

## DoD

- [ ] 18787 实例确实从最新 main 启动，`/api/system/status` 的 version/contentVersion 都是 2.0.0
- [ ] 首页、`/js/main.js`、`/styles.css`、精灵 manifest 都返回 200；浏览器 smoke 通过
- [ ] 两个孤儿 server 已清理，脚本能重复检测且不会误杀 18787
- [ ] `docs/RELEASE.md` 的重启/回滚命令可直接复制执行，日志落在 `server/data/serve.log`

## Touches

- `scripts/deploy-smoke.mjs`
- `tests/deploy-smoke.test.mjs` (new)
- `deploy/rogue-td.service`
- `docs/RELEASE.md`
- `tasks/gap-release-deploy-smoke.md`

## Notes

重启是对外可见动作：脚本默认只读，`--restart` 必须显式传；重启会短暂断线。孤儿判定同时要求「监听端口 ≠ 18787」与「cwd 指向已删除 worktree」，避免误杀其他租户的 node 进程。18787 是用户指定的端口，不要改回 8787（8787 属于其他租户）。`scripts/deploy-smoke.mjs` 同时是 AC-041 的判据仪器：可以加固只读断言，但不得为了让 AC 变绿而删除版本/静态资源断言。


人 2026-10-27：撤销本任务，等待重新设计（上得太快，先停）。