// 爬塔模式 · 无头平衡模拟：用真实 Simulation 跑完整 30 层节点图，机器人自动选路/建塔/选遗物。
// 结果用于 §5 难度映射定夺（A「楼层=波次」vs B「波次等价」）与 8 条平衡红线的读数支撑。
// 用法：node tests/balance-tower.mjs [seeds] [--write]
// 机器人口径与 tests/balance-sim.mjs 一致：真人下限（技能冷却好就放、主海克斯取第一、满级塔进化）。
// 本脚本只读，不重写 docs/BALANCE.md 之外的任何文件；--write 只把结果追加进 docs/BALANCE.md 的爬塔小节。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';
import { DIFFICULTIES, DIFFICULTY_ORDER, rollRelicOffers } from '../public/js/shared/data.js';
import { generateTowerGraph, merchantInventory, successors } from '../public/js/shared/tower.js';
import {
  SKILL,
  accountTalent,
  applyBossCoreChoice,
  buildCoverage,
  evolveReadyTowers,
  offerValue,
  pickBossCore,
  pickHex,
  pickStarterOffer,
  resolveBotEvent,
  spendGold,
  useDestructibles,
} from './lib/balance-bot.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STEP = 1 / 60;
const MAX_WAVE_SECONDS = 180;
const MAX_SIM_STEPS_PER_WAVE = Math.ceil(MAX_WAVE_SECONDS / STEP);

const SEEDS = Math.max(1, Number(process.argv[2]) || 20);
const WRITE_DOC = process.argv.includes('--write');

// 爬塔开局与普通模式同源（服务端 planRunStart）：标准起始金/生命，账号天赋按零投入下界。
// 塔解锁取全解锁，与 balance-sim「全解锁」口径一致；信物/主海克斯照常（真人下限）。
const UNLOCKED_TOWERS = ['arrow', 'cannon', 'frost', 'arc', 'poison', 'banner', 'sniper'];

