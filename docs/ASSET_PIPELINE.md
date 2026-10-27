<!-- docs-consistency:ignore-file -->
<!-- 本文件是资源管线规范：大量路径指向「尚未产出」的素材（占位、示例、目录结构），
     它们在干净检出里本就不存在。路径本身由 tests/art-spec.test.mjs 的清单校验负责，不用文档门禁重复校验。 -->

# 资源管线与清单规范（ASSET_PIPELINE）

本文件规定**资源怎么交付**：清单字段、命名、目录、图集与 DPR、压缩、占位策略、授权与出处、生成方式记录。
美术方向（风格、色板、光照、动效）见 [ART_DIRECTION](ART_DIRECTION.md)，不在这里重复。

原则：**清单先行**。任何图片在进入渲染层之前，必须先有一条通过 `tests/art-spec.test.mjs` 校验的 manifest 条目。

## 资源清单 schema

每条资源一个 JSON 对象，字段如下（`必填` 缺一即校验失败）：

| 字段 | 类型 | 必填 | 取值 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | string | 必填 | `^[a-z]+/[a-z0-9-]+$` | 全局唯一，形如 `类别/名称` |
| `path` | string | 必填 | — | 相对仓库根的源图路径，指向 DPR 1 主图 |
| `size` | object | 必填 | — | 逻辑像素尺寸 `{ "w": 64, "h": 64 }` |
| `anchor` | string | 必填 | center / foot / top-left / muzzle | 落地与对齐锚点 |
| `pivot` | object | 必填 | — | 旋转与缩放轴心，归一化 `{ "x": 0.5, "y": 0.5 }` |
| `frames` | integer | 必填 | — | 单状态最大帧数，必须 ≥ 用到的任一状态帧数 |
| `states` | array | 必填 | idle / attack / hit / death | 状态集，必须包含 `idle` |
| `status` | string | 必填 | placeholder / ready / deprecated | 交付状态；只有 `ready` 可被渲染层加载 |
| `dpr` | array | 必填 | 1 / 2 | 提供的 DPR 变体 |
| `atlas` | string | 可选 | — | 图集名；缺省表示散图 |
| `compression` | string | 必填 | lossless / lossy-webp / lossy-png | 压缩口径 |
| `provenance` | object | 必填 | — | 出处与授权，字段见「授权与出处」 |
| `license` | string | 必填 | CC0-1.0 / CC-BY-4.0 / OFL-1.1 / proprietary-internal | 授权标识，与 `provenance.license` 一致 |
| `generator` | string | 必填 | procedural-canvas2d / aseprite / blender / hand | 生成方式，见「生成方式记录」 |

字段纪律：

- `size` 一律写**逻辑像素**（DPR 1 下的 CSS 像素），DPR 2 的像素尺寸由 `size × dpr` 推导，不单独记录。
- `pivot` 用归一化坐标（0–1），与像素尺寸解耦；换分辨率不用改 pivot。
- `states` 的键必须来自 `public/js/render/art-tokens.js` 的 `motion` 令牌，不允许自造状态名。
- `frames` 与 `states` 自洽：`frames` 必须等于该资源所声明状态里最大的帧数。

## 命名规范

- 资源 id：`<类别>/<名称>`，类别固定为 `bg` / `terrain` / `tower` / `enemy` / `ally` / `fx` / `ui`，
  名称用小写 kebab-case，与 `public/js/shared/data.js` 里的实体 id 对齐（塔 `arrow`、敌人 `grunt`）。
- 文件名：`<名称>-<状态>.png`，多帧为 `<名称>-<状态>-<序号>.png`（序号从 0 起，两位补零）。
- DPR 变体：`<名称>-<状态>@2x.png`；DPR 1 不带后缀。
- 图集：`<类别>-atlas.png` + 同名 `.json`（帧矩形与 pivot 偏移表）。
- 禁止在文件名里出现空格、中文、大写字母、版本号或日期（版本属于 git，不属于文件名）。

## 目录结构

```text
public/assets/
├─ sprites/
│  ├─ towers/<塔名>/<塔名>-<状态>.png
│  ├─ enemies/<敌名>/<敌名>-<状态>.png
│  └─ allies/<友方名>/...
├─ tiles/<群系>/<群系>-<层名>.png      # 静态层：草地、路径、路径边、岩石
├─ bg/<场景>-<层名>.png                 # 视差背景层
├─ ui/<组件>-<状态>.png                 # 图标、边框、九宫格底纹
├─ vfx/<语义>-<序号>.png                # 危险/控制/增益 的序列帧
└─ atlas/<类别>-atlas.png + .json
```

