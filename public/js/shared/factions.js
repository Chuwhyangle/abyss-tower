// 五派系点数与 4/8/12 三档 setMods 层：纯数据 + 纯函数，前后端共用。
// 数值唯一来源是 docs/PHASE_ROGUE2.md §2/§3；本文件只做落地，不重复写数值出处。
// 依赖方向：factions.js -> data.js（RELIC_BY_ID），不 import sim/render，无 DOM、无随机数。
import { RELIC_BY_ID } from './data.js';

export const FACTION_ORDER = ['fire', 'frost', 'venom', 'storm', 'warden'];

// 显示名（中文，与冻结表 §2.1 的「显示名」列一致）；UI 层走 i18n 取本地化文案。
export const FACTION_NAMES = Object.freeze({
  fire: '火力',
  frost: '霜缚',
  venom: '蚀毒',
  storm: '雷暴',
  warden: '守护',
  neutral: '中立',
});

// 4/8/12 三档阈值（T1/T2/T3 的下界，§2.2）。
export const FACTION_TIERS = Object.freeze([4, 8, 12]);

// 单派系三档效果表：键是 setMods 扁平键（§3.2 的 15 个键），数值与冻结表 §3.3 逐字一致。
const FACTION_TIER_MODS = Object.freeze({
  fire: Object.freeze([
    Object.freeze({ allDamage: 0.06 }),
    Object.freeze({ critDamage: 0.4 }),
    Object.freeze({ killExplosion: Object.freeze({ ratio: 0.5, radius: 0.9 }) }),
  ]),
  frost: Object.freeze([
    Object.freeze({ slowDuration: 0.15 }),
    Object.freeze({ frostFreeze: Object.freeze({ hits: 10, duration: 0.6 }) }),
    Object.freeze({ freezeVulnerable: Object.freeze({ mult: 0.25, duration: 2 }) }),
  ]),
  venom: Object.freeze([
    Object.freeze({ poisonSlow: 0.08 }),
    Object.freeze({ poisonVulnerable: 0.12 }),
    Object.freeze({ poisonSpread: Object.freeze({ radius: 1.5, targets: 2, layers: 1 }) }),
  ]),
  storm: Object.freeze([
    Object.freeze({ chainExtra: 1 }),
    Object.freeze({ chainRange: 0.4 }),
    Object.freeze({ chainCrit: true }),
  ]),
  warden: Object.freeze([
    Object.freeze({ leakIgnoreChance: 0.2 }),
    Object.freeze({ leakDamageReduction: 1 }),
    Object.freeze({ setWaveHeal: Object.freeze({ every: 3, amount: 1, capPerRun: 5 }) }),
  ]),
});

function clampLevel(level) {
  return Math.max(1, Math.min(3, Math.floor(Number(level) || 1)));
}

// 某件遗物的派系；未知/无 faction 的旧存档遗物按 neutral 处理（§8.2 不变式 3）。
export function relicFaction(id) {
  const relic = RELIC_BY_ID[id];
  return typeof relic?.faction === 'string' ? relic.faction : 'neutral';
}

// [{id, level}] → { fire, frost, venom, storm, warden }，中立不出键（§8.1）。
export function factionPoints(states) {
  const points = Object.fromEntries(FACTION_ORDER.map((faction) => [faction, 0]));
  for (const item of states || []) {
    const id = item?.id ?? (typeof item === 'string' ? item : null);
    const faction = relicFaction(id);
    if (!(faction in points)) continue;
    points[faction] += clampLevel(item?.level ?? 1);
  }
  return points;
}

// 同 factionPoints，键值换成 0..3 的档位（4→1，8→2，12→3）。
export function factionTiers(states) {
  const points = factionPoints(states);
  const tiers = {};
  for (const faction of FACTION_ORDER) tiers[faction] = tierFor(points[faction]);
  return tiers;
}

function tierFor(points) {
  const pts = Math.max(0, Math.floor(Number(points) || 0));
  if (pts >= 12) return 3;
  if (pts >= 8) return 2;
  if (pts >= 4) return 1;
  return 0;
}

// { fire: 3 } → setMods 扁平对象；0 档/空输入返回 {}（§3.1）。
export function factionSetMods(tierByFaction) {
  const out = {};
  for (const faction of FACTION_ORDER) {
    const tier = Math.max(0, Math.min(3, Math.floor(Number(tierByFaction?.[faction]) || 0)));
    for (let t = 0; t < tier; t++) {
      Object.assign(out, FACTION_TIER_MODS[faction][t]);
    }
  }
  return out;
}
