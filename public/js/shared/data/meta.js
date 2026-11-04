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
// 三层结构（TODO-14 §2）：数值（effects，+1%/级，maxRank 2~3）+ 解锁（unlocks 机制永驻，maxRank 1）+
// 质变（unlocks 机制永驻，maxRank 1）。只有 EFFECT_REGISTRY 已声明的键会被 sim 折叠进 mods；
// unlocks 走独立的 TALENT_MECHANICS 注册表，经 talentUnlocks 聚合为 sim.talentUnlocks（不进 mods）。
import { EFFECT_REGISTRY } from '../effects.js';

export const TALENT_CATEGORIES = {
  tower: { id: 'tower', name: '塔防' },
  skill: { id: 'skill', name: '技能' },
  economy: { id: 'economy', name: '经济' },
};

// 三层分类（TODO-14 §2）：数值（浅层、可多级）/ 解锁（暴击·利息·破甲·连锁，永驻）/ 质变（塔上限+1·
// 技能二次施放·信物可控，永驻）。tier 与 category（塔/技能/经济三系）正交：category 决定 build 身份，
// tier 决定投资深度与成本分档。
export const TALENT_TIERS = {
  numeric: { id: 'numeric', name: '数值' },
  unlock: { id: 'unlock', name: '解锁' },
  qualitative: { id: 'qualitative', name: '质变' },
};

// 机制注册表：unlocks 通道的唯一声明处（与 EFFECT_REGISTRY 正交）。节点 unlocks 只有命中这里的键
// 才会被 talentUnlocks 聚合；阶段 1 读 sim.talentUnlocks 落地机制行为（baseInterest / 二次施放 /
// 塔上限等），本任务只落契约与死节点修复。
export const TALENT_MECHANICS = {
  crit: { name: '暴击', desc: '解锁暴击机制（永驻）' },
  interest: { name: '利息', desc: '解锁利息机制（永驻，阶段 1 消费为 baseInterest）' },
  armorPierce: { name: '破甲', desc: '解锁破甲机制（永驻）' },
  chain: { name: '连锁', desc: '解锁连锁机制（永驻）' },
  towerCap: { name: '塔上限 +1', desc: '质变：可建造塔数上限 +1' },
  skillDoubleCast: { name: '技能二次施放', desc: '质变：主动技能可二次施放' },
  relicControl: { name: '信物可控', desc: '质变：遗物选择可控' },
};

// 成本阶梯（TODO-14 §3 冻结）：数值 Tier1 1~2 核、rank2 3~5 核、机制叶子 12~20 核，整树 ~150~250 核。
// 阶段 0 只落 Tier1 标量 cost（数值 1~2、新节点 cost=1 保 investTalent 的 points/spent 等价 + 零迁移）；
// rank2 递增 cost 与机制叶子 12~20 核由阶段 1 路由读本表落地（本任务不重排经济，见 Notes）。
export const TALENT_COST_LADDER = {
  numeric: { tier1: [1, 2], rank2: [3, 5] },
  leaf: [12, 20],
};