- 一个资源一个目录，目录名 = 资源名；同族变体（进化、皮肤）放在同目录用后缀区分。
- 临时/试验资源放 `public/assets/_wip/`，不允许被 manifest 引用，也不允许提交到 main。

## 图集与 DPR 变体

- 图集是**构建产物**：由 manifest 与源图生成，不手工维护；图集 JSON 必须包含 `frames`、`pivot` 与 `size`。
- 单图小于 64×64 且同屏数量 > 20 的资源（敌人、投射物、粒子）必须进图集；塔与背景层允许散图。
- DPR 变体：默认提供 1x 与 2x；3x 仅在明确需要时提供，且必须同时提供 1x（低配降级路径）。
- 图集尺寸上限 2048×2048；超限按类别再切一张，命名为 `<类别>-atlas-2`。

## 压缩

- `lossless`：调色板化 PNG，用于 UI、图标、剪影描边（边缘不允许出现压缩噪点）。
- `lossy-webp`：质量 80，用于背景与大地图静态层。
- `lossy-png`：仅在需要 alpha 渐变且 WebP 不适用时使用，质量 90。
- 任何压缩都必须保留 alpha；不提供无透明通道的 JPG。

## 占位资源策略

- 贴图未完成前，运行时继续用 `public/js/render/art-tokens.js` 的令牌 + 程序化绘制作为**占位实现**，
  manifest 条目的 `status` 标 `placeholder`，`generator` 记录真实生成方式。
- `status: placeholder` 的资源**不得**被渲染层加载：加载器只认 `ready`。
- 占位转正式：补齐图片 → `status` 改 `ready` → 对比截图（`npm run visual:capture`）确认无回退 → 一次性提交。
- 占位期间 `path` 仍指向目标文件（可以暂不存在），这样 loader 的缺图错误在 CI 里能提前暴露。

## 授权与出处

公开仓库必须能追溯每一张图的来源。`provenance` 为必填对象，字段如下：

| 字段 | 类型 | 必填 | 取值 | 说明 |
| --- | --- | --- | --- | --- |
| `source` | string | 必填 | — | 来源类别：自带程序生成 / 自绘 / 第三方素材 / 截图重制 |
| `author` | string | 必填 | — | 作者或生成器署名（程序生成写管线名） |
| `license` | string | 必填 | CC0-1.0 / CC-BY-4.0 / OFL-1.1 / proprietary-internal | 与顶层 `license` 一致 |
| `url` | string | 可选 | — | 原始地址；自绘与程序生成填 `-` |
| `retrievedAt` | string | 必填 | — | 取得/生成日期，`YYYY-MM-DD` |

- 第三方素材只接受 CC0-1.0、CC-BY-4.0 与 OFL-1.1；CC-BY 必须在仓库根的致谢文件里记名（首个第三方素材引入时创建）。
- 来源不明、无授权、AI 生成但无法确权的素材一律不收。
- 仓库自带素材（程序生成或自绘）统一用 `proprietary-internal`，表示「本仓库所有，未对外授权」。

## 生成方式记录

| `generator` | 记录要求 |
| --- | --- |
| `procedural-canvas2d` | 记录生成脚本路径与随机种子；同参数必须能复现同一张图 |
| `aseprite` | 记录工程文件名与版本（例如 `arrow.aseprite`） |
| `blender` | 记录工程文件、渲染器与关键参数（采样、色彩空间） |
| `hand` | 记录作者与工具链 |

- 程序生成与手绘**同等对待**：都要进 manifest、都要有 provenance、都要能重放。
- 生成脚本放在 `scripts/` 下的专用目录；脚本本身走正常代码评审。
- 重生成不改变已有 manifest 的 `id`；只允许改 `path` 指向的新文件与 `provenance.retrievedAt`。

## 实体精灵条目（单位覆盖）

战斗内六类实体（塔、敌人、召唤物、可破坏物、传送门、基地）的覆盖集、状态优先级与缺资源回退，
权威定义在 `docs/PHASE_FEEL_ART.md` §4.3；本节只规定它们在**本清单里怎么落条目**。

- 精灵 id：`<family>.<entity-id>.<state>`，`family ∈ tower / enemy / summon / destructible / portal / base`，
  `entity-id` 与 `public/js/shared/data.js`、`public/js/shared/destructibles.js` 的实体 id 对齐
  （如 `tower.arrow-longbow.attack`、`enemy.berserk.cast`、`destructible.vein.ruined`、`portal.spawn.charge`）。
- **一个状态一条**：每个 `<family>.<entity>.<state>` 是独立清单条目，`frame` 指向该状态在图集里的帧，
  `frames: 1`、`compression: lossless`、`status: ready`。条目的 `states` 记录该状态对应的动效令牌
  （`idle / attack / hit / death` 的映射见 `public/js/render/sprite-coverage.js` 的 `ENTITY_STATE_TOKENS`），
  实体自己的状态名（`move / cast / ruined / charge / hurt / disabled / alive`）由覆盖表持有。
