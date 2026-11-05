---
id: feat-gacha-art
title: 抽卡·阶段1 美术：拉取 CC0 召唤/出货/稀有度资源到 public/assets/gacha/
status: ready
labels:
  - feat
parent: null
children: []
extra: {}
---
## Proposal

抽卡美术资源拉取与落地，冻结表 `docs/PHASE_抽卡.md` §7。零第三方依赖（只落本地资源文件，不进 npm）。

1. 拉取 CC0 资源到 `public/assets/gacha/`：
   - 召唤按钮：Summer Engine「Summon Button」（钻石召唤，紫蓝辉光）、「Challenge Button」（金色华丽）。
   - 出货特效：Summer Engine「Pixel Sparkle Burst」+ itch.io FX 魔法爆裂/火花。
   - 若有可直链的稀有度边框/光效也一并拉取。
2. 每个资源记录来源 URL + 许可（CC0），写 `public/assets/gacha/SOURCES.md`。
3. 稀有度光效/边框/金色粒子以**程序化**为主（复用现有 canvas 精灵管线风格），CC0 精灵图集为辅——保持「暗黑霓虹几何」风格统一。
4. 产出一个资源清单/注册（`public/assets/gacha/manifest.json`），供 `feat-gacha-ui` 消费（缺资源时 UI 回退到程序化塔绘制，不崩）。

## AC

- [ ] `public/assets/gacha/` 下有召唤按钮、出货特效、稀有度光效资源，且 `SOURCES.md` 记录每项来源 + CC0 许可
- [ ] `manifest.json` 列出可用资源 id→路径，供 UI 消费
- [ ] 资源文件可被服务端静态服务（`/assets/gacha/...` HTTP 200）
- [ ] 不引入第三方 npm 依赖；资源体积合理（不塞超大文件）

## DoD

- [ ] 落地于 `public/assets/gacha/*`(新) + `SOURCES.md` + `manifest.json`，零第三方依赖
- [ ] 所有资源 CC0/可商用，来源可溯
- [ ] 不碰 `public/js/**`、`server/**`、sim/数值/存档（纯资源，无代码逻辑）
- [ ] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches

## Touches

- `public/assets/gacha/` (new)
- `tasks/feat-gacha-art.md`

## Notes

立案 2026-11-06，独立于数据层/服务端，可与 `feat-gacha-ui` 并行。用户明确要求「抽卡动画等美术资源，网上很多，可以拉取，也可以开子代理一起做」。资源来源（CC0）：Summer Engine（summon/challenge button、pixel sparkle burst）、itch.io FX collection、AutoSprite、freegameui.net。注意：抽卡动画若没有现成完整 sprite sheet，则「召唤按钮 + 爆闪光效」组合 + 程序化粒子补足。语义验收交玩家（不读图评审，用户已定）。