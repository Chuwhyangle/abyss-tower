// 光晕贴图缓存：每帧新建 radial gradient 在软件渲染下开销明显，按颜色缓存一次。
import { Palette } from './palette.js';

export class GlowRenderer {
  constructor() {
    this._glowCache = new Map();
  }

  sprite(color) {
    let sprite = this._glowCache.get(color);
    if (sprite) return sprite;
    const size = 64;
    sprite = document.createElement('canvas');
    sprite.width = size;
    sprite.height = size;
    const sg = sprite.getContext('2d');
    const grad = sg.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, Palette.withAlpha(color, 1));
    grad.addColorStop(0.45, Palette.withAlpha(color, 0.35));
    grad.addColorStop(1, Palette.withAlpha(color, 0));
    sg.fillStyle = grad;
    sg.fillRect(0, 0, size, size);
    this._glowCache.set(color, sprite);
    return sprite;
  }

  draw(g, color, x, y, radius, alpha) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = alpha;
    g.drawImage(this.sprite(color), x - radius, y - radius, radius * 2, radius * 2);
    g.restore();
  }
}
