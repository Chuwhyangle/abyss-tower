// 教义（§6）：五条塔专精通过首领核心选择、不可逆；对某一种塔的全部塔生效（已建与后续新建）。
// 纯数据 + 纯函数：无 DOM、无 Math.random、不 import sim/render，前后端共用。
// 依赖方向：doctrines.js 不依赖其他业务模块，无循环。

// 教义 id 清单（§6.2）：导出名与冻结表 §8.1 逐符号对齐。
export const DOCTRINE_IDS = ['bolt', 'cannon', 'frost', 'arc', 'poison'];

// 每局最多接受次数（§6.1）。
export const DOCTRINE_MAX_PER_RUN = 2;

// 教义 -> 生效塔类型（§6.2）：bolt 教义作用于弩塔（arrow），其余与塔 id 同名。
export const DOCTRINE_BY_TOWER_TYPE = Object.freeze({
  bolt: 'arrow',
  cannon: 'cannon',
  frost: 'frost',
  arc: 'arc',
  poison: 'poison',
});

// 塔类型 -> 教义 id（反向索引，供结算/渲染按塔类型查教义）。
export const TOWER_TYPE_DOCTRINE = Object.freeze({
  arrow: 'bolt',
  cannon: 'cannon',
  frost: 'frost',
  arc: 'arc',
  poison: 'poison',
});

// 五条教义定义（§6.2）。名称与描述文案走 i18n 的 doctrine.<id>.name / doctrine.<id>.desc；
// glyph/color 只作表现（塔身徽记、HUD 图标、弹道光环），不参与结算。
export const DOCTRINES = Object.freeze({
  bolt: Object.freeze({
    id: 'bolt', towerType: 'arrow', nameKey: 'doctrine.bolt.name', descKey: 'doctrine.bolt.desc', glyph: '➤', color: '#8fe0a8',
  }),
  cannon: Object.freeze({
    id: 'cannon', towerType: 'cannon', nameKey: 'doctrine.cannon.name', descKey: 'doctrine.cannon.desc', glyph: '🔥', color: '#f0a35e',
  }),
  frost: Object.freeze({
    id: 'frost', towerType: 'frost', nameKey: 'doctrine.frost.name', descKey: 'doctrine.frost.desc', glyph: '❄', color: '#7cd4f5',
  }),
  arc: Object.freeze({
    id: 'arc', towerType: 'arc', nameKey: 'doctrine.arc.name', descKey: 'doctrine.arc.desc', glyph: '⚡', color: '#b48cff',
  }),
  poison: Object.freeze({
    id: 'poison', towerType: 'poison', nameKey: 'doctrine.poison.name', descKey: 'doctrine.poison.desc', glyph: '☣', color: '#9adf6a',
  }),
});

// 局内教义记录（§8.2）：快照里只保留 doctrineId 数组；非法/未知 id 剔除、去重且保持选择顺序。
export function normalizeDoctrineIds(ids) {
  const out = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    if (typeof id !== 'string' || !DOCTRINES[id]) continue;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

// 教义结算（§6.1/§6.2）：不可逆、不叠加、每局最多 2 条。
// doctrineId 可为教义 id 字符串，也可为核心选项载荷 { doctrineId }。
// 返回 { ok, reason, state, event }；state 为结算后的完整状态（含 wave/doctrines），
// event 为 §8.3 的 doctrine_chosen 事件。选择失败（未知/重复/超上限）时不消耗选择。
export function applyDoctrine(state = {}, doctrineId) {
  const raw = typeof doctrineId === 'object' ? doctrineId?.doctrineId : doctrineId;
  const id = typeof raw === 'string' ? raw : null;
  const def = DOCTRINES[id];
  if (!def) return { ok: false, reason: 'unknown', state: null, event: null };
  const wave = Math.max(0, Math.floor(Number(state?.wave) || 0));
  const doctrines = normalizeDoctrineIds(state?.doctrines || []);
  if (doctrines.includes(id)) return { ok: false, reason: 'duplicate', state: null, event: null };
  if (doctrines.length >= DOCTRINE_MAX_PER_RUN) return { ok: false, reason: 'max', state: null, event: null };
  return {
    ok: true,
    reason: null,
    state: { wave, doctrines: [...doctrines, id] },
    event: { type: 'doctrine_chosen', wave, id, towerType: def.towerType },
  };
}

// doctrineId -> 生效塔类型；未知 id 返回 null。
export function doctrineTowerType(id) {
  const def = DOCTRINES[id];
  return def ? def.towerType : null;
}
