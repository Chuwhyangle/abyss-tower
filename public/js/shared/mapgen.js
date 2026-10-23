// 地图生成：多入口/汇流路径图、6 种原型、地图词缀与三候选。
import { RNG } from './rng.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const LANE_COLORS = ['#5ce2d0', '#ffd36b', '#ff6b8a'];
const MAX_SPAWNS = 3;

export const ARCHETYPES = {
  canyon: {
    id: 'canyon', name: '单径峡谷', spawns: 1, wind: 0.45, scoreMul: 0.95,
    desc: '一条主路，塔位充足，适合稳定构筑。',
  },
  twin: {
    id: 'twin', name: '双径汇流', spawns: 2, wind: 0.42, scoreMul: 0.97,
    desc: '两条入口在中段汇合，汇流点是黄金火力点。',
  },
  triple: {
    id: 'triple', name: '三径裂隙', spawns: 3, wind: 0.38, scoreMul: 1.07,
    desc: '三路同时施压，考验覆盖与取舍。',
  },
  ring: {
    id: 'ring', name: '环形回廊', spawns: 2, wind: 0.6, scoreMul: 1.02,
    desc: '两条长回廊绕行后汇合，适合减速与持续输出。',
  },
  cross: {
    id: 'cross', name: '交叉回廊', spawns: 2, wind: 0.4, scoreMul: 1.1,
    desc: '两路先汇合再分叉到基地，需要二次分配火力。',
  },
  switchback: {
    id: 'switchback', name: '折返长廊', spawns: 1, wind: 0.52, scoreMul: 1.0,
    desc: '单入口反复折返，直线火力难以覆盖全程，需要沿路分段布防。',
  },
};

export const MAP_MODIFIERS = [
  {
    id: 'rich', name: '富矿', color: '#ffd36b',
    desc: '金币收入 +20%，敌人生命 +10%',
    hpMul: 1.1, speedMul: 1, goldMul: 1.2, rangeMul: 1, scoreMul: 0.95, extraPortal: 0,
  },
  {
    id: 'swift', name: '疾风', color: '#5fb6ea',
    desc: '敌人移速 +14%，击杀金币 +12%',
    hpMul: 1, speedMul: 1.14, goldMul: 1.12, rangeMul: 1, scoreMul: 1.0, extraPortal: 0,
  },
  {
    id: 'mist', name: '薄雾', color: '#b48cff',
    desc: '防御塔射程 -8%，最终分数 +5%',
    hpMul: 1, speedMul: 1, goldMul: 1, rangeMul: 0.92, scoreMul: 1.05, extraPortal: 0,
  },
  {
    id: 'rift', name: '裂界', color: '#ff6b8a',
    desc: '额外一个入口，金币收入 +10%',
    hpMul: 1.05, speedMul: 1.03, goldMul: 1.1, rangeMul: 1, scoreMul: 1.05, extraPortal: 1,
  },
  {
    id: 'armored', name: '重甲', color: '#8f9bb3',
    desc: '敌人生命 +18%、移速 -4%，击杀金币 +10%',
    hpMul: 1.18, speedMul: 0.96, goldMul: 1.1, rangeMul: 1, scoreMul: 1.06, extraPortal: 0,
  },
  {
    id: 'bounty', name: '悬赏', color: '#f2a65a',
    desc: '击杀金币 +28%，最终分数 -4%',
    hpMul: 1, speedMul: 1, goldMul: 1.28, rangeMul: 1, scoreMul: 0.96, extraPortal: 0,
  },
  {
    id: 'vista', name: '远眺', color: '#7fd1ae',
    desc: '防御塔射程 +12%，击杀金币 -6%',
    hpMul: 1, speedMul: 1, goldMul: 0.94, rangeMul: 1.12, scoreMul: 0.97, extraPortal: 0,
  },
  {
    id: 'surge', name: '涌潮', color: '#6fa8ff',
    desc: '敌人移速 +22%，击杀金币 +15%',
    hpMul: 1, speedMul: 1.22, goldMul: 1.15, rangeMul: 1, scoreMul: 1.07, extraPortal: 0,
  },
];

export const MODIFIER_BY_ID = Object.fromEntries(MAP_MODIFIERS.map((m) => [m.id, m]));

