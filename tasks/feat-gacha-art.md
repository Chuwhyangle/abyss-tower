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

- [x] `public/assets/gacha/` 下有召唤按钮、出货特效、稀有度光效资源，且 `SOURCES.md` 记录每项来源 + CC0 许可
- [x] `manifest.json` 列出可用资源 id→路径，供 UI 消费
- [x] 资源文件可被服务端静态服务（`/assets/gacha/...` HTTP 200）
- [x] 不引入第三方 npm 依赖；资源体积合理（不塞超大文件）

## DoD

- [x] 落地于 `public/assets/gacha/*`(新) + `SOURCES.md` + `manifest.json`，零第三方依赖
- [x] 所有资源 CC0/可商用，来源可溯
- [x] 不碰 `public/js/**`、`server/**`、sim/数值/存档（纯资源，无代码逻辑）
- [x] `docs/PRD.md` / `docs/TECH_DESIGN.md` 不入 Touches

## Touches

- `public/assets/gacha/` (new)
- `tasks/feat-gacha-art.md`
- `docs/PHASE_抽卡.md`

## Notes

立案 2026-11-06，独立于数据层/服务端，可与 `feat-gacha-ui` 并行。用户明确要求「抽卡动画等美术资源，网上很多，可以拉取，也可以开子代理一起做」。资源来源（CC0）：Summer Engine（summon/challenge button、pixel sparkle burst）、itch.io FX collection、AutoSprite、freegameui.net。注意：抽卡动画若没有现成完整 sprite sheet，则「召唤按钮 + 爆闪光效」组合 + 程序化粒子补足。语义验收交玩家（不读图评审，用户已定）。

实现（2026-11-06）：落地 `public/assets/gacha/`。CC0 拉取：OpenGameArt「Item Popup Starburst」（CC0-1.0，by Tiny Speck）→ `starburst.png`（出货爆光）。Proposal 点名的 Summer Engine / itch.io FX / freegamesprites 经实测为 AI 生成（CDN 路径含 `fal.media` / `ai-sprites/generated`）或主站 403，按 ASSET_PIPELINE「AI 生成无法确权不收」拒收，改为程序化生成（同 build-entity-sprites.mjs 的暗黑霓虹几何像素管线）：召唤按钮（单抽紫蓝/十连金）、sparkle、5 档稀有度边框+光效（1/3/4/5/6★，配色对齐冻结表 §6 与遗物 RARITY）。全部资源 HTTP 200 静态服务已验证；零第三方依赖；总量 92K。SOURCES.md 记录每项来源+许可（CC0-1.0 / proprietary-internal 可商用）。

门禁修复（2026-11-06 第二轮）：上轮 suite 红非本任务缺陷，而是冻结表 `docs/PHASE_抽卡.md`（docs lane 已落地）引用了 4 个尚未落地的代码路径（`public/js/shared/data/towers-rarity.js`、`server/db/migrations/0012_gacha.mjs`、`tests/gacha.test.mjs`、`server/routes/gacha.mjs`，分属 `feat-gacha-contract` / 阶段1 服务端）而未包裹 `docs-consistency:planned` 块，致 `真实仓库文档一致：check:docs` 恒红、阻断整个抽卡阶段所有 fan-in。按 `PHASE_META.md` / `TODO.md` 既有惯例给这 4 行补 planned 块（只豁免代码路径存在性，不改任何契约）；`node scripts/docs-consistency.mjs` 与 `tests/docs-consistency.test.mjs` 已全绿。
