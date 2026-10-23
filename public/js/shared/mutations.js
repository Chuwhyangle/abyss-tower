// 变异挑战：变异定义、组合校验与参数派生；前后端共用，纯函数、无随机。
// 变异只调整既有开局参数（金币/基地生命/刷新次数/可用塔）与波次已有倍率（hpMul/speedMul）。
import { TOWER_ORDER } from './data.js';

export const MUTATION_MAX = 3;

const DEFINITIONS = [
  {
    id: 'enemy_might',
    name: '敌军强化',
    desc: '敌人生命 +18%、移速 +6%。',
    hpMul: 1.18,
    speedMul: 1.06,
    scoreMul: 1.2,
  },
  {
    id: 'famine',
    name: '经济紧缩',
    desc: '开局金币 -80。',
    goldDelta: -80,
    scoreMul: 1.15,
  },
  {
    id: 'fragile_base',
    name: '脆弱基地',
    desc: '基地生命 -5。',
    hpDelta: -5,
    scoreMul: 1.15,
  },
  {
    id: 'no_reroll',
    name: '禁止刷新',
    desc: '本局不能刷新遗物。',
    rerollOverride: 0,
    scoreMul: 1.1,
  },
  {
    id: 'narrow_towers',
    name: '塔位受限',
    desc: '只能建造箭塔与炮塔。',
    towers: ['arrow', 'cannon'],
    scoreMul: 1.2,
  },
];

export const MUTATIONS = Object.fromEntries(DEFINITIONS.map((def) => [def.id, def]));
const MUTATION_BY_ID = MUTATIONS;
export const MUTATION_ORDER = DEFINITIONS.map((def) => def.id);

const MIN_START_GOLD = 100;
const MIN_BASE_HP = 8;

function round2(value) {
  return Math.round(value * 100) / 100;
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

// 接受数组或逗号分隔字符串；格式不认识时返回 null，交给校验层拒绝。
function parseMutationIds(value) {
  if (value == null || value === '') return [];
  if (Array.isArray(value)) return value.map((id) => String(id));
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
  }
  return null;
}

// 组合校验：1–3 个、必须已知、不得重复；返回按 id 排序的规范组合。
export function validateMutationSelection(value) {
  const ids = parseMutationIds(value);
  if (!ids) return { ok: false, ids: [], error: '变异组合格式不合法' };
  if (ids.length < 1 || ids.length > MUTATION_MAX) {
    return { ok: false, ids: [], error: `变异数量必须为 1–${MUTATION_MAX} 个` };
  }
  const seen = new Set();
  for (const id of ids) {
    if (!MUTATION_BY_ID[id]) return { ok: false, ids: [], error: `未知变异：${id}` };
    if (seen.has(id)) return { ok: false, ids: [], error: `变异重复：${id}` };
    seen.add(id);
  }
  return { ok: true, ids: [...ids].sort(), error: null };
}

// 同一组变异无论选择顺序如何都落到同一个榜单键。
export function mutationKey(ids) {
  return [...new Set(ids || [])].sort().join(',');
}

// 分数倍率按变异逐个相乘；组合固定时结果固定。
export function mutationScoreMul(ids) {
  return round2(
    (ids || []).reduce((mul, id) => mul * (MUTATION_BY_ID[id]?.scoreMul || 1), 1)
  );
}

function mutationWaveMul(ids) {
  let hpMul = 1;
  let speedMul = 1;
  for (const id of ids || []) {
    const def = MUTATION_BY_ID[id];
    if (!def) continue;
    hpMul *= def.hpMul || 1;
    speedMul *= def.speedMul || 1;
  }
  return { hpMul: round3(hpMul), speedMul: round3(speedMul) };
}

// 波次生成只读地图词缀的 hpMul/speedMul，叠加变异倍率时保留词缀其余字段。
export function composeWaveModifier(modifier, ids) {
  const { hpMul, speedMul } = mutationWaveMul(ids);
  if (hpMul === 1 && speedMul === 1) return modifier || null;
  const base = modifier || {
    id: 'mutated',
    name: '变异',
    desc: '变异挑战。',
    color: '#c58cff',
    hpMul: 1,
    speedMul: 1,
    goldMul: 1,
    rangeMul: 1,
    scoreMul: 1,
    extraPortal: 0,
  };
  return {
    ...base,
    hpMul: round3((base.hpMul || 1) * hpMul),
    speedMul: round3((base.speedMul || 1) * speedMul),
  };
}

// 把已校验的组合应用到开局参数上；钳制与服务端普通开局保持同一底线。
export function applyMutations(run, ids) {
  let startingGold = run.startingGold;
  let baseHp = run.baseHp;
  let maxRerolls = run.maxRerolls;
  let towersUnlocked = [...(run.towersUnlocked || TOWER_ORDER)];
  let rerollOverride = null;
  let towerFilter = null;

  for (const id of ids || []) {
    const def = MUTATION_BY_ID[id];
    if (!def) continue;
    startingGold += def.goldDelta || 0;
    baseHp += def.hpDelta || 0;
    if (def.rerollOverride != null) {
      rerollOverride =
        rerollOverride == null ? def.rerollOverride : Math.min(rerollOverride, def.rerollOverride);
    }
    if (def.towers) {
      towerFilter = towerFilter
        ? towerFilter.filter((tower) => def.towers.includes(tower))
        : def.towers.filter((tower) => TOWER_ORDER.includes(tower));
    }
  }

  if (towerFilter) {
    towersUnlocked = towersUnlocked.filter((tower) => towerFilter.includes(tower));
  }
  const { hpMul, speedMul } = mutationWaveMul(ids);

  return {
    startingGold: Math.max(MIN_START_GOLD, Math.round(startingGold)),
    baseHp: Math.max(MIN_BASE_HP, Math.round(baseHp)),
    maxRerolls:
      rerollOverride == null ? maxRerolls : Math.max(0, Math.min(maxRerolls, rerollOverride)),
    towersUnlocked,
    hpMul,
    speedMul,
    scoreMul: mutationScoreMul(ids),
  };
}

// 面向客户端展示的最小信息集。
export function mutationSummary(ids) {
  return (ids || [])
    .map((id) => MUTATION_BY_ID[id])
    .filter(Boolean)
    .map(({ id, name, desc, scoreMul }) => ({ id, name, desc, scoreMul }));
}
