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
- 语义评审：见下方「评审过程」与「评审记录」（FEEL-002 复评，2026-10-28）。

## 评审过程（FEEL-002 · 2026-10-28 复评）

#### 1. 采集：同一采集器、同 seed、同 1/60 步长

- **after = `6743258`**（打击感改造全部叶子任务落地后的构建，本次复评的基线提交）；
  **before = `3b8e1fd`**（打击感改造前的构建）。
- 采集器：`tests/visual-scenes.mjs`（`gap-feel-capture-scenarios` 落地）。场景由确定性注入驱动，
  不是自然对局录像；种子 `visual-scene-seed`，画质按场景显式指定。
- after 侧命令（在 after worktree 内逐批采集）：
  ```bash
  node tests/visual-scenes.mjs --scene all --quality high --out /tmp/feel-rereview/after-base
  node tests/visual-scenes.mjs --scenario all --quality high --viewport desktop --out /tmp/feel-rereview/after-scen-desktop
  node tests/visual-scenes.mjs --scenario all --quality high --viewport mobile-landscape --out /tmp/feel-rereview/after-scen-mobile
  ```
  waveclear 之后的场景在首次批量采集中被「战斗后选遗物」弹窗污染，已按 scenario 单独隔离重采并覆盖；
  逐批命令与提交号记录在 `docs/reviews/feel-after/manifest.json` 的 `parts[]`。
- before 侧用**同一份采集器代码**在 `3b8e1fd` 上重采（保证只有游戏代码不同）：
  ```bash
  git -C /tmp/feel-rereview-before checkout -q 3b8e1fd
  cd /tmp/feel-rereview-before && node tests/visual-scenes.mjs --scene combat --quality high --out /tmp/feel-before-rereview
  ```
- 合并清单：`docs/reviews/feel-after/manifest.json` —— 16 个 scenario × 2 视口 = 32 组、182 帧，
  每帧带 `requestedTime` 与 `snapshot.time`。
- **时间断言**：所有带 `requestedTime` 的帧满足 `|requestedTime − snapshot.time| ≤ 0.005s`；
  由 `tests/feel-review-record.test.mjs` 逐帧机械校验（`gap-feel-capture-scenarios` 修掉的移动端漂移不得回归）。
- 前后像素差（同一场景同 t 的 before/after 帧逐像素比较，RGB 任一通道差 > 6 记为不同）：

  | 场景 | 桌面 | 移动横屏 |
  | --- | --- | --- |
  | combat-impact | 6.49% | 6.10% |
  | combat-mixed | 6.22% | 6.02% |
  | combat-contact | 5.93% | 6.05% |

#### 2. 证据与 FEEL-001 缺口（E.1–E.9）的对应

| 缺口（FEEL-001 原文编号） | 证据文件（`/tmp/feel-rereview/evidence/`） |
| --- | --- |
| E.1 八种武器分别开火、可区分 | `B-weapons-arrow/cannon/frost/arc/poison/shock/sniper/banner.png`（各 6 帧）；移动端另见 `G-mobile-scenarios.png` |
| E.2 暴击 / 击杀 / 首领命中 / 破盾独立层 | `C-crit.png`、`C-kill.png`、`C-boss.png`、`C-shield.png`（事件前 1.0s、+0ms、+250ms、+500ms 四列） |
| E.3 击杀独立演出 | `C-kill.png` |
| E.4 飘字三档（全部 / 仅关键 / 关闭） | `D-floaters-tiers.png`（同 seed 同 t=1.25s 三栏并排） |
| E.5 漏怪 / 清波 / 首领死亡演出 | `C-leak.png`、`C-waveclear.png`、`C-bossdeath.png` |
| E.6 reduced-motion 开关下仍保留非运动反馈 | `E-reduced-motion.png`（裁切）与 `E2-reduced-motion-full.png`（全帧） |
| E.7 默认自动档 / low / high + 桌面与移动两视口 | `F-quality-tiers.png`（auto / low / high 同 t）、`G-mobile-scenarios.png`（844×390） |
| E.8 同 seed 模拟与 RNG 逐字节一致 | `docs/reviews/feel-sim-diff.md`（工具 `scripts/feel-sim-diff.mjs`，3 个 seed，events / rng / state 三份哈希逐字节相等）；复评口述证据另见评审包 §4.5 |
| E.9 性能与机械指标 | 下方「3. 机械层」：`visual-check --suite feel` 与 `npm run perf:budget` |
| 音频（FEEL-001 补充项） | **无音频文件**；只有合成器参数表（波形/基频/滑音/时长/噪声层，逐武器不同）——见「5. 观察边界」 |
| 评审记录落盘 | 本文件 |

评审包（给评审者的自包含版）：`/tmp/feel-rereview/REVIEW-BRIEF.md`。

#### 3. 机械层（独立于语义层，2026-10-28 本次复跑）

