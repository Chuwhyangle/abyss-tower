# 美术评审记录（ART_REVIEW）

GOAL-006「视觉重制：全面精灵化，落地暗黑霓虹几何」的**语义层**证据。机械层由
`scripts/visual-check.mjs --suite art|ui|mobile` 独立判定；本文件记录「四场景 × 两视口」的人工结论。

两层互不替代：

| 层次 | 入口 | 回答的问题 |
| --- | --- | --- |
| 机械 | `node scripts/visual-check.mjs --suite art` | 单位/塔与背景 ΔE、剪影覆盖率、背景层次 |
| 机械 | `node scripts/visual-check.mjs --suite ui` | 最小字号、HUD/商店对比度、未解锁卡可读性 |
| 机械 | `node scripts/visual-check.mjs --suite mobile` | 移动视口溢出、触控尺寸、画布尺寸、最小字号 |
| 语义 | `node scripts/art-review.mjs --check` | 四场景 × 两视口是否被看过，且结论为「通过」 |

## 如何产出评审记录

1. 采集全部场景（桌面 + 移动两视口）：
   ```bash
   npm run visual:capture -- --scene all --quality high --out /tmp/art-before
   ```
2. 打开 `/tmp/art-before/contact-sheet.html`，按场景逐张看：标题 / 选图 / 战斗 / 结算。
3. 在本文件「评审记录」下按格式追加条目。**覆盖要求**：`场景` 至少覆盖 `title / map / combat / result`，
   `视口` 至少覆盖 `desktop / mobile`（可写在同一条里，用顿号分隔）。
4. 跑 `node scripts/art-review.mjs --check`，exit 0 才算记录成立。

## 条目格式

```markdown
### ART-001 · 战斗场景前后对照
- 场景：combat
- 视口：desktop、mobile
- 日期：2026-10-27
- 评审者：fresh-context-reviewer
- 对照：before=/tmp/art-before after=/tmp/art-after
- 结论：通过
- 分数：8/10
- 说明：单位剪影与背景分离清楚，暗黑霓虹配色统一，HUD 无 12px 以下正文。
```

必填字段：`场景`、`日期`、`评审者`、`结论`、`分数`；`视口` 参与覆盖判定。`结论` 必须是「通过」。

## 基线（VIS-001 采集）

- 采集入口：`tests/visual-scenes.mjs`；场景 × 视口：title/lobby/map 用桌面 1440×900 + 移动 390×844，
  combat/result 用桌面 1440×900 + 移动横屏 844×390。
- 首轮基线对照图：`docs/reviews/baseline-contact-sheet.png`，配套指纹见 `docs/reviews/baseline-manifest.json`。
- 基线机械结果（2026-10-27，`--quality high`）：
  - art：单位与背景 ΔE 18.2、防御塔与背景 ΔE 25.3、剪影覆盖 0.60、背景亮度层次 15 —— **通过**。
  - ui：**未通过** —— 最小可见正文字号 10px（HUD 的 `hex-badge-mul` 词缀倍率角标）。
  - mobile：**未通过** —— 最小可见正文字号 8.5px（标题页 `.skill-role`）；溢出、触控尺寸（44px）、
    画布 458×250 均通过。
  - 这两项是 GOAL-006 的整改输入，不是采集基建的缺陷：阈值编码的是目标状态，基线红即差距清单。
- 语义评审：**待评审**（ART-001 完成后由全新上下文评审填写）。

## 评审记录

（尚无条目：`node scripts/art-review.mjs --check` 当前应 exit 1。）
