// 觉醒（§7）：四条 Ⅲ 级遗物行为词条，通过首领核心选择获得、每件遗物最多 1 条、不消耗原遗物。
// 纯数据 + 纯函数：无 DOM、无 Math.random、不 import sim/render，前后端共用。
// 依赖方向：awakenings.js -> data/relics.js，不反向，无循环。

// 觉醒 id 清单（§7.2）：导出名与冻结表 §8.1 逐符号对齐。
export const AWAKENING_IDS = ['sharp-pierce', 'powder-ignite', 'frostheart-shatter', 'toxin-spread'];

// 遗物 -> 觉醒 id（反向索引：每件遗物最多 1 条觉醒）。
const RELIC_AWAKENING = Object.freeze({
  sharp: 'sharp-pierce',
  powder: 'powder-ignite',
  frostheart: 'frostheart-shatter',
  toxin: 'toxin-spread',
});

// 四条觉醒定义（§7.2）。名称与描述文案走 i18n 的 awakening.<id>.name / awakening.<id>.desc；
// 触发口径（每第 6 发 / 命中 5 次 / 减速死亡 / 中毒死亡）由各结算点按 §7.2 落地。
export const AWAKENINGS = Object.freeze({
  'sharp-pierce': Object.freeze({
    id: 'sharp-pierce',
    relicId: 'sharp',
    nameKey: 'awakening.sharp-pierce.name',
    descKey: 'awakening.sharp-pierce.desc',
  }),
  'powder-ignite': Object.freeze({
    id: 'powder-ignite',
    relicId: 'powder',
    nameKey: 'awakening.powder-ignite.name',
    descKey: 'awakening.powder-ignite.desc',
  }),
  'frostheart-shatter': Object.freeze({
    id: 'frostheart-shatter',
    relicId: 'frostheart',
    nameKey: 'awakening.frostheart-shatter.name',
    descKey: 'awakening.frostheart-shatter.desc',
  }),
  'toxin-spread': Object.freeze({
    id: 'toxin-spread',
    relicId: 'toxin',
    nameKey: 'awakening.toxin-spread.name',
    descKey: 'awakening.toxin-spread.desc',
  }),
});

// 遗物 -> 觉醒定义 | null（§8.1）。非觉醒遗物或未知遗物返回 null。
export function awakeningFor(relicId) {
  const id = RELIC_AWAKENING[relicId];
  return id ? AWAKENINGS[id] : null;
}

// 局内觉醒记录（§8.2）：快照只保留 { relicId, id }；非法/未知 id 剔除、去重且保持选择顺序。
export function normalizeAwakenings(records) {
  const out = [];
  const seen = new Set();
  for (const record of Array.isArray(records) ? records : []) {
    if (!record || typeof record !== 'object') continue;
    const id = typeof record.id === 'string' ? record.id : record.awakeningId;
    const def = AWAKENINGS[id];
    if (!def) continue;
    if (seen.has(def.relicId)) continue;
    seen.add(def.relicId);
    out.push({ relicId: def.relicId, id: def.id });
  }
  return out;
}

// 觉醒结算（§7.1/§8.1/§8.3）：不可逆、同一遗物不重复、不消耗原遗物。
// relicId 可为遗物 id 字符串，也可为核心选项载荷 { relicId }（目标等级由服务端把关）。
// 返回 { ok, reason, state, event }；state 为结算后的完整状态（含 wave/awakenings），
// event 为 §8.3 的 awakening_gained 事件。选择失败（未知/重复）时不消耗选择。
export function applyAwakening(state = {}, relicId) {
  const raw = typeof relicId === 'object' ? relicId?.relicId : relicId;
  const def = awakeningFor(typeof raw === 'string' ? raw : null);
  if (!def) return { ok: false, reason: 'unknown', state: null, event: null };
  const wave = Math.max(0, Math.floor(Number(state?.wave) || 0));
  const awakenings = normalizeAwakenings(state?.awakenings || []);
  if (awakenings.some((entry) => entry.relicId === def.relicId)) {
    return { ok: false, reason: 'duplicate', state: null, event: null };
  }
  return {
    ok: true,
    reason: null,
    state: { wave, awakenings: [...awakenings, { relicId: def.relicId, id: def.id }] },
    event: { type: 'awakening_gained', wave, relicId: def.relicId, id: def.id },
  };
}
