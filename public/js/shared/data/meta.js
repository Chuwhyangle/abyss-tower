// 局外深度成长 · 跨局传承（纯数据/纯函数，不 import 运行时模块）。
// 与 cores（星核，解锁为主）/ achievements / season_pass / bounties 完全分离：
// 传承材料只服务于天赋树 / 永久强化的投入，同一次结算在各自口径下只计数一次，不重复结算。
// 账号级状态独立持久化在 player_kv('meta','legacy')，不随单局快照（见 docs/PHASE_META.md §5.3）。

// 传承材料定义表：{ id, name, source, sink }。source 说明产出侧，sink 说明消耗侧。
export const LEGACY_MATERIALS = [
  { id: 'legacy_core', name: '传承之核', source: 'settlement', sink: 'talent_upgrade' },
];

export const LEGACY_MATERIAL_BY_ID = Object.fromEntries(
  LEGACY_MATERIALS.map((material) => [material.id, material])
);

// 归一化账号传承状态：任何脏输入都收敛到 { materials, bank }，bank 恒等于 materials 求和
// （机械可检，PHASE_META §5.3）。旧存档缺少 legacy 字段时得到零材料状态，绝不抛错。
export function normalizeLegacy(raw) {
  const materials = {};
  for (const material of LEGACY_MATERIALS) {
    const count = Math.max(0, Math.floor(Number(raw?.materials?.[material.id]) || 0));
    if (count > 0) materials[material.id] = count;
  }
  const bank = Object.values(materials).reduce((sum, count) => sum + count, 0);
  return { materials, bank };
}

// 结算产出：确定性纯函数，无 RNG。按本局表现（波次 / 击杀 / 通关）线性产出，
// 系数与星核（scoring.computeOutcome 的 cores）不同、来源独立，分账清晰可对账。
export function legacyYield(runResult) {
  const waveReached = Math.max(0, Math.floor(Number(runResult?.waveReached) || 0));
  const kills = Math.max(0, Math.floor(Number(runResult?.kills) || 0));
  const victory = Boolean(runResult?.victory);
  const total = waveReached * 1 + Math.floor(kills / 10) + (victory ? 5 : 0);
  return normalizeLegacy({ materials: { legacy_core: total } });
}

// 天赋树与永久强化：账号级技能点投入 → 永久被动（纯数据/纯函数，不 import 运行时模块）。
// 与 cores/achievements/pass/bounties 完全分离，独立持久化在 player_kv('meta','talent')。
// 只有 EFFECT_REGISTRY 已声明的键会被 sim 折叠；skillCd/skillPower 留给技能层消费，
// 因此 talentMods 会把未注册的键过滤掉，绝不越界写进 mods。
import { EFFECT_REGISTRY } from '../effects.js';

export const TALENT_CATEGORIES = {
  tower: { id: 'tower', name: '塔防' },
  skill: { id: 'skill', name: '技能' },
  economy: { id: 'economy', name: '经济' },
};