// 候选地图的原型与词缀排列：同种子完全一致。
// 每日挑战复用本函数派生当日词缀，RNG 调用顺序不可改动。
export function candidatePlan(seed, count = 3) {
  const rng = new RNG(`${seed}:candidates`);
  const ids = rng
    .shuffle(Object.keys(ARCHETYPES))
    .slice(0, Math.min(count, Object.keys(ARCHETYPES).length));
  if (!ids.some((id) => id === 'canyon' || id === 'twin')) {
    ids[ids.length - 1] = rng.float() < 0.5 ? 'canyon' : 'twin';
  }
  const modifierPool = rng.shuffle(MAP_MODIFIERS);
  return { ids, modifierPool };
}

// 三张候选地图：同种子完全一致；至少包含一张低复杂度地图。
export function generateMapCandidates(seed, count = 3, cols = 22, rows = 12) {
  const { ids, modifierPool } = candidatePlan(seed, count);
  const candidates = [];
  for (let i = 0; i < count; i++) {
    const archetypeId = ids[i % ids.length];
    const modifier = modifierPool[i % modifierPool.length];
    const candidate = buildCandidate(
      `${seed}:candidate:${i}`,
      archetypeId,
      modifier,
      i,
      cols,
      rows
    );
    candidates.push(candidate);
  }
  return candidates;
}

// 兼容旧调用：单入口峡谷地图。
export function generateMap(seed, cols = 22, rows = 12) {
  return buildCandidate(`${seed}:legacy`, 'canyon', null, 0, cols, rows);
}

export function buildCandidate(seed, archetypeId, modifier, index, cols = 22, rows = 12) {
  const archetype = ARCHETYPES[archetypeId] || ARCHETYPES.canyon;
  const rng = new RNG(`${seed}:layout`);
  let layout = null;
  for (let attempt = 0; attempt < 140 && !layout; attempt++) {
    layout = buildLayout(rng, archetype, modifier || null, cols, rows);
  }
  if (!layout) layout = fallbackLayout(archetype, modifier || null, cols, rows);
  return finalize(seed, index, archetype, modifier || null, layout, cols, rows);
}

function buildLayout(rng, archetype, modifier, cols, rows) {
  const spawnCount = Math.max(
    1,
    Math.min(MAX_SPAWNS, archetype.spawns + (modifier?.extraPortal || 0))
  );
  const base = { c: cols - 1, r: 3 + rng.int(Math.max(1, rows - 6)) };
  const merge =
    spawnCount > 1
      ? { c: cols - 5 - rng.int(3), r: 2 + rng.int(Math.max(1, rows - 4)) }
      : base;

  let trunk = null;
  let branches = null;

  if (spawnCount > 1) {
    if (archetype.id === 'cross') {
      // 先汇合，再分成两条支路到基地；三入口时复用两条支路
      branches = [];
      const blocked = new Set();
      for (let i = 0; i < 2; i++) {
        const branch = carve(rng, cols, rows, merge, base, blocked, {
          sep: true,
          wind: 0.25,
          maxLen: 30,
        }) || carve(rng, cols, rows, merge, base, blocked, {
          sep: false,
          wind: 0.25,
          maxLen: 30,
        });
        if (!branch) return null;
        branches.push(branch);
        for (const cell of branch) blocked.add(cellKey(cell, rows));
      }
      trunk = branches[0];
    } else {
      trunk = carve(rng, cols, rows, merge, base, new Set(), {
        sep: false,
        wind: 0.25,
        maxLen: 30,
      });
      if (!trunk) return null;
    }
  }

  const spawnRows = pickSpawnRows(rng, rows, spawnCount);
  const blocked = new Set();
  for (const cell of trunk || []) blocked.add(cellKey(cell, rows));
  if (branches) {
    for (const branch of branches) {
      for (const cell of branch) blocked.add(cellKey(cell, rows));
    }
  }

  const lanes = [];
  for (let i = 0; i < spawnCount; i++) {
    const spawn = { c: 0, r: spawnRows[i] };
    const target = spawnCount === 1 ? base : merge;
    let path = carve(rng, cols, rows, spawn, target, blocked, {
      sep: true,
      wind: archetype.wind,
      maxLen: 64,
    });
    if (!path) {
      path = carve(rng, cols, rows, spawn, target, blocked, {
        sep: false,
        wind: archetype.wind,
        maxLen: 64,
      });
    }
    if (!path) return null;

    let cells;
    if (spawnCount === 1) {
      cells = path;
    } else if (branches) {
      cells = dedupeCells(path.concat(branches[i % branches.length].slice(1)));
    } else {
      cells = dedupeCells(path.concat(trunk.slice(1)));
    }
    if (cells.length < Math.max(8, Math.floor(cols * 0.45))) return null;

    // 交叉回廊的入口路径允许彼此重叠：三条入口都挤在汇流点左侧，
    // 后一条若被前一条整段占格，会在小网格上无路可走（裂界三入口）。
    if (!branches) for (const cell of cells) blocked.add(cellKey(cell, rows));
    lanes.push({ spawn, cells });
  }

  // 路径长度差不要过大，避免某一路必漏
  const lengths = lanes.map((lane) => lane.cells.length);
  if (Math.min(...lengths) < 8) return null;
  if (Math.max(...lengths) > Math.min(...lengths) * 2.2) return null;

  const pathSet = new Set();
  for (const lane of lanes) for (const cell of lane.cells) pathSet.add(cellKey(cell, rows));

  const freeCells = cols * rows - pathSet.size;
  if (freeCells < cols * rows * 0.36) return null;

  return { lanes, base, merge, pathSet, spawnCount, archetype, modifier };
}

