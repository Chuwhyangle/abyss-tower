// 静态背景烘焙：草地、网格、路径、岩石、生物群系地表道具、氛围光点与暗角。
// 只在构造/画质变更时执行，结果是一张离屏 canvas。
import { TILE } from '../shared/data.js';
import { RNG } from '../shared/rng.js';
import { Palette } from './palette.js';

const T = TILE;

// 背景分层顺序（绘制从远到近）。背景只在构造/画质变更时烘焙一次，不进入每帧循环。
export const BACKGROUND_LAYERS = Object.freeze(['far', 'mist', 'ground', 'decor', 'particles']);

// 每个生物群系一套分层定义；颜色仍来自 palette.js，这里只声明层次与预算。
export const BIOME_SCENES = Object.freeze({
  canyon: Object.freeze({
    motif: 'mesa',
    far: Object.freeze({ bands: 3, alpha: 0.05, tilt: 0.18 }),
    mist: Object.freeze({ patches: 4, alpha: 0.035, size: 0.2 }),
    ground: Object.freeze({ moss: 0.12 }),
    decor: Object.freeze({ prop: 'bones', density: 0.55 }),
    particles: Object.freeze({ max: 64, drift: 0.6, size: 2.2 }),
  }),
  twin: Object.freeze({
    motif: 'wetland',
    far: Object.freeze({ bands: 4, alpha: 0.055, tilt: 0.12 }),
    mist: Object.freeze({ patches: 6, alpha: 0.05, size: 0.26 }),
    ground: Object.freeze({ moss: 0.2 }),
    decor: Object.freeze({ prop: 'reed', density: 0.6 }),
    particles: Object.freeze({ max: 72, drift: 0.8, size: 2.4 }),
  }),
  triple: Object.freeze({
    motif: 'rift',
    far: Object.freeze({ bands: 3, alpha: 0.06, tilt: 0.24 }),
    mist: Object.freeze({ patches: 3, alpha: 0.03, size: 0.18 }),
    ground: Object.freeze({ moss: 0.06 }),
    decor: Object.freeze({ prop: 'crack', density: 0.6 }),
    particles: Object.freeze({ max: 58, drift: 0.45, size: 2 }),
  }),
  ring: Object.freeze({
    motif: 'runes',
    far: Object.freeze({ bands: 4, alpha: 0.05, tilt: 0.08 }),
    mist: Object.freeze({ patches: 5, alpha: 0.04, size: 0.24 }),
    ground: Object.freeze({ moss: 0.1 }),
    decor: Object.freeze({ prop: 'rune', density: 0.5 }),
    particles: Object.freeze({ max: 68, drift: 0.7, size: 2.2 }),
  }),
  cross: Object.freeze({
    motif: 'ruins',
    far: Object.freeze({ bands: 3, alpha: 0.045, tilt: 0.2 }),
    mist: Object.freeze({ patches: 4, alpha: 0.032, size: 0.22 }),
    ground: Object.freeze({ moss: 0.08 }),
    decor: Object.freeze({ prop: 'pillar', density: 0.55 }),
    particles: Object.freeze({ max: 60, drift: 0.55, size: 2.1 }),
  }),
});

export function biomeScene(map) {
  return BIOME_SCENES[map?.archetype] || BIOME_SCENES.canyon;
}

// 环境粒子预算：低配约为高配的 35%，off 为 0，未知档位回退低配；数量永不超过场景上限。
export function ambientParticleBudget(decorations, maxCount) {
  const cap = Number.isFinite(maxCount) ? Math.floor(maxCount) : 0;
  if (cap <= 0 || decorations === 'off') return 0;
  if (decorations === 'full') return cap;
  return Math.max(1, Math.round(cap * 0.35));
}

// 装饰排除区：路径格及其一圈相邻格不放置地表道具，保证路线与塔位清晰。
export function decorExclusion(map) {
  const excluded = new Set();
  const rows = map.rows;
  for (const cell of map.pathCells || []) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const c = cell.c + dc;
        const r = cell.r + dr;
        if (c >= 0 && c < map.cols && r >= 0 && r < rows) excluded.add(c * rows + r);
      }
    }
  }
  return excluded;
}

