---
id: gap-i18n-coverage-zero-hardcode
title: 双语零缺译、零硬编码：新建 tests/i18n-coverage.test.mjs，UI
  文案收进词典并补齐事件/变异/皮肤/悬赏/通行证译名（AC-026）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/i18n-coverage.test.mjs
goal_ac: AC-026
---
## Proposal

GOAL-006 退出条件要求「机械视觉检查通过：单位与背景对比度、最小字号、剪影像素覆盖、未解锁卡可读性、**双语无缺译与无硬编码**」，AC-026 以 `node --test tests/i18n-coverage.test.mjs`（expect exit 0）见证。该文件在 main 上不存在，因此 AC 当前证据是 `criterion-capability-unevaluable`（criterion 在 cwd 下无法解析），不是一次失败读数。目标正文也点名了实机问题：「英文界面里硬编码中文」。

**现状（2026-10-27 在 main 上实测，扫描口径见 Plan 第 2 步 C）**

1. **已有护栏只覆盖很小一块。** `tests/i18n.test.mjs` 断言中英键集合一致、无空文案、术语表别名，但「源码无硬编码中文」只扫 **3 个模块**（`relic-codex-ui.js` / `season-ui.js` / `app/boot-errors.js`），`t()/tOr()` 键引用也只扫这 3 个文件。全仓 UI 层从未被扫。
2. **UI 层仍有 388 处玩家可见中文字面量，分布在 28 个文件**（排除注释、`console.*`、以及 `tOr/tData` 的 fallback 实参）。最大的：`public/js/auth-ui.js` 49、`public/js/share-ui.js` 43、`public/js/ui/notifications.js` 39、`public/js/replay-ui.js` 36、`public/js/ui/season-pass.js` 35、`public/js/bounties-ui.js` 20、`public/js/ui/modals.js` 20、`public/js/ui/shared.js` 20、`public/js/share-card.js` 17、`public/js/app/combat.js` 15、`public/js/leaderboard-ui.js` 14、`public/js/app/run.js` 11、`public/js/daily-history-ui.js` 9、`public/js/api.js` 8。
   - `public/js/auth-ui.js:51-61` 整个登录/注册面板的标题、副标题、按钮都是中文 HTML 模板，没有 i18n 路径。
   - `public/js/share-ui.js:15-27`、`public/js/replay-ui.js:19-30` 各自维护一份本地 `TEXT`（zh/en 两份），`public/js/ui/notifications.js:17-25` 维护 `{key, zh, en}` 表与 `'中文 / English'` 拼接常量——都能切英文，但都不是词典，属硬编码。
   - `public/js/ui/settings-panel.js:114-127` 的 `LOCAL_FALLBACK` 注释直言「新增文案不写进词典…避免扩大 i18n 改动面」。
3. **静态外壳同样硬编码。** `public/index.html` 有 78 行含中文，仅 43 处 `data-i18n*` 标注；其余文本节点、`aria-label`、`title`、`placeholder` 在英文界面原样显示中文。
4. **数据表里被 UI 直接渲染的中文没有词典键。** `data.event.*` / `mutation.*` / `skin.*` / `bounty.*` / `seasonPass.*` 在 zh-CN/en-US 里 **0 个键**，而 UI 直接渲染原值：`public/js/ui/modals.js:244,256-257`（事件与选项 name/desc）、`public/js/ui/title.js:284` 与 `public/js/ui/result.js:45`（变异名）、`public/js/bounties-ui.js`、`public/js/ui/season-pass.js`、`public/js/cosmetics-ui.js`。这是「英文界面里硬编码中文」的主要来源。
   - 反例（已做对）：塔/敌人/难度/地图/词缀/可破坏物/遗物/技能/成就走 `data.<group>.<id>.<field>` + `tData()` 回退数据原值，词典共 908/901 键。
5. **en-US 目前仅 1 处中文**：`public/js/shared/i18n/en-US.js:371` 的 `'settings.languageZh': '简体中文'`（语言选择器的母语名，属有意白名单项）。

