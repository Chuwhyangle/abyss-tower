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
