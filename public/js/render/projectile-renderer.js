// 弹道渲染编排：按类型分桶批量绘制，轨迹与弹体使用缓存贴图，低配整帧关闭拖尾；
// 每帧不产生临时对象（固定桶 + 贴图缓存），也不改动模拟状态与随机数。
//
// 形态表与逐弹种绘制规格在 projectile-draw.js，本模块只留贴图光栅化缓存与逐桶编排。
import { TILE } from '../shared/data.js';
import { DOCTRINES } from '../shared/doctrines.js';
import { projectileArt, projectileTowerForm } from './projectile-draw.js';

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
// 单个投射物每帧的 drawImage 次数上界：弹体 1 次，拖尾 1 次，光晕 1 次。
// 传入 towerType 时按塔型形态计算，否则维持按 kind 的旧成本（向后兼容）。
export function projectileDrawCost(kind, profile = PROJECTILE_PROFILES.high, settings = {}, towerType = null) {
  const art = projectileTowerForm(towerType) || projectileArt(kind);
  let cost = 1;
  if (profile?.trails) cost++;
  if (settings && settings.glow === true && art.glow) cost++;
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

  // 塔型形态的贴图由渲染器按塔型缓存，不进入 kind 键空间。
  rasterize(spec) {
    return renderSprite(this._createCanvas, spec);
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
    // 塔型形态贴图：按 towerType 缓存，首帧惰性光栅化，跨帧复用。
    this._towerSlots = new Map();
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

  // 塔型形态槽位：首次遇到该塔型时创建一次，未知塔型缓存 null 以回退到 kind。
  _towerSlot(proj) {
    const towerType = proj && proj.towerType;
    if (typeof towerType !== 'string') return null;
    const cached = this._towerSlots.get(towerType);
    if (cached !== undefined) return cached;
    const form = projectileTowerForm(towerType);
    const slot = form ? { form, body: null, trail: null } : null;
    this._towerSlots.set(towerType, slot);
    return slot;
  }

  // start/end 允许只画 `_other` 桶里的单个元素，避免未知类型各自建数组。
  _renderBatch(g, kind, list, profile, glowOn, start = 0, end = list.length) {
    const baseArt = projectileArt(kind);
    let baseBody = null;
    let baseTrail = null;
    let baseLoaded = false;
    let calls = 0;

    for (let i = start; i < end; i++) {
      const proj = list[i];
      const slot = this._towerSlot(proj);
      const art = slot ? slot.form : baseArt;
      const bodySpec = art.body;
      const glowSpec = glowOn && art.glow ? art.glow : null;

      if (!slot && !baseLoaded) {
        // 只有真正用到 kind 兜底形态时才光栅化，避免纯塔型场景多建贴图。
        baseBody = this.sprites.get(kind, 'body');
        if (profile.trails) baseTrail = this.sprites.get(kind, 'trail');
        baseLoaded = true;
      }

      let body = slot ? slot.body : baseBody;
      if (!body) {
        body = this.sprites.rasterize(bodySpec);
        if (slot) slot.body = body;
      }

      let trail = null;
      let trailSpec = null;
      if (profile.trails && art.trail) {
        trail = slot ? slot.trail : baseTrail;
        if (!trail) {
          trail = this.sprites.rasterize(art.trail);
          if (slot) slot.trail = trail;
        }
        trailSpec = art.trail;
      }

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
      // 教义弹道变体：该塔类选了教义时，弹体加一圈教义色光环（可见变化）；
      // 未选教义（doctrineForTower 返回 null）时整段不执行，不新增绘制调用。
      const doctrineId = this.game.doctrineForTower?.(proj.towerType) || null;
      if (doctrineId && DOCTRINES[doctrineId]) {
        g.strokeStyle = DOCTRINES[doctrineId].color;
        g.lineWidth = 1.4;
        g.beginPath();
        g.arc(0, 0, 9, 0, Math.PI * 2);
        g.stroke();
        calls++;
      }
      g.restore();
    }
    return calls;
  }
}
