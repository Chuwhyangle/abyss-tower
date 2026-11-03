// 可破坏物数据模型：五种固定场景物件的类型定义、拆除效果（纯数据）与布点校验。
// 只依赖纯数据与纯函数，不引用模拟层/渲染层：
//   - 本任务（MAP-003）负责类型数值与三张图的写死布点；
//   - MAP-004 从 map.destructibles 深拷贝运行时状态，按 type 取这里的 effect；
//   - MAP-005 用 name/glyph/color/desc 做渲染与确认面板。
// 一局内以布点 id 为唯一键：所有固定布点 id 全局唯一，重复拆除同一 id 不产生第二次效果。
//
// 资源矿脉（feat-attackable-tiles）是第二条路径「塔攻击掉血」的可攻击地块：有 HP、不可花金币
// 拆除、破坏后按 seed+波次确定性掉落金币。它与五种固定物件分属不同注册表（不进 DESTRUCTIBLE_TYPES，
// 避免波及 UI/精灵/文案按五类遍历的既有测试），但共用同一套占格/拆除状态框架。
import { hashString } from './rng.js';

// 布点与出生点/基地的最小距离（切比雪夫距离：斜向相邻也算 1 格）。
export const MIN_SPAWN_DISTANCE = 2;

// 五种类型：顺序固定，UI、文档与测试按此顺序遍历。
export const DESTRUCTIBLE_TYPES = Object.freeze([
  Object.freeze({
    id: 'vein',
    name: '金脉',
    glyph: '💎',
    color: '#ffd36b',
    desc: '岩层里裸露的金脉，花 50 金拆除后立刻获得 110 金。',
    cost: 50,
    effect: Object.freeze({ gold: 110 }),
  }),
  Object.freeze({
    id: 'obelisk',
    name: '石碑',
    glyph: '🪨',
    color: '#c4b5fd',
    desc: '古老石碑，花 70 金拆除后全塔伤害永久 +5%（每局最多叠 3 层）。',
    cost: 70,
    effect: Object.freeze({ towerDamageMul: 0.05, maxStacks: 3 }),
  }),
  Object.freeze({
    id: 'cache',
    name: '补给箱',
    glyph: '📦',
    color: '#7dd3fc',
    desc: '废弃补给箱，免费拆除，获得 25 金并回复 1 点基地生命（不超过上限）。',
    cost: 0,
    effect: Object.freeze({ gold: 25, baseHp: 1 }),
  }),
  Object.freeze({
    id: 'nest',
    name: '虫巢',
    glyph: '🥚',
    color: '#84cc16',
    desc: '免费拆除，但会立刻在巢穴位置钻出 6 只当前波次的噬虫；腾出的格子可以建塔。',
    cost: 0,
    effect: Object.freeze({ spawn: Object.freeze({ enemy: 'swarm', count: 6 }) }),
  }),
  Object.freeze({
    id: 'totem',
    name: '诅咒图腾',
    glyph: '🔮',
    color: '#ff6b8a',
    desc: '存活时所有敌人移速 +8%、生命 +10%；花 80 金拆除后光环立即解除。',
    cost: 80,
    effect: Object.freeze({ aura: Object.freeze({ enemySpeedMul: 1.08, enemyHpMul: 1.1 }) }),
  }),
]);

// 类型注册表：type id → 类型定义（与 HEX_BY_ID 同构）。
export const DESTRUCTIBLE_BY_ID = Object.freeze(
  Object.fromEntries(DESTRUCTIBLE_TYPES.map((type) => [type.id, type]))
);

// 资源矿脉：可被塔攻击的资源地块（第二条路径）。无 cost = 不可花金币拆除；hp 为被塔攻击的血量。
// goldMin/goldMax 是掉落区间的纯数据（实际金额由 resourceVeinGold 按 seed+波次确定性派生）。
export const RESOURCE_VEIN_TYPE = Object.freeze({
  id: 'resourceVein',
  name: '资源矿脉',
  glyph: '💰',
  color: '#fbbf24',
  desc: '富含金币的矿脉，塔在无敌人时会自动攻击，破坏后掉落金币。',
  hp: 140,
  goldMin: 60,
  goldMax: 120,
});

// 可攻击地块注册表：type id → 类型定义（与 DESTRUCTIBLE_BY_ID 同构，只是不含五类固定物件）。
export const ATTACKABLE_BY_ID = Object.freeze({
  [RESOURCE_VEIN_TYPE.id]: RESOURCE_VEIN_TYPE,
});

// 布点 → 类型定义（五类固定物件优先，其次可攻击地块）；未知类型返回 null。
export function destructibleTypeOf(placement) {
  if (!placement || typeof placement !== 'object') return null;
  return DESTRUCTIBLE_BY_ID[placement.type] ?? ATTACKABLE_BY_ID[placement.type] ?? null;
}

// 是否可免费拆除（补给箱/虫巢）；未知类型一律视为不可免费，避免免费白嫖未知物件。
export function isFreeDestructible(placement) {
  const type = destructibleTypeOf(placement);
  return type != null && type.cost === 0;
}

// 类型定义是否可被塔攻击（有正数 hp）。
export function isAttackableType(type) {
  return type != null && Number.isFinite(type.hp) && type.hp > 0;
}

