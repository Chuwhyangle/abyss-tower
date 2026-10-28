// 首领地面表现层：狂怒光环、停顿符文圈、技能蓄力预警圈与破绽金环的方法集。
//
// 挂在 EnemyRenderer 原型上（this.game / this.glow 由类持有），只用描边与填充，不新建渐变。
import { BOSS_SKILLS, TILE } from '../shared/data.js';
import { BALANCE } from '../shared/config.js';
import { Palette } from './palette.js';

const T = TILE;

export const enemyBossMethods = {
  // 首领地面层：狂怒光环、停顿符文圈、技能预警圈、破绽金环。
  // 只用描边/填充，不新建渐变；glow 关闭时完全不加法混合。
  drawBossGround(g, t, enemy, x, y, vr, lift, settings) {
    const game = this.game;
    const now = game.time;
    const glow = settings.glow;
    const decor = settings.decorations || 'light';

    // 狂怒：脉动红环 + 拖尾，阶段越高越强。
    if (enemy.enraged) {
      const boost = enemy.bossPhase >= 3 ? 1.5 : enemy.bossPhase >= 2 ? 1.28 : 1;
      const pulse = 0.5 + 0.5 * Math.sin(t * 9);
      if (glow) this.glow.draw(g, '#ff4c4c', x, y - lift, vr * 2.7 * boost, 0.2 + pulse * 0.1);
      g.save();
      g.strokeStyle = '#ff5a5a';
      g.globalAlpha = 0.28 + pulse * 0.18;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, vr * 1.55 * boost, t * 2.2, t * 2.2 + Math.PI * 1.25);
      g.stroke();
      g.globalAlpha = 0.16 + pulse * 0.12;
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(x, y, vr * 1.95 * boost, -t * 1.6, -t * 1.6 + Math.PI * 0.9);
      g.stroke();
      g.restore();
    }

    // 停顿：脚下旋转符文圈 + 脉冲扩散。
    if (enemy.stopped) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 5);
      if (decor !== 'off') {
        g.save();
        g.translate(x, y + 3);
        g.rotate(t * 0.9);
        g.strokeStyle = `rgba(226, 96, 158, ${0.4 + pulse * 0.25})`;
        g.lineWidth = 1.6;
        g.beginPath();
        g.arc(0, 0, vr * 1.75, 0, Math.PI * 2);
        g.stroke();
        g.strokeStyle = 'rgba(255, 179, 217, 0.32)';
        g.lineWidth = 1;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          g.beginPath();
          g.moveTo(Math.cos(a) * vr * 1.5, Math.sin(a) * vr * 1.5);
          g.lineTo(Math.cos(a) * vr * 1.92, Math.sin(a) * vr * 1.92);
          g.stroke();
        }
        g.restore();
      }
      g.save();
      g.strokeStyle = `rgba(255, 179, 217, ${0.15 + (1 - pulse) * 0.3})`;
      g.lineWidth = 1.4;
      g.beginPath();
      g.arc(x, y + 3, vr * (1.4 + pulse * 0.45), 0, Math.PI * 2);
      g.stroke();
      g.restore();

      // 尘土只在完整画质出现。
      if (decor === 'full') {
        g.save();
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 + t * 0.35;
          const ph = (t * 0.7 + i * 0.21) % 1;
          g.globalAlpha = (1 - ph) * 0.3;
          g.fillStyle = '#cbbbaa';
          g.beginPath();
          g.arc(
            x + Math.cos(a) * vr * (1.1 + ph * 0.8),
            y + 4 + Math.sin(a) * 2.4 - ph * 7,
            1.4 + ph * 1.6,
            0,
            Math.PI * 2
          );
          g.fill();
        }
        g.restore();
      }
    }

    // 破绽：金色旋转裂纹环（玩法信息，低画质也保留）。
    if (now < (enemy.vulnUntil || 0)) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 6);
      g.save();
      g.translate(x, y + 3);
      g.strokeStyle = `rgba(255, 211, 107, ${0.5 + pulse * 0.35})`;
      g.lineWidth = 2;
      g.setLineDash([3, 5]);
      g.lineDashOffset = -t * 14;
      g.beginPath();
      g.arc(0, 0, vr * 1.62, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      g.strokeStyle = `rgba(255, 231, 168, ${0.35 + pulse * 0.3})`;
      g.lineWidth = 1.2;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.4;
        g.beginPath();
        g.moveTo(Math.cos(a) * vr * 1.62, Math.sin(a) * vr * 1.62);
        g.lineTo(Math.cos(a + 0.12) * vr * (1.98 + (i % 2) * 0.22), Math.sin(a + 0.12) * vr * (1.98 + (i % 2) * 0.22));
        g.stroke();
      }
      g.restore();
    }

    // 蓄力预警圈：半径来自 BALANCE，圈内按 progress 填充。
    if (enemy.cast) {
      const skill = BOSS_SKILLS[enemy.cast.kind];
      const radiusTiles = skill?.radiusKey ? BALANCE[skill.radiusKey] || 2.5 : 2.2;
      const R = radiusTiles * T;
      const color = skill?.color || '#ffd36b';
      const prog = Math.max(0, Math.min(1, enemy.cast.progress || 0));
      g.save();
      g.fillStyle = Palette.withAlpha(color, 0.08 + prog * 0.16);
      g.beginPath();
      g.arc(x, y, Math.max(2, R * prog), 0, Math.PI * 2);
      g.fill();

      g.strokeStyle = Palette.withAlpha(color, 0.55 + 0.25 * Math.sin(t * 10));
      g.lineWidth = 2;
      g.setLineDash([8, 6]);
      g.lineDashOffset = -t * 20;
      g.beginPath();
      g.arc(x, y, R, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);

      g.strokeStyle = Palette.withAlpha(color, 0.7);
      g.lineWidth = 1.4;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + t * 0.5;
        g.beginPath();
        g.moveTo(x + Math.cos(a) * (R - 3), y + Math.sin(a) * (R - 3));
        g.lineTo(x + Math.cos(a) * (R + 3), y + Math.sin(a) * (R + 3));
        g.stroke();
      }
      if (glow) this.glow.draw(g, color, x, y, R * 0.55, 0.1 + prog * 0.12);
      g.restore();
    }
  }
};
