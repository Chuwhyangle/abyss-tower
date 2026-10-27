---
id: ART-UI-001
title: HUD/文案可读性与 i18n 收口
status: todo
labels:
  - feat
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/i18n-coverage.test.mjs
goal_ac: AC-026
---
## Proposal

实机审查（英文界面 + 中文界面各跑一轮）暴露出一批与精灵管线无关、但现在就能修的可读性问题：

- 顶栏 HUD 是 12–13px 小字，金币/波次/基地血量没有视觉层级；"战斗中"在中间状态条和右侧按钮各出现一次，信息重复。
- 未解锁塔卡几乎不可读：灰字灰底、对比度极低（`public/js/ui/shop.js` + `public/styles.css`）。
- 英文界面里硬编码中文：`public/js/ui.js:147`（变异挑战）、`public/js/daily-history-ui.js:78-140`、`public/js/share-card.js:33-52`、`public/js/ui/result.js:53`、`public/js/auth-ui.js:7-11`、`public/js/settings.js:319-327`；i18n 字典没有对应键。
- 这些问题直接构成"美术不行"的第一印象，且与 GOAL-006 的精灵化正交：即使以后换皮，字号、对比度、文案与双语也必须先修好。

本任务只改表现层与文案，不改任何战斗数值、布局语义或模拟逻辑。

## Plan

1. 新增 `tests/i18n-coverage.test.mjs`：扫描 `public/js` 中除 `shared/i18n/`、`shared/data*` 之外的 CJK 字符串字面量，白名单只允许注释与测试夹具；同时校验两本字典键集一致、`t()` 使用的键在两本字典都存在。
2. 把上述硬编码文案抽到 `public/js/shared/i18n/zh-CN.js` 与 `en-US.js`，调用点改用 `t()` / `tOr()`；`settings.js` 的档位标签同样入字典（与 `gap-auto-quality-default` 串行，避免同文件冲突）。
3. 新增 `tests/ui-readability.test.mjs`：校验 HUD 字号下限（≥13px，关键数值 ≥16px）、未解锁卡文本对比度 ≥4.5:1、每屏至多一个"战斗中"状态、移动视口触控目标 ≥44px。
4. `public/styles.css` 与 `public/js/ui/hud.js` / `shop.js`：提升字号与层级、合并重复状态条、未解锁卡改为"可读的禁用态"（保留灰化但提高对比度），不改变任何点击行为。
5. 中英双语各截 title / combat / result 三张图，人工确认无混排；移动视口 390×844 复核。

## AC

- [ ] `node --test tests/i18n-coverage.test.mjs` 通过（无硬编码 CJK、两本字典键集一致）
- [ ] `node --test tests/ui-readability.test.mjs` 通过（字号、对比度、重复状态、触控尺寸）
- [ ] `npm run check:syntax` 与 `node scripts/style-check.mjs` 通过
- [ ] 英文界面下 title / daily-history / share-card / result / auth / settings 六个面板无中文字面量
- [ ] `node scripts/visual-check.mjs --suite ui` 在 VIS-001 落地后 exit 0

## DoD

- [ ] 真实浏览器中英双语截图各三张，混排与不可读卡片消失
- [ ] 移动视口 390×844 下 HUD 不溢出、触控目标 ≥44px
- [ ] `npm test` 全绿，战斗行为与数值零变化
- [ ] `docs/GUIDE.md` 的界面说明与新文案一致

## Touches

- `public/styles.css`
- `public/js/ui/hud.js`
- `public/js/ui/shop.js`
- `public/js/ui.js`
- `public/js/daily-history-ui.js`
- `public/js/share-card.js`
- `public/js/ui/result.js`
- `public/js/auth-ui.js`
- `public/js/settings.js`
- `public/js/shared/i18n/zh-CN.js`
- `public/js/shared/i18n/en-US.js`
- `tests/i18n-coverage.test.mjs` (new)
- `tests/ui-readability.test.mjs` (new)
- `docs/GUIDE.md`
- `tasks/ART-UI-001.md`

## Notes

与精灵化不冲突：本任务只修字号、对比度、文案与双语，不引入任何贴图。`public/js/settings.js` 与 `gap-auto-quality-default` 有文件重叠，调度器按 Touches 串行即可。不修改 `docs/PRD.md` / `docs/TECH_DESIGN.md`，避免继续占用文档热点；设计增量写在本任务 Notes，由后续文档整合任务统一吸收。
