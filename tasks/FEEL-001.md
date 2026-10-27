---
id: FEEL-001
title: 默认自动画质与首次进入反馈链
status: ready
labels:
  - feat
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/feel-defaults.test.mjs
---
## Proposal

首次进入默认使用 `QUALITY_PRESETS.low`（30fps、DPR 1、无光晕、无震屏、飘字仅关键），把游戏最差的表现当成默认。玩家反馈的「打击感不行」首先来自这里：命中闪白只有 0.08s，在 30fps 下只剩 2–3 帧，震屏与光晕又被关闭。需要把默认改成自动档：桌面高配、弱机/移动端降档，30fps 仅作显式选择。

## Plan

1. `public/js/settings.js` 增加 `quality: 'auto' | 'low' | 'high'`，默认 auto；`normalizeSettings` 保留旧字段兼容与逐字段迁移。
2. 新 `resolveQuality(env)` 纯函数：根据 `prefers-reduced-motion`、`navigator.hardwareConcurrency`、`devicePixelRatio`、触控与视口宽度给出初始档位；不读取任何模拟状态。
3. `public/js/game-app.js` 应用解析后的运行时设置；启动后采样前 30 帧，若平均帧时间 > 20ms 自动降一档并提示一次；用户显式选择后不再自动改。
4. `public/js/ui/settings-panel.js` 增加「自动/低/高」三选项；手动选择持久化到现有 settings key，auto 只持久化选择本身。
5. 测试 `tests/feel-defaults.test.mjs` 覆盖桌面/移动/弱机/reduced-motion 的解析结果、显式选择优先、自动降档不改变模拟。

## AC

- [ ] `node --test tests/feel-defaults.test.mjs` 通过
- [ ] `node --test tests/settings.test.mjs` 通过（含旧配置迁移）
- [ ] 桌面无头浏览器首次进入解析为 high（fps 60、glow/shake 开）
- [ ] 模拟移动端/弱机解析为 low，且设置面板显示「自动」
- [ ] 显式选择 low 后刷新仍为 low，不被自动探测覆盖

## DoD

- [ ] 真实浏览器首屏截图显示 60fps 档与光晕/震屏开启
- [ ] 自动降档只影响表现，不改变 `npm test` 与同 seed 对局结果
- [ ] 设置面板在中文/英文下文案完整
- [ ] 文档（GUIDE/TECH_DESIGN）更新默认值说明

## Touches

- `public/js/settings.js`
- `public/js/game-app.js`
- `public/js/ui/settings-panel.js`
- `tests/settings.test.mjs`
- `tests/feel-defaults.test.mjs` (new)
- `docs/GUIDE.md`
- `docs/TECH_DESIGN.md`
- `tasks/FEEL-001.md`

## Notes

自动降档的判定必须可测试：把帧时间采样与档位决策拆成纯函数，浏览器只负责接线。旧 localStorage 配置升级后不能把用户显式选择的 low 覆盖掉。
