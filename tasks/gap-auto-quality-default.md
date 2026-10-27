---
id: gap-auto-quality-default
title: 首次进入默认自动画质：桌面解析高配，弱机/移动端降为低配，30fps 仅作显式选择
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/feel-defaults.test.mjs
goal_ac: AC-011
---
## Proposal

GOAL-005（战斗反馈 2.0）的退出条件第一条要求「首次进入的默认画质为自动档：桌面高配、移动/弱机降档；30fps 仅作为显式选择」，AC-011 用 `node --test tests/feel-defaults.test.mjs` 见证。当前仓库与该要求相反，且见证文件不存在：

- `public/js/settings.js:49` 写死 `export const DEFAULT_SETTINGS = { ...QUALITY_PRESETS.low };`；`loadSettings()`（`public/js/settings.js:162-172`）在无存储/JSON 损坏时回退 `DEFAULT_SETTINGS` ⇒ 首次进入固定 30fps、DPR1、无光晕、无震屏、飘字仅关键，正是实机审查里「新玩家第一眼看到被砍掉全部反馈的版本」。
- 设置面板只有低配/高配两个恢复按钮（`public/js/ui/settings-panel.js:262-263`），`detectPreset()` 只会返回 low/high/custom，没有「自动」档位可表达。
- 文档把「首次默认低配」写成规范：`docs/PRD.md` §4.12（「首次默认低配」与只有低/高两列的预设表）、`docs/PRD.md:327`、`docs/PRD.md:354`、`docs/PRD.md:377`；`docs/TECH_DESIGN.md` §5.6/§5.7 亦同。
- 测试把低配默认写死，会与目标要求冲突：`tests/settings.test.mjs:26-32`、`tests/browser-settings.mjs:20-22,125`。
- 服务端 `server/routes/profile.mjs:65-101` 有一份与客户端镜像的设置字段与回退值，若新增「自动」字段必须同步，否则云端同步会把该字段丢弃。

本任务把「首次默认」从固定低配改为能力自适应自动档：桌面/强机解析为高配，移动端或弱机解析为低配；30fps 只作为用户显式选择（或弱机解析结果）。只改表现层默认值与设置面板，不触碰模拟、RNG 调用顺序与任何战斗数值。

去重与合并候选：库内 30 个任务全部 done/superseded，无 todo/ready/needs-human 任务认领 AC-011；`task-granularity-advice` 以本任务 Touches 实测返回 peers=[]、mentions=[]。唯一在正文提到「画质」的 MAP-005 是低配下的可破坏物渲染降级，机制不同且已 done，不合并。

## Plan

1. 文档先行（CLAUDE.md 约定）：先改 `docs/PRD.md` §4.12/§4.13 与 `docs/TECH_DESIGN.md` §5.6/§5.7，把「首次默认低配」统一为「首次默认自动档：桌面高配、移动/弱机低配；30 FPS 仅为显式选择」，预设表补「自动」档并在 §4.12 的预设清单同步。
2. `public/js/settings.js` 增加可注入、纯函数形式的能力解析：
   - `detectCapabilities(env = globalThis)` 采集 `navigator.userAgentData?.mobile`、`matchMedia('(pointer: coarse)')`、`navigator.maxTouchPoints`、`navigator.hardwareConcurrency`、`navigator.deviceMemory`、`devicePixelRatio`/`screen`；Node 无浏览器信号时返回可预测的空能力集。
   - `resolveAutoQuality(capabilities)` → `'high' | 'low'`：移动/粗指针/低核数/低内存判定 low，其余（含 Node 无信号）high。
   - 首次进入（`SETTINGS_KEY` 缺失或 JSON 损坏）按自动解析结果初始化；用户显式保存过的设置原样恢复，不被覆盖。
   - 持久化「自动模式」状态（独立 storage key 或设置对象新字段；若新增字段，必须同步 `server/routes/profile.mjs` 的回退值与 `sanitizeSettings`，保证云端往返不丢档）。
3. `public/js/ui/settings-panel.js`：新增「自动」预设按钮与「当前：自动（高配/低配）」显示；`fill` 与「全部重置」回到自动档；应用低/高配视为显式选择并落盘。
4. `public/js/shared/i18n/zh-CN.js`、`public/js/shared/i18n/en-US.js` 增加自动档文案键（如 `settings.presetAuto` / `settings.presetAutoName`），并调整低配按钮文案，避免暗示「默认」。
5. 测试：新增 `tests/feel-defaults.test.mjs`；同步修正 `tests/settings.test.mjs`、`tests/settings-panel.test.mjs`、`tests/a11y-color.test.mjs` 中写死低配默认/回退的断言；更新 `tests/browser-settings.mjs` 的首入与损坏存储断言。
6. 跑 `npm test`；改到 UI 再跑浏览器验收（本机需 `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN`）。

## AC

