// 三张固定手工地图的数据入口。
// 顺序固定为 canyon → twin → ring；几何全部写死，不使用 RNG。
import { CANYON_SPEC } from './canyon.js';
import { TWIN_SPEC } from './twin.js';
import { RING_SPEC } from './ring.js';
import { buildFixedMap, cloneMapData, deepFreeze } from './rasterize.js';

const SPECS = [CANYON_SPEC, TWIN_SPEC, RING_SPEC];

// 模块级常量：深冻结，任何调用方都无法篡改后续对局的地图。
export const FIXED_MAPS = deepFreeze(
  SPECS.map((spec, index) => buildFixedMap({ ...spec, index }))
);

export const FIXED_MAP_BY_ID = deepFreeze(
  Object.fromEntries(FIXED_MAPS.map((map) => [map.id, map]))
);

// 固定 trait（无 trait 的地图不参与），schema 与 MAP_MODIFIERS 一致。
export const FIXED_TRAITS = deepFreeze(
  FIXED_MAPS.map((map) => map.modifier).filter((trait) => trait != null)
);

// 候选地图：无论种子如何，都返回同一组固定地图的独立副本。
// seed 参数只为调用方兼容保留，不参与几何生成。
export function fixedMapCandidates(_seed) {
  return FIXED_MAPS.map((map) => cloneMapData(map));
}