// 单局：沿节点图逐层推进，战斗类开波、事件/商人/宝藏各自即时结算。
// 选路固定取第一个后继（无偏好的真人下限，与「不择优」口径一致）。
function runOneTower(seed, difficulty) {
  const graph = generateTowerGraph(seed);
  const map = generateMap(seed);
  const baseHp = 20;
  const startGold = 260;

  let result = null;
  let relicPicks = 0;
  const nodeSeen = { fight: 0, elite: 0, boss: 0, event: 0, merchant: 0, treasure: 0 };

  const sim = new Simulation({
    map,
    seed,
    difficulty,
    mode: 'tower',
    tower: { route: { path: ['1:0'], node: '1:0' } },
    gold: startGold,
    baseHp,
    maxBaseHp: baseHp,
    relics: [],
    towers: [],
    unlockedTowers: UNLOCKED_TOWERS,
    hex: pickHex(seed),
    skill: SKILL,
    talent: accountTalent('zero'),
    onGameOver: (stats) => {
      result = stats;
    },
  });

  // 信物三选一：爬塔开局沿用普通模式，取估值最高的入门遗物（真人下限，计一次获取）。
  const startOffer = pickStarterOffer(seed);
  if (startOffer) {
    sim.addRelic(startOffer);
    relicPicks += 1;
  }

  const cells = buildCoverage(map, sim);
  useDestructibles(sim, 1);
  spendGold(sim, 1, cells);

  let route = { path: ['1:0'], node: '1:0' };
  let stuck = false;
  let lastLayer = 0;
  const bossCorePicks = {};

  for (let layer = 1; layer <= 30; layer++) {
    const node = graph.byKey.get(route.node);
    if (!node) {
      stuck = true;
      break;
    }
    lastLayer = layer;
    nodeSeen[node.type] = (nodeSeen[node.type] || 0) + 1;

    if (node.type === 'fight' || node.type === 'elite' || node.type === 'boss') {
      // 难度映射 A「楼层=波次」：与 server/services/tower-service.mjs 的 serveTowerWaveFor 完全一致——
      // 空 mapMeta、无词缀、无 portal 覆盖，波次索引 = 节点层。
      const waveDef = generateWave(seed, layer, difficulty, {}, { endless: false });
      sim.beginWave(waveDef);

      let steps = 0;
      while (sim.phase === 'wave' && steps < MAX_SIM_STEPS_PER_WAVE) {
        sim.update(STEP);
        if (sim.skill && sim.skill.cooldown <= 0 && sim.enemies.length > 0) sim.castSkill();
        steps++;
      }

      // 登顶第 30 层通关或基地被破：结算已由 completeWave/gameOver 触发，直接收束本局。
      if (sim.phase === 'over') break;
      // 超时未清波：首领/高血量单位卡住，视为本局失败。
      if (sim.phase !== 'prep') {
        stuck = true;
        break;
      }

      // 战斗节点清波后的分流：boss→首领核心、fight→免费遗物、elite→无（只推进）。
      if (node.type === 'boss') {
        const choice = pickBossCore(sim, seed, layer);
        if (choice) {
          applyBossCoreChoice(sim, choice);
          bossCorePicks[choice.kind] = (bossCorePicks[choice.kind] || 0) + 1;
          if (choice.kind === 'upgrade' || choice.kind === 'search') relicPicks += 1;
        }
      } else if (node.type === 'fight') {
        const offers = rollRelicOffers(`${seed}:bot:tower:${layer}`, sim.relics, 3, layer);
        offers.sort((a, b) => offerValue(b) - offerValue(a));
        if (offers[0]) {
          sim.applyOffer(offers[0]);
          relicPicks += 1;
        }
      }
    } else if (node.type === 'event') {
      // 事件节点抵达即结算（sim.setTowerRoute 已把 phase 置为 event）。
      const resolved = resolveBotEvent(sim);
      if (!resolved.ok) {
        stuck = true;
        break;
      }
    } else if (node.type === 'merchant') {
      // 商人金币黑洞：买最值得买的可负担遗物（红线下限只作读数，不在此优化）。
      const inventory = merchantInventory(seed, node.key);
      const buy = inventory.offers
        .map((offer) => ({ offer, value: offerValue(offer) }))
        .filter((entry) => sim.gold >= entry.offer.price)
        .sort((a, b) => b.value - a.value)[0];
      if (buy) {
        sim.gold = Math.max(0, sim.gold - buy.offer.price);
        sim.applyOffer({ kind: 'relic', id: buy.offer.id });
        relicPicks += 1;
      }
    } else if (node.type === 'treasure') {
      // 宝藏节点阶段 1 无服务端端点：抵达即完成，不产遗物不推进经济。
    }

    if (sim.phase === 'over') break;

    // 通用整备：非战斗节点同样是 prep 暂停，真人会继续拆物/建塔/进化（真人下限）。
    useDestructibles(sim, layer);
    spendGold(sim, layer, cells);
    evolveReadyTowers(sim);

    if (layer < 30) {
      const next = successors(graph, route.node)[0];
      if (!next) {
        stuck = true;
        break;
      }
      route = { path: [...route.path, next.key], node: next.key };
      sim.setTowerRoute(route);
    }
  }

  const stats = result || {
    wave: lastLayer,
    clearedWave: 0,
    victory: false,
    score: 0,
    kills: sim.kills,
    gold: sim.gold,
    baseHp: sim.baseHp,
  };

  return {
    seed,
    difficulty,
    victory: !!stats.victory,
    stuck,
    cleared: stats.victory ? 30 : Math.max(0, (stats.clearedWave ?? 0) || lastLayer - 1),
    hp: Math.max(0, Math.ceil(stats.baseHp ?? sim.baseHp)),
    gold: Math.floor(stats.gold ?? sim.gold),
    kills: stats.kills ?? sim.kills,
    relicPicks,
    relicCount: sim.relics.length,
    relicLevels: sim.relics.reduce((sum, relic) => sum + relic.level, 0),
    nodeSeen,
    bossCorePicks,
    score: stats.score || 0,
  };
}

function runBatch() {
  const rows = [];
  for (const difficulty of DIFFICULTY_ORDER) {
    for (let seed = 1; seed <= SEEDS; seed++) {
      rows.push(runOneTower(seed, difficulty));
    }
  }
  return rows;
}

function summarize(rows, difficulty) {
  const list = rows.filter((row) => row.difficulty === difficulty);
  const count = list.length;
  const victories = list.filter((row) => row.victory).length;
  const avg = (field) => Math.round((list.reduce((sum, row) => sum + row[field], 0) / count) * 10) / 10;
  return {
    difficulty,
    count,
    victoryRate: Math.round((victories / count) * 100),
    avgCleared: avg('cleared'),
    avgGold: Math.round(avg('gold')),
    avgRelicPicks: avg('relicPicks'),
    avgHp: avg('hp'),
    stuck: list.filter((row) => row.stuck).length,
  };
}

