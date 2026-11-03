---
id: feat-talent-tree-wiring
title: 天赋树接线：spendLegacy 路由 + meta 树 UI + 对局注入 talent，让局外养成真正生效
status: ready
labels:
  - feat
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/meta-tree.test.mjs tests/meta-legacy.test.mjs
---
## Proposal

天赋树 + 传承之核是半成品：数据（`public/js/shared/data/meta.js` 的 `TALENT_NODES` 8 节点三系 + `talentMods`）、DB（`server/db/accounts.mjs` 的 `readTalent`/`writeTalent`、`server/db/legacy.mjs` 的 `grantLegacyInTx`/`spendLegacyInTx`）、结算产出（`run-settlement.mjs` 产出传承之核）都已写好，但三处没接线：① 无 talent 读写与传承材料消耗的路由（`spendLegacyInTx` 零调用）；② 无 meta 树 UI（玩家看不到、点不了天赋树）；③ `public/js/app/run.js` 构造 `Simulation` 没传 `talent`（`talentMods` 恒空、天赋不进对局）。修复：三处接线，让「局外养成」真正生效——这是用户「外面没什么升级系统、肉鸽感不够」的直接补位。路由按 `unlock.mjs`/`skills.mjs` 的既有模式注册进 `server/routes/index.mjs`。

## AC

- [x] 服务端新增 talent 读写 + 传承材料消耗路由，复用 `readTalent`/`writeTalent`/`spendLegacyInTx`，材料口径与 `run-settlement` 结算一致
- [x] meta 树 UI：三系 8 节点可视、花传承之核加点、已点节点持久化（存 `player_kv('meta','talent')`）
- [x] `run.js` 构造 `Simulation` 传 `talent`（读账号 talent），`talentMods` 生效进对局
- [x] `node --test tests/meta-tree.test.mjs tests/meta-legacy.test.mjs` exit 0

## DoD

- [x] 三处接线落地，不引入第三方依赖
- [x] 新增/扩展回归测试：路由读写/消耗、UI 数据模型、run.js 注入后 `talentMods` 生效
- [x] `npm test` 全绿；补跑 `node --test tests/meta-tree.test.mjs tests/meta-legacy.test.mjs`
- [x] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `server/routes/talent.mjs` (new)
- `server/routes/index.mjs`
- `server/services/run-rules.mjs`
- `server/services/run-service.mjs`
- `public/js/app/run.js`
- `public/js/ui/meta-tree.js` (new)
- `public/index.html`
- `public/styles.css`
- `public/js/shared/i18n/zh-CN.ui.js`
- `public/js/shared/i18n/en-US.ui.js`
- `tests/meta-tree.test.mjs`
- `tasks/feat-talent-tree-wiring.md`

## Notes

立案 2026-11-03，源自 `docs/TODO.md` 的 TODO-9。深和宽：把半成品的最后三处接线补全，而不是另起炉灶。若 worker 实际落地的文件与 Touches 有出入，须同步 task_write 修正 Touches 再 fan-in。

实现落地（2026-11-03）：① 新增 `server/routes/talent.mjs` 薄路由（`GET /api/talent` + `POST /api/talent/invest`），复用 `readTalent`/`writeTalent`/`spendLegacyInTx`，材料口径共用 `legacy.mjs`，与 `run-settlement` 结算一致；注册进 `server/routes/index.mjs`。② meta 树 UI `public/js/ui/meta-tree.js` + `public/index.html` 入口 + `public/styles.css` 少量节点样式。③ 天赋注入链：`run-rules.mjs`（开局 `planRunStart` 读 talent）+ `run-service.mjs`（`serialize` 读 talent）+ `run.js`（`beginGame`/`resumeRun` 传 talent）。i18n 新增 `shell.closeMetaTree` 键（zh-CN/en-US）。测试：`tests/meta-tree.test.mjs` 扩展路由读写/消耗/持久化用例；全量 `npm test` 1893 全绿。

该轴仍暗,理由:本任务为功能接线，不引入新结构文档面，L_D/L_G/L_S 无需量化。