export class BackgroundRenderer {
  constructor(game) {
    this.game = game;
  }

  build({ width, height, dpr, palette, settings }) {
    const game = this.game;
    const map = game.map;
    const bg = document.createElement('canvas');
    bg.width = Math.round(width * dpr);
    bg.height = Math.round(height * dpr);
    const g = bg.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rng = new RNG(game.seed + ':bg');
    const decor = settings.decorations;
    const scene = biomeScene(map);
    const tuftCount = decor === 'off' ? 0 : decor === 'light' ? 90 : 260;
    const pebbleCount = decor === 'off' ? 0 : decor === 'light' ? 60 : 170;
    const chevronStep = decor === 'off' ? Infinity : decor === 'light' ? 4.2 : 2.4;
    const excluded = decorExclusion(map);

    const P = palette;
    g.fillStyle = P.grass2;
    g.fillRect(0, 0, width, height);

    // 草地：色块 + 细微噪声 + 苔藓斑
    for (let r = 0; r < map.rows; r++) {
      for (let c = 0; c < map.cols; c++) {
        g.fillStyle = (c + r) % 2 === 0 ? P.grass1 : P.grass2;
        g.fillRect(c * T, r * T, T, T);
        g.fillStyle = `rgba(255,255,255,${rng.float() * 0.014})`;
        g.fillRect(c * T, r * T, T, T);
        if (rng.float() < scene.ground.moss) {
          g.fillStyle = `rgba(${P.tuft},${0.025 + rng.float() * 0.035})`;
          g.beginPath();
          g.ellipse(
            c * T + rng.range(8, T - 8),
            r * T + rng.range(8, T - 8),
            rng.range(8, 18),
            rng.range(5, 12),
            rng.float() * 3,
            0,
            Math.PI * 2
          );
          g.fill();
        }
      }
    }

    // 远景/雾霭层：低对比度叠在地面之上，路径与装饰随后绘制，保证路线始终最清晰。
    this.drawDepthLayers(g, width, height, P, scene, rng);

    // 细网格
    g.strokeStyle = P.grid;
    g.lineWidth = 1;
    for (let c = 1; c < map.cols; c++) {
      g.beginPath();
      g.moveTo(c * T + 0.5, 0);
      g.lineTo(c * T + 0.5, height);
      g.stroke();
    }
    for (let r = 1; r < map.rows; r++) {
      g.beginPath();
      g.moveTo(0, r * T + 0.5);
      g.lineTo(width, r * T + 0.5);
      g.stroke();
    }

    // 草簇
    for (let i = 0; i < tuftCount; i++) {
      const c = rng.int(map.cols);
      const r = rng.int(map.rows);
      if (!map.buildable[r][c]) continue;
      const x = c * T + rng.range(6, T - 6);
      const y = r * T + rng.range(6, T - 6);
      g.strokeStyle = `rgba(${P.tuft}, ${0.1 + rng.float() * 0.16})`;
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(x, y + 4);
      g.lineTo(x + rng.range(-3, 3), y - rng.range(2, 7));
      g.stroke();
      g.beginPath();
      g.moveTo(x, y + 4);
      g.lineTo(x + rng.range(-4, 4), y - rng.range(1, 5));
      g.stroke();
    }

    // 路径：逐条绘制；共享汇流段会重叠，颜色保持一致
    const lanes = game.lanes.length
      ? game.lanes
      : [{ pts: map.polyline, len: game.pathLen, color: '#5ce2d0' }];
    const strokePath = (pts, w, color) => {
      g.strokeStyle = color;
      g.lineWidth = w;
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.beginPath();
      pts.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
      g.stroke();
    };

    lanes.forEach((lane, laneIndex) => {
      const pts = lane.pts.map((p) => ({ x: p.x * T, y: p.y * T }));
      strokePath(pts, T * 0.94, 'rgba(0,0,0,0.42)');
      strokePath(pts, T * 0.84, P.pathEdge);
      strokePath(pts, T * 0.7, P.path);
      strokePath(pts, T * 0.54, P.pathInner);
      g.save();
      g.globalAlpha = 0.55;
      strokePath(pts, 2.4, P.pathLine);
      g.restore();
      // 多入口时用细线区分路线
      if (lanes.length > 1) {
        g.save();
        g.globalAlpha = 0.3;
        strokePath(pts, 2.2, lane.color);
        g.restore();
      }

      // 路缘石
      if (decor !== 'off') {
        const step = decor === 'light' ? 3.2 : 1.7;
        for (let d = 1; d < lane.len - 0.8; d += step) {
          const p = game.posAt(d, laneIndex);
          const side = rng.float() < 0.5 ? -1 : 1;
          const px = p.x * T + Math.cos(p.angle + Math.PI / 2) * side * T * 0.38;
          const py = p.y * T + Math.sin(p.angle + Math.PI / 2) * side * T * 0.38;
          g.fillStyle = `rgba(${P.tuft},${0.18 + rng.float() * 0.16})`;
          g.beginPath();
          g.ellipse(px, py, rng.range(1.2, 2.8), rng.range(1, 2.2), rng.float() * 3, 0, Math.PI * 2);
          g.fill();
        }
      }

      // 路面碎石
      const pebbles = Math.ceil(pebbleCount / lanes.length);
      for (let i = 0; i < pebbles; i++) {
        const d = rng.float() * lane.len;
        const p = game.posAt(d, laneIndex);
        const ox = rng.range(-0.24, 0.24) * T;
        const oy = rng.range(-0.24, 0.24) * T;
        g.fillStyle = Palette.hexToRgba(P.rockEdge, 0.12 + rng.float() * 0.18);
        g.beginPath();
        g.ellipse(p.x * T + ox, p.y * T + oy, rng.range(1, 3.2), rng.range(0.8, 2.2), rng.float() * 3, 0, Math.PI * 2);
        g.fill();
      }

      // 行进方向箭头
      for (let d = 1.6; d < lane.len - 1; d += chevronStep) {
        const p = game.posAt(d, laneIndex);
        g.save();
        g.translate(p.x * T, p.y * T);
        g.rotate(p.angle);
        g.strokeStyle = 'rgba(196, 168, 126, 0.16)';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(-4, -6);
        g.lineTo(3, 0);
        g.lineTo(-4, 6);
        g.stroke();
        g.restore();
      }
    });

    // 岩石
    for (const rock of map.rocks) {
      const x = (rock.c + 0.5) * T;
      const y = (rock.r + 0.5) * T;
      const s = rock.size * T;
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.beginPath();
      g.ellipse(x, y + s * 0.35, s * 0.9, s * 0.4, 0, 0, Math.PI * 2);
      g.fill();
      g.save();
      g.translate(x, y);
      g.rotate(rock.rot);
      g.fillStyle = P.rock;
      g.strokeStyle = P.rockEdge;
      g.lineWidth = 1.5;
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const rad = s * (i % 2 === 0 ? 1 : 0.78);
        const px = Math.cos(a) * rad;
        const py = Math.sin(a) * rad * 0.85;
        i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
      }
      g.closePath();
      g.fill();
      g.stroke();
      // 苔藓/高光
      g.fillStyle = Palette.hexToRgba(P.accent, 0.14);
      g.beginPath();
      g.ellipse(-s * 0.15, -s * 0.3, s * 0.45, s * 0.2, -0.4, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }

    // 生物群系地表遗迹：不同原型各自的氛围道具
    if (decor !== 'off') this.drawBiomeProps(g, map, P, rng, decor, excluded);

    // 生物群系氛围光点：数量由场景上限与画质档位共同约束（低配约 35%）。
    const motes = ambientParticleBudget(decor, scene.particles.max);
    for (let i = 0; i < motes; i++) {
      const x = rng.float() * width;
      const y = rng.float() * height;
      g.fillStyle = `${P.ambient}${0.035 + rng.float() * 0.06})`;
      g.beginPath();
      g.arc(x, y, rng.range(0.8, scene.particles.size), 0, Math.PI * 2);
      g.fill();
    }

    // 边缘暗角
    const vignette = g.createRadialGradient(
      width / 2,
      height / 2,
      Math.min(width, height) * 0.35,
      width / 2,
      height / 2,
      Math.max(width, height) * 0.72
    );
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.5)');
    g.fillStyle = vignette;
    g.fillRect(0, 0, width, height);