function finalize(seed, index, archetype, modifier, layout, cols, rows) {
  const rocks = [];
  const blocked = Array.from({ length: rows }, () => Array(cols).fill(false));
  const buildable = Array.from({ length: rows }, () => Array(cols).fill(false));
  const rng = new RNG(`${seed}:decor`);
  const pathSet = layout.pathSet;
  const wanted = Math.min(10, Math.floor(cols * rows * 0.045));
  let placed = 0;
  for (let tries = 0; tries < 500 && placed < wanted; tries++) {
    const c = 1 + rng.int(cols - 2);
    const r = 1 + rng.int(rows - 2);
    if (pathSet.has(c * rows + r) || blocked[r][c]) continue;
    if (isAdjacentToPath(pathSet, c, r, rows)) continue;
    blocked[r][c] = true;
    rocks.push({ c, r, size: 0.26 + rng.float() * 0.14, rot: rng.float() * Math.PI * 2 });
    placed++;
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      buildable[r][c] = !pathSet.has(c * rows + r) && !blocked[r][c];
    }
  }

  const lanes = layout.lanes.map((lane, i) => {
    const simplified = simplify(lane.cells);
    const polyline = simplified.map((p) => ({ x: p.c + 0.5, y: p.r + 0.5 }));
    return {
      id: i,
      spawnId: i,
      color: LANE_COLORS[i % LANE_COLORS.length],
      cells: lane.cells,
      polyline,
      length: polylineLength(polyline),
    };
  });

  const spawns = lanes.map((lane, i) => ({
    id: i,
    c: lane.cells[0].c,
    r: lane.cells[0].r,
    x: lane.cells[0].c + 0.5,
    y: lane.cells[0].r + 0.5,
    color: lane.color,
    laneId: i,
  }));

  const baseCell = layout.base;
  const pathCells = [];
  for (const key of pathSet) pathCells.push({ c: Math.floor(key / rows), r: key % rows });

  const meta = {
    archetype: archetype.id,
    archetypeName: archetype.name,
    portalCount: spawns.length,
    modifier: modifier ? { ...modifier } : null,
    scoreMul: Math.round(
      Math.max(0.9, Math.min(1.25, archetype.scoreMul * (modifier?.scoreMul || 1))) * 100
    ) / 100,
    merge: layout.merge ? { c: layout.merge.c, r: layout.merge.r } : null,
  };

  return {
    index,
    seed,
    cols,
    rows,
    archetype: archetype.id,
    archetypeName: archetype.name,
    modifier: modifier ? { ...modifier } : null,
    meta,
    lanes,
    spawns,
    base: {
      c: baseCell.c,
      r: baseCell.r,
      x: baseCell.c + 0.5,
      y: baseCell.r + 0.5,
    },
    pathCells,
    // 兼容旧代码/旧存档：单入口字段指向第一条路
    polyline: lanes[0].polyline,
    spawn: spawns[0],
    blocked,
    buildable,
    rocks,
  };
}

