// 爬塔精英节点词缀与奖励数据（P0-6）：精英 = fight + 1~2 条精英词缀（敌人强化）+ 金币 ×1.5 + 高稀有遗物。
// 纯数据/纯函数，seed 派生走独立流 `${seed}:tower:elite:*`，不触碰 sim.js / events.js 既有 RNG 调用顺序
// （docs/PHASE_TOWER.md §6.2 红线 4）。词缀只落 hpMul/speedMul（服务端 baked 进 generateWave）；
// 金币 ×1.5 由服务端乘进 wave.reward，高稀有由抽取层用 'elite' 稀有度档位生效。
import { RNG } from '../rng.js';

// 精英词缀池：每条至少一项敌人强化（hpMul>1 或 speedMul>1），风险收益双高。
// 数值口径沿用 MAP_MODIFIERS 的 hpMul/speedMul 字段；color 沿用既有词缀色系，仅供客户端渲染徽章。
export const TOWER_ELITE_AFFIXES = Object.freeze([
  { id: 'haste', name: '疾风', desc: '敌人移速 +22%', color: '#5fb6ea', speedMul: 1.22 },
  { id: 'iron', name: '铁壁', desc: '敌人生命 +30%', color: '#8f9bb3', hpMul: 1.3 },
  { id: 'frenzy', name: '狂暴', desc: '敌人移速 +12%，生命 +12%', color: '#ff8f5a', hpMul: 1.12, speedMul: 1.12 },
  { id: 'titan', name: '巨像', desc: '敌人生命 +45%，移速 -10%', color: '#c88bff', hpMul: 1.45, speedMul: 0.9 },
  { id: 'relentless', name: '不息', desc: '敌人生命 +20%，移速 +8%', color: '#6fa8ff', hpMul: 1.2, speedMul: 1.08 },
]);

// 精英节点固定奖励倍率：金币 ×1.5（服务端权威 baked 进 wave.reward）。
export const TOWER_ELITE_GOLD_MUL = 1.5;
// 精英节点词缀数量区间（1~2 条）。
export const TOWER_ELITE_AFFIX_MIN = 1;
export const TOWER_ELITE_AFFIX_MAX = 2;

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

// 词缀展示条目：只露 id/名称/描述/配色，不携带数值倍率（「只露词缀，不露具体收益」）。
function affixView(affix) {
  return { id: affix.id, name: affix.name, desc: affix.desc, color: affix.color };
}

// 抽取 1~2 条互异精英词缀：独立流 `${seed}:tower:elite:<key>`，同 (seed, key) 可复现。
export function rollTowerEliteAffixes(seed, nodeOrKey) {
  const key = typeof nodeOrKey === 'string' ? nodeOrKey : `${nodeOrKey.layer}:${nodeOrKey.column}`;
  const rng = new RNG(`${seed}:tower:elite:${key}`);
  const count =
    TOWER_ELITE_AFFIX_MIN + rng.int(TOWER_ELITE_AFFIX_MAX - TOWER_ELITE_AFFIX_MIN + 1);
  return rng.shuffle(TOWER_ELITE_AFFIXES).slice(0, count);
}

// 精英波次修饰符：由词缀合成 hpMul/speedMul（乘法），goldMul 恒为精英奖励倍率。
// 服务端据此把词缀 baked 进 generateWave 并乘奖励；客户端只拿到 affixes 展示条目。
export function towerEliteModifier(seed, nodeOrKey) {
  const affixes = rollTowerEliteAffixes(seed, nodeOrKey);
  let hpMul = 1;
  let speedMul = 1;
  for (const affix of affixes) {
    hpMul *= affix.hpMul ?? 1;
    speedMul *= affix.speedMul ?? 1;
  }
  const key = typeof nodeOrKey === 'string' ? nodeOrKey : `${nodeOrKey.layer}:${nodeOrKey.column}`;
  return {
    id: `tower-elite:${key}`,
    name: affixes.map((affix) => affix.name).join('·'),
    desc: affixes.map((affix) => affix.desc).join('；'),
    color: affixes[0]?.color ?? '#ff8a5c',
    hpMul: round3(hpMul),
    speedMul: round3(speedMul),
    goldMul: TOWER_ELITE_GOLD_MUL,
    affixes: affixes.map(affixView),
  };
}
