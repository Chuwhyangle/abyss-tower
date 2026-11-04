---
id: feat-play-analytics
title: 真人游玩分析脚本：report/check 双模式 + human-vs-bot 洞察
status: ready
labels:
  - feat
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/play-analytics.test.mjs
---
## Proposal

真人游玩分析闭环（`docs/TODO.md` TODO-18 三路收敛，GOAL-014 已立案）的 MVP。每局 run 已落库但没聚合分析，本任务新增 `scripts/play-analytics.mjs` 双模式：① `report` —— 只读 `new DatabaseSync(dbPath, { readOnly: true })` 直读 `runs`/`replays` 表（**不得 import `server/db/index.mjs`**，避免 import 即清理写的副作用），JS 解析 `ruleset_json`/`relics`/`offers`/`result_json`，输出 5 段 markdown（总体难度×mode 局数/通关率/波次/时长/余金/剩血、主海克斯选取率/胜率、遗物选取率/胜率差、失败波次分布、mode 使用量），全程按 `content_version` 分桶；② `check <insight-id>` —— 单条洞察求值 exit 0/1，MVP 只做 `human-vs-bot`（真人通关率 vs 机器人目标区间 `docs/BALANCE.md:12-26`，差 >10pp 且每档真人 n≥floor 才 exit 1；样本不足 exit 0）。聚合不碰 `sim.js` 确定性、默认脱敏（不输出 account_id）。新增 `scripts/` 文件登记 `scripts/test-changed.mjs` 的 TEST_MAP，`package.json` 加 `"analytics"` 命令。

## AC

- [x] `scripts/play-analytics.mjs` report 模式：只读直连 db（不 import db/index.mjs）、5 段报告、content_version 分桶、脱敏
- [x] check 模式：`check human-vs-bot` 带样本 floor + 阈值 >10pp，样本不足 exit 0、超阈值 exit 1 并写原因
- [x] 聚合正确性有测试覆盖（`tests/play-analytics.test.mjs` 喂临时 db 断言）
- [x] TEST_MAP 登记 + `package.json` `analytics` 命令
- [x] `node --test tests/play-analytics.test.mjs` exit 0；`node scripts/play-analytics.mjs check human-vs-bot` exit 0（样本不足口径）

## DoD

- [x] 落地于 `scripts/play-analytics.mjs`（新）、`tests/play-analytics.test.mjs`（新）、`scripts/test-changed.mjs`、`package.json`，零第三方依赖
- [x] report 输出样例（对当前 game.db）记录在 Notes；不碰 sim 确定性、不写库
- [x] `npm test` 全绿；补跑 `node --test tests/play-analytics.test.mjs`
- [x] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `scripts/play-analytics.mjs` (new)
- `tests/play-analytics.test.mjs` (new)
- `scripts/test-changed.mjs`
- `package.json`
- `tasks/feat-play-analytics.md`

## Notes

立案 2026-11-04，源自 `docs/TODO.md` 的 TODO-18 + GOAL-014（AC-072/073）。MVP 零迁移、只读聚合；塔编成/逐波 baseHp 打点与更多 check 是 v2。关键红线：脚本不得 `import server/db/index.mjs`（import 即写副作用），用 `new DatabaseSync(file, { readOnly: true })`（参照 `scripts/ops.mjs`）。若 worker 实际 Touches 有出入，须 task_write 修正再 fan-in。

该轴仍暗,理由:本任务为只读分析脚本，不碰玩法/数值/sim 确定性，无新玩法文档面，L_D/L_G/L_S 无需量化。

落地 2026-11-04：实际 Touches 与声明一致（scripts/play-analytics.mjs、tests/play-analytics.test.mjs 新增；scripts/test-changed.mjs、package.json 修改），无需修正。聚合口径：总体/海克斯/遗物/失败波次只统计 status='finished' 局；主海克斯选取率=选中/出现在三选一，遗物选取率=持有/出现在任一遗物三选一、胜率差=持有胜率−未持有胜率；mode 使用量统计所有状态。名称复用 shared 注册表（HEX_BY_ID/RELIC_BY_ID），未知 id 回退原文。

report 样例（当前 game.db：仅 1 局 active、0 局 finished）——总体/海克斯/遗物三段输出「（无已结算对局）」，失败波次输出「（无失败对局）」，mode 使用量输出 1 行：v1.26.0 | normal | 1。check human-vs-bot 对当前 game.db exit 0（三档 n=0 < floor=30 样本不足）。npm test 全绿（2026 例，0 fail）。
