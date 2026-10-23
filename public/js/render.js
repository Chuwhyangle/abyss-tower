// Canvas 渲染：静态地图预渲染 + 动态单位/特效绘制。
import { TILE, TOWERS, ENEMIES } from './shared/data.js';
import { RNG } from './shared/rng.js';
import { normalizeSettings } from './settings.js';

const T = TILE;

export class Renderer {
  constructor(canvas, game, settings = {}) {
    this.canvas = canvas;
    this.game = game;
    this.ctx = canvas.getContext('2d');
    this.settings = normalizeSettings(settings);
    this.W = game.map.cols * T;
    this.H = game.map.rows * T;
    this.palette = biomePalette(game.map);
    this.applyDpr();
    this.time = 0;
    this.fpsFrames = 0;
    this.fpsSince = 0;
    this.fps = 60;
    this.bg = this.buildBackground();
  }

  applyDpr() {
    this.dpr = Math.min(this.settings.dpr, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.canvas.style.aspectRatio = `${this.W} / ${this.H}`;
  }

  applySettings(settings) {
    const next = normalizeSettings(settings);
    const needsRebuild =
      next.dpr !== this.settings.dpr || next.decorations !== this.settings.decorations;
    this.settings = next;
    if (needsRebuild) {
      this.palette = biomePalette(this.game.map);
      this.applyDpr();
      this.bg = this.buildBackground();
    }
  }

  buildBackground() {
    const map = this.game.map;
    const dpr = this.dpr;
    const bg = document.createElement('canvas');
    bg.width = Math.round(this.W * dpr);
    bg.height = Math.round(this.H * dpr);
    const g = bg.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rng = new RNG(this.game.seed + ':bg');
    const decor = this.settings.decorations;
    const tuftCount = decor === 'off' ? 0 : decor === 'light' ? 90 : 260;
    const pebbleCount = decor === 'off' ? 0 : decor === 'light' ? 60 : 170;
    const chevronStep = decor === 'off' ? Infinity : decor === 'light' ? 4.2 : 2.4;

    const P = (this.palette = biomePalette(map));
    g.fillStyle = P.grass2;
    g.fillRect(0, 0, this.W, this.H);

    // 草地：色块 + 细微噪声 + 苔藓斑
    for (let r = 0; r < map.rows; r++) {
      for (let c = 0; c < map.cols; c++) {
        g.fillStyle = (c + r) % 2 === 0 ? P.grass1 : P.grass2;
        g.fillRect(c * T, r * T, T, T);
        g.fillStyle = `rgba(255,255,255,${rng.float() * 0.014})`;
        g.fillRect(c * T, r * T, T, T);
        if (rng.float() < 0.12) {
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

    // 细网格
    g.strokeStyle = P.grid;
    g.lineWidth = 1;
    for (let c = 1; c < map.cols; c++) {
      g.beginPath();
      g.moveTo(c * T + 0.5, 0);
      g.lineTo(c * T + 0.5, this.H);
      g.stroke();
    }
    for (let r = 1; r < map.rows; r++) {
      g.beginPath();
      g.moveTo(0, r * T + 0.5);
      g.lineTo(this.W, r * T + 0.5);
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
    const lanes = this.game.lanes.length
      ? this.game.lanes
      : [{ pts: map.polyline, len: this.game.pathLen, color: '#5ce2d0' }];
    const strokePath = (pts, width, color) => {
      g.strokeStyle = color;
      g.lineWidth = width;
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
          const p = this.game.posAt(d, laneIndex);
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
        const p = this.game.posAt(d, laneIndex);
        const ox = rng.range(-0.24, 0.24) * T;
        const oy = rng.range(-0.24, 0.24) * T;
        g.fillStyle = hexToRgba(P.rockEdge, 0.12 + rng.float() * 0.18);
        g.beginPath();
        g.ellipse(p.x * T + ox, p.y * T + oy, rng.range(1, 3.2), rng.range(0.8, 2.2), rng.float() * 3, 0, Math.PI * 2);
        g.fill();
      }

      // 行进方向箭头
      for (let d = 1.6; d < lane.len - 1; d += chevronStep) {
        const p = this.game.posAt(d, laneIndex);
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
      g.fillStyle = hexToRgba(P.accent, 0.14);
      g.beginPath();
      g.ellipse(-s * 0.15, -s * 0.3, s * 0.45, s * 0.2, -0.4, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }

    // 生物群系氛围光点
    if (decor !== 'off') {
      const motes = decor === 'light' ? 24 : 70;
      for (let i = 0; i < motes; i++) {
        const x = rng.float() * this.W;
        const y = rng.float() * this.H;
        g.fillStyle = `${P.ambient}${0.035 + rng.float() * 0.06})`;
        g.beginPath();
        g.arc(x, y, rng.range(0.8, 2.2), 0, Math.PI * 2);
        g.fill();
      }
    }

    // 边缘暗角
    const vignette = g.createRadialGradient(
      this.W / 2,
      this.H / 2,
      Math.min(this.W, this.H) * 0.35,
      this.W / 2,
      this.H / 2,
      Math.max(this.W, this.H) * 0.72
    );
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.5)');
    g.fillStyle = vignette;
    g.fillRect(0, 0, this.W, this.H);

    return bg;
  }

  screenToTile(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * this.W;
    const y = ((event.clientY - rect.top) / rect.height) * this.H;
    return { c: Math.floor(x / T), r: Math.floor(y / T) };
  }

  render(dt) {
    this.time += dt;
    const now = performance.now();
    this.fpsFrames++;
    if (!this.fpsSince) this.fpsSince = now;
    if (now - this.fpsSince >= 500) {
      this.fps = (this.fpsFrames * 1000) / (now - this.fpsSince);
      this.fpsFrames = 0;
      this.fpsSince = now;
    }

    const g = this.ctx;
    const game = this.game;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.W, this.H);
    g.save();
    if (this.settings.shake && game.shake > 0.2) {
      g.translate((Math.random() - 0.5) * game.shake, (Math.random() - 0.5) * game.shake);
    }
    g.drawImage(this.bg, 0, 0, this.W, this.H);

    this.drawPortals(g);
    this.drawRanges(g);
    this.drawTowers(g);
    this.drawEnemies(g);
    this.drawProjectiles(g);
    this.drawEffects(g);
    this.drawFloaters(g);
    this.drawPlacement(g);

    g.restore();

    if (this.settings.showFps) {
      g.save();
      g.fillStyle = 'rgba(5, 10, 13, 0.62)';
      g.fillRect(10, 10, 132, 24);
      g.fillStyle = '#9fe8cf';
      g.font = '600 12px "DejaVu Sans Mono", ui-monospace, monospace';
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText(`${Math.round(this.fps)} FPS · 敌 ${this.game.enemies.length}`, 18, 22);
      g.restore();
    }
  }

  // 入口视觉状态：整备阶段全部常态；波中仅激活入口高亮，其余变暗。
  // 暴露给验收测试，避免直接读取 Canvas 像素。
  portalStates() {
    const map = this.game.map;
    const spawns = map.spawns?.length
      ? map.spawns
      : [{ x: map.spawn.x, y: map.spawn.y, color: '#c9a8ff' }];
    const inWave = this.game.phase === 'wave';
    const active = new Set(
      inWave
        ? this.game.activePortals?.length
          ? this.game.activePortals
          : [0]
        : spawns.map((_, index) => index)
    );
    return spawns.map((spawn, index) => {
      const isActive = active.has(index);
      return {
        index,
        label: index + 1,
        color: spawn.color || '#c9a8ff',
        active: isActive,
        dimmed: inWave && !isActive,
      };
    });
  }

  drawPortals(g) {
    const map = this.game.map;
    const t = this.time;
    const glowOn = this.settings.glow;
    const states = this.portalStates();
    const spawns = map.spawns?.length
      ? map.spawns
      : [{ x: map.spawn.x, y: map.spawn.y, color: '#c9a8ff' }];
    const pulse = 0.85 + Math.sin(t * 3) * 0.15;

    spawns.forEach((spawn, index) => {
      const sx = spawn.x * T;
      const sy = spawn.y * T;
      const color = spawn.color || '#c9a8ff';
      const isActive = states[index]?.active !== false;
      g.save();
      if (!isActive) g.globalAlpha = 0.42;

      if (glowOn) {
        const grad = g.createRadialGradient(sx, sy, 2, sx, sy, 30 * pulse);
        grad.addColorStop(0, hexToRgba(color, 0.5));
        grad.addColorStop(1, hexToRgba(color, 0));
        g.fillStyle = grad;
        g.beginPath();
        g.arc(sx, sy, 30 * pulse, 0, Math.PI * 2);
        g.fill();
      } else {
        g.fillStyle = hexToRgba(color, 0.18);
        g.beginPath();
        g.arc(sx, sy, 18, 0, Math.PI * 2);
        g.fill();
      }

      g.translate(sx, sy);
      g.rotate(t * 1.6 + index);
      g.strokeStyle = hexToRgba(color, 0.85);
      g.lineWidth = 2.3;
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.arc(0, 0, 13 + i * 4, i * 2.1, i * 2.1 + 1.9);
        g.stroke();
      }
      g.rotate(-(t * 1.6 + index));
      g.fillStyle = color;
      g.font = '700 10px "DejaVu Sans Mono", ui-monospace, monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(states[index]?.label ?? index + 1), 0, 0);
      g.restore();
    });

    const bx = map.base.x * T;
    const by = map.base.y * T;
    const game = this.game;
    const ratio = Math.max(0, Math.min(1, game.baseHp / game.maxBaseHp));
    if (glowOn) {
      const glow = 0.8 + Math.sin(t * 2.4) * 0.2;
      const bg = g.createRadialGradient(bx, by, 3, bx, by, 40);
      bg.addColorStop(0, `rgba(90, 235, 220, ${0.32 * glow})`);
      bg.addColorStop(1, 'rgba(90, 235, 220, 0)');
      g.fillStyle = bg;
      g.beginPath();
      g.arc(bx, by, 40, 0, Math.PI * 2);
      g.fill();
    }

    // 生命环
    g.strokeStyle = 'rgba(10, 20, 18, 0.8)';
    g.lineWidth = 5;
    g.beginPath();
    g.arc(bx, by, 25, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = ratio > 0.5 ? '#5ce2b0' : ratio > 0.25 ? '#e8c35a' : '#ef5f5f';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(bx, by, 25, -Math.PI / 2, -Math.PI / 2 + ratio * Math.PI * 2);
    g.stroke();

    // 水晶
    g.save();
    g.translate(bx, by);
    g.rotate(Math.sin(t * 1.2) * 0.08);
    if (glowOn) {
      const crystal = g.createLinearGradient(0, -18, 0, 18);
      crystal.addColorStop(0, '#c8fff5');
      crystal.addColorStop(0.5, '#4fd8c8');
      crystal.addColorStop(1, '#1c7d86');
      g.fillStyle = crystal;
    } else {
      g.fillStyle = '#3fc8bb';
    }
    g.strokeStyle = 'rgba(220, 255, 250, 0.8)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(0, -19);
    g.lineTo(12, -5);
    g.lineTo(8, 14);
    g.lineTo(0, 19);
    g.lineTo(-8, 14);
    g.lineTo(-12, -5);
    g.closePath();
    g.fill();
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.beginPath();
    g.moveTo(0, -19);
    g.lineTo(0, 17);
    g.stroke();
    g.restore();
  }

  drawRanges(g) {
    const game = this.game;
    const tower = game.selectedTower;
    if (tower) {
      const stats = game.statsFor(tower);
      this.drawRangeCircle(g, tower.x, tower.y, stats.range, TOWERS[tower.type].color, 0.55);
    }
  }

  drawRangeCircle(g, x, y, range, color, alpha = 0.5) {
    g.save();
    g.beginPath();
    g.arc(x * T, y * T, range * T, 0, Math.PI * 2);
    g.fillStyle = hexToRgba(color, 0.07);
    g.fill();
    g.strokeStyle = hexToRgba(color, alpha);
    g.lineWidth = 1.5;
    g.setLineDash([6, 5]);
    g.stroke();
    g.restore();
  }

  drawTowers(g) {
    const game = this.game;
    const glow = this.settings.glow;
    for (const tower of game.towers) {
      const x = tower.x * T;
      const y = tower.y * T;
      const def = TOWERS[tower.type];
      const level = tower.level;
      const color = def.color;

      g.fillStyle = 'rgba(0,0,0,0.38)';
      g.beginPath();
      g.ellipse(x, y + 12, 21, 9, 0, 0, Math.PI * 2);
      g.fill();

      if (glow) this.drawGlow(g, color, x, y, 30, level >= 2 ? 0.2 : 0.12);

      g.save();
      g.translate(x, y);
      g.scale(1.06, 1.06);

      const oct = (radius) => {
        g.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = Math.PI / 8 + (i / 8) * Math.PI * 2;
          const px = Math.cos(a) * radius;
          const py = Math.sin(a) * radius;
          i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
        }
        g.closePath();
      };

      // 石台
      oct(22);
      g.fillStyle = '#0a1116';
      g.fill();
      g.strokeStyle = hexToRgba(color, 0.42);
      g.lineWidth = 2;
      g.stroke();

      oct(17.5);
      g.fillStyle = '#121d24';
      g.fill();
      g.strokeStyle = hexToRgba(color, 0.16);
      g.lineWidth = 1;
      g.stroke();

      // 能量环
      g.strokeStyle = hexToRgba(color, 0.5);
      g.lineWidth = 1.4;
      g.beginPath();
      g.arc(0, 0, 14, this.time * 0.4, this.time * 0.4 + Math.PI * 1.1);
      g.stroke();

      // 铆钉
      g.fillStyle = '#1c2a33';
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + (i / 4) * Math.PI * 2;
        g.beginPath();
        g.arc(Math.cos(a) * 19, Math.sin(a) * 19, 1.7, 0, Math.PI * 2);
        g.fill();
      }

      // 等级宝石
      for (let i = 0; i < 3; i++) {
        const filled = i <= level;
        const offset = (i - 1) * 7;
        g.beginPath();
        g.moveTo(offset, 25);
        g.lineTo(offset + 2.4, 27.5);
        g.lineTo(offset, 30);
        g.lineTo(offset - 2.4, 27.5);
        g.closePath();
        g.fillStyle = filled ? '#ffd36b' : 'rgba(255,211,107,0.15)';
        g.fill();
        if (filled && glow) {
          g.strokeStyle = 'rgba(255,211,107,0.5)';
          g.lineWidth = 0.8;
          g.stroke();
        }
      }

      // 炮塔
      g.save();
      g.rotate(tower.angle);
      g.translate(-(tower.recoil || 0) * 4, 0);
      this.drawTowerShape(g, tower.type, 0, 1, level);
      g.restore();

      if (game.selectedTower === tower) {
        g.strokeStyle = 'rgba(255, 211, 107, 0.95)';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(0, 0, 24, 0, Math.PI * 2);
        g.stroke();
      }
      g.restore();
    }
  }

  drawTowerShape(g, type, recoil, alpha, level = 0) {
    const def = TOWERS[type];
    const push = -recoil * 3;
    g.globalAlpha = alpha;

    if (type === 'arrow') {
      // 木质弩机
      g.fillStyle = '#2b2118';
      g.strokeStyle = '#8c6b45';
      g.lineWidth = 2;
      roundRect(g, -4 + push, -3.2, 17, 6.4, 2);
      g.fill();
      g.stroke();

      // 弩臂
      g.strokeStyle = def.color;
      g.lineWidth = 2.4;
      g.beginPath();
      g.moveTo(7 + push, -12);
      g.quadraticCurveTo(20 + push, -7, 20 + push, 0);
      g.quadraticCurveTo(20 + push, 7, 7 + push, 12);
      g.stroke();

      // 弓弦
      g.strokeStyle = 'rgba(225,255,235,0.55)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(12 + push, -9.5);
      g.lineTo(5 + push, 0);
      g.lineTo(12 + push, 9.5);
      g.stroke();

      // 弩箭
      g.strokeStyle = '#e6fff0';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(2 + push, 0);
      g.lineTo(23 + push, 0);
      g.stroke();
      g.fillStyle = '#f2fff7';
      g.beginPath();
      g.moveTo(27 + push, 0);
      g.lineTo(21 + push, -3.6);
      g.lineTo(21 + push, 3.6);
      g.closePath();
      g.fill();

      if (level >= 1) {
        g.strokeStyle = hexToRgba(def.color, 0.6);
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(0, 0, 9.5, 0, Math.PI * 2);
        g.stroke();
      }
    } else if (type === 'cannon') {
      // 铁制炮塔
      g.fillStyle = '#2a2c2b';
      g.strokeStyle = '#6d604e';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(0, 0, 10, 0, Math.PI * 2);
      g.fill();
      g.stroke();

      // 炮管
      g.fillStyle = '#3d3f3c';
      g.strokeStyle = '#7a6c56';
      g.lineWidth = 2;
      roundRect(g, 4 + push, -6.5, 19, 13, 4);
      g.fill();
      g.stroke();

      // 加固环
      g.strokeStyle = '#a08b68';
      g.lineWidth = 1.8;
      for (const bx of [9, 16]) {
        g.beginPath();
        g.moveTo(bx + push, -6.1);
        g.lineTo(bx + push, 6.1);
        g.stroke();
      }

      // 炮口
      g.fillStyle = '#1b1c1b';
      g.beginPath();
      g.arc(23 + push, 0, 4.6, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = def.color;
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(23 + push, 0, 5.6, 0, Math.PI * 2);
      g.stroke();

      if (level >= 1) {
        g.strokeStyle = hexToRgba(def.color, 0.55);
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(0, 0, 9.5, 0, Math.PI * 2);
        g.stroke();
      }
    } else if (type === 'frost') {
      // 冰晶核心
      g.save();
      g.rotate(this.time * 0.35);
      g.strokeStyle = 'rgba(160,230,255,0.35)';
      g.lineWidth = 1.2;
      for (let i = 0; i < 6; i++) {
        g.rotate(Math.PI / 3);
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(15, 0);
        g.stroke();
      }
      g.restore();

      // 主水晶
      g.fillStyle = '#2b6d8a';
      g.strokeStyle = def.color;
      g.lineWidth = 1.8;
      g.beginPath();
      g.moveTo(0, -13);
      g.lineTo(8, -3);
      g.lineTo(5, 11);
      g.lineTo(0, 14);
      g.lineTo(-5, 11);
      g.lineTo(-8, -3);
      g.closePath();
      g.fill();
      g.stroke();

      // 侧晶
      const shard = (ax, ay, sx, sy, rot) => {
        g.save();
        g.translate(ax, ay);
        g.rotate(rot);
        g.beginPath();
        g.moveTo(0, -sy);
        g.lineTo(sx, 0);
        g.lineTo(0, sy);
        g.lineTo(-sx, 0);
        g.closePath();
        g.fillStyle = '#4a9cbc';
        g.fill();
        g.strokeStyle = '#a8e6ff';
        g.lineWidth = 1.2;
        g.stroke();
        g.restore();
      };
      shard(-9, 2, 2.6, 6, -0.5);
      shard(9, 1, 2.6, 7, 0.6);
      if (level >= 2) shard(0, 15, 2.2, 5, 0);

      // 顶部高光
      g.fillStyle = 'rgba(220,255,255,0.85)';
      g.beginPath();
      g.arc(0, -8, 2.2, 0, Math.PI * 2);
      g.fill();
    } else if (type === 'arc') {
      // 特斯拉线圈
      g.fillStyle = '#221d33';
      g.strokeStyle = def.color;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(0, 0, 9, 0, Math.PI * 2);
      g.fill();
      g.stroke();

      g.strokeStyle = 'rgba(201,168,255,0.75)';
      g.lineWidth = 1.8;
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.ellipse(3 + i * 3, 0, 2.4, 8 - i * 1.4, 0, 0, Math.PI * 2);
        g.stroke();
      }

      // 电球
      const pulse = 1 + Math.sin(this.time * 8) * 0.15;
      if (this.settings.glow) this.drawGlow(g, '#d2b9ff', 15, 0, 13, 0.55);
      g.fillStyle = '#e8dcff';
      g.beginPath();
      g.arc(15, 0, 4.6 * pulse, 0, Math.PI * 2);
      g.fill();

      // 电弧
      g.strokeStyle = '#f2eaff';
      g.lineWidth = 1.4;
      for (let i = 0; i < 2; i++) {
        g.beginPath();
        g.moveTo(15, 0);
        g.lineTo(15 + 8, -6 + i * 12 + Math.sin(this.time * 20 + i) * 3);
        g.lineTo(15 + 13, 2 - i * 4);
        g.stroke();
      }
    } else if (type === 'poison') {
      // 炼金装置
      g.fillStyle = '#1c2a18';
      g.strokeStyle = def.color;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(0, 0, 9, 0, Math.PI * 2);
      g.fill();
      g.stroke();

      // 导管
      g.strokeStyle = '#6e7f55';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(4, 0);
      g.lineTo(19, 0);
      g.stroke();

      // 药瓶
      g.fillStyle = 'rgba(160, 230, 120, 0.22)';
      g.strokeStyle = '#b6e88a';
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(13, 0, 8.5, 0, Math.PI * 2);
      g.fill();
      g.stroke();

      g.fillStyle = 'rgba(120, 210, 80, 0.75)';
      g.beginPath();
      g.arc(13, 2.4, 6.4, 0.15, Math.PI - 0.15);
      g.fill();

      // 气泡
      for (let i = 0; i < 3; i++) {
        const phase = (this.time * 0.7 + i * 0.37) % 1;
        g.fillStyle = `rgba(190,255,140,${0.65 * (1 - phase)})`;
        g.beginPath();
        g.arc(
          13 + Math.sin(this.time * 2.2 + i * 2) * 4,
          3 - phase * 9,
          1.1 + phase * 1.4,
          0,
          Math.PI * 2
        );
        g.fill();
      }

      // 喷嘴
      g.fillStyle = '#7f8f63';
      roundRect(g, 20, -3.5, 6, 7, 2);
      g.fill();

      if (level >= 2) {
        g.fillStyle = 'rgba(180, 240, 120, 0.8)';
        g.beginPath();
        g.arc(0, -9, 2.2, 0, Math.PI * 2);
        g.fill();
      }
    }

    g.globalAlpha = 1;
  }

  drawEnemies(g) {
    const game = this.game;
    const t = this.time;
    const glow = this.settings.glow;

    for (const enemy of game.enemies) {
      if (enemy.dead) continue;
      const def = ENEMIES[enemy.type];
      const x = enemy.x * T;
      const y = enemy.y * T;
      const r = enemy.r * T;
      const lift = enemy.flying ? 12 : 0;
      const vr = r * 1.12;
      const bob = enemy.flying
        ? Math.sin(t * 10 + enemy.id) * 1.6
        : Math.sin(t * 7 + enemy.id) * 1.1;

      g.fillStyle = `rgba(0,0,0,${enemy.flying ? 0.2 : 0.32})`;
      g.beginPath();
      g.ellipse(x, y + 8, vr * 1.05, vr * 0.42, 0, 0, Math.PI * 2);
      g.fill();

      if (enemy.boss && glow) {
        this.drawGlow(g, '#e25096', x, y - lift, vr * 2.3, 0.3);
      } else if (enemy.heal > 0 && glow) {
        this.drawGlow(g, '#5af0aa', x, y - lift, vr * 2, 0.18);
      }

      g.save();
      g.translate(x, y - lift + bob);
      if (def.shape === 'dart') g.rotate(enemy.angle);
      else if (def.shape === 'hex') g.rotate(Math.sin(enemy.id) * 0.08);
      this.drawEnemyBody(g, enemy, def, vr);

      if (enemy.hitFlash > 0) {
        g.globalAlpha = enemy.hitFlash * 0.32;
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.arc(0, 0, vr * 1.08, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 1;
      }

      // 减速：冰晶与光环
      if (t < enemy.slowUntil) {
        g.strokeStyle = 'rgba(140, 225, 255, 0.8)';
        g.lineWidth = 1.6;
        g.beginPath();
        g.arc(0, 0, vr + 4, 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = 'rgba(190, 245, 255, 0.85)';
        for (let i = 0; i < 3; i++) {
          const a = t * 1.4 + (i / 3) * Math.PI * 2;
          const px = Math.cos(a) * (vr + 6);
          const py = Math.sin(a) * (vr + 6);
          g.beginPath();
          g.moveTo(px, py - 2.6);
          g.lineTo(px + 2, py);
          g.lineTo(px, py + 2.6);
          g.lineTo(px - 2, py);
          g.closePath();
          g.fill();
        }
      }

      // 中毒：绿色气泡
      if (t < enemy.poisonUntil) {
        g.strokeStyle = 'rgba(154, 223, 106, 0.5)';
        g.lineWidth = 1.6;
        g.beginPath();
        g.arc(0, 0, vr + 7, 0.3, 0.3 + Math.PI * 1.2);
        g.stroke();
        for (let i = 0; i < 2; i++) {
          const phase = (t * 1.6 + i * 0.5) % 1;
          g.fillStyle = `rgba(154, 223, 106, ${0.55 * (1 - phase)})`;
          g.beginPath();
          g.arc(
            Math.sin(t * 3 + i * 2) * vr * 0.6,
            -vr - phase * 12,
            1.4 + phase * 1.3,
            0,
            Math.PI * 2
          );
          g.fill();
        }
      }
      g.restore();

      // 血条
      if (enemy.hp < enemy.maxHp || enemy.boss) {
        const width = enemy.boss ? 76 : Math.max(24, vr * 2.4);
        const bx = x - width / 2;
        const by = y - lift - vr - (enemy.boss ? 18 : 12);
        g.fillStyle = 'rgba(4, 8, 10, 0.78)';
        roundRect(g, bx - 1.5, by - 1.5, width + 3, 7, 3);
        g.fill();
        const ratio = Math.max(0, enemy.hp / enemy.maxHp);
        g.fillStyle = ratio > 0.55 ? '#7ce38b' : ratio > 0.25 ? '#e8c35a' : '#ef5f5f';
        roundRect(g, bx, by, Math.max(2, width * ratio), 4, 2);
        g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.12)';
        g.lineWidth = 0.8;
        roundRect(g, bx - 1.5, by - 1.5, width + 3, 7, 3);
        g.stroke();
      }

      if (enemy.boss) {
        g.fillStyle = '#ffb3d9';
        g.font = '700 10px "Noto Sans SC", "DejaVu Sans", sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'bottom';
        g.fillText('渊主', x, y - lift - vr - 22);
      }
    }
  }

  drawEnemyBody(g, enemy, def, r) {
    const t = this.time;
    const body = def.color;
    const dark = shade(body, -0.45);
    const light = shade(body, 0.28);

    if (def.shape === 'blob') {
      // 兜帽游魂
      g.fillStyle = body;
      g.strokeStyle = dark;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(0, -r * 1.18);
      g.bezierCurveTo(r * 0.95, -r * 0.85, r * 1.0, r * 0.3, r * 0.78, r * 0.96);
      g.lineTo(r * 0.38, r * 0.55);
      g.lineTo(0, r * 1.08);
      g.lineTo(-r * 0.38, r * 0.55);
      g.lineTo(-r * 0.78, r * 0.96);
      g.bezierCurveTo(-r * 1.0, r * 0.3, -r * 0.95, -r * 0.85, 0, -r * 1.18);
      g.closePath();
      g.fill();
      g.stroke();

      g.fillStyle = 'rgba(14, 10, 18, 0.6)';
      g.beginPath();
      g.ellipse(0, -r * 0.08, r * 0.55, r * 0.62, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ffe6a6';
      g.beginPath();
      g.arc(-r * 0.24, -r * 0.16, r * 0.1, 0, Math.PI * 2);
      g.arc(r * 0.24, -r * 0.16, r * 0.1, 0, Math.PI * 2);
      g.fill();
    } else if (def.shape === 'dart') {
      // 疾影猎犬
      g.fillStyle = body;
      g.strokeStyle = dark;
      g.lineWidth = 1.8;
      g.beginPath();
      g.ellipse(-r * 0.1, 0, r * 1.05, r * 0.62, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();

      g.beginPath();
      g.moveTo(r * 0.95, -r * 0.42);
      g.lineTo(r * 1.6, 0);
      g.lineTo(r * 0.95, r * 0.42);
      g.closePath();
      g.fillStyle = light;
      g.fill();
      g.stroke();

      // 眼睛
      g.fillStyle = '#2a1a08';
      g.beginPath();
      g.arc(r * 1.05, -r * 0.12, r * 0.09, 0, Math.PI * 2);
      g.fill();

      // 四肢
      g.strokeStyle = dark;
      g.lineWidth = Math.max(1.2, r * 0.16);
      for (let i = 0; i < 3; i++) {
        const swing = Math.sin(t * 16 + i * 2.1) * r * 0.28;
        g.beginPath();
        g.moveTo(-r * 0.55 + i * r * 0.42, r * 0.35);
        g.lineTo(-r * 0.7 + i * r * 0.42 + swing, r * 0.9);
        g.stroke();
      }

      // 速度残影
      g.strokeStyle = hexToRgba(body, 0.28);
      g.lineWidth = 1.4;
      for (let i = 0; i < 2; i++) {
        g.beginPath();
        g.moveTo(-r * 1.4, -r * 0.28 + i * r * 0.35);
        g.lineTo(-r * 2.1, -r * 0.28 + i * r * 0.35);
        g.stroke();
      }
    } else if (def.shape === 'bug') {
      // 噬虫
      g.fillStyle = body;
      g.strokeStyle = dark;
      g.lineWidth = 1.4;
      g.beginPath();
      g.ellipse(0, 0, r * 0.9, r * 1.05, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();

      g.strokeStyle = dark;
      g.lineWidth = Math.max(1, r * 0.14);
      for (let i = 0; i < 3; i++) {
        const y = -r * 0.45 + i * r * 0.45;
        const wiggle = Math.sin(t * 18 + i * 1.6 + enemy.id) * r * 0.2;
        g.beginPath();
        g.moveTo(-r * 0.55, y);
        g.lineTo(-r * 1.15, y + wiggle);
        g.moveTo(r * 0.55, y);
        g.lineTo(r * 1.15, y + wiggle);
        g.stroke();
      }
      g.strokeStyle = light;
      g.lineWidth = 1.1;
      g.beginPath();
      g.moveTo(-r * 0.18, -r * 0.85);
      g.lineTo(-r * 0.45, -r * 1.35);
      g.moveTo(r * 0.18, -r * 0.85);
      g.lineTo(r * 0.45, -r * 1.35);
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.beginPath();
      g.ellipse(-r * 0.2, -r * 0.35, r * 0.24, r * 0.4, -0.3, 0, Math.PI * 2);
      g.fill();
    } else if (def.shape === 'hex') {
      // 石卫
      g.fillStyle = body;
      g.strokeStyle = dark;
      g.lineWidth = 2.2;
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        const px = Math.cos(a) * r * 1.18;
        const py = Math.sin(a) * r * 1.12;
        i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
      }
      g.closePath();
      g.fill();
      g.stroke();

      g.fillStyle = shade(body, -0.28);
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        const px = Math.cos(a) * r * 0.72;
        const py = Math.sin(a) * r * 0.68;
        i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
      }
      g.closePath();
      g.fill();

      // 裂纹
      g.strokeStyle = 'rgba(20,24,28,0.5)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(-r * 0.3, -r * 0.7);
      g.lineTo(-r * 0.05, -r * 0.2);
      g.lineTo(-r * 0.35, r * 0.25);
      g.stroke();

      // 眼睛
      g.fillStyle = '#ffb36b';
      g.beginPath();
      g.arc(r * 0.2, -r * 0.15, r * 0.12, 0, Math.PI * 2);
      g.arc(r * 0.52, -r * 0.02, r * 0.09, 0, Math.PI * 2);
      g.fill();
    } else if (def.shape === 'wing') {
      // 翼魔
      const flap = Math.sin(t * 16 + enemy.id) * 0.45;
      g.fillStyle = shade(body, -0.22);
      g.strokeStyle = dark;
      g.lineWidth = 1.4;
      g.beginPath();
      g.ellipse(-r * 0.62, -flap * r * 0.5, r * 0.72, r * 0.28, -0.55 - flap, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.beginPath();
      g.ellipse(r * 0.62, -flap * r * 0.5, r * 0.72, r * 0.28, 0.55 + flap, 0, Math.PI * 2);
      g.fill();
      g.stroke();

      g.fillStyle = body;
      g.beginPath();
      g.moveTo(r * 0.95, 0);
      g.lineTo(0, -r * 0.56);
      g.lineTo(-r * 0.95, 0);
      g.lineTo(0, r * 0.56);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = '#ffe9a8';
      g.beginPath();
      g.arc(r * 0.18, -r * 0.12, r * 0.09, 0, Math.PI * 2);
      g.fill();

      // 尾巴
      g.strokeStyle = dark;
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(-r * 0.9, 0);
      g.quadraticCurveTo(-r * 1.4, Math.sin(t * 8) * r * 0.3, -r * 1.55, 0);
      g.stroke();
    } else if (def.shape === 'priest') {
      // 祭司
      g.fillStyle = body;
      g.strokeStyle = dark;
      g.lineWidth = 1.8;
      g.beginPath();
      g.moveTo(0, -r * 1.05);
      g.quadraticCurveTo(r * 0.95, -r * 0.4, r * 0.82, r * 1.0);
      g.lineTo(-r * 0.82, r * 1.0);
      g.quadraticCurveTo(-r * 0.95, -r * 0.4, 0, -r * 1.05);
      g.closePath();
      g.fill();
      g.stroke();

      g.fillStyle = 'rgba(8, 26, 20, 0.55)';
      g.beginPath();
      g.arc(0, -r * 0.36, r * 0.42, 0, Math.PI * 2);
      g.fill();

      g.strokeStyle = '#d9fff0';
      g.lineWidth = 2.2;
      g.beginPath();
      g.moveTo(0, -r * 0.72);
      g.lineTo(0, r * 0.15);
      g.moveTo(-r * 0.28, -r * 0.42);
      g.lineTo(r * 0.28, -r * 0.42);
      g.stroke();

      // 法杖
      g.strokeStyle = '#8a7a55';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(r * 0.72, r * 0.9);
      g.lineTo(r * 0.9, -r * 0.7);
      g.stroke();
      g.fillStyle = '#a8ffd8';
      g.beginPath();
      g.arc(r * 0.9, -r * 0.82, r * 0.16, 0, Math.PI * 2);
      g.fill();
    } else if (def.shape === 'boss') {
      const spikes = 16;
      g.fillStyle = body;
      g.strokeStyle = dark;
      g.lineWidth = 2.2;
      g.beginPath();
      for (let i = 0; i < spikes; i++) {
        const a = (i / spikes) * Math.PI * 2;
        const rad = i % 2 === 0 ? r * 1.1 : r * 0.76;
        const px = Math.cos(a) * rad;
        const py = Math.sin(a) * rad;
        i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
      }
      g.closePath();
      g.fill();
      g.stroke();

      // 王冠
      g.fillStyle = '#ffd36b';
      g.beginPath();
      g.moveTo(0, -r * 1.05);
      g.lineTo(r * 0.55, -r * 1.45);
      g.lineTo(r * 0.28, -r * 1.12);
      g.lineTo(0, -r * 1.55);
      g.lineTo(-r * 0.28, -r * 1.12);
      g.lineTo(-r * 0.55, -r * 1.45);
      g.closePath();
      g.fill();

      g.fillStyle = '#260d1a';
      g.beginPath();
      g.arc(0, 0, r * 0.5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ffb3d9';
      g.beginPath();
      g.arc(0, 0, r * 0.23, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ffe9a8';
      g.beginPath();
      g.arc(-r * 0.28, -r * 0.16, r * 0.09, 0, Math.PI * 2);
      g.arc(r * 0.28, -r * 0.16, r * 0.09, 0, Math.PI * 2);
      g.fill();
    }
  }

  drawProjectiles(g) {
    for (const proj of this.game.projectiles) {
      const x = proj.x * T;
      const y = proj.y * T;
      g.save();
      g.translate(x, y);
      g.rotate(proj.angle || 0);

      if (proj.kind === 'shell') {
        g.strokeStyle = 'rgba(255, 160, 90, 0.22)';
        g.lineWidth = 7;
        g.beginPath();
        g.moveTo(-22, 0);
        g.lineTo(-4, 0);
        g.stroke();
        g.strokeStyle = 'rgba(120, 90, 70, 0.28)';
        g.lineWidth = 10;
        g.beginPath();
        g.moveTo(-30, 0);
        g.lineTo(-18, 0);
        g.stroke();
        if (this.settings.glow) this.drawGlow(g, '#ffb066', 0, 0, 12, 0.55);
        g.fillStyle = '#23282e';
        g.strokeStyle = '#ffb066';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(0, 0, 5.6, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.fillStyle = 'rgba(255, 210, 150, 0.7)';
        g.beginPath();
        g.arc(-1.4, -1.4, 1.5, 0, Math.PI * 2);
        g.fill();
      } else if (proj.kind === 'frost') {
        g.strokeStyle = 'rgba(124, 212, 245, 0.3)';
        g.lineWidth = 5;
        g.beginPath();
        g.moveTo(-18, 0);
        g.lineTo(-3, 0);
        g.stroke();
        if (this.settings.glow) this.drawGlow(g, '#a0ebff', 0, 0, 11, 0.5);
        g.fillStyle = '#e6fbff';
        g.strokeStyle = '#7cd4f5';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(6, 0);
        g.lineTo(0, -5);
        g.lineTo(-6, 0);
        g.lineTo(0, 5);
        g.closePath();
        g.fill();
        g.stroke();
        g.strokeStyle = 'rgba(220,250,255,0.55)';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(-3, 0);
        g.lineTo(3, 0);
        g.stroke();
      } else if (proj.kind === 'poison') {
        g.strokeStyle = 'rgba(154, 223, 106, 0.28)';
        g.lineWidth = 5;
        g.beginPath();
        g.moveTo(-16, 0);
        g.lineTo(-3, 0);
        g.stroke();
        if (this.settings.glow) this.drawGlow(g, '#9adf6a', 0, 0, 10, 0.45);
        g.fillStyle = '#9adf6a';
        g.beginPath();
        g.arc(0, 0, 4.8, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#3f6b2c';
        g.lineWidth = 1.2;
        g.stroke();
        g.fillStyle = 'rgba(225,255,190,0.8)';
        g.beginPath();
        g.arc(-1.4, -1.6, 1.5, 0, Math.PI * 2);
        g.fill();
      } else {
        g.strokeStyle = 'rgba(255, 233, 176, 0.35)';
        g.lineWidth = 5;
        g.beginPath();
        g.moveTo(-16, 0);
        g.lineTo(2, 0);
        g.stroke();
        g.strokeStyle = '#ffe9b0';
        g.lineWidth = 2.2;
        g.beginPath();
        g.moveTo(-9, 0);
        g.lineTo(6, 0);
        g.stroke();
        g.fillStyle = '#fff8dd';
        g.beginPath();
        g.moveTo(9, 0);
        g.lineTo(3, -3);
        g.lineTo(3, 3);
        g.closePath();
        g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.6)';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(-8, 0);
        g.lineTo(-12, -3);
        g.moveTo(-8, 0);
        g.lineTo(-12, 3);
        g.stroke();
      }
      g.restore();
    }
  }

  // 光晕贴图缓存：每帧新建 radial gradient 在软件渲染下开销明显，按颜色缓存一次。
  glowSprite(color) {
    if (!this._glowCache) this._glowCache = new Map();
    let sprite = this._glowCache.get(color);
    if (sprite) return sprite;
    const size = 64;
    sprite = document.createElement('canvas');
    sprite.width = size;
    sprite.height = size;
    const sg = sprite.getContext('2d');
    const grad = sg.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, withAlpha(color, 1));
    grad.addColorStop(0.45, withAlpha(color, 0.35));
    grad.addColorStop(1, withAlpha(color, 0));
    sg.fillStyle = grad;
    sg.fillRect(0, 0, size, size);
    this._glowCache.set(color, sprite);
    return sprite;
  }

  drawGlow(g, color, x, y, radius, alpha) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = alpha;
    g.drawImage(this.glowSprite(color), x - radius, y - radius, radius * 2, radius * 2);
    g.restore();
  }

  drawEffects(g) {
    const glow = this.settings.glow;
    const t = this.time;

    for (const effect of this.game.effects) {
      const k = effect.ttl / (effect.maxTtl || 0.3);
      const p = 1 - Math.max(0, Math.min(1, k));
      const fade = Math.max(0, Math.min(1, k));
      const x = effect.x * T;
      const y = effect.y * T;
      const color = effect.color || '#ffd36b';

      if (effect.kind === 'ring') {
        const radius = (effect.r0 + (effect.r1 - effect.r0) * p) * T;
        g.save();
        if (glow) g.globalCompositeOperation = 'lighter';
        if (glow && p < 0.45) {
          this.drawGlow(g, color, x, y, radius * 0.75, 0.42 * (1 - p / 0.45));
        }
        g.globalAlpha = fade * 0.95;
        g.strokeStyle = color;
        g.lineWidth = 0.8 + 3 * (1 - p);
        g.beginPath();
        g.arc(x, y, radius, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = fade * 0.4;
        g.lineWidth = 1.1;
        g.beginPath();
        g.arc(x, y, radius * 0.74, 0, Math.PI * 2);
        g.stroke();
        g.restore();
      } else if (effect.kind === 'spark') {
        g.save();
        if (glow) g.globalCompositeOperation = 'lighter';
        g.globalAlpha = fade;
        g.strokeStyle = color;
        g.lineWidth = 1.7;
        g.lineCap = 'round';
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + 0.35;
          const inner = 2.5 + p * 3;
          const outer = 6 + p * (9 + (i % 2) * 4);
          g.beginPath();
          g.moveTo(x + Math.cos(a) * inner, y + Math.sin(a) * inner);
          g.lineTo(x + Math.cos(a) * outer, y + Math.sin(a) * outer);
          g.stroke();
        }
        g.fillStyle = withAlpha('#ffffff', fade * 0.85);
        g.beginPath();
        g.arc(x, y, 2.6 * (1 - p * 0.6), 0, Math.PI * 2);
        g.fill();
        g.restore();
      } else if (effect.kind === 'bolt') {
        g.save();
        if (glow) {
          g.globalCompositeOperation = 'lighter';
          g.globalAlpha = (1 - p) * 0.28;
          g.strokeStyle = color;
          g.lineWidth = 7;
          this.strokeBolt(g, effect.points, x, y);
          g.globalAlpha = (1 - p) * 0.5;
          g.lineWidth = 3.5;
          this.strokeBolt(g, effect.points, x, y);
          g.globalCompositeOperation = 'source-over';
        }
        g.globalAlpha = 1 - p * 0.85;
        g.strokeStyle = '#f6f0ff';
        g.lineWidth = 1.6;
        this.strokeBolt(g, effect.points, x, y);
        g.restore();
      } else if (effect.kind === 'muzzle') {
        g.save();
        g.translate(x, y);
        g.rotate(effect.angle);
        if (glow) g.globalCompositeOperation = 'lighter';
        g.globalAlpha = fade;
        g.fillStyle = withAlpha(color, 0.55);
        g.beginPath();
        g.moveTo(0, -4.5);
        g.lineTo(18, -1.6);
        g.lineTo(18, 1.6);
        g.lineTo(0, 4.5);
        g.closePath();
        g.fill();
        g.fillStyle = withAlpha('#ffffff', fade * 0.8);
        g.beginPath();
        g.arc(2, 0, 2.6, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = fade * 0.22;
        g.fillStyle = '#c9c2b4';
        g.beginPath();
        g.arc(6 + p * 8, Math.sin(p * 5) * 2, 3 + p * 3.5, 0, Math.PI * 2);
        g.fill();
        g.restore();
      } else if (effect.kind === 'spawn') {
        g.save();
        if (glow) g.globalCompositeOperation = 'lighter';
        const rr = 8 + p * 22;
        g.globalAlpha = fade * 0.85;
        g.strokeStyle = color;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(x, y, rr, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = fade * 0.5;
        g.setLineDash([4, 6]);
        g.lineWidth = 1.4;
        g.beginPath();
        g.arc(x, y, rr * 0.66, t * 2, t * 2 + Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
        g.globalAlpha = fade * 0.35;
        g.beginPath();
        g.ellipse(x, y + 8, rr * 0.9, rr * 0.34, 0, 0, Math.PI * 2);
        g.stroke();
        g.restore();
      } else if (effect.kind === 'death') {
        g.save();
        g.globalAlpha = fade * 0.9;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + 0.4;
          const dist = p * (effect.r + 0.55) * T;
          const shard = Math.max(0.8, 3.6 * (1 - p));
          g.fillStyle = i % 3 === 0 ? '#efe6d8' : color;
          g.beginPath();
          g.arc(x + Math.cos(a) * dist, y + Math.sin(a) * dist - p * 6, shard, 0, Math.PI * 2);
          g.fill();
        }
        g.globalAlpha = fade * 0.14;
        g.fillStyle = '#0c0a10';
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2 + p;
          g.beginPath();
          g.arc(x + Math.cos(a) * p * 10, y - p * 8 - i, 7 + p * 9, 0, Math.PI * 2);
          g.fill();
        }
        if (glow) {
          g.globalCompositeOperation = 'lighter';
          g.globalAlpha = fade * 0.4;
          g.strokeStyle = color;
          g.lineWidth = 1.4;
          g.beginPath();
          g.arc(x, y, p * (effect.r + 0.9) * T, 0, Math.PI * 2);
          g.stroke();
        }
        g.restore();
      } else if (effect.kind === 'heal') {
        g.save();
        if (glow) g.globalCompositeOperation = 'lighter';
        g.strokeStyle = '#7cf0b8';
        g.lineWidth = 2.2;
        g.lineCap = 'round';
        for (let i = 0; i < 2; i++) {
          const rise = p * 22 + i * 9;
          const s = 4.5 - i * 1.2;
          const hx = x + (i === 0 ? 0 : 6);
          const hy = y - rise;
          g.globalAlpha = fade * (i === 0 ? 0.95 : 0.5);
          g.beginPath();
          g.moveTo(hx - s, hy);
          g.lineTo(hx + s, hy);
          g.moveTo(hx, hy - s);
          g.lineTo(hx, hy + s);
          g.stroke();
        }
        g.restore();
      } else if (effect.kind === 'place') {
        g.save();
        if (glow) g.globalCompositeOperation = 'lighter';
        const rr = 6 + p * 22;
        g.globalAlpha = fade * 0.85;
        g.strokeStyle = color;
        g.lineWidth = 2.2;
        g.beginPath();
        g.arc(x, y, rr, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = fade * 0.7;
        g.lineWidth = 1.6;
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + p * 1.6;
          g.beginPath();
          g.moveTo(x + Math.cos(a) * (rr + 3), y + Math.sin(a) * (rr + 3));
          g.lineTo(x + Math.cos(a) * (rr + 8), y + Math.sin(a) * (rr + 8));
          g.stroke();
        }
        g.globalAlpha = fade * 0.3;
        const beam = g.createLinearGradient(x, y - 26, x, y + 4);
        beam.addColorStop(0, withAlpha(color, 0));
        beam.addColorStop(0.7, withAlpha(color, 0.55));
        beam.addColorStop(1, withAlpha(color, 0));
        g.fillStyle = beam;
        g.fillRect(x - 3, y - 26, 6, 30);
        g.restore();
      } else if (effect.kind === 'poison') {
        g.save();
        if (glow) g.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 3; i++) {
          const ph = (p + i * 0.3) % 1;
          g.globalAlpha = fade * (1 - ph) * 0.75;
          g.fillStyle = '#9adf6a';
          g.beginPath();
          g.arc(x + Math.sin(ph * 8 + i) * 5, y - ph * 16, 2.4 * (1 - ph * 0.55), 0, Math.PI * 2);
          g.fill();
        }
        g.restore();
      } else if (effect.kind === 'leak') {
        g.save();
        const rr = 12 + p * 28;
        if (glow) this.drawGlow(g, '#ff4c4c', x, y, rr, fade * 0.45);
        g.globalAlpha = fade * 0.75;
        g.strokeStyle = '#ff5a5a';
        g.lineWidth = 2.4;
        g.beginPath();
        g.arc(x, y, rr, 0, Math.PI * 2);
        g.stroke();
        g.restore();
      }
    }
  }

  strokeBolt(g, points, offsetX = 0, offsetY = 0) {
    if (!points || points.length < 2) return;
    g.beginPath();
    for (let i = 0; i < points.length; i++) {
      const px = points[i].x * T;
      const py = points[i].y * T;
      if (i === 0) {
        g.moveTo(px, py);
        continue;
      }
      const prev = points[i - 1];
      const ax = prev.x * T;
      const ay = prev.y * T;
      const midX = (ax + px) / 2 + (Math.random() - 0.5) * 12;
      const midY = (ay + py) / 2 + (Math.random() - 0.5) * 12;
      g.lineTo(midX, midY);
      g.lineTo(px, py);
    }
    g.stroke();
  }

  drawFloaters(g) {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const floater of this.game.floaters) {
      const alpha = Math.max(0, Math.min(1, floater.ttl / floater.maxTtl));
      const x = floater.x * T;
      const y = floater.y * T;
      const size = floater.big ? 17 : 13;
      g.globalAlpha = alpha;
      g.font = `700 ${size}px "DejaVu Sans Mono", ui-monospace, monospace`;
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(0, 0, 0, 0.75)';
      g.strokeText(floater.text, x, y);
      g.fillStyle = floater.color;
      g.fillText(floater.text, x, y);
      g.globalAlpha = 1;
    }
  }

  drawPlacement(g) {
    const game = this.game;
    const hover = game.hover;

    if (!game.placementType || !hover) return;
    const { c, r } = hover;
    const inBounds = r >= 0 && r < game.map.rows && c >= 0 && c < game.map.cols;
    if (!inBounds) return;

    const ok = game.canBuild(c, r) && game.gold >= game.towerCost(game.placementType);
    const x = (c + 0.5) * T;
    const y = (r + 0.5) * T;
    const color = ok ? '#7ce38b' : '#ef5f5f';
    const stats = game.previewStats(game.placementType, 0);

    g.save();
    g.globalAlpha = 0.9;
    g.fillStyle = ok ? 'rgba(124, 227, 139, 0.12)' : 'rgba(239, 95, 95, 0.14)';
    g.fillRect(c * T + 2, r * T + 2, T - 4, T - 4);
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.strokeRect(c * T + 2, r * T + 2, T - 4, T - 4);

    g.beginPath();
    g.arc(x, y, stats.range * T, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255, 255, 255, 0.04)';
    g.fill();
    g.setLineDash([5, 5]);
    g.strokeStyle = ok ? 'rgba(124, 227, 139, 0.5)' : 'rgba(239, 95, 95, 0.5)';
    g.lineWidth = 1.4;
    g.stroke();
    g.setLineDash([]);

    g.globalAlpha = 0.6;
    g.save();
    g.translate(x, y);
    g.rotate(-Math.PI / 2);
    this.drawTowerShape(g, game.placementType, 0, 1);
    g.restore();
    g.globalAlpha = 1;
    g.restore();
  }
}

function biomePalette(map) {
  const palettes = {
    canyon: {
      grass1: '#13221a', grass2: '#101c16', grid: 'rgba(110, 190, 140, 0.05)',
      pathEdge: '#19130f', path: '#322619', pathInner: '#463425',
      pathLine: 'rgba(214, 178, 126, 0.22)', tuft: '96, 180, 128',
      rock: '#3c4a4f', rockEdge: '#66777d', accent: '#8fe0a8', ambient: 'rgba(120, 220, 160, ',
    },
    twin: {
      grass1: '#112228', grass2: '#0e1d22', grid: 'rgba(110, 200, 210, 0.05)',
      pathEdge: '#101b20', path: '#213238', pathInner: '#2e464e',
      pathLine: 'rgba(120, 210, 220, 0.2)', tuft: '80, 170, 180',
      rock: '#3a4c53', rockEdge: '#5f7c86', accent: '#5ce2d0', ambient: 'rgba(90, 210, 220, ',
    },
    triple: {
      grass1: '#241817', grass2: '#1e1413', grid: 'rgba(220, 120, 100, 0.045)',
      pathEdge: '#1d0f0c', path: '#3a211b', pathInner: '#523026',
      pathLine: 'rgba(255, 150, 110, 0.2)', tuft: '190, 100, 90',
      rock: '#4b3a38', rockEdge: '#76564f', accent: '#ff8a6b', ambient: 'rgba(255, 120, 90, ',
    },
    ring: {
      grass1: '#1a1630', grass2: '#151228', grid: 'rgba(150, 130, 220, 0.05)',
      pathEdge: '#140f22', path: '#2b2340', pathInner: '#403356',
      pathLine: 'rgba(190, 160, 255, 0.22)', tuft: '130, 110, 200',
      rock: '#413a58', rockEdge: '#6b5f8c', accent: '#b48cff', ambient: 'rgba(170, 130, 255, ',
    },
    cross: {
      grass1: '#222015', grass2: '#1c1a12', grid: 'rgba(220, 200, 120, 0.05)',
      pathEdge: '#1b160d', path: '#3a3320', pathInner: '#54492e',
      pathLine: 'rgba(255, 220, 130, 0.2)', tuft: '180, 170, 90',
      rock: '#4a4638', rockEdge: '#756c52', accent: '#ffd36b', ambient: 'rgba(255, 210, 110, ',
    },
  };
  return palettes[map.archetype] || palettes.canyon;
}

function withAlpha(color, alpha) {
  if (!color) return `rgba(255, 255, 255, ${alpha})`;
  if (color.startsWith('#')) return hexToRgba(color, alpha);
  const match = /^rgba?\(([^)]+)\)/.exec(color);
  if (match) {
    const [r, g, b] = match[1].split(',').map((v) => v.trim());
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}

function hexToRgba(hex, alpha) {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function shade(hex, amount) {
  const value = hex.replace('#', '');
  const r = Math.max(0, Math.min(255, parseInt(value.slice(0, 2), 16) * (1 + amount)));
  const g = Math.max(0, Math.min(255, parseInt(value.slice(2, 4), 16) * (1 + amount)));
  const b = Math.max(0, Math.min(255, parseInt(value.slice(4, 6), 16) * (1 + amount)));
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}
