# 抽卡美术资源 · 来源与许可（SOURCES）

本目录是抽卡系统（`docs/PHASE_抽卡.md` §7）的美术资源落地处。所有资源可商用、来源可溯；
第三方素材一律 CC0，仓库自绘/程序生成素材一律 `proprietary-internal`（本仓库所有，未对外授权，可商用）。

> ⚠️ 许可说明：任务 Proposal 点名的「Summer Engine」与「itch.io FX / freegamesprites」等外部源，
> 经实测其「CC0」资源为 AI 生成（CDN 路径含 `fal.media` / `ai-sprites/generated`），按
> `docs/ASSET_PIPELINE.md`「AI 生成但无法确权的素材一律不收」的规定不予采纳；itch.io 主站（403）
> 亦不可直连。因此除 `starburst.png` 之外，其余资源采用**程序化生成**（与既有
> `scripts/build-entity-sprites.mjs` 同一「暗黑霓虹几何」像素管线风格），作为冻结表 §7「程序化为主」的落地。

## 资源清单

| 文件 | 用途 | 来源 | 许可 |
| --- | --- | --- | --- |
| `starburst.png` | 出货爆光 / 星爆特效（叠加在塔卡后） | 第三方素材：OpenGameArt.org「Item Popup Starburst」（by Tiny Speck / Glitch），`https://opengameart.org/content/item-popup-starburst` | CC0-1.0 |
| `summon-button.png` | 召唤按钮（单抽，钻石召唤·紫蓝辉光） | 自带程序生成（procedural-canvas2d，128×64） | proprietary-internal |
| `summon-button-ten.png` | 召唤按钮（十连，金色华丽） | 自带程序生成（procedural-canvas2d，128×64） | proprietary-internal |
| `sparkle.png` | 程序化火花（Pixel Sparkle Burst 替代） | 自带程序生成（procedural-canvas2d，96×96） | proprietary-internal |
| `rarity-border-1.png` | 稀有度边框（1★ 基础，图鉴展示） | 自带程序生成（procedural-canvas2d，96×128） | proprietary-internal |
| `rarity-border-3.png` | 稀有度边框（3★ 普通） | 自带程序生成（procedural-canvas2d，96×128） | proprietary-internal |
| `rarity-border-4.png` | 稀有度边框（4★ 稀有） | 自带程序生成（procedural-canvas2d，96×128） | proprietary-internal |
| `rarity-border-5.png` | 稀有度边框（5★ 史诗） | 自带程序生成（procedural-canvas2d，96×128） | proprietary-internal |
| `rarity-border-6.png` | 稀有度边框（6★ 传说） | 自带程序生成（procedural-canvas2d，96×128） | proprietary-internal |
| `rarity-glow-1.png` | 稀有度光效（1★ 基础） | 自带程序生成（procedural-canvas2d，96×96） | proprietary-internal |
| `rarity-glow-3.png` | 稀有度光效（3★ 普通） | 自带程序生成（procedural-canvas2d，96×96） | proprietary-internal |
| `rarity-glow-4.png` | 稀有度光效（4★ 稀有） | 自带程序生成（procedural-canvas2d，96×96） | proprietary-internal |
| `rarity-glow-5.png` | 稀有度光效（5★ 史诗） | 自带程序生成（procedural-canvas2d，96×96） | proprietary-internal |
| `rarity-glow-6.png` | 稀有度光效（6★ 传说） | 自带程序生成（procedural-canvas2d，96×96） | proprietary-internal |

## 程序化生成方式（可重放）

程序化资源为确定性生成：不读环境、不用随机数、不写时间戳，同参数两次执行字节一致。生成逻辑与本仓库
`scripts/build-entity-sprites.mjs` 共用 `scripts/lib/png.mjs`（零依赖 PNG 编码，node:zlib + 自写 CRC32）。

- **稀有度配色**（对齐冻结表 §6「出货动画分档」与遗物 `RARITY` 色）：
  `1★ #8a9aa8`（基础灰）、`3★ #9fb0c3`（普通）、`4★ #5bc8ff`（稀有蓝）、`5★ #c88bff`（史诗紫）、`6★ #ffd36b`（传说金）。
- **召唤按钮**：`#0d151b` 底 + `#22333f` 线描边 + 中心菱形宝石（单抽蓝紫 / 十连金）+ 中心光晕（`radialGlow`，核心 + 光晕环两层）。
- **光效/边框**：光晕为叠加层（非 `shadowBlur`），符合 `docs/ART_DIRECTION.md`「发光是叠加层而非模糊滤镜」的约定。
- 运行时若缺少 `manifest.json` 里的任一 `status: ready` 资源，`feat-gacha-ui` 应回退到程序化塔绘制（不崩），
  与 ASSET_PIPELINE「缺资源回退」一致。

## manifest.json

`manifest.json` 列出全部资源 `id → path`（`src` 为 `/assets/gacha/...` 静态服务路径），供 `feat-gacha-ui` 消费；
字段遵循 `docs/ASSET_PIPELINE.md` 的清单 schema（`id / path / size / anchor / pivot / frames / states / status / dpr / compression / provenance / license / generator`）。