function buildMarkdown(rows) {
  const lines = [];
  lines.push('');
  lines.push('## 爬塔模式 · 难度映射（阶段 2 集成定夺）');
  lines.push('');
  lines.push('**定论：方案 A「楼层=波次」**（`ruleset.tower.difficultyMode = "floor-equals-wave"`）。');
  lines.push('');
  lines.push('依据：');
  lines.push('');
  lines.push('1. **结构性唯一可行**：波次索引被用作节点层游标——服务端 `serveTowerWaveFor` 以 `node.layer` 落 '
    + '`wavesServed`，客户端 `onTowerStarted`/`currentTowerNode` 以 `clearedWave >= node.layer` 判已清，'
    + '`clearWave` 要求 `wave === run.wavesServed`，`completeWave` 以 `cleared >= 30` 判登顶。'
    + '方案 B「波次等价」（只战斗推进难度）需要另一套独立难度游标，且会与上述四处清波口径冲突，'
    + '不属于「盖在 30 波难度阶梯上的自选路线」（§1.2），故否决。');
  lines.push('2. **方案 A 直接实现 §4.2 难度追击**：难度随层追击，躲架（跳过战斗）即遗物落后，'
    + '难度不因躲架而变慢——这正是「楼层=波次」的口径。');
  lines.push('');
  lines.push(`实测口径：${SEEDS} 种子 × 三档难度，机器人真人下限（技能冷却好就放、选路固定取第一个后继、`
    + '全解锁塔组、零账号天赋下界、信物/主海克斯照常）。');
  lines.push('');
  lines.push('| 难度 | 通关率 | 平均登顶层 | 平均终局余金 | 平均遗物获取次数 | 平均残血 | 卡死局 |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const difficulty of DIFFICULTY_ORDER) {
    const s = summarize(rows, difficulty);
    lines.push(
      `| ${DIFFICULTIES[difficulty].name} | ${s.victoryRate}% | ${s.avgCleared} | ${s.avgGold} | `
        + `${s.avgRelicPicks} | ${s.avgHp} | ${s.stuck} |`
    );
  }
  lines.push('');
  lines.push('> 本表由 `node tests/balance-tower.mjs [seeds] --write` 生成。平衡红线 #1（遗物 12~15 次/局）'
    + '与 #6（终局余金 2000~3000）的终值收口见 §4.4，属平衡 lane 后续工作，本任务只给出读数支撑与难度映射定论。');
  return lines.join('\n');
}

function writeDoc(markdown) {
  const docPath = path.join(ROOT, 'docs', 'BALANCE.md');
  const existing = fs.existsSync(docPath) ? fs.readFileSync(docPath, 'utf8') : '';
  const marker = '## 爬塔模式 · 难度映射（阶段 2 集成定夺）';
  const head = existing.split(marker)[0].replace(/\s+$/, '');
  fs.writeFileSync(docPath, `${head}\n${markdown}\n`);
}

function main() {
  const rows = runBatch();
  const table = [];
  table.push('爬塔难度映射实测（方案 A「楼层=波次」）：');
  table.push('难度 | 通关率 | 平均登顶层 | 平均终局余金 | 平均遗物获取 | 平均残血 | 卡死');
  for (const difficulty of DIFFICULTY_ORDER) {
    const s = summarize(rows, difficulty);
    table.push(
      `${DIFFICULTIES[difficulty].name} | ${s.victoryRate}% | ${s.avgCleared} | ${s.avgGold} | `
        + `${s.avgRelicPicks} | ${s.avgHp} | ${s.stuck}`
    );
  }
  console.log(table.join('\n'));
  console.log('');
  console.log(JSON.stringify(rows.map((row) => ({
    seed: row.seed,
    difficulty: row.difficulty,
    victory: row.victory,
    cleared: row.cleared,
    gold: row.gold,
    relicPicks: row.relicPicks,
    hp: row.hp,
    stuck: row.stuck,
  })), null, 2));

  if (WRITE_DOC) {
    writeDoc(buildMarkdown(rows));
    console.log(`\n[docs] 已回写 docs/BALANCE.md（${SEEDS} 种子）`);
  }
}

main();
