// 弹道绘制：炮弹/冰锥/电球/毒液/箭矢五种形态。
// 性能约束：按类型分桶批量绘制，轨迹与弹体使用缓存贴图，低配整帧关闭拖尾；
// 每帧不产生临时对象（固定桶 + 贴图缓存），也不改动模拟状态与随机数。
import { TILE } from '../shared/data.js';

const T = TILE;
// 贴图按 2x 光栅化，DPR 1/2 都能保持边缘清晰。
export const PROJECTILE_SPRITE_SCALE = 2;

export const PROJECTILE_KINDS = ['shell', 'frost', 'shock', 'poison', 'bolt'];

export const PROJECTILE_PROFILES = {
  low: { tier: 'low', trails: false, frameBudget: 192, layers: 1 },
  high: { tier: 'high', trails: true, frameBudget: 384, layers: 2 },
};

// 与 settings.js 的高配预设对齐：完整装饰，或高 DPR + 光晕，才画拖尾。
export function projectileProfile(settings = {}) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const high = source.decorations === 'full' || (source.glow === true && Number(source.dpr) >= 2);
  return high ? PROJECTILE_PROFILES.high : PROJECTILE_PROFILES.low;
}

// 图形定义：w/h 为逻辑尺寸，ox/oy 为贴图内弹体中心偏移。
// draw(g) 在已平移到中心的逻辑坐标系里绘制，坐标与原逐帧绘制完全一致。
export const PROJECTILE_ART = {
  shell: {
    trail: {
      w: 30, h: 12, ox: 30, oy: 6,
      draw(g) {
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
      },
    },
    body: {
      w: 20, h: 20, ox: 10, oy: 10,
      draw(g) {
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
      },
    },
    glow: { color: '#ffb066', radius: 12, alpha: 0.55 },
  },
  frost: {
    trail: {
      w: 20, h: 8, ox: 19, oy: 4,
      draw(g) {
        g.strokeStyle = 'rgba(124, 212, 245, 0.3)';
        g.lineWidth = 5;
        g.beginPath();
        g.moveTo(-18, 0);
        g.lineTo(-3, 0);
        g.stroke();
      },
    },
    body: {
      w: 16, h: 16, ox: 8, oy: 8,
      draw(g) {
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
      },
    },
    glow: { color: '#a0ebff', radius: 11, alpha: 0.5 },
  },
  shock: {
    trail: {
      w: 18, h: 8, ox: 17, oy: 4,
      draw(g) {
        g.strokeStyle = 'rgba(111, 227, 200, 0.3)';
        g.lineWidth = 5;
        g.beginPath();
        g.moveTo(-16, 0);
        g.lineTo(-3, 0);
        g.stroke();
      },
    },
    body: {
      w: 20, h: 20, ox: 10, oy: 10,
      draw(g) {
        g.fillStyle = '#b9fff0';
        g.strokeStyle = '#6fe3c8';
        g.lineWidth = 1.6;
        g.beginPath();
        g.arc(0, 0, 4.6, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.strokeStyle = 'rgba(210, 255, 246, 0.7)';
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(0, 0, 7.4, -0.9, 0.9);
        g.stroke();
      },
    },
    glow: { color: '#6fe3c8', radius: 11, alpha: 0.5 },
  },
  poison: {
    trail: {
      w: 18, h: 8, ox: 17, oy: 4,
      draw(g) {
        g.strokeStyle = 'rgba(154, 223, 106, 0.28)';
        g.lineWidth = 5;
        g.beginPath();
        g.moveTo(-16, 0);
        g.lineTo(-3, 0);
        g.stroke();
      },
    },
    body: {
      w: 14, h: 14, ox: 7, oy: 7,
      draw(g) {
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
      },
    },
    glow: { color: '#9adf6a', radius: 10, alpha: 0.45 },
  },
  bolt: {
    trail: {
      w: 20, h: 8, ox: 17, oy: 4,
      draw(g) {
        g.strokeStyle = 'rgba(255, 233, 176, 0.35)';
        g.lineWidth = 5;
        g.beginPath();
        g.moveTo(-16, 0);
        g.lineTo(2, 0);
        g.stroke();
      },
    },
    body: {
      w: 24, h: 10, ox: 13, oy: 5,
      draw(g) {
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
      },
    },
    glow: null,
  },
};

export function projectileArt(kind) {
  return PROJECTILE_ART[kind] || PROJECTILE_ART.bolt;
}

// 单个投射物每帧的 drawImage 次数上界：弹体 1 次，拖尾 1 次，光晕 1 次。
export function projectileDrawCost(kind, profile = PROJECTILE_PROFILES.high, settings = {}) {
  let cost = 1;
  if (profile?.trails) cost++;
  if (settings && settings.glow === true && projectileArt(kind).glow) cost++;
  return cost;
}

// 给定各类型数量，估算一帧的 drawImage 次数；用于回归断言。
export function frameDrawCalls(counts, profile = PROJECTILE_PROFILES.high, settings = {}) {
  const source = counts && typeof counts === 'object' ? counts : {};
  let total = 0;
  for (const kind of PROJECTILE_KINDS) {
    const raw = source[kind];
    const count = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
    total += count * projectileDrawCost(kind, profile, settings);
  }
  return total;
}

// 分桶与贴图都在构造时固定，渲染循环不为每个投射物分配对象。
export const PROJECTILE_TEMPS_PER_FRAME = 0;

const defaultCreateCanvas = () => {
  if (typeof document === 'undefined') {
    throw new Error('ProjectileRenderer 需要注入 createCanvas（无 document 环境）');
  }
  return document.createElement('canvas');
};

function renderSprite(factory, spec) {
  const canvas = factory();
  canvas.width = Math.max(1, Math.round(spec.w * PROJECTILE_SPRITE_SCALE));
  canvas.height = Math.max(1, Math.round(spec.h * PROJECTILE_SPRITE_SCALE));
  const g = canvas.getContext('2d');
  g.scale(PROJECTILE_SPRITE_SCALE, PROJECTILE_SPRITE_SCALE);
  g.translate(spec.ox, spec.oy);
  spec.draw(g);
  return canvas;
}

class ProjectileSpriteCache {
  constructor(createCanvas) {
    this._createCanvas = createCanvas;
    this._cache = new Map();
  }

  get(kind, layer) {
    const key = `${kind}:${layer}`;
    const hit = this._cache.get(key);
    if (hit) return hit;
    const spec = projectileArt(kind)[layer];
    if (!spec) return null;
    const sprite = renderSprite(this._createCanvas, spec);
    this._cache.set(key, sprite);
    return sprite;
  }

  get size() {
    return this._cache.size;
  }
}

export class ProjectileRenderer {
  constructor(game, { glow, createCanvas } = {}) {
    this.game = game;
    this.glow = glow;
    this.sprites = new ProjectileSpriteCache(createCanvas || defaultCreateCanvas);
    this._buckets = new Map();
    for (const kind of PROJECTILE_KINDS) this._buckets.set(kind, []);
    this._other = [];
    this.drawCalls = 0;
    this.drawn = 0;
    this.lastProfile = PROJECTILE_PROFILES.low;
  }

  render(g, settings) {
    const profile = projectileProfile(settings);
    this.lastProfile = profile;
    const glowOn = !!(settings && settings.glow);
    if (this.glow && typeof this.glow.configure === 'function') this.glow.configure(settings);

    for (const bucket of this._buckets.values()) bucket.length = 0;
    this._other.length = 0;

    const projectiles = this.game.projectiles;
    let total = 0;
    for (let i = 0; i < projectiles.length && total < profile.frameBudget; i++) {
      const proj = projectiles[i];
      const bucket = this._buckets.get(proj.kind) || this._other;
      bucket.push(proj);
      total++;
    }

    let calls = 0;
    for (const kind of PROJECTILE_KINDS) {
      const list = this._buckets.get(kind);
      if (list.length) calls += this._renderBatch(g, kind, list, profile, glowOn);
    }
    for (let i = 0; i < this._other.length; i++) {
      calls += this._renderBatch(g, 'bolt', this._other, profile, glowOn, i, i + 1);
    }
    this.drawCalls = calls;
    this.drawn = total;
  }

  // start/end 允许只画 `_other` 桶里的单个元素，避免未知类型各自建数组。
  _renderBatch(g, kind, list, profile, glowOn, start = 0, end = list.length) {
    const art = projectileArt(kind);
    const body = this.sprites.get(kind, 'body');
    const bodySpec = art.body;
    const trail = profile.trails ? this.sprites.get(kind, 'trail') : null;
    const trailSpec = art.trail;
    const glowSpec = glowOn && art.glow ? art.glow : null;
    let calls = 0;

    for (let i = start; i < end; i++) {
      const proj = list[i];
      g.save();
      g.translate(proj.x * T, proj.y * T);
      g.rotate(proj.angle || 0);
      if (trail && trailSpec) {
        g.drawImage(trail, -trailSpec.ox, -trailSpec.oy, trailSpec.w, trailSpec.h);
        calls++;
      }
      if (glowSpec && this.glow && this.glow.draw(g, glowSpec.color, 0, 0, glowSpec.radius, glowSpec.alpha)) {
        calls++;
      }
      g.drawImage(body, -bodySpec.ox, -bodySpec.oy, bodySpec.w, bodySpec.h);
      calls++;
      g.restore();
    }
    return calls;
  }
}
