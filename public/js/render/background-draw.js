// 背景绘制：远景/雾霭分带、区域过渡带、昼夜色调、天气粒子与生物群系地表道具。
// 纯绘制原语（只碰传入的 canvas context 与 RNG），编排与调用顺序在 background-renderer.js。
import { TILE } from '../shared/data.js';
import { AMBIENCE_TINTS } from '../shared/ambience.js';
import { WEATHER_TYPES, regionTransitionBands } from './background-data.js';
import { Palette } from './palette.js';

const T = TILE;

// 远景山脊 + 雾霭：每层透明度不同，形成静态视差纵深；不覆盖路径与塔位。
export function drawDepthLayers(g, width, height, P, scene, rng) {
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

// 区域过渡带：在区域边界处用低透明度渐变衔接地表氛围，仅高画质绘制。
export function drawRegionTransitions(g, map, width, height, P, scene, decorations) {
  const bands = regionTransitionBands(map, scene, decorations);
  if (!bands.length) return;
  const cell = width / map.cols;
  for (const band of bands) {
    const cx = band.x * cell;
    const half = band.spread * cell;
    const grad = g.createLinearGradient(cx - half, 0, cx + half, 0);
    grad.addColorStop(0, Palette.hexToRgba(P.accent, 0));
    grad.addColorStop(0.5, Palette.hexToRgba(P.accent, band.alpha));
    grad.addColorStop(1, Palette.hexToRgba(P.accent, 0));
    g.fillStyle = grad;
    g.fillRect(cx - half, 0, half * 2, height);
  }
}

// 昼夜色调：全屏低透明度叠加，路径与单位轮廓对比不被压低。
export function drawDayNightTint(g, width, height, phase) {
  const tint = phase || AMBIENCE_TINTS.day;
  g.fillStyle = `rgba(${tint.color}, ${tint.alpha})`;
  g.fillRect(0, 0, width, height);
}

// 天气粒子：只落在路径/塔位排除区之外，且数量受画质预算约束（off 时不绘制）。
export function drawWeather(g, width, height, map, P, rng, spec, excluded) {
  const def = WEATHER_TYPES[spec.weather] || WEATHER_TYPES.rain;
  const count = spec.particles;
  const cols = Math.floor(Number(map?.cols) || 0);
  const rows = Math.floor(Number(map?.rows) || 0);
  if (count <= 0 || cols <= 0 || rows <= 0) return;

  const cellW = width / cols;
  const cellH = height / rows;
  const dropColor = def.color || P.accent;

  for (let i = 0; i < count; i++) {
    const c = rng.int(cols);
    const r = rng.int(rows);
    // 路径及其相邻格不放天气粒子，保证路线与敌人轮廓清晰。
    if (excluded?.has(c * rows + r)) continue;
    const x = (c + rng.float()) * cellW;
    const y = (r + rng.float()) * cellH;

    if (spec.weather === 'fog') {
      const rx = cellW * def.size * (0.5 + rng.float() * 0.6);
      const ry = rx * (0.28 + rng.float() * 0.22);
      g.fillStyle = Palette.hexToRgba(dropColor, def.alpha * (0.5 + rng.float() * 0.5));
      g.beginPath();
      g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      g.fill();
      continue;
    }

    const length = def.size * (spec.weather === 'meteor' ? 7 : 5);
    const dx = Math.cos(def.angle) * length;
    const dy = Math.sin(def.angle) * length;
    g.strokeStyle = Palette.hexToRgba(dropColor, def.alpha * (0.55 + rng.float() * 0.45));
    g.lineWidth = spec.weather === 'meteor' ? def.size * 0.9 : def.size * 0.55;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + dx, y + dy);
    g.stroke();
  }
  g.lineCap = 'butt';
}

// 生物群系地表道具：只画低对比度地贴，塔与单位仍是最清晰的层次。
export function drawBiomeProps(g, map, P, rng, decor, excluded) {
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
    } else if (arch === 'switchback') {
      // 风蚀石柱：斜切层叠薄片 + 风痕
      const h = rng.range(7, 15);
      const w = rng.range(4, 7);
      g.fillStyle = 'rgba(8, 12, 20, 0.35)';
      g.beginPath();
      g.ellipse(x + w * 0.3, y + 4, w * 1.2, w * 0.38, 0, 0, Math.PI * 2);
      g.fill();
      for (let j = 0; j < 3; j++) {
        const yy = y + 3 - (h * j) / 3;
        g.fillStyle = Palette.hexToRgba(P.rock, 0.55 - j * 0.12);
        g.strokeStyle = Palette.hexToRgba(P.rockEdge, 0.45);
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x - w / 2 + j * 1.2, yy);
        g.lineTo(x + w / 2 + j * 1.2, yy - 2.2);
        g.lineTo(x + w * 0.3 + j * 1.2, yy - h * 0.34);
        g.closePath();
        g.fill();
        g.stroke();
      }
      g.strokeStyle = Palette.hexToRgba(P.accent, 0.3);
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(x - w * 0.4, y + 2);
      g.lineTo(x + w * 0.1, y - h * 0.8);
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
