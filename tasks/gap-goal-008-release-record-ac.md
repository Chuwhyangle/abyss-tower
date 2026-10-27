---
id: gap-goal-008-release-record-ac
title: GOAL-008 充分性缺口：退出条件 4 的 tag 与发布哈希/回滚记录无 AC（提案新增 AC-043）
status: needs-human
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/release-record.test.mjs
---
## Proposal

GOAL-008（v2.0 发布收口：版本、部署与真人试玩）的退出条件是合取式。第四条目前在域 AC 里没有任何见证，原文逐字为：

> tag/推送等对外发布动作由人确认后执行，并在 `docs/RELEASE.md` 记下发布哈希与回滚方式。

**未被覆盖的部分（逐字）：「在 `docs/RELEASE.md` 记下发布哈希与回滚方式」，以及同一句里的 tag 产物本身。**

**为什么现有 AC 集不覆盖它（逐条对照 AC-040…AC-042）：**

- **AC-040**（`node scripts/release-check.mjs`）全程没有一次 `git` 调用（该文件只 import `fs` / `path`）。它对 `docs/RELEASE.md` 的全部要求是两行互不绑定的字符串判定：`release.includes('v2.0.0')` 与 `/回滚/.test(release)`（`scripts/release-check.mjs:50-52`）——任意一处出现 `v2.0.0`、文件里任意一句泛泛的「回滚」流程说明即可通过。⇒ **v2.0.0 tag 不存在、RELEASE.md 一个真实提交哈希都没记，AC-040 仍可 exit 0。** 现状佐证：`git tag --list` 最新只到 `v1.31.0`；`grep -n '回滚\|哈希' docs/RELEASE.md` 今日 0 命中。
- **AC-041**（`node scripts/deploy-smoke.mjs --base http://127.0.0.1:18787`）只读运行实例的 health、`/api/system/status` 的 version 与静态资源；不读 git tag、不读 RELEASE.md。实例跑在 2.0.0 不能推出 tag 存在或发布哈希被记录。
- **AC-042**（`node scripts/playtest-check.mjs`）只校验 `docs/PLAYTEST.md` 的样本量与字段口径，与发布标记正交。
- 现有仪器没有替代物：`node scripts/release.mjs verify v2.0.0`（`scripts/release.mjs:205`）校验 tag 存在且 tag 提交上的版本标记一致，但它不读 RELEASE.md；而「发布哈希」在全仓 `grep -rn '发布哈希' scripts/ tests/ docs/` **0 命中**，这条退出条件在代码里没有承载点。承担版本收口的 DOCS-003 也只在 Plan 第 3 步写「发布哈希**占位**」，DoD 写「回滚命令与发布哈希占位」——占位符不是「记下发布哈希」。

<!-- dedup-ref -->
相邻但不同机制（判定 separate，不合并）：DOCS-003（goal_ac=AC-040，版本面文案与占位符）与本任务共享 `docs/RELEASE.md`，但验收面不同——DOCS-003 证「版本号/CHANGELOG/PRD 对齐」，本任务证「tag 与发布记录可核验」；gap-release-deploy-smoke（goal_ac=AC-041）负责 18787 实例，本任务不碰部署。合并候选检查：`task-granularity-advice --root /data/home/wenhao/abyss-tower --touches scripts/release-record-check.mjs --touches docs/RELEASE.md` → peers=[DOCS-003, gap-release-deploy-smoke]（共享 docs/RELEASE.md）、mentions=[]；调度器按 Touches 串行即可。

**提案：为 GOAL-008 新增一条 AC（AC-043）**

- id：`AC-043`（最小空闲号：AC-040…AC-042 已占用，`goals/` 下无 AC-043 文件）
- title：v2.0.0 tag 与 RELEASE 发布记录（哈希 + 回滚命令）可核验
- criterion：`node scripts/release.mjs verify v2.0.0 && node scripts/release-record-check.mjs`
- expect：`exit 0`
- origin：GOAL-008 退出条件：tag/推送等对外发布动作由人确认后执行，并在 `docs/RELEASE.md` 记下发布哈希与回滚方式。

**为什么这条 AC 覆盖了缺口：** 两个臂各自见证这句退出条件的一个产物，且都不是对文案的复述。

1. `release.mjs verify v2.0.0` 在 tag 缺失时直接失败，并在 tag 存在时用 `git show` 读取 tag 提交里的版本标记，拦住「tag 打在版本号还没更新的提交上」。这把「人确认后打了 tag」落成机械可读的产物，同时**不**自动 push/tag（与目标「非目标」一节一致：脚本不 push、不建 PR、不打 tag）。
2. `scripts/release-record-check.mjs`（本任务新增，零依赖、只读）要求 `docs/RELEASE.md` 的 v2.0.0 发布记录里出现**完整 40 位提交哈希**，并断言它等于 `git rev-parse refs/tags/v2.0.0^{commit}`；同时要求「回滚」一节给出一条可执行 `git` 命令，且命令里引用的上一版本 tag 真实存在（当前为 `v1.31.0`）。于是「记下发布哈希」不再是出现某个字符串，而是**必须与真实 tag 指向同一个提交**：写错、写成占位符、写 7 位短哈希、回滚引用不存在的 tag，都 exit 1。

