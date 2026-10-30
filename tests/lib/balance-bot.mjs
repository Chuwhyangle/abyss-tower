// 平衡模拟的机器人策略：开局整备、建塔升级、遗物/事件/可破坏物的固定决策，以及 --skill 参数解析。
// 由 tests/balance-sim.mjs 引入；策略改动会改变平衡数据的口径。
import { SKILLS, relicModsAtLevel } from '../../public/js/shared/data.js';
import { offerHexes } from '../../public/js/shared/hexes/index.js';
import { effectBalanceWeight, getEffect } from '../../public/js/shared/effects.js';
import { DESTRUCTIBLE_BY_ID } from '../../public/js/shared/destructibles.js';

function numericArg(flag, fallback) {
  const raw = process.argv.find((arg) => arg.startsWith(`--${flag}=`));
  const value = Number(raw ? raw.slice(flag.length + 3) : NaN);
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

// 同时支持 `--flag=value` 与 `--flag value`。
function stringArg(flag, fallback = null) {
  const argv = process.argv;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === `--${flag}` && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      return argv[i + 1];
    }
    if (argv[i].startsWith(`--${flag}=`)) return argv[i].slice(flag.length + 3);
  }
  return fallback;
}

// 默认带初始技能「霜月·极光」Lv1：真人开局必带一个技能（aurora 初始解锁），
// 冷却好就用（见 balance-sim.mjs 的释放循环）；--skill=none 仍可回到无技能旧口径。
const SKILL_ID = stringArg('skill', 'aurora');
const SKILL_LEVEL = Math.max(1, Math.min(10, numericArg('skill-level', 1)));
if (SKILL_ID !== 'none' && !SKILLS[SKILL_ID]) {
  console.error(`未知技能：${SKILL_ID}（可选 none / ${Object.keys(SKILLS).join(' / ')}）`);
  process.exit(1);
}
const SKILL = SKILL_ID === 'none' ? null : { id: SKILL_ID, level: SKILL_LEVEL };

// ---------- 机器人策略 ----------

// 权重来自效果注册表；未注册的键直接报错，避免机器人静默忽略新效果。
function modsValue(mods = {}) {
  let value = 0;
  for (const [key, raw] of Object.entries(mods)) {
    getEffect(key);
    const weight = effectBalanceWeight(key);
    if (key === 'dmg') {
      for (const amount of Object.values(raw)) value += amount * weight;
    } else if (typeof raw === 'number') {
      value += raw * weight;
    }
  }
  return value;
}

function offerValue(offer) {
  if (offer.kind === 'relic') {
    const after = relicModsAtLevel(offer.id, offer.toLevel);
    const before = offer.fromLevel ? relicModsAtLevel(offer.id, offer.fromLevel) : {};
    return modsValue(after) - modsValue(before);
  }
  if (offer.kind === 'gold') return offer.amount * 0.06;
  if (offer.kind === 'repair') return offer.amount * 12;
  return 0;
}

// 局内事件的选项估值：金币 1 分、基地生命/上限 12 分（与遗物里的 repair 同口径）。
// 赌局按期望值折算，机器人只做确定性比较，不消耗战斗 RNG。
function eventOptionValue(option) {
  const expected = {};
  const add = (deltas, weight = 1) => {
    for (const [key, raw] of Object.entries(deltas || {})) {
      expected[key] = (expected[key] || 0) + raw * weight;
    }
  };
  if (option?.gamble) {
    add(option.gamble.win, option.gamble.chance);
    add(option.gamble.lose, 1 - option.gamble.chance);
  } else {
    add(option?.deltas);
  }
  let value = 0;
  for (const [key, amount] of Object.entries(expected)) {
    if (key === 'gold') value += amount;
    else if (key === 'hp' || key === 'maxHp') value += amount * 12;
    else value += amount;
  }
  return value;
}

// 事件波结算：按期望收益从高到低尝试可负担的选项；全部失败才视为卡死。
// 事件是独立 RNG（seed:event:wave），这里不改变战斗随机序列。
function resolveBotEvent(sim) {
  const options = Array.isArray(sim.pendingEvent?.options) ? sim.pendingEvent.options : [];
  const ranked = options
    .map((option, index) => ({ index, value: eventOptionValue(option) }))
    .sort((a, b) => b.value - a.value || a.index - b.index);
  for (const entry of ranked) {
    const result = sim.applyEventOption(entry.index);
    if (result.ok) return result;
  }
  return { ok: false, reason: 'no-affordable-option' };
}

// 可破坏物策略（固定图）：只拆“净收益为正”的物件。
// 补给箱免费 +25 金/+1 生命，永远拆；金脉净赚 60 金，留 15 金缓冲后拆；
// 图腾光环 +8% 移速/+10% 生命，留 60 金缓冲后拆；石碑 +5% 塔伤害，中后期金币富余再拆。
// 虫巢不拆：免费但会立刻刷 6 只噬虫，机器人不为此冒险（腾格子的收益低于漏怪风险）。
const DESTRUCTIBLE_POLICY = {
  cache: () => true,
  vein: (sim) => sim.gold >= DESTRUCTIBLE_BY_ID.vein.cost + 15,
  totem: (sim) => sim.gold >= DESTRUCTIBLE_BY_ID.totem.cost + 60,
  obelisk: (sim, wave) => wave >= 8 && sim.gold >= DESTRUCTIBLE_BY_ID.obelisk.cost + 200,
};

