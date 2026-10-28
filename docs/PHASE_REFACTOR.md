# 结构性重构 · 阶段决策（PHASE_REFACTOR）

- 状态：**GOAL-009 计划正本**（2026-10-28）
- 定位：本阶段拆分边界、结构预算与门禁口径的**唯一定义处**。实现任务按本文分片，不各自发明拆分方式。
<!-- docs-consistency:planned-start — 计划态产物：落地前不存在，块内豁免「代码路径存在性」；链接与 npm 脚本照旧校验。R6 收口时删除全部计划块。 -->
- 变更纪律：修改本文任一预算值或门禁口径，必须同时改 `scripts/structure-budget.mjs` 与对应测试；只改一处视为漂移。
<!-- docs-consistency:planned-end -->
- 相关正本：`CLAUDE.md`（开发约定：封装优先、每 5 个版本重构一次、子代理按文件所有权分工）。

---

## 1. 背景（2026-10-28 实测）

| 指标 | 数值 |
| --- | --- |
| JS/MJS 文件 | 421 |
| 总行数 | 116,780 |
| `tests/` | 59,733 行（51%，214 文件） |
| `public/js/` | 38,398 行（119 文件） |
| `scripts/` | 10,134 行（30 文件） |
| `server/` | 9,406 行（58 文件） |
| 近 7 天 | 584 提交，+135,409 / −17,999 行 |

超过 600 行的非数据源文件共 **24 个**，集中在四处：

- **渲染**：`skill-renderer` 1396、`enemy-renderer` 1081、`tower-renderer` 1054、`effect-renderer` 1049、
  `projectile-renderer` 772、`background-renderer` 727、`sprite-pipeline` 649。
- **服务端**：`services/run-service` 1017、`db/leaderboard` 893。
- **共享层**：`shared/achievements` 1027、`audio.js` 1221、`relic-codex-ui` 632。
- **测试与脚本**：`visual-scenes` 1257、`visual-scenarios` 942、`visual-check.test` 900、`dynamic-perf` 790、
  `i18n-coverage.test` 764、`render-visuals.test` 699、`balance-sim` 1289、`build-entity-sprites` 686、
  `style-check` 685、`build-sprite-atlas` 618、`browser-map` 606、`sim-skills.test` 669。

这些文件的共同形态是：**静态数据表 + 单一 God class/函数集合**混在一个模块里。数据表改一行要理解整套绘制逻辑，
并行任务在同一文件上互斥（7 天改动量的前四名正是 `sim.js` / `render.js` / `ui.js` / `main.js` 这些汇总点，
说明改动频繁落在同一批文件上）。

## 2. 目标

1. 运行时文件 ≤ 600 行、工具/测试文件 ≤ 800 行；数据表外提到独立 `*-data.js`（只含常量与纯查表函数，不 import 运行时模块）。
2. 大模块按**职责**拆分：渲染器拆成「数据 / 几何与绘制原语 / 单实体绘制 / 编排」四类；服务拆成「规则 / 持久化 / 序列化」。
<!-- docs-consistency:planned-start -->
3. 新增**结构门禁** `scripts/structure-budget.mjs`，并在测试中生效：行数预算、导入无环、数据模块纯度。
<!-- docs-consistency:planned-end -->
4. 新增**行为不变**的可执行见证：模拟确定性哈希、视觉像素哈希、全量测试、性能预算。

## 3. 非目标

- 不改任何玩家可见行为：数值、波次、经济、计分、文案、画面像素、音频参数一律不动。
- 不改公共 API 的函数名/签名/返回结构；只移动实现位置与拆分类（调用方 import 由任务同步调整）。
- 不引入第三方依赖、构建步骤或新框架。
- 不重写功能；不做「顺手优化」——发现的问题新立任务，不并入重构。

## 4. 拆分原则

1. **纯移动优先**：先做「同文件内分节 → 外提数据表 → 外提纯函数 → 最后才拆类」，每一步都可单独通过全量测试。
2. **数据模块纯度**：`*-data.js` 不得 import `public/js/sim/**`、`public/js/render/**`、`public/js/app/**` 等运行时模块；
   只允许 import 其他数据模块或 `shared/data.js` 的纯常量。
3. **依赖方向**：`data → primitives → entity renderer → orchestrator`；不允许反向 import，不允许环。
4. **每个任务独立落地**：一个任务 = 一组文件；`## Touches` 精确到文件；fan-in 时全量测试与视觉像素门必须绿。
5. **测试同步**：对外导出被移动时，测试的 import 路径同步更新；不新增「兼容壳」重导出（死导出只会累积）。

