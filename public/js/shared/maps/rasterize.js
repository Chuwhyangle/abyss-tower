// 固定地图栅格化：把 lane 的 waypoints（[c,r] 数组）展开成 4 邻接 cell 序列，
// 产出与旧 mapgen（随机 carve）完全兼容的地图对象。
// 纯数据、纯函数，不调用 RNG；同一份 spec 每次输出完全一致。
import { validateDestructibles } from '../destructibles.js';

// 与旧 mapgen 保持一致的 lane 配色（渲染层按 lane 取色）。
export const LANE_COLORS = ['#5ce2d0', '#ffd36b', '#ff6b8a'];

// 单条 lane 的最短格数：低于该值对手方来不及布防，视为数据错误。
const MIN_PATH_CELLS = 9;

const SCORE_MUL_MIN = 0.9;
const SCORE_MUL_MAX = 1.25;

// 逐图敌人生命补偿倍率：难图 <1（降 HP）、易图 >1（升 HP），用于收敛逐图通关率。
// 只作用在敌人血量上，不参与计分；与固定 trait 的 hpMul 相乘后生效。
const HP_MUL_MIN = 0.8;
const HP_MUL_MAX = 1.2;

export class MapSpecError extends Error {
  constructor(reason, detail = {}) {
    super(`固定地图数据非法：${reason}${detail.detail ? `（${detail.detail}）` : ''}`);
    this.name = 'MapSpecError';
    this.reason = reason;
    Object.assign(this, detail);
  }
}

function isCellInBounds(cell, cols, rows) {
  return (
    Array.isArray(cell) &&
    cell.length === 2 &&
    Number.isInteger(cell[0]) &&
    Number.isInteger(cell[1]) &&
    cell[0] >= 0 &&
    cell[0] < cols &&
    cell[1] >= 0 &&
    cell[1] < rows
  );
}

// waypoints → 4 邻接 cell 列表。
// 校验：越界、相邻 waypoint 非同行同列（斜线/跳跃）、重复点（含自交）、最短长度。
export function rasterizeLane(waypoints, cols, rows, { label = 'lane', minCells = MIN_PATH_CELLS } = {}) {
  if (!Array.isArray(waypoints) || waypoints.length < 2) {
    throw new MapSpecError('waypoints-invalid', { label, detail: '至少需要两个 waypoint' });
  }
  waypoints.forEach((point, index) => {
    if (!isCellInBounds(point, cols, rows)) {
      throw new MapSpecError('waypoint-out-of-bounds', {
        label,
        index,
        detail: `${JSON.stringify(point)} 不在 ${cols}×${rows} 网格内`,
      });
    }
  });

  const cells = [{ c: waypoints[0][0], r: waypoints[0][1] }];
  const seen = new Set([cellKey(cells[0], rows)]);

  for (let index = 1; index < waypoints.length; index++) {
    const from = cells[cells.length - 1];
    const [toC, toR] = waypoints[index];
    const dc = Math.sign(toC - from.c);
    const dr = Math.sign(toR - from.r);

    if (dc === 0 && dr === 0) {
      throw new MapSpecError('duplicate-waypoint', {
        label,
        index,
        detail: `waypoint ${index} 与前一个点重复`,
      });
    }
    // 4 邻接要求每一段都沿单一轴向推进；斜线段无法逐格栅格化。
    if (dc !== 0 && dr !== 0) {
      throw new MapSpecError('non-4-adjacent-waypoint', {
        label,
        index,
        detail: `${JSON.stringify(waypoints[index - 1])} → ${JSON.stringify(waypoints[index])} 不是水平/垂直段`,
      });
    }

    let { c, r } = from;
    while (c !== toC || r !== toR) {
      c += dc;
      r += dr;
      const cell = { c, r };
      const key = cellKey(cell, rows);
      if (seen.has(key)) {
        throw new MapSpecError('duplicate-cell', {
          label,
          index,
          detail: `路径重复经过 (${c},${r})`,
        });
      }
      seen.add(key);
      cells.push(cell);
    }
  }

  if (cells.length < minCells) {
    throw new MapSpecError('path-too-short', {
      label,
      detail: `${cells.length} < ${minCells} 格`,
    });
  }

  return cells;
}

