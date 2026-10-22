// 地图生成：从左边缘随机游走到右边缘，保证路径不自交、不贴身。
import { RNG } from './rng.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function generateMap(seed, cols = 22, rows = 12) {
  const rng = new RNG(seed + ':map');
  let cells = null;

  for (let attempt = 0; attempt < 80 && !cells; attempt++) {
    cells = carvePath(rng, cols, rows, 1 + rng.int(rows - 2));
  }
  if (!cells) cells = serpentine(cols, rows);

  cells = simplify(cells);
  if (cells.length < 3) cells = serpentine(cols, rows);

  const inPath = new Set(cells.map((p) => p.c * rows + p.r));
  const blocked = Array.from({ length: rows }, () => Array(cols).fill(false));
  const buildable = Array.from({ length: rows }, () => Array(cols).fill(false));

  // 障碍物：只放在非路径格，数量适中，避免把可建造区域切碎。
  const decorRng = new RNG(seed + ':decor');
  const wanted = Math.min(10, Math.floor(cols * rows * 0.045));
  let placed = 0;
  for (let tries = 0; tries < 400 && placed < wanted; tries++) {
    const c = 1 + decorRng.int(cols - 2);
    const r = 1 + decorRng.int(rows - 2);
    if (inPath.has(c * rows + r) || blocked[r][c]) continue;
    if ((c === 0 && r === 0) || (c === cols - 1 && r === rows - 1)) continue;
    blocked[r][c] = true;
    placed++;
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      buildable[r][c] = !inPath.has(c * rows + r) && !blocked[r][c];
    }
  }

  const polyline = cells.map((p) => ({ x: p.c + 0.5, y: p.r + 0.5 }));
  const rocks = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (blocked[r][c]) {
        rocks.push({
          c, r,
          size: 0.26 + decorRng.float() * 0.14,
          rot: decorRng.float() * Math.PI * 2,
        });
      }
    }
  }

  return {
    seed,
    cols,
    rows,
    pathCells: cells,
    polyline,
    spawn: polyline[0],
    base: polyline[polyline.length - 1],
    blocked,
    buildable,
    rocks,
  };
}

function carvePath(rng, cols, rows, startRow) {
  const key = (c, r) => c * rows + r;
  const start = { c: 0, r: startRow };
  const stack = [start];
  const inPath = new Set([key(start.c, start.r)]);
  const visited = new Set([key(start.c, start.r)]);
  let steps = 0;
  const maxSteps = cols * rows * 8;

  while (stack.length && steps++ < maxSteps) {
    const cur = stack[stack.length - 1];
    if (cur.c === cols - 1) {
      return stack.map((p) => ({ c: p.c, r: p.r }));
    }

    const cands = [];
    for (const [dc, dr] of DIRS) {
      const c = cur.c + dc;
      const r = cur.r + dr;
      if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
      const k = key(c, r);
      if (visited.has(k) || inPath.has(k)) continue;

      // 新格子不能与已存在的路径相邻（当前格除外），避免通道贴在一起。
      let touches = false;
      for (const [ddc, ddr] of DIRS) {
        const nc = c + ddc;
        const nr = r + ddr;
        if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
        if (nc === cur.c && nr === cur.r) continue;
        if (inPath.has(key(nc, nr))) { touches = true; break; }
      }
      if (touches) continue;
      cands.push({ c, r });
    }

    if (!cands.length) {
      const dead = stack.pop();
      inPath.delete(key(dead.c, dead.r));
      continue;
    }

    let next = null;
    if (rng.float() < 0.55) next = cands.find((p) => p.c === cur.c + 1) || null;
    if (!next) next = cands[rng.int(cands.length)];

    inPath.add(key(next.c, next.r));
    visited.add(key(next.c, next.r));
    stack.push(next);
  }
  return null;
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

// 兜底：规则蛇形路径，一定可玩。
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