    return bg;
  }

  // 远景山脊 + 雾霭：每层透明度不同，形成静态视差纵深；不覆盖路径与塔位。
  drawDepthLayers(g, width, height, P, scene, rng) {
    const { far, mist } = scene;

    const sky = g.createLinearGradient(0, 0, 0, height * 0.62);
    sky.addColorStop(0, Palette.hexToRgba(P.grass2, Math.min(0.82, 0.5 + far.alpha * 5)));
    sky.addColorStop(1, Palette.hexToRgba(P.grass2, 0));
    g.fillStyle = sky;
    g.fillRect(0, 0, width, height * 0.62);

    const steps = 12;
    for (let band = 0; band < far.bands; band++) {
      const baseY = height * (0.08 + band * 0.11);
      const amp = height * (0.015 + band * 0.007);
      const alpha = far.alpha * (1 - band * 0.16);
      g.fillStyle = Palette.hexToRgba(P.accent, alpha);
      g.beginPath();
      g.moveTo(0, baseY);
      for (let i = 0; i <= steps; i++) {
        const x = (i / steps) * width;
        const y =
          baseY +
          Math.sin(i * 1.7 + band * 2.3 + rng.float() * 0.6) * amp +
          far.tilt * height * 0.015 * (i / steps - 0.5);
        g.lineTo(x, y);
      }
      g.lineTo(width, baseY + height * 0.2);
      g.lineTo(0, baseY + height * 0.2);
      g.closePath();
      g.fill();
    }

    for (let i = 0; i < mist.patches; i++) {
      const x = rng.float() * width;
      const y = height * (0.22 + rng.float() * 0.56);
      const rx = width * mist.size * (0.5 + rng.float() * 0.7);
      const ry = rx * (0.26 + rng.float() * 0.22);
      g.fillStyle = Palette.hexToRgba(P.accent, mist.alpha * (0.6 + rng.float() * 0.8));
      g.beginPath();
      g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      g.fill();
    }
  }

  // 生物群系地表道具：只画低对比度地贴，塔与单位仍是最清晰的层次。
  drawBiomeProps(g, map, P, rng, decor, excluded) {
    const arch = map.archetype || 'canyon';
    const count = decor === 'light' ? 6 : 14;

    for (let i = 0; i < count; i++) {
      const c = rng.int(map.cols);
      const r = rng.int(map.rows);
      if (!map.buildable?.[r]?.[c]) continue;
      // 路径与其相邻格不放置地贴，避免挡住路线和塔位。
      if (excluded?.has(c * map.rows + r)) continue;
      const x = c * T + rng.range(0.25, 0.75) * T;
      const y = r * T + rng.range(0.25, 0.75) * T;

      if (arch === 'twin') {
        // 潮湿洼地 + 芦苇
        const rx = rng.range(10, 18);
        const ry = rng.range(5, 9);
        g.fillStyle = Palette.hexToRgba(P.accent, 0.09);
        g.beginPath();
        g.ellipse(x, y, rx, ry, rng.float() * 0.6, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = Palette.hexToRgba(P.accent, 0.16);
        g.lineWidth = 1;
        g.stroke();
        g.strokeStyle = Palette.hexToRgba(P.tuft, 0.22);
        g.lineWidth = 1.2;
        for (let j = 0; j < 3; j++) {
          const bx = x + rng.range(-rx * 0.7, rx * 0.7);
          g.beginPath();
          g.moveTo(bx, y + ry * 0.6);
          g.lineTo(bx + rng.range(-2, 2), y - rng.range(6, 12));
          g.stroke();
        }
      } else if (arch === 'triple') {
        // 地裂与余烬
        g.strokeStyle = 'rgba(24, 12, 10, 0.55)';
        g.lineWidth = 2;
        g.beginPath();
        let px = x - rng.range(8, 14);
        let py = y + rng.range(-4, 4);
        g.moveTo(px, py);
        for (let j = 0; j < 4; j++) {
          px += rng.range(5, 9);
          py += rng.range(-5, 5);
          g.lineTo(px, py);
        }
        g.stroke();
        g.strokeStyle = Palette.hexToRgba(P.accent, 0.28);
        g.lineWidth = 1;
        g.stroke();
      } else if (arch === 'ring') {
        // 浮空符文石
        const s = rng.range(4, 7);
        g.fillStyle = 'rgba(10, 8, 18, 0.45)';
        g.beginPath();
        g.ellipse(x, y + s * 0.9, s * 0.9, s * 0.35, 0, 0, Math.PI * 2);
        g.fill();
        g.save();
        g.translate(x, y);
        g.rotate(rng.range(-0.25, 0.25));
        g.fillStyle = Palette.hexToRgba(P.rock, 0.9);
        g.strokeStyle = Palette.hexToRgba(P.rockEdge, 0.7);
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(-s * 0.7, s);
        g.lineTo(-s * 0.5, -s);
        g.lineTo(s * 0.5, -s);
        g.lineTo(s * 0.7, s);
        g.closePath();
        g.fill();
        g.stroke();
        g.strokeStyle = Palette.hexToRgba(P.accent, 0.5);
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(0, -s * 0.1, s * 0.32, 0, Math.PI * 2);
        g.moveTo(-s * 0.32, -s * 0.1);
        g.lineTo(s * 0.32, -s * 0.1);
        g.stroke();
        g.restore();
      } else if (arch === 'cross') {
        // 断柱与碎石
        const h = rng.range(6, 13);
        const w = rng.range(5, 8);
        g.fillStyle = 'rgba(12, 10, 6, 0.35)';
        g.beginPath();
        g.ellipse(x + 2, y + 4, w * 1.1, w * 0.4, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = Palette.hexToRgba(P.rock, 0.85);
        g.strokeStyle = Palette.hexToRgba(P.rockEdge, 0.6);
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x - w / 2, y + 4);
        g.lineTo(x - w / 2, y - h);
        g.lineTo(x - w / 4, y - h + 3);
        g.lineTo(x + w / 4, y - h - 2);
        g.lineTo(x + w / 2, y - h + 2);
        g.lineTo(x + w / 2, y + 4);
        g.closePath();
        g.fill();
        g.stroke();
        g.strokeStyle = 'rgba(0, 0, 0, 0.25)';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x + w * 0.15, y + 3);
        g.lineTo(x + w * 0.15, y - h + 4);
        g.stroke();
      } else {
        // 骸骨与残骸
        g.strokeStyle = 'rgba(206, 200, 182, 0.24)';
        g.lineWidth = 1.4;
        g.lineCap = 'round';
        for (let j = 0; j < 2; j++) {
          const bx = x + rng.range(-8, 8);
          const by = y + rng.range(-5, 5);
          const a = rng.float() * Math.PI;
          g.beginPath();
          g.moveTo(bx - Math.cos(a) * 6, by - Math.sin(a) * 6);
          g.lineTo(bx + Math.cos(a) * 6, by + Math.sin(a) * 6);
          g.stroke();
        }
        g.fillStyle = 'rgba(206, 200, 182, 0.2)';
        g.beginPath();
        g.arc(x + rng.range(-6, 6), y + rng.range(-4, 4), 2.2, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.lineCap = 'butt';
  }
}
