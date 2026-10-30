---
id: gap-goals-gitignore-untracked
title: 修复 .gitignore：goals/*.md 进版本库（镜像 tasks 修法）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`.gitignore` 第 48 行 `goals/` 整目录忽略，导致 goals/ 下 70+ 个 goal 文件（GOAL-001~012 及 AC-001~065）零 git 跟踪：fan-in 的 doc-surface 只判已提交 diff，goals 的改动进不了校验面。tasks 已修好同型问题（`.gitignore` 用 `tasks/*` + `!tasks/*.md`，101 个 .md 全跟踪），goals 漏修。

修法镜像 tasks：`.gitignore` 把第 48 行 `goals/` 改成 `goals/*`，紧接其后加 `!goals/*.md` 例外（`goals/*.lock` 仍被 `goals/*` 覆盖忽略），然后 `git add -f` 全部历史 goals/*.md 并提交；此后新 goal 文件可普通 `git add`、无需 `-f`。

## AC

- [x] `.gitignore` 例外落地：`grep -qE '^goals/\*$' .gitignore && grep -qE '^!goals/\*\.md$' .gitignore` exit 0
- [x] 历史 goal 全部进 git 跟踪：`git ls-files 'goals/*.md' | wc -l` ≥ 70
- [x] 文档所有权门禁不回归：`node scripts/check-doc-ownership.mjs` exit 0
- [x] 全量测试不回归：`npm test` exit 0

## DoD

`.gitignore` 例外已落地并提交；70+ 个历史 goals/*.md 进 git 跟踪（`git ls-files 'goals/*.md' | wc -l` ≥ 70）；新 goal 文件 `git add` 无需 `-f`；tasks 跟踪不受影响（`git ls-files 'tasks/*.md' | wc -l` 仍为 101）。

## Touches

- `.gitignore`
- `tasks/gap-goals-gitignore-untracked.md`
- `goals/AC-001-本地-head-包含上游-v1-31-0-基线提交-abe054a.md`
- `goals/AC-002-全量测试连续-3-次-0-失败.md`
- `goals/AC-003-三张固定地图与可破坏物通过自动化验收.md`
- `goals/AC-004-十个主海克斯全部可选用且效果可验证.md`
- `goals/AC-005-全量测试通过-基线确认.md`
- `goals/AC-006-quay-运行时忽略项已入库.md`
- `goals/AC-007-稳定性门禁可运行且通过.md`
- `goals/AC-008-三张固定图在普通-每日-本周-无尽-变异中开局一致.md`
- `goals/AC-009-可破坏物拆除-模拟-渲染-点击-刷新保持.md`
- `goals/AC-010-开局三选一-每日同组-快照-结算-分享码与-ui-接线.md`
- `goals/AC-011-首次进入默认自动画质-低配仅在弱机-移动端.md`
- `goals/AC-012-每次伤害都产出结构化命中事件且模拟结果不变.md`
- `goals/AC-013-hitstop-与定向震屏-镜头冲击受设置护栏且确定性不变.md`
- `goals/AC-014-八种武器命中音效可区分并受限流与压缩总线约束.md`
- `goals/AC-015-八种武器命中特效可区分并受粒子预算约束.md`
- `goals/AC-016-伤害飘字分层与设置三档不刷屏.md`
- `goals/AC-017-漏怪-清波-首领死亡各有独立演出.md`
- `goals/AC-018-战斗场景机械指标-反馈覆盖-对比度-特效预算.md`
- `goals/AC-019-打击感改造后性能预算不回归.md`
- `goals/AC-020-打击感语义评审记录存在且通过.md`
- `goals/AC-021-美术方向与资源规范定稿并被测试引用.md`
- `goals/AC-022-精灵管线-加载-图集-dpr-缺资源回退.md`
- `goals/AC-023-塔-敌人-召唤物-可破坏物-传送门-基地精灵与状态动画覆盖.md`
- `goals/AC-024-背景与氛围场景机械指标.md`
- `goals/AC-025-ui-皮肤化与可读性-字号-对比度-锁定态.md`
- `goals/AC-026-双语零缺译-零硬编码.md`
- `goals/AC-027-移动端与低配降级视觉检查.md`
- `goals/AC-028-视觉重制后性能预算不回归.md`
- `goals/AC-029-美术语义评审记录存在且通过.md`
- `goals/AC-030-首领命中-破盾-护甲吸收各有可辨识的独立反馈层.md`
- `goals/AC-031-四场景-两视口全部走精灵资源-缺资源时场景级回退不崩溃.md`
- `goals/AC-032-设计重基-phase-rogue2-覆盖-70-件遗物与核心-契约-教义-觉醒字段表.md`
- `goals/AC-033-五派系点数与-4-8-12-阈值在模拟-快照-计分-ui-一致生效.md`
- `goals/AC-034-开局信物三选一与第-3-波起保底升级卡.md`
- `goals/AC-035-首领核心-五个首领波清波后的五类核心选择.md`
- `goals/AC-036-契约卡-第-9-14-19-24-波替换一张遗物卡-每局最多两次.md`
- `goals/AC-037-教义-五条塔专精通过首领核心选择且不可逆.md`
- `goals/AC-038-觉醒-p0-四条三级遗物行为词条.md`
- `goals/AC-039-肉鸽-2-0-平衡复测-三档通关率回到目标区间.md`
- `goals/AC-040-v2-0-版本号-changelog-release-一致.md`
- `goals/AC-041-18787-实例部署最新-main-并通过冒烟.md`
- `goals/AC-042-真人试玩记录满足-playtest-最低样本量与字段口径.md`
- `goals/AC-043-结构预算门禁通过且债务登记清空.md`
- `goals/AC-044-重构不改变行为-全量测试通过.md`
- `goals/AC-045-静态检查-语法-导入-风格-文档-通过.md`
- `goals/AC-046-模拟确定性哈希与重构前逐字节一致.md`
- `goals/AC-047-视觉像素与重构前逐帧一致且视觉套件通过.md`
- `goals/AC-048-性能预算不回归.md`
- `goals/AC-049-文档所有权与阶段文档一致.md`
- `goals/AC-050-敌人总数至少14且新敌人行为有区分度并进波次.md`
- `goals/AC-051-新敌人精灵-渲染-i18n-覆盖通过既有门禁.md`
- `goals/AC-052-三档平衡复测回到目标区间.md`
- `goals/AC-053-全量测试与模拟确定性不回归.md`
- `goals/AC-054-设计重基-phase-rogue2-覆盖70遗物6套装与核心契约教义觉醒字段表.md`
- `goals/AC-055-五派系点数与4-8-12阈值在模拟快照ui一致生效.md`
- `goals/AC-056-开局信物三选一与第3波起保底升级卡.md`
- `goals/AC-057-首领核心五个首领波清波后的五类核心选择.md`
- `goals/AC-058-契约卡第9-14-19-24波替换一张遗物卡每局最多两次.md`
- `goals/AC-059-教义五条塔专精通过首领核心选择且不可逆.md`
- `goals/AC-060-觉醒-p0-四条三级遗物行为词条.md`
- `goals/AC-061-肉鸽-2-0-平衡复测三档通关率回到目标区间.md`
- `goals/AC-062-设计定稿-phase-meta-机制数值字段契约ac映射.md`
- `goals/AC-063-天赋树与永久强化在模拟快照ui一致生效.md`
- `goals/AC-064-跨局传承与星核成就通行证悬赏分层清晰无重复.md`
- `goals/AC-065-平衡复测全量测试与确定性不回归.md`
- `goals/GOAL-001-上游基线合并与开发基线确认.md`
- `goals/GOAL-002-测试稳定性与并发隔离.md`
- `goals/GOAL-003-地图-2-0-三张固定可复用地图与可破坏物.md`
- `goals/GOAL-004-主海克斯-十个定义整局的开始选择.md`
- `goals/GOAL-005-战斗反馈-2-0-每一击都有重量.md`
- `goals/GOAL-006-视觉重制-全面精灵化-落地-暗黑霓虹几何.md`
- `goals/GOAL-007-肉鸽养成-2-0-派系-核心与契约.md`
- `goals/GOAL-008-v2-0-发布收口-版本-部署与真人试玩.md`
- `goals/GOAL-009-结构性重构-拆分长文件与结构门禁.md`
- `goals/GOAL-010-敌人扩充与固定三图平衡校准.md`
- `goals/GOAL-011-肉鸽养成-2-0-派系-首领核心-契约卡与教义.md`
- `goals/GOAL-012-局外深度成长-天赋树与跨局传承.md`