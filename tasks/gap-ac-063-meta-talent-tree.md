---
id: gap-ac-063-meta-talent-tree
title: 天赋树与永久强化：账号技能点、塔/技能/经济永久被动在模拟/快照/UI 一致生效（AC-063）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-phase-meta-design-freeze
goal_ac: AC-063
---
## Proposal

AC-063（天赋树与永久强化在模拟、快照与 UI 一致生效）已激活，criterion `test -s public/js/shared/data/meta.js && grep -q 'talent' public/js/shared/data/meta.js` 当前 exit 1（meta.js 不存在）。本任务按 `docs/PHASE_META.md` 冻结表落天赋树：账号级技能点、塔/技能/经济的永久被动，数值克制（可感知但不碾压）。前置依赖 `gap-phase-meta-design-freeze`（AC-062）产出冻结表，走顶层 `depends_on`。

<!-- dedup-ref --> 无任务以 `goal_ac: AC-063` 认领；AC-064（跨局传承）与 AC-065（平衡）各自独立认领，本任务只落天赋树与永久强化。

## Plan

1. 新增 `public/js/shared/data/meta.js`：天赋树节点表、永久被动效果（talent 键），纯数据无 DOM。
2. 服务端 `server/db/accounts.mjs` 加天赋点持久化（账号级，与星核/成就分离）。
3. `public/js/sim.js` 读取账号天赋被动并合并进战斗数值（克制系数），确定性不变。
4. UI 展示天赋树 + 加点入口；i18n 中英成对。
5. 新增 `tests/meta-tree.test.mjs`：节点生效、点数持久化、克制数值、快照/旧档兼容。

## AC

- [x] `test -s public/js/shared/data/meta.js && grep -q 'talent' public/js/shared/data/meta.js` exit 0（AC-063 本体判据）
- [x] `node --test tests/meta-tree.test.mjs` exit 0
- [x] `npm test` exit 0

## DoD

- [x] 账号投入天赋点后，对应永久被动在同一 seed 的确定性模拟里真实生效（非只测函数），且未加点时与改动前逐字节一致
- [x] 天赋点与星核/成就/通行证/悬赏数据分离、无重复结算；快照与旧档兼容

## Notes

设计增量（PHASE_META §5.2 契约落地）：
- `TALENT_NODES` 8 节点（塔/技能/经济三系，各 maxRank 2），`TALENT_CATEGORIES`/`TALENT_ORDER`/`TALENT_BY_ID` 与冻结表一致。
- `normalizeTalent`/`investTalent`/`talentEffect`/`talentMods` 纯函数；`talentMods` 只汇总 `EFFECT_REGISTRY` 已声明键（`skillCd`/`skillPower` 未注册，留给技能层，sim 不折叠）。
- sim 在 `recomputeMods()` 内折叠天赋被动（零投入为空操作，逐字节一致）；持久化走 `player_kv('meta','talent')`，与星核/成就/通行证/悬赏分离；`toSnapshot` 不写天赋字段。
- DOM 加点面板不在本任务 Touches（无 ui 文件），本次只落地数据/持久化/sim/i18n 四层；i18n 中英已成对（`talent.*` 与 `data.talent.*`）。

## Touches

- `public/js/shared/data/meta.js`
- `server/db/accounts.mjs`
- `public/js/sim.js`
- `public/js/shared/i18n/zh-CN.js`
- `public/js/shared/i18n/en-US.js`
- `tests/meta-tree.test.mjs`
- `tasks/gap-ac-063-meta-talent-tree.md`

## Blocker

**2026-10-30T11:22:35.823Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=anti-drift: BASELINE-MISMATCH: merge target 'develop' is not a continuation of the project's default branch 'main' — 'develop' (bdba2e68) is NOT a continuation of the project's default branch 'main' (420e8801) — it is 6 commit(s) behind and shares only an old merge base, so a task diff against it is meaningless.
  The develop...HEAD diff is therefore the mainline's divergence, NOT task gap-ac-063-meta-talent-tree's own work; no declaration of ## Touches can satisfy it. This is a BASELINE defect, not an out-of-declared write by the task.
  Remedy: `quay init --force --adopt-branch-model` (preserves the old tip as 'develop-pre-quay-init-<sha>' and re-points 'develop' at 'main'), then re-dispatch the task.
- run_id：wk-prod-anchor
- session_id：986a3af8-85cf-4406-b7f6-ad9d54dbe297
