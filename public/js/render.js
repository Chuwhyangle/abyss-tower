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

    g.fillStyle = '#0a110d';
    g.fillRect(0, 0, this.W, this.H);

    // 草地棋盘
    for (let r = 0; r < map.rows; r++) {
      for (let c = 0; c < map.cols; c++) {
        const shimmer = rng.float() * 10;
        g.fillStyle =
          (c + r) % 2 === 0
            ? `rgb(${15 + shimmer * 0.4}, ${27 + shimmer * 0.5}, ${20 + shimmer * 0.3})`
            : `rgb(${13 + shimmer * 0.3}, ${24 + shimmer * 0.4}, ${18 + shimmer * 0.3})`;
        g.fillRect(c * T, r * T, T, T);
      }
    }

    // 细网格
    g.strokeStyle = 'rgba(110, 170, 130, 0.05)';
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
      g.strokeStyle = `rgba(96, 160, 118, ${0.08 + rng.float() * 0.12})`;
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
      strokePath(pts, T * 0.9, 'rgba(0,0,0,0.35)');
      strokePath(pts, T * 0.8, '#2b221a');
      strokePath(pts, T * 0.64, '#3d2f24');
      strokePath(pts, T * 0.5, 'rgba(84, 66, 49, 0.55)');
      // 多入口时用细线区分路线
      if (lanes.length > 1) {
        g.save();
        g.globalAlpha = 0.28;
        strokePath(pts, 2.2, lane.color);
        g.restore();
      }

      // 路面碎石
      const pebbles = Math.ceil(pebbleCount / lanes.length);
      for (let i = 0; i < pebbles; i++) {
        const d = rng.float() * lane.len;
        const p = this.game.posAt(d, laneIndex);
        const ox = rng.range(-0.24, 0.24) * T;
        const oy = rng.range(-0.24, 0.24) * T;
        g.fillStyle = `rgba(${120 + rng.int(40)}, ${98 + rng.int(30)}, ${76 + rng.int(20)}, ${0.12 + rng.float() * 0.18})`;
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
      g.fillStyle = '#3a4348';
      g.strokeStyle = '#596369';
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
      g.restore();
    }

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

  drawPortals(g) {
    const map = this.game.map;
    const t = this.time;
    const glowOn = this.settings.glow;
    const spawns = map.spawns?.length
      ? map.spawns
      : [{ x: map.spawn.x, y: map.spawn.y, color: '#c9a8ff' }];
    const active = new Set(
      this.game.activePortals?.length ? this.game.activePortals : [0]
    );
    const pulse = 0.85 + Math.sin(t * 3) * 0.15;

    spawns.forEach((spawn, index) => {
      const sx = spawn.x * T;
      const sy = spawn.y * T;
      const color = spawn.color || '#c9a8ff';
      const isActive = active.has(index);
      g.save();
      if (!isActive) g.globalAlpha = 0.35;

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
      g.fillText(String(index + 1), 0, 0);
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
    for (const tower of game.towers) {
      const x = tower.x * T;
      const y = tower.y * T;
      const def = TOWERS[tower.type];

      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.beginPath();
      g.ellipse(x, y + 11, 18, 8, 0, 0, Math.PI * 2);
      g.fill();

      // 底座
      g.fillStyle = '#0e171d';
      g.strokeStyle = hexToRgba(def.color, 0.55);
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, 16.5, 0, Math.PI * 2);
      g.fill();
      g.stroke();

      g.fillStyle = hexToRgba(def.color, 0.16);
      g.beginPath();
      g.arc(x, y, 12.5, 0, Math.PI * 2);
      g.fill();

      g.save();
      g.translate(x, y);
      g.rotate(tower.angle);
      this.drawTowerShape(g, tower.type, tower.recoil || 0, 1);
      g.restore();

      // 等级指示
      const pips = tower.level + 1;
      for (let i = 0; i < pips; i++) {
        g.fillStyle = '#ffd36b';
        const offset = (i - (pips - 1) / 2) * 6;
        g.fillRect(x + offset - 1.6, y + 17, 3.2, 3.2);
      }

      if (game.selectedTower === tower) {
        g.strokeStyle = 'rgba(255, 211, 107, 0.9)';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(x, y, 19.5, 0, Math.PI * 2);
        g.stroke();
      }
    }
  }

  drawTowerShape(g, type, recoil, alpha) {
    const def = TOWERS[type];
    const push = -recoil * 3;
    g.globalAlpha = alpha;

    if (type === 'arrow') {
      g.fillStyle = '#243329';
      g.strokeStyle = def.color;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(0, 0, 8, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.strokeStyle = def.color;
      g.lineWidth = 2.4;
      g.beginPath();
      g.moveTo(2 + push, -7);
      g.quadraticCurveTo(11 + push, 0, 2 + push, 7);
      g.stroke();
      g.strokeStyle = '#d9ffe6';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(push, 0);
      g.lineTo(17 + push, 0);
      g.stroke();
      g.fillStyle = '#d9ffe6';
      g.beginPath();
      g.moveTo(21 + push, 0);
      g.lineTo(15 + push, -4);
      g.lineTo(15 + push, 4);
      g.closePath();
      g.fill();
    } else if (type === 'cannon') {
      g.fillStyle = '#3a3630';
      g.strokeStyle = def.color;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(0, 0, 9, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = '#4c443a';
      g.strokeStyle = '#8c7a60';
      g.lineWidth = 2;
      roundRect(g, 2 + push, -6.5, 18, 13, 4);
      g.fill();
      g.stroke();
      g.fillStyle = def.color;
      g.beginPath();
      g.arc(20 + push, 0, 4.4, 0, Math.PI * 2);
      g.fill();
    } else if (type === 'frost') {
      g.save();
      g.rotate(this.time * 0.9);
      g.strokeStyle = def.color;
      g.lineWidth = 2.2;
      for (let i = 0; i < 6; i++) {
        g.rotate(Math.PI / 3);
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(13, 0);
        g.moveTo(9, -3.5);
        g.lineTo(13, 0);
        g.lineTo(9, 3.5);
        g.stroke();
      }
      g.fillStyle = 'rgba(160, 230, 255, 0.9)';
      g.beginPath();
      g.arc(0, 0, 4.2, 0, Math.PI * 2);
      g.fill();
      g.restore();
    } else if (type === 'arc') {
      g.fillStyle = '#241f33';
      g.strokeStyle = def.color;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(0, 0, 8, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      const flicker = Math.sin(this.time * 18) * 1.5;
      g.strokeStyle = '#e3d2ff';
      g.lineWidth = 2.4;
      g.beginPath();
      g.moveTo(1 + push, 0);
      g.lineTo(7 + push, -5 + flicker);
      g.lineTo(11 + push, 4 - flicker);
      g.lineTo(17 + push, -1);
      g.stroke();
      g.fillStyle = '#c9a8ff';
      g.beginPath();
      g.arc(17 + push, -1, 2.6, 0, Math.PI * 2);
      g.fill();
    } else if (type === 'poison') {
      g.fillStyle = '#1c2a18';
      g.strokeStyle = def.color;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(0, 0, 8, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = '#35502a';
      g.strokeStyle = def.color;
      g.beginPath();
      g.arc(15 + push, 0, 8, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = 'rgba(154, 223, 106, 0.85)';
      for (let i = 0; i < 3; i++) {
        const phase = (this.time * 0.8 + i * 0.5) % 1;
        g.beginPath();
        g.arc(15 + push + Math.sin(i * 2 + this.time * 2) * 3, -phase * 7, 1.6 + phase * 1.2, 0, Math.PI * 2);
        g.fill();
      }
    }

    g.globalAlpha = 1;
  }

  drawEnemies(g) {
    const game = this.game;
    for (const enemy of game.enemies) {
      if (enemy.dead) continue;
      const def = ENEMIES[enemy.type];
      const x = enemy.x * T;
      const y = enemy.y * T;
      const r = enemy.r * T;
      const lift = enemy.flying ? 12 : 0;

      g.fillStyle = `rgba(0,0,0,${enemy.flying ? 0.22 : 0.3})`;
      g.beginPath();
      g.ellipse(x, y + 7, r * 0.95, r * 0.45, 0, 0, Math.PI * 2);
      g.fill();

      g.save();
      g.translate(x, y - lift);
      if (def.shape === 'dart' || def.shape === 'blob' || def.shape === 'hex') {
        g.rotate(enemy.angle);
      }

      if (enemy.boss && this.settings.glow) {
        const glow = g.createRadialGradient(0, 0, r * 0.5, 0, 0, r * 2);
        glow.addColorStop(0, 'rgba(226, 96, 158, 0.28)');
        glow.addColorStop(1, 'rgba(226, 96, 158, 0)');
        g.fillStyle = glow;
        g.beginPath();
        g.arc(0, 0, r * 2, 0, Math.PI * 2);
        g.fill();
      }

      g.fillStyle = def.color;
      g.strokeStyle = shade(def.color, -0.42);
      g.lineWidth = 2;

      switch (def.shape) {
        case 'blob': {
          g.beginPath();
          g.arc(0, 0, r, 0, Math.PI * 2);
          g.fill();
          g.stroke();
          g.fillStyle = 'rgba(20, 20, 26, 0.8)';
          g.beginPath();
          g.arc(r * 0.35, -r * 0.18, r * 0.13, 0, Math.PI * 2);
          g.arc(r * 0.35, r * 0.3, r * 0.13, 0, Math.PI * 2);
          g.fill();
          break;
        }
        case 'dart': {
          g.beginPath();
          g.moveTo(r * 1.3, 0);
          g.lineTo(-r * 0.8, -r * 0.8);
          g.lineTo(-r * 0.35, 0);
          g.lineTo(-r * 0.8, r * 0.8);
          g.closePath();
          g.fill();
          g.stroke();
          break;
        }
        case 'bug': {
          g.beginPath();
          g.arc(0, 0, r, 0, Math.PI * 2);
          g.fill();
          g.stroke();
          g.strokeStyle = shade(def.color, -0.5);
          g.lineWidth = 1.4;
          for (let i = 0; i < 3; i++) {
            const px = (i - 1) * r * 0.45;
            g.beginPath();
            g.moveTo(px, -r * 0.7);
            g.lineTo(px + Math.sin(this.time * 10 + i) * 2, -r * 1.25);
            g.stroke();
          }
          break;
        }
        case 'hex': {
          g.beginPath();
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
            const px = Math.cos(a) * r;
            const py = Math.sin(a) * r;
            i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
          }
          g.closePath();
          g.fill();
          g.stroke();
          g.fillStyle = shade(def.color, -0.3);
          g.beginPath();
          g.arc(0, 0, r * 0.42, 0, Math.PI * 2);
          g.fill();
          break;
        }
        case 'wing': {
          const flap = Math.sin(this.time * 14 + enemy.id) * 0.5;
          g.fillStyle = shade(def.color, -0.25);
          g.beginPath();
          g.ellipse(-r * 0.55, -flap * r * 0.4, r * 0.7, r * 0.32, -0.5 - flap, 0, Math.PI * 2);
          g.ellipse(r * 0.55, -flap * r * 0.4, r * 0.7, r * 0.32, 0.5 + flap, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = def.color;
          g.beginPath();
          g.moveTo(r * 0.9, 0);
          g.lineTo(0, -r * 0.55);
          g.lineTo(-r * 0.9, 0);
          g.lineTo(0, r * 0.55);
          g.closePath();
          g.fill();
          g.stroke();
          break;
        }
        case 'priest': {
          g.beginPath();
          g.arc(0, 0, r, 0, Math.PI * 2);
          g.fill();
          g.stroke();
          g.strokeStyle = '#d9fff0';
          g.lineWidth = 2.4;
          g.beginPath();
          g.moveTo(0, -r * 0.62);
          g.lineTo(0, r * 0.62);
          g.moveTo(-r * 0.42, -r * 0.1);
          g.lineTo(r * 0.42, -r * 0.1);
          g.stroke();
          break;
        }
        case 'boss': {
          g.beginPath();
          for (let i = 0; i < 16; i++) {
            const a = (i / 16) * Math.PI * 2;
            const rad = i % 2 === 0 ? r : r * 0.78;
            const px = Math.cos(a) * rad;
            const py = Math.sin(a) * rad;
            i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
          }
          g.closePath();
          g.fill();
          g.stroke();
          g.fillStyle = '#2a0f1e';
          g.beginPath();
          g.arc(0, 0, r * 0.5, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = '#ffb3d9';
          g.beginPath();
          g.arc(0, 0, r * 0.22, 0, Math.PI * 2);
          g.fill();
          break;
        }
        default:
          g.beginPath();
          g.arc(0, 0, r, 0, Math.PI * 2);
          g.fill();
          g.stroke();
      }

      if (enemy.hitFlash > 0) {
        g.globalAlpha = enemy.hitFlash * 0.55;
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.arc(0, 0, r * 1.05, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 1;
      }

      if (this.time < enemy.slowUntil) {
        g.strokeStyle = 'rgba(124, 212, 245, 0.85)';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(0, 0, r + 4, 0, Math.PI * 2);
        g.stroke();
      }
      if (this.time < enemy.poisonUntil) {
        g.strokeStyle = 'rgba(154, 223, 106, 0.55)';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(0, 0, r + 7, 0.4, 0.4 + Math.PI * 1.1);
        g.stroke();
      }

      g.restore();

      // 血条
      if (enemy.hp < enemy.maxHp) {
        const width = enemy.boss ? 64 : Math.max(22, r * 2.2);
        const bx = x - width / 2;
        const by = y - lift - r - 10;
        g.fillStyle = 'rgba(0, 0, 0, 0.6)';
        g.fillRect(bx - 1, by - 1, width + 2, 5);
        const ratio = Math.max(0, enemy.hp / enemy.maxHp);
        g.fillStyle = ratio > 0.55 ? '#7ce38b' : ratio > 0.25 ? '#e8c35a' : '#ef5f5f';
        g.fillRect(bx, by, width * ratio, 3);
      }
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
        g.strokeStyle = 'rgba(255, 160, 90, 0.25)';
        g.lineWidth = 5;
        g.beginPath();
        g.moveTo(-16, 0);
        g.lineTo(-4, 0);
        g.stroke();
        g.fillStyle = '#2c3138';
        g.strokeStyle = '#ffb066';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(0, 0, 5, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      } else if (proj.kind === 'frost') {
        g.strokeStyle = 'rgba(124, 212, 245, 0.3)';
        g.lineWidth = 4;
        g.beginPath();
        g.moveTo(-14, 0);
        g.lineTo(-3, 0);
        g.stroke();
        g.fillStyle = '#d8f6ff';
        g.strokeStyle = '#7cd4f5';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(5, 0);
        g.lineTo(0, -4);
        g.lineTo(-5, 0);
        g.lineTo(0, 4);
        g.closePath();
        g.fill();
        g.stroke();
      } else if (proj.kind === 'poison') {
        g.strokeStyle = 'rgba(154, 223, 106, 0.25)';
        g.lineWidth = 4;
        g.beginPath();
        g.moveTo(-12, 0);
        g.lineTo(-3, 0);
        g.stroke();
        g.fillStyle = '#9adf6a';
        g.beginPath();
        g.arc(0, 0, 4.2, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#3f6b2c';
        g.lineWidth = 1.2;
        g.stroke();
      } else {
        g.strokeStyle = '#ffe9b0';
        g.lineWidth = 2.2;
        g.beginPath();
        g.moveTo(-9, 0);
        g.lineTo(5, 0);
        g.stroke();
        g.fillStyle = '#fff8dd';
        g.beginPath();
        g.moveTo(8, 0);
        g.lineTo(3, -2.5);
        g.lineTo(3, 2.5);
        g.closePath();
        g.fill();
      }
      g.restore();
    }
  }

  drawEffects(g) {
    for (const effect of this.game.effects) {
      const k = effect.ttl / (effect.maxTtl || 0.3);
      const p = 1 - Math.max(0, Math.min(1, k));
      const x = effect.x * T;
      const y = effect.y * T;

      if (effect.kind === 'ring') {
        g.globalAlpha = 1 - p;
        g.strokeStyle = effect.color;
        g.lineWidth = 3.5;
        g.beginPath();
        g.arc(x, y, (effect.r0 + (effect.r1 - effect.r0) * p) * T, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      } else if (effect.kind === 'spark') {
        g.globalAlpha = 1 - p;
        g.strokeStyle = effect.color;
        g.lineWidth = 1.6;
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + p * 2;
          g.beginPath();
          g.moveTo(x + Math.cos(a) * 3, y + Math.sin(a) * 3);
          g.lineTo(x + Math.cos(a) * (7 + p * 9), y + Math.sin(a) * (7 + p * 9));
          g.stroke();
        }
        g.globalAlpha = 1;
      } else if (effect.kind === 'bolt') {
        if (this.settings.glow) {
          g.globalAlpha = (1 - p * 0.5) * 0.3;
          g.strokeStyle = effect.color;
          g.lineWidth = 6;
          this.strokeBolt(g, effect.points, x, y);
        }
        g.globalAlpha = 1 - p;
        g.strokeStyle = '#f2eaff';
        g.lineWidth = 2;
        this.strokeBolt(g, effect.points, x, y);
        g.globalAlpha = 1;
      } else if (effect.kind === 'muzzle') {
        g.globalAlpha = 1 - p;
        g.save();
        g.translate(x, y);
        g.rotate(effect.angle);
        g.fillStyle = effect.color;
        g.beginPath();
        g.moveTo(0, -4);
        g.lineTo(9, 0);
        g.lineTo(0, 4);
        g.closePath();
        g.fill();
        g.restore();
        g.globalAlpha = 1;
      } else if (effect.kind === 'spawn') {
        g.globalAlpha = 1 - p;
        g.strokeStyle = effect.color;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(x, y, 8 + p * 18, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      } else if (effect.kind === 'death') {
        g.globalAlpha = (1 - p) * 0.9;
        g.fillStyle = effect.color;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + p * 1.5;
          const dist = p * (effect.r + 0.5) * T;
          g.beginPath();
          g.arc(x + Math.cos(a) * dist, y + Math.sin(a) * dist, Math.max(1, 4 * (1 - p)), 0, Math.PI * 2);
          g.fill();
        }
        g.globalAlpha = 1;
      } else if (effect.kind === 'heal') {
        g.globalAlpha = 1 - p;
        g.strokeStyle = '#7cf0b8';
        g.lineWidth = 2.4;
        const hx = x;
        const hy = y - p * 18;
        g.beginPath();
        g.moveTo(hx - 5, hy);
        g.lineTo(hx + 5, hy);
        g.moveTo(hx, hy - 5);
        g.lineTo(hx, hy + 5);
        g.stroke();
        g.globalAlpha = 1;
      } else if (effect.kind === 'place') {
        g.globalAlpha = 1 - p;
        g.strokeStyle = effect.color || '#ffd36b';
        g.lineWidth = 2.5;
        g.beginPath();
        g.arc(x, y, 6 + p * 22, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      } else if (effect.kind === 'poison') {
        g.globalAlpha = 1 - p;
        g.fillStyle = '#9adf6a';
        g.beginPath();
        g.arc(x + Math.sin(p * 9) * 5, y - p * 14, 2.4 * (1 - p * 0.5), 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 1;
      } else if (effect.kind === 'leak') {
        g.globalAlpha = 1 - p;
        g.fillStyle = 'rgba(255, 70, 70, 0.5)';
        g.beginPath();
        g.arc(x, y, 12 + p * 26, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 1;
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