本任务把「零缺译、零硬编码」变成可机械判定的口径并落地：UI 文案全部进词典，数据驱动界面走 `tData()` 并补齐键，静态外壳加 `data-i18n*`，扫描器自带自测与允许清单上限，杜绝「把测试写空」式过关。

<!-- dedup-ref -->
去重与粒度：库内没有任何任务以 `goal_ac: AC-026` 认领本 AC，也没有 i18n 覆盖率/硬编码扫描任务（`grep -rl "goal_ac: AC-026" tasks/` 为空）。`task-granularity-advice` 以本任务 Touches 实测的 open peers 只共享文档与词典：ART-001、gap-audio-impacts、gap-background-atmosphere-gate、gap-culmination-shows、gap-floaters-layering、gap-hitstop-camera-feedback、gap-ui-readability-font-floor、gap-weapon-impact-vfx（均只共享 `docs/TECH_DESIGN.md` / `docs/PRD.md`），以及 gap-auto-quality-default（另共享 `public/js/settings.js`、`public/js/ui/settings-panel.js` 与两份词典，它要加 `settings.preset*` 键）。机制不同、验收面独立（各自 criterion 不同），判定 separate，不合并；共享文件由调度器按 Touches 串行。`mentions[]` 中的 combat.js/settings.js/result.js 只是正文提及，不构成 Touches 冲突。

## Plan

1. **先文档后开发（CLAUDE.md 约定）**
   - `docs/PRD.md`：补「双语口径」——玩家可见文案一律来自 `public/js/shared/i18n/` 两份词典；数据表自带中文仅作为 `tData()` 的**不可达回退**；静态外壳用 `data-i18n*`；验收命令 `node --test tests/i18n-coverage.test.mjs`。
   - `docs/TECH_DESIGN.md`：新增「i18n 与本地化」小节：单一来源、键命名（`<area>.<id>.<field>`；数据表统一 `data.<group>.<id>.<field>`）、`t`/`tOr`/`tData` 分工与回退语义、允许清单规则、A–E 五组扫描面，并写明「不得通过空扫描/放宽白名单过关」。

2. **新增 `tests/i18n-coverage.test.mjs`**，五组断言：
   - **A 字典完整性**：`Object.keys(zh)` 与 `Object.keys(en)` 逐项相等；所有值为非空字符串；`en-US` 值不含 CJK（白名单仅 `settings.languageZh`）；zh 含 CJK 的键，其 en 值不得与 zh 逐字相同（防复制未译）。
   - **B 引用完整性**：扫描 `public/js/**/*.js` 中的字面量 `t('k')` / `tOr('k'` / `hasKey('k')` / `tFor(locale,'k')` / `tData('g','id','f')`，以及 `public/index.html` 的 `data-i18n` / `data-i18n-title` / `data-i18n-aria`，逐项断言两份词典都存在；`tData` 按 `data.<group>.<id>.<field>` 合成键。
   - **C UI 层零硬编码**：扫描 `public/js/ui/**`、`public/js/*-ui.js`、`public/js/app/**`、`public/js/api.js`、`public/js/settings.js`、`public/js/audio.js`、`public/js/share-card.js`、`public/js/ui.js`、`public/js/game-app.js`，断言除 `tOr(...)`/`tData(...)` 的 **fallback 实参**外不含 CJK；`public/index.html` 的文本节点必须为空或与对应 `data-i18n` 的 zh 值逐字相等，且含中文的 `aria-label`/`title`/`placeholder` 都必须有标注。允许清单 `HARDCODE_ALLOWLIST` 为 `{file, text, reason}`，断言每项 reason ≥8 字、总数 ≤5。
   - **D 数据层零缺译（枚举式）**：import 数据模块，逐实体断言两份词典都有非空键：塔/敌人/难度/固定地图/词缀/可破坏物（现状已覆盖）＋**事件 12（name/desc）、事件选项 36（name/desc）、变异 5（name/desc）、皮肤 8 + 套装 2（name）、悬赏模板 14（title/desc）+ 3 档位 + 3 周期、赛季通行证 5 里程碑（name/desc）+ 4 个积分来源**；英文值不含 CJK 且不等于中文值。
   - **E 扫描器自测**：内嵌 fixture（含行注释、块注释、`${}` 模板插值、正则字面量、`tOr` fallback、`data-i18n` 属性）断言扫描器恰好在预期位置命中/放过，防止扫描器什么都不报。