## 5. 结构预算（门禁口径）

<!-- docs-consistency:planned-start — 预算表与债务登记目录由 R0 创建，落地前不存在。R6 收口时删除本块。 -->
| 项 | 阈值 | 说明 |
| --- | --- | --- |
| 运行时单文件行数 | ≤ 600 | `public/js` 与 `server` 下 `.js/.mjs` |
| 工具/测试单文件行数 | ≤ 800 | `scripts` 与 `tests` 下 `.js/.mjs`（采集与断言天然更长） |
| 数据文件豁免 | 白名单 | `public/js/shared/i18n/*.js`、`server/db/migrations/*.mjs`、`*-data.js` 且满足纯度规则 |
| 导入环 | 0 | 从四个源根构建静态 import 图，Tarjan 强连通分量判环 |
| 数据模块纯度 | 0 违规 | `*-data.js` 只能依赖其他数据模块、`public/js/shared/data.js` 或 `node:` 内建，不得 import 运行时模块（`public/js/sim.js`、`public/js/sim/`、`public/js/render/`、`public/js/app/`、`public/js/ui.js`、`server/`） |
| 债务登记 | `scripts/structure-budget.allow.d/<task-id>.json` | 每个任务一个文件、互不冲突；条目 = `{path, maxLines, owner}`，任务完成即删自己的文件，最终目录必须为空（数据豁免除外） |
<!-- docs-consistency:planned-end -->

门禁的判定口径（`scripts/structure-budget.mjs`，改这里必须同时改 §5 与 `tests/structure-budget.test.mjs`）：

- **文件名即 owner**：`<task-id>.json` 里的每条 `owner` 必须等于文件名去掉 `.json` 的部分——所以「一个任务一个文件」是机械可检的，同一条路径也不会被两个任务各登记一次。
- **owner 必须是活任务**：`tasks/<owner>.md` 不存在即判红（任务改名/删除后悬空的债务条目不会静默存活）。
- **四种债务违规**：超限未登记（`over-budget`）、超出登记上限（`debt-exceeded`）、文件已在预算内却仍登记（`debt-stale`，还清就该删）、条目路径不存在（`debt-unknown-path`）。
- **豁免不设限**：数据豁免文件不参与行数判定，但仍受纯度规则约束（数据模块 import 运行时模块照样红）。
- **`tests/balance-sim.mjs`（1289）** 在 R1–R5 没有对应的拆分任务，登记在 `refactor-closeout.json`（R6 收口时清空）。

命令：`npm run check:structure`（= `node scripts/structure-budget.mjs --check`），已接入 `npm run verify:local` 与 CI。

## 6. 分期与文件所有权

<!-- docs-consistency:planned-start — 本节按任务 id 指派尚未创建的产物，落地前这些路径不存在。R6 收口时删除本块。 -->
> 依赖关系：R0 → (R1 ∥ R2 ∥ R3 ∥ R4 ∥ R5) → R6。同一阶段的任务文件互不重叠。

### R0 · 基线、门禁与见证工具（`refactor-baseline-and-structure-gate`）
- 交付：`scripts/structure-budget.mjs` + `scripts/structure-budget.allow.d/`（每个拆分任务一份债务文件）+ `tests/structure-budget.test.mjs`；
  `scripts/visual-parity.mjs` + 基线 `docs/reviews/refactor-baseline.json`（5 场景 × 2 视口 + 16 scenario × 2 视口，逐帧 pixelHash）；
  `scripts/check-sim-determinism.mjs` + 基线 `docs/reviews/sim-determinism.json`（3 个 seed × events/rng/state）；
  接入 `npm run verify:local`（`check:structure` 阻塞）与 CI（`.github/workflows/ci.yml` 的结构预算步骤）。
- 命令：`npm run check:structure` / `npm run visual:parity` / `npm run sim:determinism`；parity 与 determinism 不进每次 CI，
  只作为 GOAL AC 判据（AC-046 / AC-047），基线用同名 `:write` 脚本重采。
- Touches：新增上述文件、`docs/PHASE_REFACTOR.md`、`package.json`、`.github/workflows/ci.yml`、`scripts/test-changed.mjs`（新脚本登记进映射，否则审计覆盖会红）。