- [x] `node --test tests/feel-defaults.test.mjs` exit 0，且该文件覆盖：桌面能力首入为高配（60fps/DPR2/glow/shake/floaters all，且不出现 30fps）、移动/弱机首入为低配、显式低配后重新加载仍为 30fps、损坏存储回退自动解析而非强制低配
- [x] `node --test tests/settings.test.mjs tests/settings-panel.test.mjs tests/a11y-color.test.mjs` exit 0
- [x] `grep -rn "首次默认低配" docs/ public/` 0 命中（文档与注释口径统一为自动档）
- [x] `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN npm run test:settings` exit 0（真实浏览器：清空 localStorage 首入为自动→桌面高配；显式低配刷新后仍 30fps）
- [x] `npm test` exit 0
- [x] 若新增设置字段：`node --test tests/settings-sync.test.mjs tests/api.test.mjs` exit 0（云端往返保留自动档，不静默降回低配）

## DoD

- [x] 真实浏览器（Chrome、zh_CN）清空 localStorage 首入：设置面板显示「自动」，`window.__rtd.state.settings` 为桌面高配（fps 60 / dpr 2 / glow true / shake true / floaters all），战斗画面实际出现光晕与震屏
- [x] 面板显式点「低配」→ 应用 → 刷新，设置仍为 30fps/DPR1/无光晕/无震屏；再点「自动」能按当前能力重新解析
- [x] 以移动 UA + coarse pointer（或浏览器移动仿真）首入解析为低配，且攻击提示、敌人状态等非运动信息仍可见
- [x] PRD §4.12/§4.13 与 TECH §5.6/§5.7 与实际行为一致，无「默认低配」残留
- [x] Notes 记录能力信号清单与 low/high 判定阈值，并说明为何不改模拟与 RNG 调用顺序

## Touches

- `docs/PRD.md`
- `docs/TECH_DESIGN.md`
- `docs/GUIDE.md`
- `public/js/settings.js`
- `public/js/ui/settings-panel.js`
- `public/js/shared/i18n/zh-CN.js`
- `public/js/shared/i18n/en-US.js`
- `server/routes/profile.mjs`
- `tests/feel-defaults.test.mjs`
- `tests/settings.test.mjs`
- `tests/settings-panel.test.mjs`
- `tests/a11y-color.test.mjs`
- `tests/audio-mix.test.mjs`
- `tests/settings-sync.test.mjs`
- `tests/browser-settings.mjs`
- `tasks/gap-auto-quality-default.md`

## Notes

- 能力信号与判定阈值（`public/js/settings.js`）：
  - `navigator.userAgentData?.mobile === true` → low
  - `matchMedia('(pointer: coarse)').matches` → low（主输入为触摸；带触摸屏的笔记本主指针仍是 fine，不受影响）
  - `navigator.hardwareConcurrency` ∈ (0, 4) → low（弱机）；`navigator.deviceMemory` ∈ (0, 4) GB → low
  - 其余（含 Node 等无浏览器信号的空能力集）→ high；`maxTouchPoints`、`devicePixelRatio` 只采集不参与判档，留给后续细粒度策略
- 自动解析只在四处发生：首次进入（无存储）、存储损坏/不可写、点「自动」、全部重置。`qualityMode: 'manual'` 的设置原样恢复；`qualityMode: 'auto'` 每次加载按当前设备重新解析，且只覆盖 fps/dpr/decorations/floaters/glow/shake，音量、音乐、色弱与高对比偏好永不重置。
- 新增设置字段 `qualityMode: 'auto' | 'manual'`，已同步 `server/routes/profile.mjs` 的 `SETTINGS_FALLBACK`/`SETTINGS_OPTIONS`；`tests/settings-sync.test.mjs` 增加「自动档随同步往返保留、服务端不静默降回低配」用例。
- 不改模拟与 RNG 调用顺序的理由：本次改动只落在表现层默认值/持久化（`public/js/settings.js`）、设置面板与文案、服务端设置字段校验；未触碰 `public/js/sim.js`、`public/js/shared/` 中的战斗逻辑或任何 RNG 调用点。全量 `npm test` 1471 项通过，其中 `tests/a11y-color.test.mjs` 的同种子战斗哈希回归继续证明表现设置不改变战斗结果。
- 移动端证据：CDP 移动仿真（390×844、touch、iPhone UA）下 `matchMedia('(pointer: coarse)')` 为 true，清空设置首入得到 `qualityMode: auto` + 30fps/DPR1/无光晕/无震屏；低配预设内容与改动前逐字段一致，攻击提示/敌人状态等非运动信息沿用既有低配渲染路径（`tests/render-effects.test.mjs`、`tests/render-budget.test.mjs`、`tests/destructibles-ui.test.mjs` 覆盖）。
- Touches 追加 3 个文件，均由「首次默认从固定低配改为自动档」直接引起：`docs/GUIDE.md`（§15.3 玩家文档仍写「首次进入默认低配」）、`tests/audio-mix.test.mjs`（断言 `saved.fps === DEFAULT_SETTINGS.fps` 编码了旧的固定低配默认）、`tests/settings-sync.test.mjs`（损坏回退断言 + AC6 要求的自动档云端往返用例）。
- 为守住 ui-split 的「子模块 < 400 行」约束，`public/js/ui/settings-panel.js` 的 `ITEM_META` 压缩为单行条目（纯格式，无行为变化）。