3. **UI 层迁移（388 处，可按文件所有权拆 ≤3 个子代理，见 CLAUDE.md）**：每个中文字面量改成词典键 + `t()`/`tOr()`；**zh 值必须与改动前的实际渲染文案逐字相同**（避免现有浏览器断言与中文回归）。优先处理最大的 11 个文件。`share-ui`、`replay-ui` 的本地 `TEXT`、`notifications` 的 `{zh,en}` 表与 `'中文 / English'` 常量整体下线。
   - 为保持 locale 参数化的纯函数语义（`replay-ui` 的 `buildTimeline/formatReplayEntry/formatTimelineText/shareFailureText`、`notifications` 的 `*Text/*Label`）不变，在 `public/js/i18n.js` 增加 `tFor(locale, key, params = {})`（必要时 `tOrFor`），这些函数改调它并保留原有 `locale` 形参；zh-CN 下返回值与当前字面量逐字一致。

4. **数据驱动界面接 `tData()`**：`ui/modals.js`（事件名/描述/选项）、`ui/title.js` 与 `ui/result.js`（变异名）、`bounties-ui.js`（模板标题/描述、档位/周期标签）、`ui/season-pass.js`（里程碑、积分来源）、`cosmetics-ui.js`（皮肤与套装名）。

5. **词典补键**：`zh-CN.js` / `en-US.js` 同步新增（UI 约 300、数据约 165，以扫描器归零为准）；只增不改既有键值（`gap-auto-quality-default` 会另加 `settings.preset*`，不要覆盖）；`settings.languageZh` 保持唯一 CJK 白名单项；删除 `ui/settings-panel.js` 的 `LOCAL_FALLBACK` 改用正式键。

6. **静态外壳**：`public/index.html` 的文本节点/`aria-label`/`title`/`placeholder` 全部补 `data-i18n*` 与词典键；保留的 zh 文本必须与 zh 字典逐字一致（B/C 组会校验）。

7. **回归**：`node --test tests/i18n.test.mjs tests/i18n-coverage.test.mjs tests/ui-split.test.mjs`；`npm test`；浏览器 `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN npm run smoke` / `flow` / `test:mobile`（本机浏览器默认 en-US，中文断言必须带 locale）。若某测试断言源码字面量，改成断言渲染结果/词典键，并把该测试加进 Touches（改完 `task_write` 后须 `git checkout main -- tasks/gap-i18n-coverage-zero-hardcode.md` 同步进 worktree）。

8. **新增 `tests/browser-i18n.mjs`**（复用 `tests/harness.mjs` 的 `startTestServer`/`launchBrowser`/`registerAndLogin`）：载入前把 `abyss-tower.locale.v1` 设为 `en-US`，走标题→海克斯三选一→选图→战斗→结算，并打开排行榜/悬赏/通行证/外观/回放/分享/通知偏好 7 个面板，断言 `document.body.innerText`、所有 `aria-label`/`title`/`placeholder` 零 CJK、零裸键（形如 `area.section.key` 且不在词典）、`window.__bootErrors` 为空；再切回 zh-CN 重跑一遍确认无空洞。

## AC

