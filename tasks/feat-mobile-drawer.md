---
id: feat-mobile-drawer
title: 手机适配：紧凑屏信息改可收起抽屉 + 触控目标放大 + 扩浏览器测试覆盖
status: todo
labels:
  - feat
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/ui-split.test.mjs tests/mobile-input.test.mjs
---
## Proposal

手机端现状（用户拍板方向 A：维持横屏、只优化信息可达性）：紧凑屏把遗物面板/下一波情报整体 `display:none`（`styles.css:2350-2352`），HUD 靠隐藏信息压缩（≤720px 隐藏第 4 项 stat 等），触控层薄（只有画布 + 技能钮），`browser-mobile.mjs` 未覆盖塔面板/结算/offer 弹窗。本任务：① 紧凑屏信息改「可收起抽屉/按钮」而非隐藏——遗物列表与下一波情报在小屏有可达入口；② 触控目标放大——塔面板升级/出售/进化、倍速、暂停等按钮达 ≥44px 触控高度；③ 扩 `tests/browser-mobile.mjs` 覆盖塔面板操作、结算、offer 弹窗的溢出断言。**不改竖屏可玩**（仍横屏提示转横）。

## AC

- [ ] 紧凑屏遗物列表/下一波情报有可达入口（抽屉或按钮），不再整块 `display:none`
- [ ] 塔面板升级/出售/进化、倍速、暂停等触控目标 ≥44px
- [ ] `tests/browser-mobile.mjs` 新增塔面板操作、结算、offer 弹窗溢出断言
- [ ] `node --test tests/ui-split.test.mjs tests/mobile-input.test.mjs` exit 0

## DoD

- [ ] 落地于 `public/styles.css`、`public/index.html`、`public/js/ui/hud.js`、`public/js/app/input.js`，不引入第三方依赖
- [ ] 回归测试覆盖抽屉入口、触控尺寸、浏览器移动端溢出
- [ ] `npm test` 全绿；`LANG=zh_CN.UTF-8` 补跑 `node tests/browser-mobile.mjs`
- [ ] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `public/styles.css`
- `public/index.html`
- `public/js/ui/hud.js`
- `public/js/app/input.js`
- `tests/browser-mobile.mjs`
- `tasks/feat-mobile-drawer.md`

## Notes

立案 2026-11-03，源自 `docs/TODO.md` 的 TODO-7（方向 A 已定）。浏览器验收需 `LANG=zh_CN.UTF-8`（本机 Chrome 默认 en-US 会误报）。若 worker 实际 Touches 有出入，须 task_write 修正再 fan-in。

该轴仍暗,理由:本任务为移动端可达性优化，无新文档面，L_D/L_G/L_S 无需量化。
