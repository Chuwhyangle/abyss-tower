// 受击反馈原语：闪白强度、高光强度与轮廓高光的纯绘制函数。
//
// 时长窗口与几何来自 enemy-data.js；这里只做换算与落笔，不持有状态。
import { ENEMY_ANIM_VARIANTS, HIT_HIGHLIGHT } from './enemy-data.js';

// 受击闪白只在前 0.08s 可见：hitFlash 由模拟以 decay/秒线性衰减，
// 这里把剩余量映射成该窗口内的亮度，窗口外的尾段不再闪白。
export function hitFlashAlpha(flash, variant = ENEMY_ANIM_VARIANTS.full) {
  if (!variant.hitFlash.enabled || !(flash > 0)) return 0;
  const window = Math.min(1, variant.hitFlash.duration * variant.hitFlash.decay);
  if (!(window > 0)) return 0;
  const cutoff = 1 - window;
  const progress = (flash - cutoff) / window;
  return progress > 0 ? Math.min(1, progress) : 0;
}

// 受击高光强度：与 hitFlashAlpha 共用同一 0.08s 窗口，窗口外为 0（时序不变）。
export function hitHighlightAlpha(flash, variant = ENEMY_ANIM_VARIANTS.full) {
  const alpha = hitFlashAlpha(flash, variant);
  return alpha > 0 ? alpha * variant.hitFlash.alpha : 0;
}

// 纯绘制（只算几何、只画在传入的上下文里），便于命中帧的像素级测试复现。
// 返回是否实际绘制，调用方可据此做预算/断言。
export function drawHitHighlight(g, { radius, alpha, scale = 1, style = HIT_HIGHLIGHT } = {}) {
  if (!(alpha > 0) || !(radius > 0)) return false;
  const rimRadius = radius * (scale > 0 ? scale : 1);
  g.save();
  // 外沿细环：落在剪影之外，锐利但不盖住形体。
  g.globalAlpha = alpha * style.haloAlpha;
  g.strokeStyle = style.rimColor;
  g.lineWidth = style.haloWidth;
  g.beginPath();
  g.arc(0, 0, rimRadius * style.haloScale, 0, Math.PI * 2);
  g.stroke();
  // 主亮环：贴着剪影边缘，命中瞬间的锐利切分。
  g.globalAlpha = alpha * style.rimAlpha;
  g.strokeStyle = style.rimColor;
  g.lineWidth = style.rimWidth;
  g.beginPath();
  g.arc(0, 0, rimRadius, 0, Math.PI * 2);
  g.stroke();
  // 内侧细环：让高光读作「轮廓被点亮」，同时不抹掉本体的明暗层次。
  g.globalAlpha = alpha * style.innerAlpha;
  g.strokeStyle = style.innerColor;
  g.lineWidth = style.innerWidth;
  g.beginPath();
  g.arc(0, 0, radius * style.innerScale, 0, Math.PI * 2);
  g.stroke();
  // 接触核：极小面积的实心高光，保留「打中了一点」的锐利感。
  g.globalAlpha = alpha * style.coreAlpha;
  g.fillStyle = style.rimColor;
  g.beginPath();
  g.arc(0, 0, Math.max(1.2, radius * style.coreScale), 0, Math.PI * 2);
  g.fill();
  g.restore();
  return true;
}