- [ ] `node --test tests/i18n-coverage.test.mjs` exit 0，且该文件覆盖 A–E 五组断言（含扫描器自测 fixture 与「允许清单 ≤5 项、每项 reason ≥8 字」的断言）
- [ ] `node --test tests/i18n.test.mjs` exit 0（既有护栏不回归）
- [ ] 数据层键齐：D 组枚举的每个实体在两份词典都有非空键，en 值无 CJK 且不等于中文（测试内断言，失败信息逐条列出缺失键）
- [ ] `node --test tests/ui-split.test.mjs tests/share-ui.test.mjs tests/replay-share.test.mjs tests/settings-panel.test.mjs` exit 0
- [ ] `npm test` exit 0
- [ ] `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN npm run smoke`、`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN npm run flow`、`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN npm run test:mobile` 均 exit 0
- [ ] `node tests/browser-i18n.mjs` exit 0（en-US 全程零 CJK、零裸键、无 `__bootErrors`）
- [ ] `docs/TECH_DESIGN.md` 含「i18n 与本地化」小节且 `docs/PRD.md` 含双语口径：`grep -n "i18n-coverage.test.mjs" docs/TECH_DESIGN.md docs/PRD.md` 两个文件各 ≥1 命中

## DoD

- [ ] 真实浏览器（Chrome）en-US 实跑：把 `localStorage['abyss-tower.locale.v1']` 设为 `en-US` 后完成一局（标题→海克斯→选图→战斗→结算）并逐个打开 7 个面板；记录每屏 `innerText` 的 CJK 计数（必须 0）、裸键计数（0）、`window.__bootErrors`（空）与截图路径到 Notes
- [ ] 局内切换语言（zh-CN ⇄ en-US）各两次：界面即时刷新、无中英混排、无裸键；输出记录进 Notes
- [ ] zh-CN 回归：`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN npm run smoke|flow|test:mobile` 全绿；抽查标题/商店/结算三屏截图，文案与改动前逐字一致
- [ ] 扫描器非空转证据：把落地过程中 `node --test tests/i18n-coverage.test.mjs` 的首次输出（文件尚不存在或断言红）与最终输出（exit 0）、以及扫描面命中数一并写进 Notes
- [ ] Notes 记录：新增键数（zh/en 各多少）、扫描面文件数与字面量数、`HARDCODE_ALLOWLIST` 内容与理由、`tests/browser-i18n.mjs` 输出摘要
- [ ] 不改 `public/js/sim.js` 与 `public/js/sim/**`、不改战斗数值/接口/存档；`git diff --stat` 只含本任务 Touches 内文件

## Touches

- `public/index.html`
- `public/js/i18n.js`
- `public/js/api.js`
- `public/js/app/combat.js`
- `public/js/app/controller.js`
- `public/js/app/input.js`
- `public/js/app/run.js`
- `public/js/app/session.js`
- `public/js/app/skills.js`
- `public/js/audio.js`
- `public/js/auth-ui.js`
- `public/js/bounties-ui.js`
- `public/js/cosmetics-ui.js`
- `public/js/daily-history-ui.js`
- `public/js/leaderboard-ui.js`
- `public/js/replay-ui.js`
- `public/js/settings.js`
- `public/js/share-card.js`
- `public/js/share-ui.js`
- `public/js/ui.js`
- `public/js/ui/modals.js`
- `public/js/ui/notifications.js`
- `public/js/ui/result.js`
- `public/js/ui/season-pass.js`
- `public/js/ui/settings-panel.js`
- `public/js/ui/shared.js`
- `public/js/ui/shop.js`
- `public/js/ui/title.js`
- `public/js/shared/i18n/zh-CN.js`
- `public/js/shared/i18n/en-US.js`
- `tests/i18n-coverage.test.mjs`
- `tests/i18n.test.mjs`
- `tests/browser-i18n.mjs`
- `tests/ui-split.test.mjs`
- `tests/share-ui.test.mjs`
- `tests/replay-share.test.mjs`
- `tests/settings-panel.test.mjs`
- `tasks/gap-i18n-coverage-zero-hardcode.md`

## Notes

- 文档 lane（DOCS-001，2026-10-27）：本任务的设计增量已收口到 `docs/PHASE_FEEL_ART.md`；两份总文档不再由本任务修改（Touches 已摘除），实现中新发现的设计增量写进本任务 Notes。
