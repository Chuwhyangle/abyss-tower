// 遗物图鉴的数据表与纯推导：稀有度/套装顺序、效果展示单位表、已收录集合推导。
// 只依赖共享数据与效果注册表；渲染在 relic-codex-draw.js，面板接线在 relic-codex-ui.js。
import { RELIC_BY_ID } from './shared/data.js';
import { RELIC_SET_BONUSES } from './shared/effects.js';

export const RARITY_ORDER = ['common', 'rare', 'epic'];
export const SET_ORDER = Object.keys(RELIC_SET_BONUSES);

// 效果键的展示单位：百分比 / 整数 / 绝对值带符号 / 小数。与 effects.js 的字段一一对应。
const EFFECT_FORMATS = {
  dmg: 'pct',
  dmgAll: 'pct',
  fireRate: 'pct',
  range: 'number',
  splash: 'pct',
  slow: 'pct',
  slowDur: 'pct',
  chain: 'int',
  dot: 'pct',
  goldMul: 'pct',
  killGold: 'int',
  interest: 'pct',
  crit: 'pct',
  armorPierce: 'pct',
  costMul: 'signedPct',
  frostDmgBonus: 'pct',
  lowHpDmg: 'pct',
  richDmg: 'pct',
  emptySlotDmg: 'pct',
  projSpeed: 'pct',
  bossDmg: 'pct',
  baseHp: 'int',
};

// 接受遗物 id 数组、{id}/字符串混合数组，或带 relics 字段的存档/对局对象。
export function relicIdsOf(value) {
  let list = [];
  if (Array.isArray(value)) list = value;
  else if (value && Array.isArray(value.relics)) list = value.relics;
  const ids = [];
  for (const item of list) {
    const id = typeof item === 'string' ? item : item?.id;
    if (typeof id === 'string' && RELIC_BY_ID[id]) ids.push(id);
  }
  return ids;
}

export function collectDiscovered({
  activeRun = null,
  runs = [],
  snapshot = null,
  stored = [],
  unlocks = [],
} = {}) {
  const ids = new Set();
  const add = (value) => {
    for (const id of relicIdsOf(value)) ids.add(id);
  };
  add(stored);
  // profile.unlocks 目前只有永久成长项；若服务端将来把遗物 id 记入这里也能直接生效。
  add(unlocks);
  add(snapshot?.relics);
  add(activeRun);
  for (const run of runs || []) add(run);
  return [...ids].sort();
}

export function effectValueText(key, value) {
  const kind = EFFECT_FORMATS[key] || 'number';
  const num = Number(value) || 0;
  if (kind === 'pct') return { value: String(Math.round(num * 100)) };
  if (kind === 'int') return { value: String(Math.round(num)) };
  if (kind === 'signedPct') {
    const pct = Math.round(num * 100);
    return { sign: pct < 0 ? '-' : '+', value: String(Math.abs(pct)) };
  }
  return { value: String(Math.round(num * 100) / 100) };
}
