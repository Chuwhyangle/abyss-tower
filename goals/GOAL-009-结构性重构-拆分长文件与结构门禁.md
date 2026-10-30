---
id: GOAL-009
title: 结构性重构：拆分长文件与结构门禁
status: active
kind: goal
origin: 人 2026-10-28：打击感先默认通过，下一步做重构优化（实测 421 文件 / 116,780 行 / 24 个 >600 行文件）
activatedAt: 2026-10-28T11:46:19.783Z
statusLog:
  - at: 2026-10-28T11:46:19.783Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
---
## 背景

功能与表现层已经收口（8 塔 / 12+ 敌人 / 10 主海克斯 / 70 遗物 / 3 张固定地图 / 5 种模式），
但代码体量到了需要结构性收口的阶段：

- 421 个 JS/MJS 文件、116,780 行；`tests/` 占 51%（59,733 行），`public/js/` 38,398 行，`server/` 9,406 行。
- 近 7 天 584 个提交、+135,409 / −17,999 行，改动集中在少数汇总点与超大模块上。
- 24 个非数据源文件超过 600 行，最大 1,396 行；共同形态是「静态数据表 + God class」混在一个模块，
  数据改一行要理解整套绘制/结算逻辑，并行任务在同一文件上互斥。

本 goal 只做**行为不变**的结构重构：拆文件、外提数据表、抽公共原语、建立结构门禁与行为不变的见证工具。
不改任何玩家可见行为。

## 范围

- `public/js/render/`：`skill-renderer`（1396）、`enemy-renderer`（1081）、`tower-renderer`（1054）、
  `effect-renderer`（1049）、`projectile-renderer`（772）按「数据 / 绘制原语 / 单实体 / 编排」拆分。
- `server/`：`services/run-service`（1017）、`db/leaderboard`（893）按「规则 / 持久化 / 序列化」拆分。
- `public/js/shared/achievements.js`（1027）、`public/js/audio.js`（1221）拆分。
- `tests/`：`visual-scenes`（1257）、`visual-scenarios`（942）、`visual-check.test`（900）抽公共 harness。
- 新增 `scripts/structure-budget.mjs`（行数预算 / 导入无环 / 数据模块纯度 + 债务登记）、
  `scripts/visual-parity.mjs`（逐帧像素哈希对照）、`scripts/check-sim-determinism.mjs`（三份模拟哈希对照）。
- 设计正本：`docs/PHASE_REFACTOR.md`（拆分边界、600 行预算、门禁口径、AC 映射）。

## 非目标

- 不改数值、波次、经济、计分、文案、画面像素、音频参数与公共 API。
- 不拆 `public/js/sim.js` 与 `sim/**`（已是 572 行编排 + 9 个子系统），只作为确定性见证对象。
- 不引入第三方依赖、构建步骤或新框架；不做顺手优化——发现的问题另立任务。
- 不改任务池的调度与门禁语义。

## 退出条件

- 结构预算门禁通过，且债务登记 `scripts/structure-budget.allow.json` 清空（数据文件豁免除外）。
- 重构不改变行为：`npm test` 全绿；语法、导入、风格、文档静态检查全部通过。
- 模拟确定性哈希（events / rng / state）与重构前逐字节一致。
- 视觉像素与重构前逐帧一致，且 `visual-check --suite all` 通过。
- 性能预算不回归：`npm run perf:budget` 通过。
- 文档所有权检查通过，`docs/PHASE_REFACTOR.md` 与实测数字一致。
