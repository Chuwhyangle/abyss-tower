# 打击感评审记录（FEEL_REVIEW）

GOAL-005「战斗反馈 2.0：每一击都有重量」的**语义层**证据。机械层由
`scripts/visual-check.mjs --suite feel` 独立判定；本文件只记录「人（或全新上下文的评审 agent）看图之后的结论」。

两层互不替代：

| 层次 | 入口 | 回答的问题 |
| --- | --- | --- |
| 机械 | `node scripts/visual-check.mjs --suite feel` | 反馈覆盖、命中特效覆盖、飘字可见性、敌我反差、特效预算是否达标 |
| 语义 | `node scripts/feel-review.mjs --check` | 同一批图是否被真正看过，并且结论是「通过」 |

## 如何产出评审记录

1. 采集前后对照图：
   ```bash
   npm run visual:capture -- --scene combat --quality high --out /tmp/feel-before
   ```
   改动后再采一次，把两次目录都保留（`contact-sheet.html` 可直接在浏览器里并排看）。
2. 逐帧看 `contact-sheet.html`：命中闪白、飘字、击杀迸发、漏怪/清波/首领演出是否读得出来。
3. 在本文件「评审记录」下按下面的格式追加条目；`场景` 至少要覆盖 `combat`。
4. 跑 `node scripts/feel-review.mjs --check`，exit 0 才算记录成立。

## 条目格式

```markdown
### FEEL-001 · combat 前后对照
- 场景：combat
- 日期：2026-10-27
- 评审者：fresh-context-reviewer
- 对照：before=/tmp/feel-before after=/tmp/feel-after
- 结论：通过
- 分数：8/10
- 说明：命中闪白与火花可辨识，暴击与普通命中分层清楚；混战时飘字不刷屏。
```

必填字段：`场景`、`日期`、`评审者`、`结论`、`分数`。`结论` 必须是「通过」；`分数` 形如 `8/10`。

## 基线（VIS-001 采集）

- 采集入口：`tests/visual-scenes.mjs`（固定种子、固定 1/60 步长、桌面 1440×900 / 移动横屏 844×390）。
- 首轮基线对照图：`docs/reviews/baseline-contact-sheet.png`，配套指纹见 `docs/reviews/baseline-manifest.json`
  （14 帧 = 5 场景 × 两视口，战斗场景各 3 帧）。
- 基线机械结果（2026-10-27，`--quality high`）：
  - 反馈覆盖 0.0024（阈值 ≥ 0.002）
  - 命中特效覆盖 0.0006（阈值 ≥ 0.0003）
  - 受击闪白覆盖 0.0016、飘字覆盖 0.0004、敌人与背景 ΔE 18.2
  - 单场景采集耗时约 3.2–3.8 秒，全场景全视口约 31 秒（远低于 60 秒 / 5 分钟预算）。
- 语义评审：**待评审**（FEEL-001 完成打击感改造后由全新上下文评审填写）。

## 评审记录

（尚无条目：`node scripts/feel-review.mjs --check` 当前应 exit 1。）