- 覆盖集：`TOWERS` 8 型 + 每型 3 条进化 = 32 个塔形态；`ENEMIES` 12 型 + `BOSS_VARIANTS` 3 变体 = 15；
  召唤物 `kind`（当前 `skeleton`）；`DESTRUCTIBLE_TYPES` 5 型；传送门 `spawn`；基地 `crystal`。
  合计 55 个实体、146 个状态帧；新增实体必须同时进覆盖表与 `tests/sprite-coverage.test.mjs`，否则测试直接红。
- 帧与锚点：单帧 48×48（= 1 格），同一实体的各状态帧在画布内预对齐，`pivot` 统一 `{ "x": 0.5, "y": 0.5 }`；
  `anchor` 记录语义（单位 `foot`、塔与场景物 `center`），绘制原点仍是模拟坐标，不同帧因此不漂移。
- 进化形态：`tower.evolutions` 为完整列表时取**最后一个已应用形态**作为主体精灵，其余形态只影响数值与挂饰，不再叠图。
- 图集：`public/assets/sprites/entities/entity-atlas@1x.png` + `@2x.png` + `entity-atlas.json`，
  生成器 `scripts/build-entity-sprites.mjs`（`procedural-canvas2d`，无随机源、无时间戳，同输入两次执行字节一致）。
- 合并纪律：清单由 `build-sprite-atlas.mjs`（probe）与 `build-entity-sprites.mjs`（实体）共同维护，
  各自只改自己的条目与图集声明，条目按 id、图集名按字典序排序，任一脚本跑完都是同一份字节。
- 缺资源回退：`status` 非 `ready` 或文件加载失败时，渲染器 `sprites.draw()` 返回 `false`，
  实体按既有程序化路径绘制；实体渲染器自己不 `new Image`。

## 示例资源条目

以下两条是**真实实体**（现有 `public/js/shared/data.js` 中的箭塔与步兵），按本规范走通全流程。
它们的 `status` 为 `placeholder`：外观此刻仍由程序化渲染提供，贴图落地后改 `ready` 即可，字段不用重写。

箭塔（`tower/arrow`）：视觉半径 25 逻辑像素 → 64×64 画布；待机 4 帧 + 攻击 5 帧，因此 `frames` = 5。

```json
{
  "id": "tower/arrow",
  "path": "public/assets/sprites/towers/arrow/arrow.png",
  "size": { "w": 64, "h": 64 },
  "anchor": "center",
  "pivot": { "x": 0.5, "y": 0.5 },
  "frames": 5,
  "states": ["idle", "attack"],
  "status": "placeholder",
  "dpr": [1, 2],
  "atlas": "towers-atlas",
  "compression": "lossless",
  "provenance": {
    "source": "自带程序生成",
    "author": "abyss-tower render pipeline",
    "license": "proprietary-internal",
    "url": "-",
    "retrievedAt": "2026-10-27"
  },
  "license": "proprietary-internal",
  "generator": "procedural-canvas2d"
}
```

步兵（`enemy/grunt`）：半径 0.3 格 × 48px = 14.4px → 32×32 画布；待机 4 / 受击 2 / 死亡 6 帧，因此 `frames` = 6。

```json
{
  "id": "enemy/grunt",
  "path": "public/assets/sprites/enemies/grunt/grunt.png",
  "size": { "w": 32, "h": 32 },
  "anchor": "foot",
  "pivot": { "x": 0.5, "y": 0.5 },
  "frames": 6,
  "states": ["idle", "hit", "death"],
  "status": "placeholder",
  "dpr": [1, 2],
  "atlas": "enemies-atlas",
  "compression": "lossy-webp",
  "provenance": {
    "source": "自带程序生成",
    "author": "abyss-tower render pipeline",
    "license": "proprietary-internal",
    "url": "-",
    "retrievedAt": "2026-10-27"
  },
  "license": "proprietary-internal",
  "generator": "procedural-canvas2d"
}
```

接入顺序（一个资源的完整走通路径）：

1. 按「目录结构」放好源图，按「命名规范」命名。
2. 在资源清单里写条目（照抄上面的字段），跑 `node --test tests/art-spec.test.mjs`。
3. 在 `public/js/render/art-tokens.js` 补该资源需要的角色色（若已有可复用则跳过）。
4. `status` 改 `ready`，渲染层按 `id` 加载；用 `npm run visual:capture` 出前后对照图。
5. 评审记录写进 `docs/ART_REVIEW.md`。
