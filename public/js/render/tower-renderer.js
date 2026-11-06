// 塔绘制：射程圈、塔身、炮塔造型与放置预览。依赖显式传入的光晕渲染器。
//
// 动画/进化/皮肤预算表在 tower-data.js，进化与停摆绘制在 tower-draw.js，八种塔体造型在 tower-body.js
// （方法集合挂回本类原型，对外仍是同一个 TowerRenderer、同一套方法签名）。
import { registerRenderer } from './registry.js';
import { TILE, TOWERS } from '../shared/data.js';
import { MIRROR_STAT_MUL } from '../shared/hexes/mirror-engineering.js';
import { DOCTRINES } from '../shared/doctrines.js';
import { Palette } from './palette.js';
import {
  towerAppliedEvolutions,
  towerSpriteId,
  towerVisualTier,
  ultimateVisual,
} from './sprite-coverage.js';
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
      // 进化分支的专属配色；独塔模式可能已选多条进化，取最后一条的颜色做主强调色。
      const appliedEvolutions = towerAppliedEvolutions(tower);
      const evolution = appliedEvolutions.length > 0
        ? def.evolutions?.find((entry) => entry.id === appliedEvolutions[appliedEvolutions.length - 1]) || null
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
        // 独塔模式可同时挂多条进化（3/6/9 级逐级三选一）：最外层画最新一条，
        // 更早的进化按选中顺序向里嵌套（半径逐层收缩），层级越深越厚。
        if (evolution) {
          const budget = evolutionVisualBudget(settings.decorations);
          this.drawEvolutionMark(g, time, evolutionVisual(evolution.id), budget, accent);
          for (let depth = 1; depth < appliedEvolutions.length; depth++) {
            const entry = def.evolutions?.find(
              (item) => item.id === appliedEvolutions[appliedEvolutions.length - 1 - depth]
            );
            if (!entry) continue;
            const scale = 0.78 - (depth - 1) * 0.18;
            g.save();
            g.scale(scale, scale);
            this.drawEvolutionMark(g, time, evolutionVisual(entry.id), budget, accent);
            g.restore();
          }
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

      // 教义徽记：该塔类选了教义时，在塔顶画一枚菱形徽记。精灵/程序化路径都覆盖，
      // 低配同样显示，且只有一次 fill + stroke，不新增逐帧动画开销（GOAL-006 约束）。
      const doctrineId = game.doctrineForTower?.(tower.type) || null;
      if (doctrineId && DOCTRINES[doctrineId]) {
        g.save();
        g.translate(0, -30);
        g.rotate(Math.PI / 4);
        g.fillStyle = DOCTRINES[doctrineId].color;
        g.fillRect(-4.5, -4.5, 9, 9);
        g.strokeStyle = 'rgba(0,0,0,0.45)';
        g.lineWidth = 1;
        g.strokeRect(-4.5, -4.5, 9, 9);
        g.restore();
      }

      // 大招光环（独塔 10 级）：白热核心 + 塔色双环呼吸，与命中时的大招爆发层呼应。
      // 任何画质档位都保留一图；普通塔等级上限远低于 10，不会进入此分支。
      const ultimate = ultimateVisual(tower.type);
      if (ultimate && towerVisualTier(level) >= 4) {
        this.drawUltimateAura(g, time, ultimate, accent);
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

  // 大招光环：独塔 10 级的塔身专属层——白热核心 + 塔色双环呼吸。
  // 只读传入的 spec/accent，不新增模拟事件、不消耗命中层粒子预算。
  drawUltimateAura(g, time, spec, accent) {
    const breathe = 0.5 + 0.5 * Math.sin(time * 3.1);
    g.save();
    g.globalAlpha = 0.55 + breathe * 0.4;
    g.strokeStyle = spec.accent;
    g.lineWidth = 1.6;
    g.beginPath();
    g.arc(0, 0, 27 + breathe * 2.5, 0, Math.PI * 2);
    g.stroke();
    g.globalAlpha = 0.35 + breathe * 0.25;
    g.strokeStyle = spec.color;
    g.lineWidth = 1;
    g.beginPath();
    g.arc(0, 0, 25 - breathe * 1.5, 0, Math.PI * 2);
    g.stroke();
    g.globalAlpha = 0.85;
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(0, 0, 2.2 + breathe * 1.2, 0, Math.PI * 2);
    g.fill();
    g.restore();
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

  // 镜像落位幽灵预览：本体建成后待落位镜像槽的落点提示（0 造价、60% 属性，浅蓝染色）。
  renderMirrorPlacement(g, time, glowOn, settings) {
    const game = this.game;
    const hover = game.hover;
    if (!game.mirrorPlacing || !hover) return;
    const body = typeof game.pendingMirrorBody === 'function' ? game.pendingMirrorBody() : null;
    const type = body ? body.type : null;
    if (!type) return;
    const { c, r } = hover;
    const inBounds = r >= 0 && r < game.map.rows && c >= 0 && c < game.map.cols;
    if (!inBounds) return;

    // 镜像 0 造价：只判可建，不判金币。
    const ok = game.canBuild(c, r);
    const x = (c + 0.5) * T;
    const y = (r + 0.5) * T;
    const stats = game.previewStats(type, body.level);
    const range = stats.range * MIRROR_STAT_MUL;

    g.save();
    g.globalAlpha = 0.9;
    g.fillStyle = ok ? 'rgba(56, 189, 248, 0.12)' : 'rgba(239, 95, 95, 0.14)';
    g.fillRect(c * T + 2, r * T + 2, T - 4, T - 4);
    g.strokeStyle = ok ? '#38bdf8' : '#ef5f5f';
    g.lineWidth = 2;
    g.strokeRect(c * T + 2, r * T + 2, T - 4, T - 4);

    g.beginPath();
    g.arc(x, y, range * T, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255, 255, 255, 0.04)';
    g.fill();
    g.setLineDash([5, 5]);
    g.strokeStyle = ok ? 'rgba(56, 189, 248, 0.5)' : 'rgba(239, 95, 95, 0.5)';
    g.lineWidth = 1.4;
    g.stroke();
    g.setLineDash([]);

    g.globalAlpha = 0.55;
    g.save();
    g.translate(x, y);
    g.rotate(-Math.PI / 2);
    this.drawTowerShape(
      g,
      time,
      type,
      body.level,
      1,
      0,
      glowOn,
      skinColorFor(activeSkin('tower'), Palette.towerColor(type, settings))
    );
    g.restore();
    g.globalAlpha = 1;
    g.restore();
  }
}

Object.assign(TowerRenderer.prototype, towerDrawMethods, towerBodyMethods);

// 自注册到渲染器注册表：render.js 经 id 创建实例，不再逐个静态 import。
registerRenderer('tower', TowerRenderer);