// 完整 map 对象：字段与旧 generateMap 的返回值一一对应（lanes/spawns/base/
// pathCells/polyline/spawn/blocked/buildable/rocks/meta）。
export function buildFixedMap(spec) {
  if (!spec || typeof spec !== 'object') {
    throw new MapSpecError('spec-invalid', { detail: 'spec 必须是对象' });
  }
  const { id, name, cols, rows } = spec;
  if (typeof id !== 'string' || !id) throw new MapSpecError('id-invalid', { detail: String(id) });
  if (typeof name !== 'string' || !name) {
    throw new MapSpecError('name-invalid', { id, detail: String(name) });
  }
  if (!Number.isInteger(cols) || cols <= 0 || !Number.isInteger(rows) || rows <= 0) {
    throw new MapSpecError('grid-invalid', { id, detail: `${cols}×${rows}` });
  }
  if (!Array.isArray(spec.lanes) || spec.lanes.length === 0) {
    throw new MapSpecError('lanes-invalid', { id, detail: '至少需要一条 lane' });
  }

  const scoreMul = roundScoreMul(spec.scoreMul, id);
  const hpMul = roundHpMul(spec.hpMul, id);
  const baseWaypoint = spec.base;
  if (!isCellInBounds(baseWaypoint, cols, rows)) {
    throw new MapSpecError('base-out-of-bounds', { id, detail: JSON.stringify(baseWaypoint) });
  }
  const baseCell = { c: baseWaypoint[0], r: baseWaypoint[1] };

  const laneCells = spec.lanes.map((lane, index) =>
    rasterizeLane(lane.waypoints, cols, rows, { label: `${id}.lane${index}` })
  );

  // 所有 lane 必须收束到基地；否则 sim 的漏怪结算与 polyline 终点无意义。
  laneCells.forEach((cells, index) => {
    const last = cells[cells.length - 1];
    if (last.c !== baseCell.c || last.r !== baseCell.r) {
      throw new MapSpecError('lane-not-ending-at-base', {
        id,
        lane: index,
        detail: `(${last.c},${last.r}) ≠ 基地 (${baseCell.c},${baseCell.r})`,
      });
    }
  });

  const pathSet = new Set();
  for (const cells of laneCells) for (const cell of cells) pathSet.add(cellKey(cell, rows));

  const merge = normalizeMerge(spec.merge, id, laneCells, cols, rows, pathSet);

  const rocks = normalizeBlockers(spec.rocks, id, 'rocks', pathSet, cols, rows).map((rock) => ({
    c: rock.c,
    r: rock.r,
    size: normalizeRockSize(rock.size, id),
    rot: normalizeRockRot(rock.rot, id),
  }));
  const blockers = normalizeBlockers(spec.blockers, id, 'blockers', pathSet, cols, rows);

  const rockKeys = new Set(rocks.map((rock) => cellKey(rock, rows)));
  for (const cell of blockers) {
    if (rockKeys.has(cellKey(cell, rows))) {
      throw new MapSpecError('blocker-overlaps-rock', {
        id,
        detail: `(${cell.c},${cell.r})`,
      });
    }
  }

  const destructibles = cloneMapData(spec.destructibles ?? []);
  if (!Array.isArray(destructibles)) {
    throw new MapSpecError('destructibles-invalid', { id, detail: '必须是数组' });
  }

  // blocked 只记岩石与固定阻挡（路径不记 blocked，这与旧 finalize 一致）。
  const blocked = Array.from({ length: rows }, () => Array(cols).fill(false));
  for (const cell of rocks) blocked[cell.r][cell.c] = true;
  for (const cell of blockers) blocked[cell.r][cell.c] = true;

  // 手写塔位掩码：固定地图声明 buildableMask 时取代「全图可建」，
  // 只开放掩码格 + 可破坏物占格（可破坏物拆除后由模拟层恢复该格可建）。
  // 未声明掩码的旧 spec / 合成地图回退到「非路径且非阻挡即可建」，与旧行为一致。
  const maskCells = normalizeBuildableMask(
    spec.buildableMask,
    id,
    pathSet,
    blocked,
    destructibles,
    cols,
    rows
  );
  const maskKeys = maskCells ? new Set(maskCells.map((cell) => cellKey(cell, rows))) : null;
  const destructibleKeys = new Set(destructibles.map((cell) => cellKey(cell, rows)));

  const buildable = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) =>
      maskKeys
        ? maskKeys.has(c * rows + r) || destructibleKeys.has(c * rows + r)
        : !pathSet.has(c * rows + r) && !blocked[r][c]
    )
  );

  const lanes = laneCells.map((cells, index) => {
    const polyline = simplifyCells(cells).map((cell) => ({ x: cell.c + 0.5, y: cell.r + 0.5 }));
    return {
      id: index,
      spawnId: index,
      color: LANE_COLORS[index % LANE_COLORS.length],
      cells,
      polyline,
      length: polylineLength(polyline),
    };
  });

  const spawns = lanes.map((lane, index) => ({
    id: index,
    c: lane.cells[0].c,
    r: lane.cells[0].r,
    x: lane.cells[0].c + 0.5,
    y: lane.cells[0].r + 0.5,
    color: lane.color,
    laneId: index,
  }));
  spawns.forEach((spawn, index) => {
    const duplicate = spawns.findIndex(
      (other, otherIndex) => otherIndex < index && other.c === spawn.c && other.r === spawn.r
    );
    if (duplicate !== -1) {
      throw new MapSpecError('duplicate-spawn', {
        id,
        detail: `入口 ${index} 与入口 ${duplicate} 重合`,
      });
    }
  });

  // 汇流后多条 lane 共享同一段主干：pathCells 按首次经过去重（与旧 finalize 的 Set 一致）。
  const pathCells = [];
  for (const key of pathSet) pathCells.push({ c: Math.floor(key / rows), r: key % rows });

  const trait = spec.trait ? cloneMapData(spec.trait) : null;
  const archetype = spec.archetype || id;
  const meta = {
    archetype,
    archetypeName: spec.archetypeName || name,
    portalCount: spawns.length,
    modifier: trait ? cloneMapData(trait) : null,
    scoreMul,
    hpMul,
    merge,
  };

  const map = {
    id,
    name,
    desc: spec.desc || '',
    seed: `fixed:${id}`,
    index: Number.isInteger(spec.index) ? spec.index : 0,
    cols,
    rows,
    archetype,
    archetypeName: meta.archetypeName,
    modifier: trait ? cloneMapData(trait) : null,
    trait: trait ? cloneMapData(trait) : null,
    meta,
    lanes,
    spawns,
    base: { c: baseCell.c, r: baseCell.r, x: baseCell.c + 0.5, y: baseCell.r + 0.5 },
    pathCells,
    // 兼容旧代码/旧存档：单入口字段指向第一条路。
    polyline: lanes[0].polyline,
    spawn: spawns[0],
    blocked,
    buildable,
    rocks,
    blockers,
    // 固定可破坏物布点：terrain 的 buildable 不扣除它们，占用/可建判定由模拟层（MAP-004）按存活状态决定。
    destructibles,
  };

  // 布点一旦声明就必须自洽：未声明布点的旧 spec / 合成地图不做额外要求。
  if (destructibles.length > 0) {
    const check = validateDestructibles(map);
    if (!check.ok) {
      const first = check.errors[0];
      const label = first.id ?? first.index ?? '';
      throw new MapSpecError('destructibles-invalid', {
        id,
        detail: `${label} ${first.code}${first.detail ? ` ${first.detail}` : ''}`.trim(),
      });
    }
  }

  return map;
}

