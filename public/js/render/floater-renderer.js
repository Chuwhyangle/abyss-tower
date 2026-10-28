// 飘字：伤害数字与关键提示。
// 分层绘制：层决定 z 序/字号/字重/颜色，帧预算与同层合并由 shared/floaters.js 统一裁决。
import { TILE } from '../shared/data.js';
import {
  BIG_SIZE_BONUS,
  FLOATER_CASING,
  FLOATER_LAYERS,
  STACK_STEP,
  floaterAlpha,
  floaterBudget,
  planFloaterFrame,
} from '../shared/floaters.js';

const T = TILE;

export class FloaterRenderer {
  constructor(game) {
    this.game = game;
    // 本帧统计：浏览器验收读取 drawn / suppressed / visible / layers。
    this.stats = { drawn: 0, suppressed: 0, visible: 0, layers: [] };
  }

  render(g) {
    const mode = this.game.floatersMode || 'all';
    const { draw, suppressed, visible } = planFloaterFrame(this.game.floaters, {
      mode,
      budget: floaterBudget(mode),
    });
    this.stats = {
      drawn: draw.length,
      suppressed,
      visible,
      layers: [...new Set(draw.map((floater) => floater.layer))],
    };

    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const floater of draw) {
      const layer = FLOATER_LAYERS[floater.layer] || FLOATER_LAYERS.damage;
      // 淡出到下限就不再变暗：尾段仍能读出数字，而不是变灰后突然消失。
      const alpha = floaterAlpha(floater);
      const x = floater.x * T;
      // 同层近邻按 stack 逐级上移，避免数字叠成一坨。
      const y = floater.y * T - (floater.stack || 0) * STACK_STEP * T;
      const size = layer.size + (floater.big ? BIG_SIZE_BONUS : 0);
      g.globalAlpha = alpha;
      g.font = `${layer.weight} ${size}px "DejaVu Sans Mono", ui-monospace, monospace`;
      g.lineWidth = FLOATER_CASING.width;
      g.strokeStyle = FLOATER_CASING.color;
      g.strokeText(floater.text, x, y);
      g.fillStyle = floater.color || layer.color;
      g.fillText(floater.text, x, y);
      g.globalAlpha = 1;
    }
  }
}
