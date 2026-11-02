---
id: GOAL-010
title: 敌人扩充与固定三图平衡校准
status: active
kind: goal
origin: 人 2026-10-30：敌人已 12 类且进波次，但固定三图平衡崩盘（29%/1%/0%）；决定再扩 2–4 类敌人并统一重平衡
activatedAt: 2026-10-30T06:54:26.000Z
statusLog:
  - at: 2026-10-30T06:54:26.000Z
    from: draft
    to: active
    actor: goal-cli
    reason: 人 2026-10-30 立案激活
  - at: 2026-10-30T07:10:30.862Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: all ACs achieved + sufficiency covered"
  - at: 2026-10-30T08:28:27.000Z
    from: achieved
    to: active
    actor: goal-cli
    reason: "人 2026-10-30 重开：3 个 AC 卡 draft 被误判 achieved"
---
## 背景

敌人已有 12 类（游魂/疾影/噬虫/石卫/翼魔/祭司/渊主 + 护盾兵/分裂体/分裂仔/传令官/施法者），全部进波次且有 `tests/enemies-depth.test.mjs` 覆盖。但 `docs/BALANCE.md`（2026-10-26）显示固定三图下机器人全解锁通关率只有 29%/1%/0%，远低于目标区间 70–85 / 25–40 / 5–12%——这是从随机 carve 地图换成三张固定手工图之后留下的缺口。

本 goal 在 12 类基础上再扩 2–4 类敌人（总 14–16 类），并统一重平衡，让三档回到目标区间。

## 范围

- 新增 2–4 类敌人，每类有区分度的机制行为（护盾反弹 / 相位闪烁 / 吸血 / 自爆分裂 / 光环强化等），进波次（weight/countMult/minWave/interval）。
- 新敌人接入既有管线：渲染精灵（含状态动画）、i18n 双语、命中反馈层、`ENEMIES` 数据表，并扩展 `tests/enemies-depth.test.mjs`。
- 平衡复测：固定三图 × 40 种子，三档机器人全解锁通关率回到 70–85 / 25–40 / 5–12，报告写入 `docs/BALANCE.md`。

## 非目标

- 不改 30 波结构、三档难度倍率表、经济与计分口径、首领机制红线与入口计划。
- 不改 GOAL-005/006 已冻结的命中反馈层序与精灵资源契约（新敌人接入既有管线，不新建）。
- 不做肉鸽 2.0 的遗物/派系改造（那是 GOAL-011 的事）。

## 退出条件

- 敌人总数 ≥14（`ENEMIES` 条目），新敌人行为有区分度且进波次。
- 新敌人精灵/渲染/i18n 覆盖通过既有门禁（sprite 覆盖 + i18n 零缺译）。
- 平衡复测：三档通关率回到 70–85 / 25–40 / 5–12，`docs/BALANCE.md` 复跑。
- `npm test` 全绿、模拟确定性哈希不回归、旧档兼容。
