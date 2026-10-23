// 飘字：伤害数字与关键提示。
import { TILE } from '../shared/data.js';

const T = TILE;

export class FloaterRenderer {
  constructor(game) {
    this.game = game;
  }

  render(g) {
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
}
