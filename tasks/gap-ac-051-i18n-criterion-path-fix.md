---
id: gap-ac-051-i18n-criterion-path-fix
title: AC-051 判据路径修正：i18n 域拆分把 wraith/golem 键迁到 zh-CN.enemies.js，criterion
  改指域名文件使其重新为真
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-051
---
## Proposal

AC-051（GOAL-010「敌人扩充与固定三图平衡校准」→「新敌人精灵/渲染/i18n 覆盖通过既有门禁」）criterion 逐字为 `grep -q 'data.enemy.wraith.name' public/js/shared/i18n/zh-CN.js && grep -q 'data.enemy.golem.name' public/js/shared/i18n/zh-CN.js`，expect `exit 0`。本轮在被评估 HEAD 上逐字执行 → exit 1（两条 grep 均 MISSING）。

根因：i18n per-domain 拆分把字面键从聚合入口文件迁到了域名文件，criterion 硬编码的 `zh-CN.js` 路径过期。提交 `49c1e73 fix(balance): 恢复 develop i18n 域拆分并同步 talent 描述到地板值，重生成 balance 文档` 把 `public/js/shared/i18n/zh-CN.js` 改成聚合入口（`import enemies from './zh-CN.enemies.js'; export default { ...enemies, ...relics, ...meta, ...ui }`），`data.enemy.wraith.name`（相位幽魂）/ `data.enemy.golem.name`（岩石魔像）的字面键现位于 `public/js/shared/i18n/zh-CN.enemies.js:15-16`（en-US 侧同位于 `en-US.enemies.js:15-16`）。故对 `zh-CN.js` 的 grep 不再命中。

保证本身仍然成立：既有 i18n 门禁 `tests/i18n-coverage.test.mjs` 按 `Object.keys(ENEMIES)` 自动枚举 `data.enemy.<id>.name`，本轮 `# pass 19 / # fail 0` exit 0，零缺译仍然成立。红的只是 AC-051 里那条把键锁死在旧聚合文件路径的 grep 判据——是判据路径过期，不是保证被破坏。

**为什么此前的修复没守住**：`gap-ac-051-sprite-i18n-coverage`（done，`goal_ac: AC-051`）在 develop 7675f64 上把这两个字面键落进 `zh-CN.js`，使 grep 判据一度为真；随后 `49c1e73` 的 i18n 域拆分把它们从 `zh-CN.js` 迁到 `zh-CN.enemies.js`，旧 grep 路径随之过期。修的是判据路径，不是重新往 `zh-CN.js` 堆重复键——那会破坏聚合入口，也会打红「键集合必须与 en-US.js 完全一致」的门禁。

修正动作：经 `goal_write`（MCP）把 AC-051 的 criterion 改为 `grep -q 'data.enemy.wraith.name' public/js/shared/i18n/zh-CN.enemies.js && grep -q 'data.enemy.golem.name' public/js/shared/i18n/zh-CN.enemies.js`（键名、expect `exit 0`、双语语义均不变，仅路径改到域名文件）。语义保留的最小修正，落地到 `goals/AC-051-新敌人精灵-渲染-i18n-覆盖通过既有门禁.md` 的 frontmatter。

<!-- dedup-ref --> 机制去重：声明 `goal_ac: AC-051` 的唯一前序任务 `gap-ac-051-sprite-i18n-coverage` 已 `done`（其修复已随 `49c1e73` 过期），无在飞（todo/ready/needs-human）任务认领 AC-051，故本次是新立案而非重复；粒度检查 `task-granularity-advice.js --root /data/home/wenhao/abyss-tower --touches "goals/AC-051-新敌人精灵-渲染-i18n-覆盖通过既有门禁.md" --json` 返回 `peers: []`、`mentions: []`，无合并候选。本任务只改 AC-051 判据路径，不碰 i18n 代码文件、不碰 `gap-ac-050-enemies-expand`（done）的敌人内容 lane、不碰 AC-052 平衡 lane。

## AC

- [x] `grep -q 'data.enemy.wraith.name' public/js/shared/i18n/zh-CN.enemies.js && grep -q 'data.enemy.golem.name' public/js/shared/i18n/zh-CN.enemies.js` exit 0（修正后的 criterion 逐字为真）
- [x] `grep -q 'zh-CN.enemies.js' "goals/AC-051-新敌人精灵-渲染-i18n-覆盖通过既有门禁.md"` exit 0（AC-051 的 criterion 已落到域名文件路径）
- [x] `node --test tests/i18n-coverage.test.mjs` exit 0（既有 i18n 门禁仍绿，零缺译保证独立成立）
- [x] 本任务 diff 只含 `goals/AC-051-新敌人精灵-渲染-i18n-覆盖通过既有门禁.md` 与 `tasks/gap-ac-051-i18n-criterion-path-fix.md`（`git diff --name-only <base>..HEAD` 逐字核对）

## DoD

- [x] 修正后 AC-051 的 criterion 可被 driver 独立复算为真：Notes 记录 `goal_get AC-051` 返回的 criterion 原文（应为指向 `zh-CN.enemies.js` 的两条 grep），并记录逐字命令的退出码为 0
- [x] 语义保留：键名 `data.enemy.wraith.name` / `data.enemy.golem.name`、expect `exit 0`、双语语义均未变，只有文件路径从 `zh-CN.js` 改到 `zh-CN.enemies.js`；未往 `zh-CN.js` 堆重复键、未改任何 i18n 代码文件
- [x] Notes 写清为何此前修复没守住：`gap-ac-051-sprite-i18n-coverage`（done）落键于 `zh-CN.js` → `49c1e73` i18n 域拆分把键迁到 `zh-CN.enemies.js` → 硬编码 grep 路径过期
- [x] 无产品行为/玩法/数值改动，无第三方依赖；`git status --short` 无本任务相关未提交改动

## Touches

- `goals/AC-051-新敌人精灵-渲染-i18n-覆盖通过既有门禁.md`
- `tasks/gap-ac-051-i18n-criterion-path-fix.md`

## Notes

2026-11-02 判据路径修正落地。`goal_get AC-051` 返回的 criterion 原文：`grep -q 'data.enemy.wraith.name' public/js/shared/i18n/zh-CN.enemies.js && grep -q 'data.enemy.golem.name' public/js/shared/i18n/zh-CN.enemies.js`（两条 grep 均指向域名文件 `zh-CN.enemies.js`）。该逐字命令在本任务 worktree 上退出码 0（已逐字执行核对）。既有 i18n 门禁 `node --test tests/i18n-coverage.test.mjs` 独立复算仍绿（19 pass / 0 fail），零缺译保证独立成立，红的只是把键锁死在旧聚合文件路径的 grep 判据，不是保证本身被破坏。

语义保留：键名 `data.enemy.wraith.name` / `data.enemy.golem.name`、expect `exit 0`、双语语义均未变，仅文件路径从 `zh-CN.js` 改到 `zh-CN.enemies.js`；未往 `zh-CN.js` 堆重复键、未改任何 i18n 代码文件。`gap-ac-051-sprite-i18n-coverage`（done）落键于 `zh-CN.js` → `49c1e73` i18n 域拆分把键迁到 `zh-CN.enemies.js` → 硬编码 grep 路径过期，故只修判据路径、不回填重复键，否则会破坏聚合入口并打红「键集合必须与 en-US.js 完全一致」的门禁。