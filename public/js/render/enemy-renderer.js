// 敌人绘制门面：遍历敌人、阴影/光晕/加速环/状态层/血条/首领标签与精灵或形体选择。
//
// 形体与首领地面层拆到 ./enemy-*.js，方法集合挂回同一原型——对外仍是同一个 EnemyRenderer。
import { TILE, ENEMIES, BOSS_SKILLS } from '../shared/data.js';
import { BOSS_VARIANTS } from '../shared/data/enemies.js';
import { Palette } from './palette.js';
import { CanvasShapes } from './canvas-shapes.js';
import { ENEMY_SPRITE_RADIUS, enemySpriteId } from './sprite-coverage.js';
import { activeSkin, skinColorFor } from '../shared/skins.js';
import { enemyAnimVariant, enemyWalkProfile, skinOutlineBudget } from './enemy-data.js';
import { drawHitHighlight, hitHighlightAlpha } from './enemy-feedback.js';
import { enemyBossMethods } from './enemy-boss.js';
import { enemyBodyMethods } from './enemy-body.js';

const T = TILE;

export class EnemyRenderer {
  constructor(game, { glow, sprites = null } = {}) {
    this.game = game;
    this.glow = glow;
    // 注入式精灵管线：敌人渲染器自己不加载图片；未注入 / 缺资源时走既有程序化形体。
    this.sprites = sprites;
  }

