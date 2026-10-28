// 技能本体绘制：L0 背景 / L1 地面 / L2 世界 / L3 屏幕四层的方法集。
//
// 挂回 SkillRenderer 原型（同一实例字段与同一套方法签名），类只保留时间同步与编排。
import { SKILLS, TILE } from '../shared/data.js';
import { Palette, SKILL_WARNING_STYLE } from './palette.js';
import { clamp01, rgba } from './skill-data.js';
import { warningCountdown, warningProfile } from './skill-warnings.js';

const T = TILE;

export const skillDrawMethods = {
  // ---------- L0 背景 ----------

  _drawAuroraL0(g, time, intensity) {
    const tint = this._textures.tints?.aurora;
    if (tint) {
      g.save();
      g.globalAlpha = 0.55 * intensity;
      g.drawImage(tint, 0, 0, this.W, this.H);
      g.restore();
    }
    if (!this.profile.glow) return;
    const curtain = this._textures.curtain;
    if (!curtain) return;
    const drift = Math.sin(time * 0.12) * this.W * 0.04;
    const pulse = 0.55 + Math.sin(time * 0.5) * 0.12;
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = (this.quality === 'full' ? 0.62 : 0.42) * intensity * pulse;
    // 单张帘幕 + 相位漂移即可，保持整帧全屏叠加 ≤3 次（L0 两张 + L3 一张）。
    g.drawImage(curtain, drift - this.W * 0.04, -this.H * 0.08, this.W * 1.12, this.H * 0.85);
    g.restore();
  },

  _drawMeteorL0(g, time, intensity) {
    const tint = this._textures.tints?.meteor;
    if (!tint) return;
    g.save();
    g.globalAlpha = (this.quality === 'minimal' ? 0.32 : 0.46) * intensity;
    g.drawImage(tint, 0, 0, this.W, this.H);
    g.restore();
  },

  _drawChronoStarL0(g, time, intensity) {
    const tint = this._textures.tints?.chrono;
    if (tint) {
      g.save();
      g.globalAlpha = 0.6 * intensity;
      g.drawImage(tint, 0, 0, this.W, this.H);
      g.restore();
    }
    if (!this.profile.glow) return;
    const stars = this._textures.stars;
    if (!stars) return;
    const offset = (time * 7) % this.W;
    g.save();
    g.globalAlpha = (this.quality === 'full' ? 0.8 : 0.55) * intensity;
    // 单次全屏绘制；视差靠偏移量，不再叠第二层（全屏叠加预算 ≤3）。
    g.drawImage(stars, -offset, 0, this.W, this.H);
    g.restore();
  },

  // ---------- L1 地面 ----------

  _drawAuroraGround(g, time) {
    const now = this.game.time || 0;
    const frost = this._textures.frost;
    if (!frost) return;
    g.save();
    for (const enemy of this.game.enemies || []) {
      if (enemy.dead || now >= (enemy.freezeUntil || 0)) continue;
      const r = (enemy.r || 0.3) * T * 2.4;
      g.globalAlpha = 0.8;
      g.drawImage(frost, enemy.x * T - r, enemy.y * T - r * 0.55, r * 2, r * 1.1);
    }
    g.restore();
  },

  _drawChronoGround(g, time) {
    if (!this.profile.glow) return;
    const game = this.game;
    const cx = ((game.map?.base?.x ?? game.map?.cols / 2) || 0) * T;
    const cy = ((game.map?.base?.y ?? game.map?.rows / 2) || 0) * T;
    const radius = Math.min(this.W, this.H) * 0.34;
    const color = this.colors.chrono;
    const pulse = 0.4 + Math.sin(time * 2.4) * 0.12;
    g.save();
    g.translate(cx, cy);
    g.strokeStyle = rgba(color, pulse);
    g.lineWidth = 1.4;
    g.setLineDash([5, 9]);
    g.lineDashOffset = -time * 16;
    g.beginPath();
    g.arc(0, 0, radius, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    g.strokeStyle = rgba(color, pulse * 0.55);
    g.lineWidth = 1;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2 + time * 0.08;
      const inner = radius - (i % 6 === 0 ? 10 : 5);
      g.beginPath();
      g.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
      g.lineTo(Math.cos(a) * radius, Math.sin(a) * radius);
      g.stroke();
    }
    g.restore();
  },

  _drawGroundFx(g, time, event) {
    const id = this._classify(event) || this._activeId();
    if (!id) return;
    const kind = String(event.kind || '').toLowerCase();
    const { x, y, progress, fade } = this._fxBasics(event);
    const r = Math.max(6, (event.r ?? event.radius ?? 1) * T);

    if (id === 'meteor') {
      // 落点预警：`meteorWarn` 期间地面圈 + 倒计时环。玩法信息，minimal 也保留。
      if (/warn|telegraph|mark/.test(kind)) {
        const profile = warningProfile('meteor');
        const color = Palette.semanticColor(profile.semantic, this.settings);
        const left = warningCountdown(event.ttl, event.maxTtl ?? profile.ttl);
        const warnAlpha = 0.16 + fade * 0.22;
        g.save();
        g.fillStyle = rgba(color, warnAlpha * progress);
        g.beginPath();
        g.arc(x, y, Math.max(2, r * progress), 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = rgba(color, 0.55 + fade * 0.3);
        g.lineWidth = profile.lineWidth;
        g.setLineDash(SKILL_WARNING_STYLE.dash);
        g.lineDashOffset = -time * SKILL_WARNING_STYLE.dashScroll;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
        // 倒计时环：剩余时间越少弧越短，落点更可读。
        const start = -Math.PI / 2;
        g.strokeStyle = rgba(SKILL_WARNING_STYLE.countdownColor, 0.78);
        g.lineWidth = profile.countdownWidth;
        g.beginPath();
        g.arc(x, y, r * 0.86, start, start + Math.PI * 2 * left);
        g.stroke();
        g.restore();
      }
      // 落点后的焦痕：余韵，低配关闭。
      if (this.profile.afterglow && (kind === 'meteor' || /scorch/.test(kind))) {
        const scorch = this._textures.scorch;
        if (scorch) {
          g.save();
          g.globalAlpha = Math.min(0.75, fade + 0.15);
          g.drawImage(scorch, x - r * 1.2, y - r * 0.62, r * 2.4, r * 1.24);
          g.restore();
        }
      }
    }

    if (id === 'aurora' && /shatter|crystal|frost|ice/.test(kind) && this.profile.afterglow) {
      const frost = this._textures.frost;
      if (frost) {
        g.save();
        g.globalAlpha = fade * 0.7;
        g.drawImage(frost, x - r * 0.8, y - r * 0.4, r * 1.6, r * 0.8);
        g.restore();
      }
    }
  },

  // ---------- L2 世界 ----------

  _drawFreezeShell(g, time, enemy, id) {
    const x = enemy.x * T;
    const y = enemy.y * T - (enemy.flying ? 12 : 0);
    const r = Math.max(8, (enemy.r || 0.3) * T * 1.22);
    const now = this.game.time || 0;
    const chrono = id === 'chrono';
    const color = chrono ? this.colors.chrono : this.colors.aurora;
    const pulse = 0.5 + Math.sin(time * 5 + (enemy.id || 0)) * 0.5;

    g.save();
    g.translate(x, y);
    if (!this.profile.glow) {
      g.strokeStyle = chrono ? rgba(color, 0.8) : 'rgba(170, 235, 255, 0.85)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(0, 0, r + 2, 0, Math.PI * 2);
      g.stroke();
      g.restore();
      return;
    }

    if (chrono) {
      // 时间泡：双环 + 刻度，`time` 只驱动相位。
      g.strokeStyle = rgba(color, 0.5 + pulse * 0.3);
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(0, 0, r + 3 + pulse * 1.5, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = rgba('#e5dcff', 0.34);
      g.lineWidth = 1;
      g.rotate(time * 0.7);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.beginPath();
        g.moveTo(Math.cos(a) * (r + 1), Math.sin(a) * (r + 1));
        g.lineTo(Math.cos(a) * (r + 5), Math.sin(a) * (r + 5));
        g.stroke();
      }
    } else {
      // 冰壳：六边形外框 + 冰晶尖刺。
      g.strokeStyle = `rgba(190, 242, 255, ${0.55 + pulse * 0.35})`;
      g.lineWidth = 1.6;
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + time * 0.25;
        const px = Math.cos(a) * (r + 1.5);
        const py = Math.sin(a) * (r + 1.5);
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      g.stroke();
      g.fillStyle = `rgba(205, 245, 255, ${0.1 + pulse * 0.12})`;
      g.fill();
      g.fillStyle = 'rgba(225, 250, 255, 0.8)';
      for (let i = 0; i < 3; i++) {
        const a = time * 1.4 + (i / 3) * Math.PI * 2;
        const px = Math.cos(a) * (r + 3);
        const py = Math.sin(a) * (r + 3);
        g.beginPath();
        g.moveTo(px, py - 3);
        g.lineTo(px + 2, py);
        g.lineTo(px, py + 3);
        g.lineTo(px - 2, py);
        g.closePath();
        g.fill();
      }
    }

    // 冻结易伤：碎裂高光。
    if (now < (enemy.freezeVulnUntil || 0)) {
      g.strokeStyle = `rgba(255, 236, 170, ${0.35 + pulse * 0.3})`;
      g.lineWidth = 1;
      g.beginPath();
      g.arc(0, 0, r * (1.35 + pulse * 0.1), 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
  },

  _drawOverdrive(g, time, tower) {
    const id = this._activeId() || 'chrono';
    const beam = this._textures.beams?.[id] || this._textures.beams?.chrono;
    const x = tower.x * T;
    const y = tower.y * T;
    const pulse = 0.7 + Math.sin(time * 7 + (tower.id || 0)) * 0.3;
    const color = this.colors[id] || this.colors.chrono;

    g.save();
    g.strokeStyle = rgba(color, 0.6 + pulse * 0.25);
    g.lineWidth = 1.6;
    g.beginPath();
    g.arc(x, y, 18 + pulse * 3, 0, Math.PI * 2);
    g.stroke();

    if (beam && this.profile.glow) {
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.55 + pulse * 0.2;
      g.drawImage(beam, x - 26, y - 150, 52, 150);
      g.globalCompositeOperation = 'source-over';
    } else {
      g.strokeStyle = rgba(color, 0.4 + pulse * 0.2);
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x, y - 80);
      g.stroke();
    }
    g.restore();
  },

  _fxBasics(event) {
    const maxTtl = Math.max(0.001, Number(event.maxTtl ?? event.ttl ?? 1));
    const ttl = Math.max(0, Number(event.ttl ?? 0));
    const progress = clamp01(1 - ttl / maxTtl);
    const fade = clamp01(ttl / maxTtl);
    const base = this.game.map?.base || { x: this.game.map?.cols / 2 || 0, y: this.game.map?.rows / 2 || 0 };
    return {
      x: (event.x ?? base.x) * T,
      y: (event.y ?? base.y) * T,
      progress,
      fade,
      maxTtl,
      ttl,
    };
  },

  // 命中高光：所有画质都保留（玩法反馈），余韵才随档位裁剪。
  _drawHitFlash(g, x, y, r, alpha) {
    const flash = this._textures.flash;
    if (!flash || alpha <= 0.01) return;
    const d = Math.max(16, r * 2.6);
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = Math.min(0.9, alpha);
    g.drawImage(flash, x - d / 2, y - d / 2, d, d);
    g.restore();
  },

  _drawWorldFx(g, time, event, activeId) {
    const id = this._classify(event) || activeId;
    if (!id) return;
    const kind = String(event.kind || '').toLowerCase();
    const { x, y, progress, fade } = this._fxBasics(event);
    const r = Math.max(8, (event.r ?? event.radius ?? 1) * T);
    const color = this.colors[id] || this.colors.aurora;

    // 命中瞬间高光与余韵分离：预警/持续型事件不闪，命中事件在生命周期前 45% 闪一次。
    if (!/warn|telegraph|mark|stasis/.test(kind) && progress < 0.45) {
      this._drawHitFlash(g, x, y, r, 1 - progress / 0.45);
    }

    if (id === 'meteor') {
      // 预警阶段：流星本体向落点下坠 + 拖尾（meteorWarn 的 ttl 正好是预警时长）。
      if (/warn|fall|trail|blaze/.test(kind) && progress < 0.96) {
        const fall = (1 - progress) * Math.min(320, this.H * 0.5);
        const headY = y - fall;
        g.save();
        g.globalCompositeOperation = 'lighter';
        // 拖尾用两段实色描边，避免每帧新建渐变。
        g.strokeStyle = rgba(color, 0.28);
        g.lineWidth = 6;
        g.beginPath();
        g.moveTo(x, headY - 70);
        g.lineTo(x, headY);
        g.stroke();
        g.strokeStyle = rgba(color, 0.75);
        g.lineWidth = 2.4;
        g.beginPath();
        g.moveTo(x, headY - 46);
        g.lineTo(x, headY);
        g.stroke();
        g.fillStyle = rgba('#fff2d8', 0.9);
        g.beginPath();
        g.arc(x, headY, 4 + fade * 2, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
      // 落点瞬间：星爆冲击环（`meteor` 是命中事件，不再重复画下坠）。
      if (progress > 0.2 && !/ember|warn/.test(kind)) {
        const p = (progress - 0.2) / 0.8;
        g.save();
        g.strokeStyle = rgba(color, (1 - p) * 0.9);
        g.lineWidth = 2.4 * (1 - p) + 0.6;
        g.beginPath();
        g.arc(x, y, r * (0.25 + p * 0.95), 0, Math.PI * 2);
        g.stroke();
        g.strokeStyle = rgba('#ffe0a8', (1 - p) * 0.55);
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(x, y, r * (0.1 + p * 0.7), 0, Math.PI * 2);
        g.stroke();
        g.restore();
      }
    } else if (id === 'aurora') {
      // 碎晶：径向冰晶与扩散环。
      const radius = (event.r0 ?? 0.1) * T + ((event.r1 ?? event.r ?? 1) * T - (event.r0 ?? 0.1) * T) * progress;
      g.save();
      g.strokeStyle = rgba(color, fade * 0.75);
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(x, y, Math.max(3, radius), 0, Math.PI * 2);
      g.stroke();
      if (this.profile.afterglow) {
        g.fillStyle = rgba('#d8f6ff', fade * 0.85);
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2 + progress * 1.4;
          const dist = Math.max(4, radius);
          const px = x + Math.cos(a) * dist;
          const py = y + Math.sin(a) * dist;
          const s = 2 + (1 - progress) * 3;
          g.beginPath();
          g.moveTo(px, py - s);
          g.lineTo(px + s * 0.7, py);
          g.lineTo(px, py + s);
          g.lineTo(px - s * 0.7, py);
          g.closePath();
          g.fill();
        }
      }
      g.restore();
    } else if (id === 'chrono') {
      if (/stasis/.test(kind)) {
        // 时停穹顶：整个持续期间保持，不做一次性扩散。
        const pulse = 0.45 + Math.sin(time * 4) * 0.15;
        g.save();
        g.fillStyle = rgba(color, 0.05 + fade * 0.05);
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = rgba(color, 0.3 + pulse * 0.4 * fade);
        g.lineWidth = 2;
        g.setLineDash([10, 8]);
        g.lineDashOffset = time * 22;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
        g.restore();
        return;
      }
      // 星辉 / 时间涟漪。
      const r0 = (event.r0 ?? 0.2) * T;
      const r1 = (event.r1 ?? event.r ?? 2.2) * T;
      const radius = r0 + (r1 - r0) * (1 - Math.pow(1 - progress, 2));
      g.save();
      g.strokeStyle = rgba(color, fade * 0.85);
      g.lineWidth = 1.8;
      g.beginPath();
      g.arc(x, y, Math.max(3, radius), 0, Math.PI * 2);
      g.stroke();
      if (this.profile.afterglow) {
        g.strokeStyle = rgba('#efe8ff', fade * 0.45);
        g.lineWidth = 1;
        g.beginPath();
        g.arc(x, y, Math.max(3, radius * 0.72), 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = rgba('#f3ecff', fade * 0.8);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 - progress * 1.2;
          const px = x + Math.cos(a) * radius * 0.8;
          const py = y + Math.sin(a) * radius * 0.8;
          g.beginPath();
          g.arc(px, py, 1.6, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.restore();
    } else {
      // 未知事件：通用扩散环，保证新事件至少有反馈。
      g.save();
      g.strokeStyle = rgba(color, fade * 0.7);
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(x, y, Math.max(4, r * progress), 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
  },

  // ---------- L3 屏幕 ----------

  _drawChronoScreenRing(g, time, intensity) {
    const cx = this.W / 2;
    const cy = this.H / 2;
    const radius = Math.min(this.W, this.H) * 0.47;
    const color = this.colors.chrono;
    g.save();
    g.globalAlpha = intensity * 0.7;
    g.strokeStyle = rgba(color, 0.4);
    g.lineWidth = 1.2;
    g.beginPath();
    g.arc(cx, cy, radius, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = rgba('#e9e2ff', 0.3);
    g.lineWidth = 1;
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2 + time * 0.06;
      const inner = radius - (i % 3 === 0 ? 12 : 6);
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      g.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
      g.stroke();
    }
    g.restore();
  },

  _drawBanner(g) {
    if (!this.profile.banner) return;
    const amb = this._amb;
    if (!amb.id || amb.age > 1.7) return;
    const def = SKILLS[amb.id];
    if (!def) return;
    const fadeIn = clamp01(amb.age / 0.16);
    const fadeOut = clamp01((1.7 - amb.age) / 0.5);
    const alpha = Math.min(fadeIn, fadeOut);
    const color = this.colors[amb.id] || def.color;
    const level = this.game.skill?.level || 1;
    const y = this.H * 0.17;
    g.save();
    g.globalAlpha = alpha;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.font = '800 26px "Noto Sans SC", "DejaVu Sans", sans-serif';
    g.strokeStyle = 'rgba(4, 8, 12, 0.68)';
    g.lineWidth = 5;
    g.strokeText(def.name, this.W / 2, y);
    g.fillStyle = color;
    g.fillText(def.name, this.W / 2, y);
    g.font = '600 12px "DejaVu Sans Mono", ui-monospace, monospace';
    g.fillStyle = rgba('#e8f4ff', 0.7 * alpha);
    g.fillText(`Lv.${level}`, this.W / 2, y + 24);
    g.restore();
  }
};
