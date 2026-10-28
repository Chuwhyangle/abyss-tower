// 塔绘制：射程圈、塔身、炮塔造型与放置预览。依赖显式传入的光晕渲染器。
//
// 动画/进化/皮肤预算表在 tower-data.js，进化与停摆绘制在 tower-draw.js，八种塔体造型在 tower-body.js
// （方法集合挂回本类原型，对外仍是同一个 TowerRenderer、同一套方法签名）。
import { TILE, TOWERS } from '../shared/data.js';
import { Palette } from './palette.js';
import { towerSpriteId } from './sprite-coverage.js';
import { activeSkin, skinColorFor } from '../shared/skins.js';
import {
  evolutionVisual,
  evolutionVisualBudget,
  skinOutlineBudget,
  towerAnimVariant,
  towerRecoilAmount,
  towerUpgradePulse,
} from './tower-data.js';
import { towerDrawMethods } from './tower-draw.js';
import { towerBodyMethods } from './tower-body.js';

const T = TILE;

export class TowerRenderer {
  constructor(game, { glow, sprites = null } = {}) {
    this.game = game;
    this.glow = glow;
    // 注入式精灵管线：渲染器自己不加载图片，缺资源 / 未注入时 draw() 不可用，
    // 塔身继续走下面的程序化路径（画面与接入前一致）。
    this.sprites = sprites;
  }

  renderRanges(g, settings) {
    const game = this.game;
    const tower = game.selectedTower;
    if (tower) {
      const stats = game.statsFor(tower);
      const color = skinColorFor(activeSkin('tower'), Palette.towerColor(tower.type, settings));
      this.drawRangeCircle(g, tower.x, tower.y, stats.range, color, 0.55);
    }
  }

  drawRangeCircle(g, x, y, range, color, alpha = 0.5) {
    g.save();
    g.beginPath();
    g.arc(x * T, y * T, range * T, 0, Math.PI * 2);
    g.fillStyle = Palette.hexToRgba(color, 0.07);
    g.fill();
    g.strokeStyle = Palette.hexToRgba(color, alpha);
    g.lineWidth = 1.5;
    g.setLineDash([6, 5]);
    g.stroke();
    g.restore();
  }

