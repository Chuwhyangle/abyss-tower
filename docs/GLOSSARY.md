# 术语表（Glossary）

本表是文案用词的唯一来源。`tests/i18n.test.mjs` 会读取下方表格，校验英文文案中
不出现「禁用英文别名」。新增术语时先改这里，再改 `public/js/shared/i18n/`。

| 中文 | English（正式用词） | 禁用英文别名 |
| --- | --- | --- |
| 塔 | Tower | defense tower, defence tower, turret |
| 遗物 | Relic | artifact, artefact |
| 技能 | Skill | ability, abilities |
| 难度 | Difficulty | — |
| 星核 | Core | star core, crystal shard |
| 波次 | Wave | round, stage |
| 首领 | Boss | — |
| 敌人 | Enemy | monster, creature, mob |
| 金币 | Gold | coin, money |

## 用法约定

- **塔**：塔名统一为 `<修饰词> Tower`（如 `Cannon Tower`、`Frost Tower`）；
  泛指时用 `tower(s)`，不用 `defense tower` 或 `turret`。
- **遗物**：一律 `relic`，不用 `artifact`。
- **技能**：主动技能一律 `skill`（`active skill`），不用 `ability`。
- **星核**：货币名用 `Core`（复数 `Cores`），符号 `◈`；金币符号为 `◆`。
- **波次**：一律 `wave`，不用 `round` / `stage`。
- **难度名**：中文「漫游 / 远征 / 深渊」对应英文 `Roam / Expedition / Abyss`。
- **首领**：`Boss`；最终波为 `Final Boss`。