### R1 · 渲染：技能与敌人（`refactor-render-skill-enemy`）
- 拆 `skill-renderer.js`（1396）与 `enemy-renderer.js`（1081）：
  技能表/警告表/画质档 → `skill-data.js`；警告绘制 → `skill-warnings.js`；技能绘制 → `skill-draw.js`；类留编排。
  敌人动画表/闪白与高亮 → `enemy-data.js`、`enemy-feedback.js`；Boss 地面与身体绘制分文件；类留编排。

### R2 · 渲染：特效、塔与弹道（`refactor-render-effects-tower-projectile`）
- 拆 `effect-renderer.js`（1049）、`tower-renderer.js`（1054）、`projectile-renderer.js`（772）：
  事件/变体/粒子池拆数据、粒子池、绘制三层；塔动画与进化视觉拆数据与绘制；弹道按弹种拆绘制函数。

### R3 · 服务端：run 与排行榜（`refactor-server-run-leaderboard`）
- `run-service.js`（1017）拆：`run-rules`（每日/周常/固定图规则）、`run-settlement`（结算与成就/通知）、`run-service`（编排 + 错误）；
- `leaderboard.js`（893）拆：`leaderboard-sql`（查询构造）、`leaderboard-validate`（校验/防作弊）、`leaderboard`（编排 + 赛季）。

### R4 · 共享层：成就与音频（`refactor-shared-achievements-audio`）
- `achievements.js`（1027）拆：`achievements-data`（812 起的定义表）、`achievements-rules`（条件求值）、`achievements`（索引 + 季节）；
- `audio.js`（1221）拆：`audio-synth`（合成器/总线）、`audio-music`（曲目/层/Boss）、`audio-ambience`（环境音）、`audio`（门面）。

### R5 · 测试：视觉三件套（`refactor-tests-visual-harness`）
- `visual-scenes.js`（1257）、`visual-scenarios.js`（942）、`visual-check.test.js`（900）拆出 `tests/lib/visual/*.mjs`：
  采集会话、场景计划、指标断言、contact sheet 四块；测试文件只留用例。

### R6 · 收口（`refactor-closeout`）
- 清空 `structure-budget.allow.d/`（除数据豁免）；拆 `background-renderer`(727)、`sprite-pipeline`(649)、`relic-codex-ui`(632)；更新本文实测数字；
  跑满门禁（测试、静态、确定性、视觉、性能）。
- **计划块日落**：收口时删除本文全部计划块（含起止标记行），回归 100% 存在性校验
  （`npm run check:docs` 在无块状态下 exit 0）——此时 §5/§6/§7 的产物都已落地，计划态豁免失去存在理由。

<!-- docs-consistency:planned-end -->

## 7. 门禁与 GOAL AC 映射

<!-- docs-consistency:planned-start — 判据命令指向 R0 产物，落地前不存在。R6 收口时删除本块。 -->
| AC | 判据 | 命令 |
| --- | --- | --- |
| AC-043 | 结构预算通过、债务登记为空（数据豁免除外） | `node scripts/structure-budget.mjs --check` |
| AC-044 | 行为不变：全量测试 | `npm test` |
| AC-045 | 静态检查 | `npm run check:syntax && npm run check:imports && npm run check:style && npm run check:docs` |
| AC-046 | 模拟确定性哈希与重构前逐字节一致 | `node scripts/check-sim-determinism.mjs --check` |
| AC-047 | 视觉像素与重构前逐帧一致 + 视觉套件通过 | `node scripts/visual-parity.mjs --check && node scripts/visual-check.mjs --suite all` |
| AC-048 | 性能预算 | `npm run perf:budget` |
| AC-049 | 文档所有权与本文同步 | `node scripts/check-doc-ownership.mjs && node scripts/docs-consistency.mjs` |
<!-- docs-consistency:planned-end -->

## 8. 风险与回滚

- **视觉像素漂移**：任何绘制顺序/浮点运算顺序变化都会改像素。R0 的 `visual-parity` 是逐帧哈希，不是阈值——
  失败即回滚该文件的改动方式（先纯移动，再谈重组）。
- **模拟确定性**：`sim.js` 与 `sim/**` 不在本阶段拆分范围（它已是 572 行编排 + 9 个子系统），只作为确定性见证对象。
- **任务并行冲突**：R1–R5 的 Touches 必须互斥（债务文件按任务分开）；R6 独占最终清理。
- **回滚**：每个任务一个 worktree 分支，fan-in 前全量门禁；失败保留 worktree，按 driver 的 exited-not-landed 流程处理。
