// 光晕贴图缓存：每帧新建 radial gradient 在软件渲染下开销明显，按颜色缓存一次。
// 低配档位直接跳过额外光晕；缓存条数有上限，避免配色变化时无限增长。
import { Palette } from './palette.js';

export const GLOW_QUALITY = {
  low: { enabled: false, layers: 1, alphaScale: 0.6, maxEntries: 8 },
  high: { enabled: true, layers: 2, alphaScale: 1, maxEntries: 24 },
};

export function glowQuality(settings = {}) {
  const source = settings && typeof settings === 'object' ? settings : {};
  return source.glow === true ? GLOW_QUALITY.high : GLOW_QUALITY.low;
}

function drawSprite(color) {
  const size = 64;
  const sprite = document.createElement('canvas');
  sprite.width = size;
  sprite.height = size;
  const sg = sprite.getContext('2d');
  const grad = sg.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, Palette.withAlpha(color, 1));
  grad.addColorStop(0.45, Palette.withAlpha(color, 0.35));
  grad.addColorStop(1, Palette.withAlpha(color, 0));
  sg.fillStyle = grad;
  sg.fillRect(0, 0, size, size);
  return sprite;
}

export class GlowRenderer {
  constructor({ capacity = GLOW_QUALITY.high.maxEntries, createSprite = drawSprite } = {}) {
    this._glowCache = new Map();
    this.capacity = Math.max(1, Math.floor(capacity) || 1);
    this._createSprite = createSprite;
    this._quality = GLOW_QUALITY.high;
  }

  // 由渲染入口每帧同步当前设置；低配时 draw() 直接返回 false。
  configure(settings) {
    this._quality = glowQuality(settings);
    this._prune();
    return this._quality;
  }

  get quality() {
    return this._quality;
  }

  get size() {
    return this._glowCache.size;
  }

  _limit() {
    return Math.min(this.capacity, this._quality.maxEntries);
  }

  _prune() {
    const limit = this._limit();
    while (this._glowCache.size > limit) {
      const oldest = this._glowCache.keys().next();
      if (oldest.done) break;
      this._glowCache.delete(oldest.value);
    }
  }

  sprite(color) {
    let sprite = this._glowCache.get(color);
    if (sprite) {
      // 命中缓存时刷新顺序，让常用颜色不被新颜色挤出。
      this._glowCache.delete(color);
      this._glowCache.set(color, sprite);
      return sprite;
    }
    sprite = this._createSprite(color);
    this._glowCache.set(color, sprite);
    this._prune();
    return sprite;
  }

  draw(g, color, x, y, radius, alpha) {
    if (!this._quality.enabled) return false;
    const scaled = alpha * this._quality.alphaScale;
    if (!(scaled > 0) || !(radius > 0)) return false;
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = scaled;
    g.drawImage(this.sprite(color), x - radius, y - radius, radius * 2, radius * 2);
    g.restore();
    return true;
  }
}