**本 AC 不覆盖的部分（明说）：** 推送到远端。核对远端需要网络（`git ls-remote`），不适合做每轮可重复的判据；本 AC 只钉住本地 tag 与发布记录，push 仍按退出条件由人执行。

## Plan

1. 人先裁定本提案（见 DoD 最后一项）；执行者不得自行写目标库。
2. 新增 `scripts/release-record-check.mjs`（零第三方依赖，只读，不写任何文件）：
   - `git rev-parse --verify refs/tags/v2.0.0^{commit}` 取 tag 提交；
   - 在 `docs/RELEASE.md` 定位 v2.0.0 发布记录小节（约定标题 `## v2.0.0 发布记录`，与 DOCS-003 写的 v2.0.0 段落同一节）；
   - 要求该节含 40 位十六进制提交哈希且等于 tag 提交；要求含「回滚」小节，其中至少一条 `git` 命令，且命令引用的 `refs/tags/<上一版本>` 可解析；
   - 失败时点名「缺哪个字段 / 哪个哈希对不上 / 哪个 tag 不存在」并 exit 1，成功打印 `PASS release record v2.0.0 → <sha7>`。
3. 新增 `tests/release-record.test.mjs`：用临时 git 仓库 + 夹具覆盖六种情形——①全对→exit 0 ②tag 缺失 ③哈希与 tag 提交不一致 ④哈希写成 7 位短哈希 ⑤回滚节缺命令 ⑥回滚引用的 tag 不存在，逐项断言退出码与错误文案。
4. 在 `scripts/test-changed.mjs` 的 TEST_MAP 登记 `scripts/release-record-check.mjs` → `tests/release-record.test.mjs`（新增源文件不登记会让全量 suite 的「审计覆盖」条红）。
5. `docs/RELEASE.md` 增加「发布记录」字段口径（发布哈希 / 发布日期 / 人确认 / 回滚命令模板），把 DOCS-003 的「发布哈希占位」升级为可填的真实字段；正文里的版本对齐文案仍由 DOCS-003 负责，本任务不改。
6. 人工发版后（tag 已由人创建并 push），人把实际哈希填进该节；随后 `node scripts/release.mjs verify v2.0.0 && node scripts/release-record-check.mjs` 应 exit 0。

## AC

- [ ] `node --test tests/release-record.test.mjs` exit 0
- [ ] `npm test` exit 0
- [ ] 检查器不自证：夹具覆盖 tag 缺失场景并断言 exit 1 且错误文案点名 `v2.0.0`（当前仓库确实未发布 v2.0.0，`git tag --list` 无该 tag）
- [ ] 人工接受后 AC-043 以本提案的 criterion 写入 GOAL-008；人完成 tag/push 并把真实哈希填进 `docs/RELEASE.md` 后，`node scripts/release.mjs verify v2.0.0 && node scripts/release-record-check.mjs` exit 0（待外部）

## DoD

- [ ] 六种夹具情形逐一无假绿：哈希与 tag 不一致、短哈希、占位符文本、回滚 tag 不存在都 exit 1
- [ ] `docs/RELEASE.md` 的发布记录字段口径写死（哪个小节、什么格式、谁填），DOCS-003 的「占位」不再是不二的终态
- [ ] 不自动 push / 不自动 tag：脚本只读，打 tag 与推送仍是人的动作；Notes 记录人工步骤与复核命令
- [ ] `npm test` exit 0；`node scripts/check-doc-ownership.mjs` exit 0（本任务不碰 PRD / TECH_DESIGN）
- [ ] 人裁定记录写入 Notes：认可 AC-043（推荐）/ 调整 criterion / 改为修订退出条件并说明为什么发布哈希不应有目标级见证（待外部）

## Touches

- `scripts/release-record-check.mjs` (new)
- `tests/release-record.test.mjs` (new)
- `scripts/test-changed.mjs`
- `docs/RELEASE.md`
- `tasks/gap-goal-008-release-record-ac.md`

## Notes

本任务是 goal-sufficiency 的提案任务，状态 `needs-human`：`goals/*.md` 只由人/管理者写入，执行者不得自行登记 AC-043，也不得把 GOAL-008 或任何 AC 置为 achieved。检查器只读——不 push、不打 tag、不写 RELEASE.md，「人确认后执行」的动作仍是人的。遵循 CLAUDE.md：零第三方依赖；`docs/PRD.md` / `docs/TECH_DESIGN.md` 不在 Touches。若人选择「修订退出条件」而不是新增 AC，请在裁定里说明理由并把本任务 supersede。