// 资源矿脉掉落金额：seed + 波次 + 矿脉 id 确定性派生（hashString 取模区间），不消耗 combatRng。
export function resourceVeinGold(seed, wave, veinId) {
  const min = RESOURCE_VEIN_TYPE.goldMin;
  const span = RESOURCE_VEIN_TYPE.goldMax - min + 1;
  const h = hashString(`${seed}:resourceVein:${wave}:${veinId}`)();
  return min + (h % span);
}

// 纯函数：把一次拆除落到「已拆除 id 列表」上。
// 同一 id 第二次调用返回 already-destroyed 且不追加 —— 一局内效果只生效一次（幂等）。
export function markDestroyed(destroyedIds, id) {
  const current = Array.isArray(destroyedIds) ? [...destroyedIds] : [];
  if (typeof id !== 'string' || id === '') {
    return { ok: false, reason: 'id-invalid', destroyed: current };
  }
  if (current.includes(id)) {
    return { ok: false, reason: 'already-destroyed', destroyed: current };
  }
  return { ok: true, reason: 'destroyed', destroyed: [...current, id] };
}

function cellDistance(a, b) {
  return Math.max(Math.abs(a.c - b.c), Math.abs(a.r - b.r));
}

function onPath(map, c, r) {
  if (Array.isArray(map.pathCells)) return map.pathCells.some((cell) => cell.c === c && cell.r === r);
  // 旧存档/合成地图可能只带 buildable 矩阵：路径格不可建造。
  return map.buildable?.[r]?.[c] === false;
}

// 单件校验：类型、格坐标、地形（路径/岩石/基地/出生点）、与出生点/基地的距离、
// 以及同图内的 id 与格子唯一性。返回 { ok, errors: [{ code, detail }] }。
export function validateDestructible(obj, map) {
  if (!map || typeof map !== 'object' || !Number.isInteger(map.cols) || !Number.isInteger(map.rows)) {
    return { ok: false, errors: [{ code: 'map-invalid', detail: '地图缺少 cols/rows' }] };
  }
  if (!obj || typeof obj !== 'object') {
    return { ok: false, errors: [{ code: 'obj-invalid', detail: String(obj) }] };
  }

  const errors = [];
  const fail = (code, detail) => errors.push({ code, detail });

  if (typeof obj.id !== 'string' || obj.id === '') fail('id-invalid', String(obj.id));
  if (!destructibleTypeOf(obj)) fail('type-unknown', String(obj.type));

  if (!Number.isInteger(obj.c) || !Number.isInteger(obj.r)) {
    fail('cell-invalid', `${obj.c},${obj.r}`);
  } else {
    const { c, r } = obj;
    if (c < 0 || c >= map.cols || r < 0 || r >= map.rows) {
      fail('out-of-bounds', `(${c},${r})`);
    } else {
      if (onPath(map, c, r)) fail('on-path', `(${c},${r})`);
      if (map.blocked?.[r]?.[c]) fail('on-blocker', `(${c},${r})`);
      if (map.buildable?.[r]?.[c] === false && !onPath(map, c, r)) {
        fail('not-buildable', `(${c},${r})`);
      }
      if (map.base && map.base.c === c && map.base.r === r) fail('on-base', `(${c},${r})`);
      const spawns = Array.isArray(map.spawns) ? map.spawns : [];
      if (spawns.some((spawn) => spawn.c === c && spawn.r === r)) fail('on-spawn', `(${c},${r})`);
      for (const spawn of spawns) {
        if (cellDistance(obj, spawn) < MIN_SPAWN_DISTANCE) {
          fail('too-close-to-spawn', `(${c},${r}) 距出生点 ${cellDistance(obj, spawn)} 格`);
          break;
        }
      }
      if (map.base && cellDistance(obj, map.base) < MIN_SPAWN_DISTANCE) {
        fail('too-close-to-base', `(${c},${r}) 距基地 ${cellDistance(obj, map.base)} 格`);
      }
    }
  }

  const siblings = Array.isArray(map.destructibles) ? map.destructibles : [];
  if (siblings.filter((item) => item && item.id === obj.id).length > 1) {
    fail('duplicate-id', String(obj.id));
  }
  if (
    Number.isInteger(obj.c) &&
    Number.isInteger(obj.r) &&
    siblings.filter((item) => item && item.c === obj.c && item.r === obj.r).length > 1
  ) {
    fail('duplicate-cell', `(${obj.c},${obj.r})`);
  }

  return { ok: errors.length === 0, errors };
}

// 整图校验：逐件校验 + 每张图至少一个可免费拆除的物件。
// 空布点地图（旧 spec / 合成地图）不要求免费物件，只有真正声明了布点的地图才检查。
export function validateDestructibles(map, { requireFree = true } = {}) {
  if (!map || !Array.isArray(map.destructibles)) {
    return { ok: false, errors: [{ code: 'destructibles-invalid', detail: '地图缺少 destructibles 数组' }] };
  }
  const errors = [];
  map.destructibles.forEach((obj, index) => {
    for (const error of validateDestructible(obj, map).errors) {
      errors.push({ index, id: obj?.id ?? null, ...error });
    }
  });
  if (requireFree && map.destructibles.length > 0 && !map.destructibles.some(isFreeDestructible)) {
    errors.push({ code: 'no-free-destructible', detail: '每张图至少需要一个可免费拆除的物件' });
  }
  return { ok: errors.length === 0, errors };
}