// 每项 effects 的值是「每级增量」；cost/maxRank 固定，rank ∈ [0, maxRank]。
// 数值节点按 TODO-14 拉到「有意义的成长」：+1%/级（约原 +0.1%/级 的 10×），maxRank 2~3、cost 1~2 分档；
// 解锁/质变节点无 effects（effects 为空，talentEffect 有 null 防护），只有 unlocks 机制键，maxRank 1、
// cost 1（阶段 0 占位，最终叶子成本见 TALENT_COST_LADDER）。保留旧 8 节点 id 不变，旧玩家零迁移。
// 最终 % 与叶子成本依赖阶段 2 零 meta 基线重排 + balance 复测（见 docs/TODO.md TODO-14）。
export const TALENT_NODES = [
  // —— 数值层 · 塔系（保留旧 id） ——
  { id: 'tower_atk', name: '百炼锋刃', category: 'tower', tier: 'numeric', cost: 2, maxRank: 3, effects: { dmgAll: 0.01 }, desc: '所有防御塔伤害 +1%（每级）' },
  { id: 'tower_range', name: '鹰隼之眼', category: 'tower', tier: 'numeric', cost: 1, maxRank: 2, effects: { range: 0.1 }, desc: '所有防御塔射程 +0.1 格（每级）' },
  { id: 'tower_cost', name: '精工图纸', category: 'tower', tier: 'numeric', cost: 1, maxRank: 2, effects: { costMul: -0.01 }, desc: '建造与升级费用 -1%（每级）' },

  // —— 数值层 · 技能系（保留旧 id；skillCd/skillPower 已在 EFFECT_REGISTRY 注册，由 skill-system 消费） ——
  { id: 'skill_cd', name: '冥想专注', category: 'skill', tier: 'numeric', cost: 2, maxRank: 3, effects: { skillCd: -0.01 }, desc: '主动技能冷却 -1%（每级）' },
  { id: 'skill_power', name: '奥能增幅', category: 'skill', tier: 'numeric', cost: 2, maxRank: 3, effects: { skillPower: 0.01 }, desc: '主动技能效果幅度 +1%（每级）' },

  // —— 数值层 · 经济系（保留旧 id） ——
  { id: 'economy_gold', name: '敛财术', category: 'economy', tier: 'numeric', cost: 1, maxRank: 2, effects: { goldMul: 0.01 }, desc: '金币收入 +1%（每级）' },
  { id: 'economy_interest', name: '复利精算', category: 'economy', tier: 'numeric', cost: 1, maxRank: 2, effects: { interest: 0.01 }, desc: '波末利息 +1%（每级）' },
  { id: 'economy_kill', name: '战利品学', category: 'economy', tier: 'numeric', cost: 2, maxRank: 3, effects: { killGold: 0.2 }, desc: '击杀金币 +0.2（每级）' },

  // —— 解锁层（机制永驻，maxRank 1） ——
  { id: 'unlock_crit', name: '会心一击', category: 'tower', tier: 'unlock', cost: 1, maxRank: 1, unlocks: ['crit'], desc: '解锁暴击机制（永驻）' },
  { id: 'unlock_armor_pierce', name: '破甲专精', category: 'tower', tier: 'unlock', cost: 1, maxRank: 1, unlocks: ['armorPierce'], desc: '解锁破甲机制（永驻）' },
  { id: 'unlock_chain', name: '连锁反应', category: 'tower', tier: 'unlock', cost: 1, maxRank: 1, unlocks: ['chain'], desc: '解锁连锁机制（永驻）' },
  { id: 'unlock_interest', name: '生财有道', category: 'economy', tier: 'unlock', cost: 1, maxRank: 1, unlocks: ['interest'], desc: '解锁利息机制（永驻）' },

  // —— 质变层（机制永驻，maxRank 1） ——
  { id: 'qual_tower_cap', name: '千军万马', category: 'tower', tier: 'qualitative', cost: 1, maxRank: 1, unlocks: ['towerCap'], desc: '可建造塔数上限 +1' },
  { id: 'qual_skill_double_cast', name: '回响共鸣', category: 'skill', tier: 'qualitative', cost: 1, maxRank: 1, unlocks: ['skillDoubleCast'], desc: '主动技能可二次施放' },
  { id: 'qual_relic_control', name: '信物契约', category: 'economy', tier: 'qualitative', cost: 1, maxRank: 1, unlocks: ['relicControl'], desc: '遗物选择可控' },
];

export const TALENT_ORDER = TALENT_NODES.map((node) => node.id);
export const TALENT_BY_ID = Object.fromEntries(TALENT_NODES.map((node) => [node.id, node]));

const round = (value) => Math.round(value * 1000) / 1000;

// 单节点在指定 rank 下的效果（每个键 = 每级增量 × 等级）；rank 越界时安全收敛。
// 解锁/质变节点无 effects（只有 unlocks），null 防护返回空对象，绝不抛错。
export function talentEffect(nodeId, rank = 0) {
  const node = TALENT_BY_ID[nodeId];
  if (!node) return {};
  const level = Math.max(0, Math.min(node.maxRank, Math.floor(Number(rank) || 0)));
  const effect = {};
  for (const [key, perRank] of Object.entries(node.effects || {})) {
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
// skillCd/skillPower 已在 EFFECT_REGISTRY 注册，故一并折叠进 mods，由 skill-system.js 消费。
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

// 汇总天赋已解锁的机制（unlocks 通道，镜像 talentMods）。只保留 TALENT_MECHANICS 已声明的键；
// 顺序固定（TALENT_NODES 表序、去重），零投入返回空数组。纯函数、零 RNG，不进 sim.mods。
export function talentUnlocks(talent) {
  const state = normalizeTalent(talent);
  const unlocks = [];
  for (const node of TALENT_NODES) {
    const rank = state.nodes[node.id] || 0;
    if (rank <= 0) continue;
    for (const key of node.unlocks || []) {
      if (!(key in TALENT_MECHANICS)) continue;
      if (!unlocks.includes(key)) unlocks.push(key);
    }
  }
  return unlocks;
}
