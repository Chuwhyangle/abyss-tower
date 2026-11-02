// 平衡模拟的机器人策略：开局整备、建塔升级、遗物/事件/可破坏物的固定决策，以及 --skill 参数解析。
// 由 tests/balance-sim.mjs 引入；策略改动会改变平衡数据的口径。
import { SKILLS, RELIC_MAX_LEVEL, relicModsAtLevel, rollStarterOffers } from '../../public/js/shared/data.js';
import { effectBalanceWeight, getEffect } from '../../public/js/shared/effects.js';
import { DESTRUCTIBLE_BY_ID } from '../../public/js/shared/destructibles.js';
import { offerHexes } from '../../public/js/shared/hexes/index.js';
import { rollBossCoreOffers } from '../../public/js/shared/boss-core.js';
import { isContractWave, rollContractOffer } from '../../public/js/shared/contracts.js';
import { TALENT_NODES } from '../../public/js/shared/data/meta.js';

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

const SKILL_ID = stringArg('skill', 'aurora');
const SKILL_LEVEL = Math.max(1, Math.min(10, numericArg('skill-level', 1)));
if (!SKILLS[SKILL_ID]) {
  console.error(`未知技能：${SKILL_ID}（可选 ${Object.keys(SKILLS).join(' / ')}）`);
  process.exit(1);
}
// 机器人唯一口径为真人下限：技能默认生效（冷却好就放），不支持 --skill=none 关技能。
const SKILL = { id: SKILL_ID, level: SKILL_LEVEL };

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
  // 战旗塔：不攻击，为光环内其他塔提供增伤/攻速。真人下限「配一座光环辅助」，固定 1 座。
  if (wave >= 4 && unlocked.includes('banner') && (counts.banner || 0) < 1) return 'banner';
  // 狙击塔：超远射程单体高伤，第 25/30 波首领的单体对策。真人下限「针对首领建单体塔」，固定 1 座。
  if (wave >= 9 && unlocked.includes('sniper') && (counts.sniper || 0) < 1) return 'sniper';
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
}

// ---------- 肉鸽 2.0 系统机器人策略（真人下限：固定优先级、不遍历组合择优） ----------

// 开局信物三选一（§2.5）：取估值最高的入门遗物，估值与遗物三选一同口径（offerValue）。
function pickStarterOffer(seed) {
  const offers = rollStarterOffers(`${seed}:starter`, 'normal');
  offers.sort((a, b) => offerValue(b) - offerValue(a));
  return offers[0] || null;
}

// 首领核心三选一（§4）：固定优先级 觉醒 > 教义 > 升阶 > 搜寻 > 补给。
// 觉醒仅在已持有对应 Ⅲ 级遗物时选，教义仅在未满 2 条时选，其余核心取第一个候选。
const BOSS_CORE_PRIORITY = ['awakening', 'doctrine', 'upgrade', 'search', 'supply'];

function pickBossCore(sim, seed, wave) {
  const offers = rollBossCoreOffers(String(seed), wave, sim.relics, {
    doctrineTaken: sim.rogue2.doctrines,
  });
  const byKind = new Map(offers.map((offer) => [offer.kind, offer]));
  for (const kind of BOSS_CORE_PRIORITY) {
    const offer = byKind.get(kind);
    if (!offer) continue;
    if (kind === 'awakening') {
      const option = (offer.options || []).find(
        (entry) => sim.getRelicLevel(entry.relicId) >= RELIC_MAX_LEVEL
      );
      if (option) return { kind, option };
      continue;
    }
    if (kind === 'doctrine' && sim.rogue2.doctrines.length >= 2) continue;
    const option = (offer.options || [])[0];
    if (option) return { kind, option };
  }
  return null;
}

// 首领核心即时结算：升阶/搜寻走 addRelic，补给直接改金币/基地生命，教义/觉醒走各自结算。
function applyBossCoreChoice(sim, choice) {
  if (!choice) return false;
  const { kind, option } = choice;
  if (kind === 'upgrade' || kind === 'search') {
    if (!option?.id) return false;
    return !!sim.addRelic({ id: option.id, toLevel: option.toLevel }).applied;
  }
  if (kind === 'supply') {
    if (option?.type === 'gold') {
      sim.gold += Math.max(0, Math.floor(option.amount) || 0);
      return true;
    }
    if (option?.type === 'maxHp') {
      const amount = Math.max(0, Math.floor(option.amount) || 0);
      sim.maxBaseHp += amount;
      sim.baseHp = Math.min(sim.maxBaseHp, sim.baseHp + amount);
      return true;
    }
    return false;
  }
  if (kind === 'doctrine') return !!(option?.doctrineId && sim.applyDoctrine(option.doctrineId).ok);
  if (kind === 'awakening') return !!(option?.relicId && sim.applyAwakening(option.relicId).ok);
  return false;
}

// 契约接受（§5）：只接受净收益明确、代价可承受的契约（血契/贫契/惰契）；
// 债契需 reroll（机器人不持有，跳过）、焚契焚毁遗物（跳过）。
const ACCEPTABLE_CONTRACTS = new Set(['blood', 'poverty', 'sloth']);

function maybeAcceptContract(sim, seed, wave) {
  if (!isContractWave(wave)) return false;
  const offer = rollContractOffer(String(seed), wave, {
    accepted: sim.rogue2.contracts.length,
    relics: sim.relics,
  });
  if (!offer || !ACCEPTABLE_CONTRACTS.has(offer.id)) return false;
  return !!sim.applyContract(offer, { rerolls: 0 }).ok;
}

// ---------- 真人下限基座（AC-052 口径：技能/主海克斯/塔进化） ----------

// 主海克斯三选一：开局必选其一，取第一 offer 是「无偏好」下限（不按地图/遗物择优）。
function pickHex(seed) {
  return offerHexes(String(seed), 3, 'normal')[0] || null;
}

// 满级塔进化：免费、不占经济，真人必然顺手点；取第一分支是「不择优」下限。
function evolveReadyTowers(sim) {
  for (const tower of sim.towers) {
    if (!sim.canEvolve(tower)) continue;
    const options = sim.evolutionOptions(tower);
    if (options[0]) sim.evolveTower(tower, options[0].id);
  }
}

// ---------- GOAL-012 账号级 meta 增益端点 ----------

// 平衡复测的两个端点：'zero' = 账号无任何天赋/传承投入；'full' = 全部天赋节点满投入。
// 只返回账号天赋状态（{ points, nodes }），由 sim.js 在开局一次性折叠进 mods（deterministic），
// 机器人不额外加钱/加伤，仍走既有的固定策略——天赋带来的 costMul/goldMul/interest/killGold
// 通过 sim.towerCost / sim.upgradeCost / sim.gold 等状态真实进入机器人决策，dmgAll/range 在
// 战斗里真实生效，不靠作弊凑数（PHASE_META §4.1/§4.2）。
export function accountTalent(endpoint) {
  if (endpoint !== 'full') return { points: 0, nodes: {} };
  const nodes = {};
  let spent = 0;
  for (const node of TALENT_NODES) {
    nodes[node.id] = node.maxRank;
    spent += node.maxRank;
  }
  return { points: spent, nodes };
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
  pickStarterOffer,
  pickBossCore,
  applyBossCoreChoice,
  maybeAcceptContract,
  pickHex,
  evolveReadyTowers,
};