// 每项 effects 的值是「每级增量」；cost/maxRank 固定，rank ∈ [0, maxRank]。
// 数值克制（PHASE_META §4.1）：单项 ≤ +8%，每类累计 ≤ +24%，hpMul 0.85/1.10/1.34 不在此列。
export const TALENT_NODES = [
  { id: 'tower_atk', name: '百炼锋刃', category: 'tower', cost: 1, maxRank: 2, effects: { dmgAll: 0.04 }, desc: '所有防御塔伤害 +4%（每级）' },
  { id: 'tower_range', name: '鹰隼之眼', category: 'tower', cost: 1, maxRank: 2, effects: { range: 0.3 }, desc: '所有防御塔射程 +0.3 格（每级）' },
  { id: 'tower_cost', name: '精工图纸', category: 'tower', cost: 1, maxRank: 2, effects: { costMul: -0.04 }, desc: '建造与升级费用 -4%（每级）' },
  { id: 'skill_cd', name: '冥想专注', category: 'skill', cost: 1, maxRank: 2, effects: { skillCd: -0.04 }, desc: '主动技能冷却 -4%（每级）' },
  { id: 'skill_power', name: '奥能增幅', category: 'skill', cost: 1, maxRank: 2, effects: { skillPower: 0.04 }, desc: '主动技能效果幅度 +4%（每级）' },
  { id: 'economy_gold', name: '敛财术', category: 'economy', cost: 1, maxRank: 2, effects: { goldMul: 0.04 }, desc: '金币收入 +4%（每级）' },
  { id: 'economy_interest', name: '复利精算', category: 'economy', cost: 1, maxRank: 2, effects: { interest: 0.02 }, desc: '波末利息 +2%（每级）' },
  { id: 'economy_kill', name: '战利品学', category: 'economy', cost: 1, maxRank: 2, effects: { killGold: 1 }, desc: '击杀金币 +1（每级）' },
];

export const TALENT_ORDER = TALENT_NODES.map((node) => node.id);
export const TALENT_BY_ID = Object.fromEntries(TALENT_NODES.map((node) => [node.id, node]));

const round = (value) => Math.round(value * 1000) / 1000;

// 单节点在指定 rank 下的效果（每个键 = 每级增量 × 等级）；rank 越界时安全收敛。
export function talentEffect(nodeId, rank = 0) {
  const node = TALENT_BY_ID[nodeId];
  if (!node) return {};
  const level = Math.max(0, Math.min(node.maxRank, Math.floor(Number(rank) || 0)));
  const effect = {};
  for (const [key, perRank] of Object.entries(node.effects)) {
    effect[key] = round(perRank * level);
  }
  return effect;
}

// 归一化账号天赋状态：任何脏输入都收敛到 { points, spent, nodes }，spent 恒等于 Σ nodes[].rank。
// 旧存档缺少 talent 字段时得到零投入状态，绝不抛错。
export function normalizeTalent(raw) {
  const points = Math.max(0, Math.floor(Number(raw?.points) || 0));
  const nodes = {};
  if (raw && raw.nodes && typeof raw.nodes === 'object') {
    for (const node of TALENT_NODES) {
      const rank = Math.max(0, Math.min(node.maxRank, Math.floor(Number(raw.nodes[node.id]) || 0)));
      if (rank > 0) nodes[node.id] = rank;
    }
  }
  const spent = Object.values(nodes).reduce((sum, rank) => sum + rank, 0);
  return { points, spent, nodes };
}

// 投入 1 点：点数充足且未满级才成功，返回 { ok, reason, state }（state 恒为归一化后的新对象）。
export function investTalent(talent, nodeId) {
  const state = normalizeTalent(talent);
  const node = TALENT_BY_ID[nodeId];
  if (!node) return { ok: false, reason: 'unknown_node', state };
  if (state.points <= state.spent) return { ok: false, reason: 'no_points', state };
  const current = state.nodes[node.id] || 0;
  if (current >= node.maxRank) return { ok: false, reason: 'maxed', state };
  state.nodes[node.id] = current + 1;
  state.spent += 1;
  return { ok: true, reason: null, state };
}

// 汇总天赋带来的全部被动乘数，只保留 EFFECT_REGISTRY 已声明的键（sim 直接折叠）。
// 顺序固定（TALENT_NODES 表序），零投入时返回空对象，不影响既有 mods 逐字节一致。
export function talentMods(talent) {
  const state = normalizeTalent(talent);
  const mods = {};
  for (const node of TALENT_NODES) {
    const rank = state.nodes[node.id] || 0;
    if (rank <= 0) continue;
    for (const [key, value] of Object.entries(talentEffect(node.id, rank))) {
      if (!(key in EFFECT_REGISTRY)) continue;
      mods[key] = round((mods[key] || 0) + value);
    }
  }
  return mods;
}