function useDestructibles(sim, wave) {
  for (const item of Array.isArray(sim.destructibles) ? sim.destructibles : []) {
    if (item.destroyed) continue;
    const rule = DESTRUCTIBLE_POLICY[item.type];
    if (!rule || !rule(sim, wave)) continue;
    sim.destroyDestructible(item.id);
  }
}

// 按 lane 采样路径点：每条 lane 都从入口采到基地（含终点），保证多入口地图的
// 覆盖评分不会漏掉任何一路。返回的 lane 字段用于校验/调试。
export function sampleLanePoints(sim, step = 0.5) {
  const samples = [];
  sim.lanes.forEach((lane, laneIndex) => {
    const count = Math.max(1, Math.ceil(lane.len / step));
    for (let i = 0; i <= count; i++) {
      const d = Math.min(lane.len, i * step);
      const pos = sim.posAt(d, laneIndex);
      samples.push({ x: pos.x, y: pos.y, lane: laneIndex });
    }
  });
  return samples;
}

function buildCoverage(map, sim) {
  const samples = sampleLanePoints(sim);

  const cells = [];
  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) {
      if (!map.buildable[r][c]) continue;
      let coverage = 0;
      for (const sample of samples) {
        const dx = sample.x - (c + 0.5);
        const dy = sample.y - (r + 0.5);
        if (dx * dx + dy * dy <= 3.1 * 3.1) coverage++;
      }
      if (coverage > 3) cells.push({ c, r, coverage });
    }
  }
  cells.sort((a, b) => b.coverage - a.coverage);
  return cells;
}

function desiredType(sim, wave) {
  const counts = {};
  for (const tower of sim.towers) counts[tower.type] = (counts[tower.type] || 0) + 1;
  const total = sim.towers.length;
  const unlocked = sim.unlockedTowers;

  if (total < 2) return 'arrow';
  if (wave >= 2 && (counts.cannon || 0) < Math.ceil(total * 0.3)) return 'cannon';
  if (wave >= 3 && (counts.frost || 0) < Math.ceil(total * 0.18)) return 'frost';
  if (wave >= 8 && unlocked.includes('poison') && (counts.poison || 0) < Math.ceil(total * 0.2)) {
    return 'poison';
  }
  if (wave >= 6 && unlocked.includes('arc') && (counts.arc || 0) < Math.ceil(total * 0.2)) {
    return 'arc';
  }
  return 'arrow';
}

function spendGold(sim, wave, cells) {
  const targetTowers = Math.min(18, 4 + wave);

  for (let guard = 0; guard < 24 && sim.towers.length < targetTowers; guard++) {
    let type = desiredType(sim, wave);
    if (!sim.unlockedTowers.includes(type)) type = 'arrow';
    const cost = sim.towerCost(type);
    if (sim.gold < cost + 15) break;
    const cell = cells.find((entry) => sim.canBuild(entry.c, entry.r));
    if (!cell) break;
    if (!sim.placeTower(type, cell.c, cell.r)) break;
  }

  for (let guard = 0; guard < 40; guard++) {
    const options = sim.towers
      .filter((tower) => sim.upgradeCost(tower) != null)
      .map((tower) => ({ tower, cost: sim.upgradeCost(tower), level: tower.level }))
      .filter((option) => sim.gold >= option.cost + 40)
      .sort((a, b) => a.level - b.level || a.cost - b.cost);
    if (!options.length) break;
    // 塔数量不足时优先铺塔，金币富余再升级
    if (sim.towers.length < targetTowers && sim.gold < 240) break;
    sim.upgradeTower(options[0].tower);
  }

  evolveTowers(sim);
}

// 满级塔立即选分支进化（真人下限：见到进化就选，取第一分支，不卖塔不换塔）。
// 进化免费、不消耗 RNG、不改变基础塔数值，只叠加数据表里声明的乘法系数。
function evolveTowers(sim) {
  for (const tower of sim.towers) {
    if (!sim.canEvolve(tower)) continue;
    const options = sim.evolutionOptions(tower);
    if (!options.length) continue;
    sim.evolveTower(tower, options[0].id);
  }
}

// 开局主海克斯：真人必须在放行波次前从三选一里挑一个（见 run-service.chooseHex）。
// 机器人取确定性三选一的第一张——不做针对性挑选，是最低决策门槛，而不是完美操作。
function pickHex(seed) {
  const offers = offerHexes(seed, 3);
  return offers.length ? offers[0] : null;
}

export {
  numericArg,
  stringArg,
  SKILL,
  buildCoverage,
  offerValue,
  resolveBotEvent,
  useDestructibles,
  spendGold,
  evolveTowers,
  pickHex,
};