// 折线只保留拐点与端点（与旧 mapgen 的 simplify 行为一致）。
export function simplifyCells(cells) {
  const out = [];
  for (let i = 0; i < cells.length; i++) {
    if (i === 0 || i === cells.length - 1) {
      out.push(cells[i]);
      continue;
    }
    const a = cells[i - 1];
    const b = cells[i];
    const c = cells[i + 1];
    const d1c = Math.sign(b.c - a.c);
    const d1r = Math.sign(b.r - a.r);
    const d2c = Math.sign(c.c - b.c);
    const d2r = Math.sign(c.r - b.r);
    if (d1c !== d2c || d1r !== d2r) out.push(b);
  }
  return out;
}

export function polylineLength(polyline) {
  let length = 0;
  for (let i = 1; i < polyline.length; i++) {
    length += Math.hypot(polyline[i].x - polyline[i - 1].x, polyline[i].y - polyline[i - 1].y);
  }
  return length;
}

// 纯数据深拷贝：固定地图是模块级常量，调用方拿到的是独立副本。
export function cloneMapData(value) {
  if (Array.isArray(value)) return value.map(cloneMapData);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = cloneMapData(item);
    return out;
  }
  return value;
}

export function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function normalizeMerge(merge, id, laneCells, cols, rows, pathSet) {
  if (laneCells.length === 1) {
    if (merge != null) {
      throw new MapSpecError('merge-invalid', { id, detail: '单入口地图不应声明汇流点' });
    }
    return null;
  }
  if (!isCellInBounds(merge, cols, rows)) {
    throw new MapSpecError('merge-invalid', { id, detail: JSON.stringify(merge) });
  }
  const point = { c: merge[0], r: merge[1] };
  if (!pathSet.has(cellKey(point, rows))) {
    throw new MapSpecError('merge-not-on-path', { id, detail: JSON.stringify(merge) });
  }
  laneCells.forEach((cells, index) => {
    if (!cells.some((cell) => cell.c === point.c && cell.r === point.r)) {
      throw new MapSpecError('merge-not-on-lane', {
        id,
        lane: index,
        detail: `汇流点不在 lane ${index} 上`,
      });
    }
  });
  return point;
}

