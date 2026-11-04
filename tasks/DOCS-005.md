---
id: DOCS-005
title: 关卡节点化 PHASE 冻结表：6 节点 × 5 波章节契约落 docs/PHASE_CHAPTERS.md
status: ready
labels:
  - docs
parent: null
children: []
extra:
  schema: execution
  acceptance: node --test tests/docs-phase-sync.test.mjs tests/docs-consistency.test.mjs
---
## Proposal

关卡节点化（`docs/TODO.md` TODO-15，三路子代理收敛方案，用户已点头开工）需要按「先文档后开发」先落一份冻结表 `docs/PHASE_CHAPTERS.md`（ASCII 文件名），作为后续实现任务（章节表 `chapters.js`、`generateWave` 接线、服务端 presence-gate、replay 版本）的字段契约与 AC 映射唯一定义处。文档须含：① 背景与范围（30 波线性重复度高，切成 6 节点 × 5 波）；② 章节契约——6 节点表（石肤荒野 1–5 / 天穹裂痕 6–10 / 重甲壁垒 11–15 / 裂潮涌动 16–20 / 相位风暴 21–25 / 深渊终章 26–30），每节点 `{ id, name, waves:[start,end], theme:{hpMul,speedMul}, enemyPool[], bossVariant }`；③ 难度曲线契约——`hpGrowth 1.17` 拆「节点内 1.13 + 边界 ×1.22」（实际跳变 1.38、30 波收敛 93.6×），首领「1.55 单调台阶 + final ×2.0」、拉平变体 hpMul；④ 平衡红线（边界跳变 1.30~1.45、节点内 r≥1.10、speedGrowth≤0.008、maxCount=80 别指望数量、bossFinalMul≤2.6）；⑤ 实现三阶段（阶段 0 章节表契约 → 阶段 1 waves/服务端/replay 并行 → 阶段 2 CONTENT_VERSION+1 集成）与确定性红线（`chapterForWave` 纯函数无新 RNG、旧行为 presence-gate 字节不变、SAVE_VERSION 不动、REPLAY_VERSION 3→4）。

## AC

- [x] `docs/PHASE_CHAPTERS.md` 存在，含背景/范围/章节契约/难度曲线/平衡红线/实现三阶段六节
- [x] 6 节点表与 `docs/TODO.md` TODO-15 三路收敛方案一致（主题/敌人池/词缀/首领）
- [x] ASCII 文件名 `PHASE_CHAPTERS.md`（不触发 docs-consistency 非 ASCII 截断）
- [x] `node --test tests/docs-phase-sync.test.mjs tests/docs-consistency.test.mjs` exit 0

## DoD

- [x] `docs/PHASE_CHAPTERS.md` 落地，章节契约与 TODO-15 逐条对应
- [x] 若 docs-phase-sync 需覆盖新 PHASE 文档，同步更新其检查（不破坏既有 PHASE_* 断言）
- [x] `npm test` 全绿
- [x] `git diff --name-only <base>..HEAD` 只含本任务 Touches 声明文件

## Touches

- `docs/PHASE_CHAPTERS.md` (new)
- `tests/docs-phase-sync.test.mjs`
- `tasks/DOCS-005.md`

## Notes

立案 2026-11-04，源自 `docs/TODO.md` 的 TODO-15。关卡节点化实现依赖本冻结表落地后再拆任务（阶段 0 章节表 → 阶段 1 并行 → 阶段 2 集成）。若 worker 实际 Touches 有出入，须 task_write 修正再 fan-in。

实现 2026-11-04：落 `docs/PHASE_CHAPTERS.md`（§1 背景 / §2 范围 / §3 章节契约 / §4 难度曲线 / §5 平衡红线 / §6 实现三阶段，六节点表逐条对应 TODO-15），`tests/docs-phase-sync.test.mjs` 新增六节断言。验证：acceptance 命令 exit 0、`npm test` 1993 例全绿、anti-drift 零越界。

该轴仍暗,理由:本任务为阶段冻结表文档，把已定稿设计落文档，L_D/L_G/L_S 无需量化。