function carve(rng, cols, rows, start, target, blocked, { sep = true, wind = 0.45, maxLen = 80 } = {}) {
  const key = (c, r) => c * rows + r;
  const startKey = key(start.c, start.r);
  const targetKey = key(target.c, target.r);
  const stack = [{ c: start.c, r: start.r }];
  const inPath = new Set([startKey]);
  const visited = new Set([startKey]);
  let steps = 0;

  while (stack.length && steps++ < 6000) {
    const cur = stack[stack.length - 1];
    if (cur.c === target.c && cur.r === target.r) {
      return stack.map((p) => ({ c: p.c, r: p.r }));
    }
    if (stack.length > maxLen) {
      const dead = stack.pop();
      inPath.delete(key(dead.c, dead.r));
      continue;
    }

    const cands = [];
    for (const [dc, dr] of rng.shuffle(DIRS)) {
      const c = cur.c + dc;
      const r = cur.r + dr;
      if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
      const k = key(c, r);
      if (visited.has(k) || inPath.has(k)) continue;
      if (k !== targetKey && blocked.has(k)) continue;

      if (sep && k !== targetKey) {
        let touches = false;
        for (const [ddc, ddr] of DIRS) {
          const nc = c + ddc;
          const nr = r + ddr;
          if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
          if (nc === cur.c && nr === cur.r) continue;
          if (nc === start.c && nr === start.r) continue;
          if (blocked.has(key(nc, nr))) {
            touches = true;
            break;
          }
        }
        if (touches) continue;
      }
      cands.push({ c, r, k });
    }

    if (!cands.length) {
      const dead = stack.pop();
      inPath.delete(key(dead.c, dead.r));
      continue;
    }

    let next = null;
    const right = cands.find((cell) => cell.c === cur.c + 1);
    if (right && rng.float() < 1 - wind) next = right;
    if (!next) next = cands[rng.int(cands.length)];

    inPath.add(next.k);
    visited.add(next.k);
    stack.push({ c: next.c, r: next.r });
  }
  return null;
}

function pickSpawnRows(rng, rows, count) {
  if (count === 1) return [2 + rng.int(Math.max(1, rows - 4))];
  if (count === 2) {
    const first = 1 + rng.int(3);
    const second = rows - 2 - rng.int(3);
    return [first, Math.max(first + 3, Math.min(rows - 2, second))];
  }
  const mid = Math.floor(rows / 2) + rng.int(2) - 1;
  return [1 + rng.int(2), Math.max(2, Math.min(rows - 3, mid)), rows - 2 - rng.int(2)];
}

function fallbackLayout(archetype, modifier, cols, rows) {
  const cells = serpentine(cols, rows);
  const spawn = cells[0];
  const base = cells[cells.length - 1];
  return {
    lanes: [{ spawn, cells }],
    base,
    merge: null,
    pathSet: new Set(cells.map((p) => p.c * rows + p.r)),
    spawnCount: 1,
    archetype,
    modifier,
  };
}

function serpentine(cols, rows) {
  const cells = [];
  const rowList = [];
  for (let r = 1; r <= rows - 3; r += 2) rowList.push(r);
  if (rowList.length % 2 === 0) rowList.pop();
  let prevEndCol = 0;
  rowList.forEach((r, i) => {
    if (i === 0) {
      for (let c = 0; c < cols; c++) cells.push({ c, r });
      prevEndCol = cols - 1;
    } else {
      const prevRow = rowList[i - 1];
      for (let rr = prevRow + 1; rr <= r; rr++) cells.push({ c: prevEndCol, r: rr });
      if (prevEndCol === cols - 1) {
        for (let c = cols - 2; c >= 0; c--) cells.push({ c, r });
        prevEndCol = 0;
      } else {
        for (let c = 1; c < cols; c++) cells.push({ c, r });
        prevEndCol = cols - 1;
      }
    }
  });
  return cells;
}

function simplify(cells) {
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

function dedupeCells(cells) {
  const seen = new Set();
  const out = [];
  for (const cell of cells) {
    const key = `${cell.c},${cell.r}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cell);
  }
  return out;
}

function polylineLength(polyline) {
  let length = 0;
  for (let i = 1; i < polyline.length; i++) {
    length += Math.hypot(polyline[i].x - polyline[i - 1].x, polyline[i].y - polyline[i - 1].y);
  }
  return length;
}

function cellKey(cell, rows) {
  return cell.c * rows + cell.r;
}

function isAdjacentToPath(pathSet, c, r, rows) {
  for (const [dc, dr] of DIRS) {
    if (pathSet.has((c + dc) * rows + (r + dr))) return true;
  }
  return false;
}
