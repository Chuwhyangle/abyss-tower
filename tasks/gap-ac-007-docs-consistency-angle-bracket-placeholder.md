---
id: gap-ac-007-docs-consistency-angle-bracket-placeholder
title: AC-007 复验：docs-consistency 尖括号占位符截断误报
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
  acceptance: node scripts/check-stability.mjs
goal_ac: AC-007
---
## Proposal

AC-007 判据 `node scripts/check-stability.mjs` 现 exit 1（3 轮全红），唯一确定性失败用例是 `tests/docs-consistency.test.mjs:345`「真实仓库文档一致：check:docs 的判定为通过」，报错 `docs/TODO.md:235: 代码路径不存在 -> docs/PHASE_`。

根因：`docs/TODO.md:235`（TODO-15 关卡节点化方案，commit b5e36aae）写的是占位符路径 `` `docs/PHASE_<主题>.md` ``——`<主题>` 是「先文档后开发」的占位符，不是字面路径。`scripts/docs-consistency.mjs` 的 `REPO_PATH_RE` token 字符集为 `[A-Za-z0-9._/*${CJK_PATH_CHARS}-]`，不含 `<`/`>`，路径在 `<` 处截断成 `docs/PHASE_`，该前缀不存在 → 误报。

此前修非 ASCII 截断（57858ccf：CJK 纳入字符集 + planned 块豁免，对应任务 `gap-ac-007-docs-consistency-nonascii-planned-path`）没覆盖尖括号占位符——`UNSAFE_PATH_CHARS = /[<>*{}$:?#|]/` 虽早已声明 `<`/`>` 为不安全字符，token 却从未把它们截进来，`normalizeCodePath` 的「含 unsafe 字符即返回 null 跳过」分支（与 `*` 通配符同一机制）永不触发。`CONTRIBUTING.md:32` 的 `` `docs/<topic>` `` 同因未误报，仅因其截断成的 `docs/` 目录真实存在。Nov 3 红同一根因（当时在 `docs/TODO.md:135`），Nov 4 的 TODO-15 提交推到 235 行——确定性假红，非 flake。

修法（系统性、不修文档文本）：把 `<`/`>` 纳入 `REPO_PATH_RE` token 字符集，使 `` `docs/PHASE_<主题>.md` ``、`` `docs/<topic>` `` 等尖括号占位符被整段捕获，再由既有的 `UNSAFE_PATH_CHARS` 判为 unsafe 返回 null 跳过。任何「顶层目录/…<占位符>…」占位约定都被识别为占位符，而非截断成前缀去查存在性；真实缺失路径（如 `docs/PHASE_不存在.md`）照旧报红。已实测：改后 OLD `docs/PHASE_` → NEW `docs/PHASE_<主题>.md`（整段捕获），真实 CJK 路径与真实缺失路径捕获不变。

## Plan

1. `scripts/docs-consistency.mjs`：`REPO_PATH_RE` 字符集从 `[A-Za-z0-9._/*${CJK_PATH_CHARS}-]` 扩为 `[A-Za-z0-9._/*${CJK_PATH_CHARS}<>-]`（`-` 保持末位字面量），补注释说明尖括号占位符由 `UNSAFE_PATH_CHARS` 拒绝。
2. `tests/docs-consistency.test.mjs`：新增回归 fixture——`makeFixture` 放 `` `docs/PHASE_<主题>.md` `` 与 `` `docs/<topic>` ``，断言 `codePathProblems(...)` 为 0（占位符不误报）；同 fixture 放 `` `docs/PHASE_不存在.md` `` 断言仍报（防过度跳过）。真实仓库用例 345 不动。
3. `node --test tests/docs-consistency.test.mjs` 全绿 → `npm test` 全绿。
4. `node scripts/check-stability.mjs` 连续 3 轮 exit 0，AC-007 判据翻绿。

## AC

- [ ] `REPO_PATH_RE` 字符集含 `<` 与 `>`；`` `docs/PHASE_<主题>.md` `` 与 `` `docs/<topic>` `` 占位符不再被报「代码路径不存在」
- [ ] 新增回归测试：尖括号占位符不误报、真实缺失路径仍报
- [ ] `node --test tests/docs-consistency.test.mjs` exit 0
- [ ] `npm test` exit 0（全量套件一次通过）
- [ ] `node scripts/check-stability.mjs` exit 0

## DoD

- [ ] 门禁语义未放宽：仅让占位符不误报，真实缺失路径照旧红
- [ ] 零运行时/玩家可见改动、零第三方依赖
- [ ] 不提交 `server/data/*.db*`、`backups/*.db`

## Touches

- `scripts/docs-consistency.mjs`
- `tests/docs-consistency.test.mjs`
- `tasks/gap-ac-007-docs-consistency-angle-bracket-placeholder.md`

## Notes

无 in-flight 任务 claim `goal_ac: AC-007`（现 7 个 claim 任务均 done）；granularity-advice `peers` 为空（无 open 任务触碰 docs-consistency）；无 `depends_on`。前任 `gap-ac-007-docs-consistency-nonascii-planned-path`（done）是不同机制（非 ASCII 截断 + planned 块），不折叠。