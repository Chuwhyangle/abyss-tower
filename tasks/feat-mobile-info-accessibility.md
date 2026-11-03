---
id: feat-mobile-info-accessibility
title: 手机横屏信息可达性：紧凑屏抽屉 + 触控目标放大 + 扩 browser-mobile 覆盖
status: done
labels:
  - feat
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/ui-modules.test.mjs tests/panels-visual.test.mjs
---
## Proposal

手机适配已定 A 方向（用户 2026-11-03 拍板）：**维持横屏，只优化信息可达性**。现状三个缺口：① 紧凑屏把遗物面板/下一波情报整体 `display:none`（`styles.css:2350-2352`），关键信息直接丢失；② HUD 靠隐藏信息压缩（≤720px 隐藏第 4 项 stat 等），触控层薄（只有画布 + 技能钮）；③ `tests/browser-mobile.mjs` 未覆盖塔面板/结算/offer 弹窗。修复：① 紧凑屏关键信息（遗物/下一波/加成一览）改「可收起抽屉」而非隐藏，与 `feat-bonus-summary-relic-collapse`（done）的移动端遗物抽屉联动；② 触控目标放大（塔面板升级/出售/进化、倍速、暂停 ≥44px）；③ 扩 `browser-mobile.mjs` 覆盖塔面板/结算/offer 弹窗/退出确认。

## AC

- [x] 紧凑屏关键信息（遗物/下一波/加成一览）可从抽屉查看，不再 `display:none` 丢失
- [x] 塔面板升级/出售/进化、倍速、暂停触控目标 ≥44px
- [x] `tests/browser-mobile.mjs` 新增塔面板/结算/offer 弹窗覆盖（`LANG=zh_CN.UTF-8` 下通过）
- [x] `node --test tests/ui-modules.test.mjs tests/panels-visual.test.mjs` exit 0

## DoD

- [x] 落地于 `public/styles.css`、`public/index.html`、`public/js/ui/hud.js`、`public/js/ui/shop.js`、`public/js/app/input.js`，不引入第三方依赖
- [x] 回归测试覆盖抽屉可达性、触控尺寸、browser-mobile 新覆盖
- [x] `npm test` 全绿；补跑 `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN npm run test:mobile`
- [x] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `tests/browser-mobile.mjs`
- `tasks/feat-mobile-info-accessibility.md`

## Notes

立案 2026-11-03，源自 `docs/TODO.md` 的 TODO-7（方向 A）。browser-mobile 是浏览器验收，需 `LANG=zh_CN.UTF-8`（本机 Chrome 默认 en-US，中文断言会误报）。若 worker 实际 Touches 有出入，须 task_write 修正再 fan-in。

AC-1（紧凑屏抽屉）与 AC-2（触控目标 ≥44px）已由前序任务落地并合入 develop：`feat-bonus-summary-relic-collapse`（done，遗物抽屉/下一波情报/加成一览）与 `gap-mobile-visual-font-floor`（done，塔面板/倍速/暂停触控目标）。本任务实际 delta 仅 `tests/browser-mobile.mjs`（AC-3：新增塔面板/结算/offer 弹窗覆盖；并在无头环境把 requestFullscreen/orientation.lock 降级为 no-op，消除 CDP 渲染进程挂起）。AC-4 已复验：`node --test tests/ui-modules.test.mjs tests/panels-visual.test.mjs` exit 0。`npm test` 1920 例全绿；`LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node tests/browser-mobile.mjs` exit 0。

该轴仍暗,理由:本任务为移动端可达性增强，不改玩法/数值/文档面，L_D/L_G/L_S 无需量化。