- `node scripts/visual-check.mjs --suite feel` → **PASS**
  - 反馈覆盖 0.0026（≥0.002）、命中特效覆盖 0.0007（≥0.0003）、受击闪白 0.0014（≥0.0004）
  - 飘字覆盖 0.0006（≥0.00008）、飘字条数 2（≥1）、同屏命中特效 5（≥4）
  - 敌人与背景 ΔE 19.41（≥10）、特效预算 5（≤320）
- `npm run perf:budget` → **PASS**

  | 场景 | 渲染 FPS（基线→本次） | 渲染耗时 ms（基线→本次） | P95 帧间隔 ms |
  | --- | --- | --- | --- |
  | normal-1x-low | 29.92 → 29.97 | 1.197 → 0.522 | 16.8 |
  | late-3x-high | 57.70 → 60.33 | 2.089 → 1.230 | 16.8 |
  | skills-1x-high | 25.68 → 44.32 | 4.710 → 2.317 | 33.4 |

- 同 seed 一致性：`docs/reviews/feel-sim-diff.md`（3 个 seed，events / rng / state 哈希三者逐字节相等；
  哈希互不相同，篡改任一 RNG 值立刻报红——证明「一致」不是空转）。

#### 4. 评审者与上下文隔离

- 复评由**五位互不相识的全新上下文 subagent** 分别只看自己那一片证据，**不共享彼此结论**：
  `fresh-context-subagent-aa2a4388823d623b2`（A 组前后对照 + 整体重量感 + 一致性）、
  `fresh-context-subagent-aa03965ff7aeca6f6`（弩/炮/霜/电弧四塔）、
  `fresh-context-subagent-ac5c2769fb196a3f4`（毒/震荡/狙击/战旗四塔）、
  `fresh-context-subagent-a30a89db0d9b7953d`（暴击/击杀/首领/破盾/漏怪/清波/首领死亡）、
  `fresh-context-subagent-affeb7806da499f5a`（飘字三档 / reduced-motion / 画质档位 / 移动端）。
- **不复用** FEEL-001 的评审者 `ac6c9e7b5c403f466`。
- 隔离方式：每位评审者只收到 `/tmp/feel-rereview/REVIEW-BRIEF.md`（退出条件原文、逐项问题清单、
  证据清单、机械证据表、已知边界）与自己切片内的图片路径；prompt 明确禁止读取仓库源码、
  任务库/目标库、记忆与任何会话历史，禁止运行会读取仓库的命令。它们看不到实现过程、提交历史、
  开发者自评与预期结论。
- 执行者只**原样转写**评审结论与分数（见下方条目），未改写结论、未调整分数。
- 证据只分发到 `/tmp/feel-rereview/`；评审者之间的 prompt 不包含其他人的判断。

#### 5. 观察边界（如实纳入判断）

1. **before 侧只有 combat 场景**：`3b8e1fd` 没有结构化命中事件、飘字分层、画质档位切换接口这些可观测面，
   因此 B/C/D/E/F/G 组只有 after 侧帧；前后成对对照限于 combat。
2. **清波（`C-waveclear`）**：清波后立即弹出「战斗后三选一遗物」弹窗，弹窗覆盖画面中央的横幅；
   提供的是弹窗可见的原始帧，横幅本身不可见。
3. **静态帧不能体现运动分量**：hitstop、震屏、受击位移/挤压、慢动作时长，单帧或静态拼图无法证明。
4. **音频**：只有参数表，没有音频文件或带声轨的视频，无法试听。
5. 事件帧是**确定性注入**（固定 seed、固定步长）产生的，不是自然对局录像。

#### 6. 随仓库落地的产物

- `docs/reviews/feel-review-before-after.png`（1518×1647）：桌面全帧前后对照 + 桌面原生裁切 + 移动横屏前后对照
- `docs/reviews/feel-after/contact-sheet.png`：after 16 scenario × 两视口总览（每格一张代表帧）
- `docs/reviews/feel-after/manifest.json`：after 合并清单（32 组 / 182 帧，含每帧 `requestedTime` 与 `snapshot.time`）
- `tests/feel-review-record.test.mjs`：本记录与产物的机械校验（gate 通过、覆盖 combat、不复用旧评审者、
  时间断言、两半像素不同、gate 对「不通过」确实报红）

## 历史（不参与 gate 的既有结论）

FEEL-001（2026-10-28）：首次全新上下文语义评审由 `ac6c9e7b5c403f466` 判**不通过 4/10**。
其阻塞项是证据缺口（八武器、暴击/击杀/首领/破盾、飘字三档、漏怪/清波/首领死亡、reduced-motion、
自动档与低画质、同 seed 一致性）与「飘字对比度下降、锐利星芒被整身刷白取代」。
该次评审的完整原文、逐项判断与执行者核对记录在分支 `task/gap-feel-review-record`（`d28b166`）的
`docs/FEEL_REVIEW.md`，本文件不改写其结论、亦不据此通过；它对应的整改由上表 E.1–E.9 的证据关闭。
FEEL-002 是**新的**评审者基于新证据重做的复评。

## 评审记录

<!--REVIEWER-ENTRIES-->
