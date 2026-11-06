// 友方单位渲染：亡者军团的骷髅等临时盟友。
// 数据全部来自 sim.allies，渲染层只读（不写模拟状态、不消耗随机数）。
// 每帧每个盟友固定 3 次绘制（投影 / 身体 / 武器），不创建临时对象或贴图。
import { registerRenderer } from './registry.js';
import { TILE } from '../shared/data.js';
import { SUMMON_SPRITE_RADIUS, summonSpriteId } from './sprite-coverage.js';

const T = TILE;

export class AllyRenderer {
  constructor(game) {
    this.game = game;
    // 精灵管线由 Renderer 注入（setSprites）：未注入 / 缺资源时走下面的程序化盟友。
    this.sprites = null;
  }

  setSprites(sprites) {
    this.sprites = sprites || null;
    return this;
  }

  render(g, time = 0, settings = {}) {
    const allies = this.game?.allies;
    if (!Array.isArray(allies) || allies.length === 0) return;
    const glow = settings?.glow === true;
    for (const ally of allies) {
      if (!ally || ally.dead) continue;
      const x = ally.x * T;
      const y = ally.y * T;
      // 生命将尽时淡出，给玩家「即将消失」的提示（最后 40% 存活时间）。
      const life = ally.life > 0 ? Math.max(0, ally.ttl) / ally.life : 1;
      const alpha = Math.min(1, 0.4 + life * 0.6);
      const r = Math.max(2, (ally.r || 0.25) * T);
      const color = ally.color || '#cfe8ff';
      g.save();
      g.globalAlpha = alpha;

      // 地面投影
      g.fillStyle = 'rgba(0, 0, 0, 0.28)';
      g.beginPath();
      g.ellipse(x, y + r * 0.8, r * 0.9, r * 0.32, 0, 0, Math.PI * 2);
      g.fill();

      // 身体：受击/出手时略微放大，作为攻击提示
      const pulse = ally.recoil > 0 ? 1 + ally.recoil * 0.12 : 1;
      if (glow) {
        g.fillStyle = hexToRgba(color, 0.18);
        g.beginPath();
        g.arc(x, y, r * 1.7 * pulse, 0, Math.PI * 2);
        g.fill();
      }

      // 朝向：攻击方向的短刺，空闲时按模拟时间轻微摆动
      const angle = Number.isFinite(ally.angle) ? ally.angle : Math.sin(time * 2) * 0.3;
      // 精灵优先：注册表命中且有可用帧时用图集贴图替换形体与朝向刺（帧里自带朝向），
      // draw 返回 false 时完整走下面的程序化盟友。
      const spriteId = summonSpriteId(ally);
      const spriteDrawn = spriteId
        ? this.sprites?.draw(g, spriteId, x, y, { scale: (r / SUMMON_SPRITE_RADIUS) * pulse, rotation: angle }) === true
        : false;
      if (!spriteDrawn) {
        g.fillStyle = color;
        g.strokeStyle = 'rgba(10, 18, 26, 0.85)';
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(x, y, r * pulse, 0, Math.PI * 2);
        g.fill();
        g.stroke();

        g.strokeStyle = color;
        g.lineWidth = Math.max(1.4, r * 0.28);
        g.beginPath();
        g.moveTo(x + Math.cos(angle) * r * 0.7, y + Math.sin(angle) * r * 0.7);
        g.lineTo(x + Math.cos(angle) * r * 1.5, y + Math.sin(angle) * r * 1.5);
        g.stroke();
      }
      g.restore();
    }
  }
}

// #rrggbb → rgba()；非法颜色直接回退白色半透明，渲染不因数据异常中断。
function hexToRgba(color, alpha) {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return `rgba(255, 255, 255, ${alpha})`;
  const value = parseInt(match[1], 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

// 自注册到渲染器注册表：render.js 经 id 创建实例，不再逐个静态 import。
registerRenderer('ally', AllyRenderer);