function normalizeBlockers(list, id, field, pathSet, cols, rows) {
  if (list == null) return [];
  if (!Array.isArray(list)) {
    throw new MapSpecError(`${field}-invalid`, { id, detail: '必须是数组' });
  }
  const seen = new Set();
  return list.map((item, index) => {
    const cell = Array.isArray(item) ? item : [item.c, item.r];
    if (!isCellInBounds(cell, cols, rows)) {
      throw new MapSpecError(`${field}-out-of-bounds`, { id, index, detail: JSON.stringify(cell) });
    }
    const key = cellKey({ c: cell[0], r: cell[1] }, rows);
    if (pathSet.has(key)) {
      throw new MapSpecError(`${field}-on-path`, { id, index, detail: `(${cell[0]},${cell[1]})` });
    }
    if (seen.has(key)) {
      throw new MapSpecError(`${field}-duplicate`, { id, index, detail: `(${cell[0]},${cell[1]})` });
    }
    seen.add(key);
    return field === 'rocks'
      ? { c: cell[0], r: cell[1], size: item.size, rot: item.rot }
      : { c: cell[0], r: cell[1] };
  });
}

// 手写塔位掩码：固定地图声明 buildableMask 时取代「全图可建」。
// 掩码格必须落在界内、不压路径、不压岩石/阻挡、不占可破坏物格、不重复；
// 「偏少（15~25）」与「贴路为主」是平衡目标，由地图作者与回归测试把关，不在此硬编码。
function normalizeBuildableMask(mask, id, pathSet, blocked, destructibles, cols, rows) {
  if (mask == null) return null;
  if (!Array.isArray(mask) || mask.length === 0) {
    throw new MapSpecError('buildableMask-invalid', { id, detail: '掩码必须是非空数组' });
  }
  const seen = new Set();
  const destructibleKeys = new Set(destructibles.map((cell) => cellKey(cell, rows)));
  return mask.map((cell, index) => {
    const point = Array.isArray(cell) ? cell : [cell?.c, cell?.r];
    if (!isCellInBounds(point, cols, rows)) {
      throw new MapSpecError('buildableMask-out-of-bounds', { id, index, detail: JSON.stringify(point) });
    }
    const c = point[0];
    const r = point[1];
    const key = cellKey({ c, r }, rows);
    if (pathSet.has(key)) {
      throw new MapSpecError('buildableMask-on-path', { id, index, detail: `(${c},${r})` });
    }
    if (blocked[r][c]) {
      throw new MapSpecError('buildableMask-on-blocked', { id, index, detail: `(${c},${r})` });
    }
    if (destructibleKeys.has(key)) {
      throw new MapSpecError('buildableMask-on-destructible', { id, index, detail: `(${c},${r})` });
    }
    if (seen.has(key)) {
      throw new MapSpecError('buildableMask-duplicate', { id, index, detail: `(${c},${r})` });
    }
    seen.add(key);
    return { c, r };
  });
}

function normalizeRockSize(size, id) {
  const value = Number(size);
  if (!Number.isFinite(value) || value <= 0 || value > 0.6) {
    throw new MapSpecError('rock-size-invalid', { id, detail: String(size) });
  }
  return Math.round(value * 1000) / 1000;
}

function normalizeRockRot(rot, id) {
  const value = Number(rot);
  if (!Number.isFinite(value)) {
    throw new MapSpecError('rock-rot-invalid', { id, detail: String(rot) });
  }
  return value;
}

function roundScoreMul(value, id) {
  const scoreMul = Number(value);
  if (!Number.isFinite(scoreMul)) {
    throw new MapSpecError('scoreMul-invalid', { id, detail: String(value) });
  }
  const rounded = Math.round(scoreMul * 100) / 100;
  if (rounded < SCORE_MUL_MIN || rounded > SCORE_MUL_MAX) {
    throw new MapSpecError('scoreMul-out-of-range', { id, detail: String(scoreMul) });
  }
  return rounded;
}

function roundHpMul(value, id) {
  // 缺省视为 1（不补偿），旧 spec / 合成地图无需声明 hpMul。
  const hpMul = value == null ? 1 : Number(value);
  if (!Number.isFinite(hpMul)) {
    throw new MapSpecError('hpMul-invalid', { id, detail: String(value) });
  }
  const rounded = Math.round(hpMul * 100) / 100;
  if (rounded < HP_MUL_MIN || rounded > HP_MUL_MAX) {
    throw new MapSpecError('hpMul-out-of-range', { id, detail: String(hpMul) });
  }
  return rounded;
}

function cellKey(cell, rows) {
  return cell.c * rows + cell.r;
}