  render(g, time, settings) {
    const game = this.game;
    const t = time;
    const glow = settings.glow;
    const anim = enemyAnimVariant(settings.decorations);
    const walk = anim.walk;
    const skin = activeSkin('enemy');
    const budget = skinOutlineBudget(settings.decorations);
    const outline = budget === 'none' ? null : skin.outline;
    const mergeOutline = budget === 'merged' && !!outline;

    for (const enemy of game.enemies) {
      if (enemy.dead) continue;
      const def = ENEMIES[enemy.type];
      const x = enemy.x * T;
      const y = enemy.y * T;
      const r = enemy.r * T;
      const lift = enemy.flying ? 12 : 0;
      const vr = r * 1.12;
      const walkProfile = enemyWalkProfile(def.shape);
      const variantDef = enemy.variant ? BOSS_VARIANTS[enemy.variant] : null;
      const phase = t * (enemy.flying ? walk.flyingSpeed : walk.speed) + enemy.id;
      const stride = walk.enabled ? Math.sin(phase) : 0;
      const bob = stride * walkProfile.bob;
      const sway = stride * walkProfile.stride;
      const lean = walk.enabled ? Math.sin(phase * 0.5 + 0.8) * walkProfile.lean : 0;

      g.fillStyle = `rgba(0,0,0,${enemy.flying ? 0.2 : 0.32})`;
      g.beginPath();
      g.ellipse(x, y + 8, vr * 1.05, vr * 0.42, 0, 0, Math.PI * 2);
      g.fill();

      // 首领地面表现层（狂怒光环 / 停顿符文 / 蓄力预警 / 破绽环）。
      if (enemy.boss) this.drawBossGround(g, t, enemy, x, y, vr, lift, settings);

      // 加速光环：地面虚线范围提示，关闭装饰时省略。
      if (enemy.aura && settings.decorations !== 'off') {
        g.save();
        g.strokeStyle = 'rgba(224, 139, 60, 0.16)';
        g.lineWidth = 1.2;
        g.setLineDash([5, 7]);
        g.lineDashOffset = -t * 9;
        g.beginPath();
        g.arc(x, y, enemy.aura.range * T, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
        g.restore();
      }

      if (enemy.boss && glow) {
        this.glow.draw(g, variantDef?.color || '#e25096', x, y - lift, vr * 2.3, 0.3);
      } else if (enemy.heal > 0 && glow) {
        this.glow.draw(g, '#5af0aa', x, y - lift, vr * 2, 0.18);
      } else if (enemy.aura && glow) {
        this.glow.draw(g, '#e08b3c', x, y - lift, vr * 1.8, 0.14);
      }

      g.save();
      g.translate(x + sway, y - lift + bob);
      if (def.shape === 'dart') g.rotate(enemy.angle + lean);
      else if (def.shape === 'hex') g.rotate(Math.sin(enemy.id) * 0.08 + lean);
      else if (walk.enabled) g.rotate(lean);
      // 精灵优先：注册表命中且有可用帧时用图集贴图替换形体（帧内是标称半径的同一画布，
      // 按实体模拟半径等比缩放）；draw 返回 false 时完整走既有程序化路径。
      const spriteId = enemySpriteId(enemy);
      const spriteDrawn = spriteId
        ? this.sprites?.draw(g, spriteId, 0, 0, { scale: vr / ENEMY_SPRITE_RADIUS }) === true
        : false;
      if (!spriteDrawn) {
        this.drawEnemyBody(
          g,
          time,
          enemy,
          def,
          vr,
          walk.enabled,
          variantDef
            ? Palette.presentColor(variantDef.color, settings)
            : skinColorFor(skin, Palette.enemyColor(enemy.type, settings)),
          outline,
          mergeOutline
        );
      }

      // 皮肤轮廓：高配单独描环；低配已并进本体主描边，不再新增绘制调用。
      if (outline && !mergeOutline) {
        g.strokeStyle = Palette.hexToRgba(outline.color, outline.alpha);
        g.lineWidth = outline.width;
        g.beginPath();
        g.arc(0, 0, vr + 1.5, 0, Math.PI * 2);
        g.stroke();
      }

      // 受击高光：轮廓优先（不再整身刷白，剪影与内部明暗层次保持可读）。
      const flash = hitHighlightAlpha(enemy.hitFlash, anim);
      if (flash > 0) {
        drawHitHighlight(g, { radius: vr, alpha: flash, scale: anim.hitFlash.radius });
      }

      // 护盾：剩余护盾越多，前向护盾弧越亮。
      if (enemy.shield > 0) {
        const shieldRatio = enemy.maxShield > 0 ? Math.max(0, enemy.shield / enemy.maxShield) : 0;
        g.strokeStyle = `rgba(150, 214, 255, ${0.35 + shieldRatio * 0.55})`;
        g.lineWidth = 2.4;
        g.beginPath();
        g.arc(0, 0, vr + 6, -Math.PI * 0.8, Math.PI * 0.8);
        g.stroke();
        g.strokeStyle = `rgba(220, 245, 255, ${0.2 + shieldRatio * 0.35})`;
        g.lineWidth = 1;
        g.beginPath();
        g.arc(0, 0, vr + 8, -Math.PI * 0.55, Math.PI * 0.55);
        g.stroke();
      }

      // 减速：冰晶与光环。
      // 状态判定必须用模拟时间 game.time；渲染真实时间 t 只用于动画相位，
      // 否则 2×/3× 下状态会被多显示 2–3 倍。
      if (game.time < (enemy.slowUntil || 0)) {
        g.strokeStyle = 'rgba(140, 225, 255, 0.8)';
        g.lineWidth = 1.6;
        g.beginPath();
        g.arc(0, 0, vr + 4, 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = 'rgba(190, 245, 255, 0.85)';
        for (let i = 0; i < 3; i++) {
          const a = t * 1.4 + (i / 3) * Math.PI * 2;
          const px = Math.cos(a) * (vr + 6);
          const py = Math.sin(a) * (vr + 6);
          g.beginPath();
          g.moveTo(px, py - 2.6);
          g.lineTo(px + 2, py);
          g.lineTo(px, py + 2.6);
          g.lineTo(px - 2, py);
          g.closePath();
          g.fill();
        }
      }

      // 中毒：绿色气泡（状态同样按模拟时间判定）
      if (game.time < (enemy.poisonUntil || 0)) {
        g.strokeStyle = 'rgba(154, 223, 106, 0.5)';
        g.lineWidth = 1.6;
        g.beginPath();
        g.arc(0, 0, vr + 7, 0.3, 0.3 + Math.PI * 1.2);
        g.stroke();
        for (let i = 0; i < 2; i++) {
          const phase = (t * 1.6 + i * 0.5) % 1;
          g.fillStyle = `rgba(154, 223, 106, ${0.55 * (1 - phase)})`;
          g.beginPath();
          g.arc(
            Math.sin(t * 3 + i * 2) * vr * 0.6,
            -vr - phase * 12,
            1.4 + phase * 1.3,
            0,
            Math.PI * 2
          );
          g.fill();
        }
      }
      g.restore();

      // 血条
      if (enemy.hp < enemy.maxHp || enemy.boss) {
        const width = enemy.boss ? 76 : Math.max(24, vr * 2.4);
        const bx = x - width / 2;
        const by = y - lift - vr - (enemy.boss ? 18 : 12);
        g.fillStyle = 'rgba(4, 8, 10, 0.78)';
        CanvasShapes.roundRect(g, bx - 1.5, by - 1.5, width + 3, 7, 3);
        g.fill();
        const ratio = Math.max(0, enemy.hp / enemy.maxHp);
        g.fillStyle = ratio > 0.55 ? '#7ce38b' : ratio > 0.25 ? '#e8c35a' : '#ef5f5f';
        CanvasShapes.roundRect(g, bx, by, Math.max(2, width * ratio), 4, 2);
        g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.12)';
        g.lineWidth = 0.8;
        CanvasShapes.roundRect(g, bx - 1.5, by - 1.5, width + 3, 7, 3);
        g.stroke();
      }

      if (enemy.boss) {
        g.textAlign = 'center';
        g.textBaseline = 'bottom';
        g.lineJoin = 'round';
        const label = (text, color, font, atY) => {
          g.font = font;
          g.lineWidth = 3;
          g.strokeStyle = 'rgba(4, 8, 10, 0.8)';
          g.strokeText(text, x, atY);
          g.fillStyle = color;
          g.fillText(text, x, atY);
        };
        const headY = y - lift - vr - 22;
        label(
          variantDef?.name || '渊主',
          variantDef?.color || '#ffb3d9',
          '700 10px "Noto Sans SC", "DejaVu Sans", sans-serif',
          headY
        );

        // 蓄力中优先显示技能名；否则破绽期间显示金色标记。
        if (enemy.cast) {
          const skill = BOSS_SKILLS[enemy.cast.kind];
          label(
            skill?.name || enemy.cast.kind,
            skill?.color || '#ffd36b',
            '700 11px "Noto Sans SC", "DejaVu Sans", sans-serif',
            headY - 15
          );
        } else if (game.time < (enemy.vulnUntil || 0)) {
          const pulse = 0.65 + 0.35 * Math.sin(t * 7);
          label(
            '破绽',
            `rgba(255, 211, 107, ${pulse})`,
            '700 9px "Noto Sans SC", "DejaVu Sans", sans-serif',
            headY - 14
          );
        }
      }
    }
  }
}

// 首领地面层与形体绘制以方法集合形式挂在同一原型上，对外仍是同一个 EnemyRenderer 实例与同一套方法签名。
Object.assign(EnemyRenderer.prototype, enemyBossMethods, enemyBodyMethods);