  render(g, time, settings) {
    const game = this.game;
    const glow = settings.glow;
    const anim = towerAnimVariant(settings.decorations);
    const skin = activeSkin('tower');
    const budget = skinOutlineBudget(settings.decorations);
    const outline = budget === 'none' ? null : skin.outline;
    const mergeOutline = budget === 'merged' && !!outline;
    for (const tower of game.towers) {
      const x = tower.x * T;
      const y = tower.y * T;
      const def = TOWERS[tower.type];
      const level = tower.level;
      const color = skinColorFor(skin, Palette.towerColor(tower.type, settings));
      // 进化分支的专属配色；未进化时退回塔的默认色。
      const evolution = tower.evolution
        ? def.evolutions?.find((entry) => entry.id === tower.evolution) || null
        : null;
      const accent = evolution ? Palette.presentColor(evolution.color, settings) : color;
      const disableLeft = (tower.disabledUntil || 0) - game.time;
      const disabled = disableLeft > 0;
      const recoil = towerRecoilAmount(tower.recoil || 0, tower.type, anim);

      g.fillStyle = 'rgba(0,0,0,0.38)';
      g.beginPath();
      g.ellipse(x, y + 12, 21, 9, 0, 0, Math.PI * 2);
      g.fill();

      if (glow && !disabled) {
        this.glow.draw(g, accent, x, y, evolution ? 34 : 30, evolution ? 0.26 : level >= 2 ? 0.2 : 0.12);
      }

      g.save();
      g.translate(x, y);
      g.scale(1.06, 1.06);

      // 精灵优先：注册表命中且有可用帧时，用图集贴图替换塔身（石台/炮塔/停摆表现都在帧里）；
      // draw 返回 false（未注入 / 缺资源 / 未登记）时完整走下面的程序化路径。
      // 射程圈、升级脉冲、选中框属于覆盖层，无论走哪条路径都照旧绘制。
      const spriteId = towerSpriteId(tower, game.time);
      const spriteDrawn = spriteId ? this.sprites?.draw(g, spriteId, 0, 0, { rotation: tower.angle }) === true : false;

      // 升级脉冲：只在高配出现，相位固定到塔位避免整场同频闪烁。
      const pulse = towerUpgradePulse(level, time, anim, tower.x * 0.37 + tower.y * 0.21);
      if (pulse > 0) {
        g.strokeStyle = Palette.hexToRgba(accent, (anim.upgradePulse.alpha + level * 0.04) * (0.4 + pulse * 0.6));
        g.lineWidth = 1.2 + pulse * 0.8;
        g.beginPath();
        g.arc(0, 0, anim.upgradePulse.baseRadius + (1 - pulse) * anim.upgradePulse.grow, 0, Math.PI * 2);
        g.stroke();
      }

      if (!spriteDrawn) {
        const oct = (radius) => {
          g.beginPath();
          for (let i = 0; i < 8; i++) {
            const a = Math.PI / 8 + (i / 8) * Math.PI * 2;
            const px = Math.cos(a) * radius;
            const py = Math.sin(a) * radius;
            i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
          }
          g.closePath();
        };

        // 石台：低配把皮肤轮廓并入这一圈外描边，避免额外 stroke。
        oct(22);
        g.fillStyle = '#0a1116';
        g.fill();
        if (mergeOutline) {
          g.strokeStyle = Palette.hexToRgba(outline.color, outline.alpha);
          g.lineWidth = outline.width;
        } else {
          g.strokeStyle = Palette.hexToRgba(color, 0.42);
          g.lineWidth = 2;
        }
        g.stroke();

        oct(17.5);
        g.fillStyle = '#121d24';
        g.fill();
        g.strokeStyle = Palette.hexToRgba(color, 0.16);
        g.lineWidth = 1;
        g.stroke();

        // 能量环
        g.strokeStyle = Palette.hexToRgba(color, 0.5);
        g.lineWidth = 1.4;
        g.beginPath();
        g.arc(0, 0, 14, time * 0.4, time * 0.4 + Math.PI * 1.1);
        g.stroke();

        // 皮肤轮廓：高配单独描环；低配已并进石台外描边，不再新增绘制调用。
        if (outline && !mergeOutline) {
          g.strokeStyle = Palette.hexToRgba(outline.color, outline.alpha);
          g.lineWidth = outline.width;
          g.beginPath();
          g.arc(0, 0, 24, 0, Math.PI * 2);
          g.stroke();
        }

        // 铆钉
        g.fillStyle = '#1c2a33';
        for (let i = 0; i < 4; i++) {
          const a = Math.PI / 4 + (i / 4) * Math.PI * 2;
          g.beginPath();
          g.arc(Math.cos(a) * 19, Math.sin(a) * 19, 1.7, 0, Math.PI * 2);
          g.fill();
        }

        // 等级宝石
        for (let i = 0; i < 3; i++) {
          const filled = i <= level;
          const offset = (i - 1) * 7;
          g.beginPath();
          g.moveTo(offset, 25);
          g.lineTo(offset + 2.4, 27.5);
          g.lineTo(offset, 30);
          g.lineTo(offset - 2.4, 27.5);
          g.closePath();
          g.fillStyle = filled ? '#ffd36b' : 'rgba(255,211,107,0.15)';
          g.fill();
          if (filled && glow) {
            g.strokeStyle = 'rgba(255,211,107,0.5)';
            g.lineWidth = 0.8;
            g.stroke();
          }
        }

        // 进化标识：每条路线独有的轮廓 + 符文组合，开销随画质档位递增。
        if (evolution) {
          this.drawEvolutionMark(
            g,
            time,
            evolutionVisual(evolution.id),
            evolutionVisualBudget(settings.decorations),
            accent
          );
        }

        // 炮塔：整机后退 + 高配追加炮管回缩，二者都只读模拟层已有的 recoil。
        g.save();
        g.rotate(tower.angle);
        g.translate(-recoil * anim.recoil.distance, 0);
        this.drawTowerShape(
          g,
          time,
          tower.type,
          Math.min(1, recoil * anim.recoil.barrel),
          1,
          level,
          glow,
          color
        );
        g.restore();

        // 被首领震击停摆：变暗 + 电弧 + 剩余时间弧线。
        if (disabled) this.drawDisabled(g, time, disableLeft);
      }

      if (game.selectedTower === tower) {
        g.strokeStyle = 'rgba(255, 211, 107, 0.95)';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(0, 0, 24, 0, Math.PI * 2);
        g.stroke();
      }
      g.restore();
    }
  }

  renderPlacement(g, time, glowOn, settings) {
    const game = this.game;
    const hover = game.hover;

    if (!game.placementType || !hover) return;
    const { c, r } = hover;
    const inBounds = r >= 0 && r < game.map.rows && c >= 0 && c < game.map.cols;
    if (!inBounds) return;

    const ok = game.canBuild(c, r) && game.gold >= game.towerCost(game.placementType);
    const x = (c + 0.5) * T;
    const y = (r + 0.5) * T;
    const color = ok ? '#7ce38b' : '#ef5f5f';
    const stats = game.previewStats(game.placementType, 0);

    g.save();
    g.globalAlpha = 0.9;
    g.fillStyle = ok ? 'rgba(124, 227, 139, 0.12)' : 'rgba(239, 95, 95, 0.14)';
    g.fillRect(c * T + 2, r * T + 2, T - 4, T - 4);
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.strokeRect(c * T + 2, r * T + 2, T - 4, T - 4);

    g.beginPath();
    g.arc(x, y, stats.range * T, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255, 255, 255, 0.04)';
    g.fill();
    g.setLineDash([5, 5]);
    g.strokeStyle = ok ? 'rgba(124, 227, 139, 0.5)' : 'rgba(239, 95, 95, 0.5)';
    g.lineWidth = 1.4;
    g.stroke();
    g.setLineDash([]);

    g.globalAlpha = 0.6;
    g.save();
    g.translate(x, y);
    g.rotate(-Math.PI / 2);
    this.drawTowerShape(
      g,
      time,
      game.placementType,
      0,
      1,
      0,
      glowOn,
      skinColorFor(activeSkin('tower'), Palette.towerColor(game.placementType, settings))
    );
    g.restore();
    g.globalAlpha = 1;
    g.restore();
  }
}

Object.assign(TowerRenderer.prototype, towerDrawMethods, towerBodyMethods);
