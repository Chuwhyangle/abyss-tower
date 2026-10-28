// 技能粒子池：对象池获取/回收、环境与事件粒子生成、积分与绘制的方法集。
//
// 挂回 SkillRenderer 原型；预算（cap / quality / profile）由类持有，这里只读。
import { TILE } from '../shared/data.js';
import { clamp01 } from './skill-data.js';

const T = TILE;

export const skillParticleMethods = {
  // ---------- 粒子池 ----------

  _obtain() {
    return this._pool.pop() || {};
  },

  _release(particle) {
    if (this._pool.length < 256) this._pool.push(particle);
  },

  _trimParticles() {
    while (this.particles.length > this.cap) {
      this._release(this.particles.pop());
    }
  },

  _spawn(kind, x, y, options = {}) {
    if (this.particles.length >= this.cap) return null;
    const particle = this._obtain();
    particle.kind = kind;
    particle.x = x;
    particle.y = y;
    particle.vx = options.vx || 0;
    particle.vy = options.vy || 0;
    particle.ttl = options.ttl || 0.6;
    particle.maxTtl = particle.ttl;
    particle.size = options.size || 2;
    particle.rot = options.rot || 0;
    particle.vr = options.vr || 0;
    particle.color = options.color || '#ffffff';
    this.particles.push(particle);
    return particle;
  },

  _updateParticles(dt) {
    if (!dt || !this.particles.length) return;
    let write = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.ttl -= dt;
      if (p.ttl <= 0) {
        this._release(p);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.kind === 'ember') p.vy -= 6 * dt;
      if (p.kind === 'snow') p.vy = Math.min(p.vy + 3 * dt, 20);
      if (p.kind === 'star') p.vy -= 1.5 * dt;
      this.particles[write++] = p;
    }
    this.particles.length = write;
  },

  _drawParticles(g) {
    if (!this.particles.length) return;
    g.save();
    for (const p of this.particles) {
      const alpha = clamp01(p.ttl / Math.max(0.001, p.maxTtl));
      const x = p.x * T;
      const y = p.y * T;
      g.globalAlpha = alpha;
      if (p.kind === 'ember') {
        g.fillStyle = p.color;
        g.beginPath();
        g.arc(x, y, p.size * (0.6 + alpha * 0.4), 0, Math.PI * 2);
        g.fill();
      } else if (p.kind === 'snow') {
        g.fillStyle = p.color;
        g.save();
        g.translate(x, y);
        g.rotate(p.rot);
        g.fillRect(-p.size * 0.5, -p.size * 0.5, p.size, p.size);
        g.restore();
      } else if (p.kind === 'star') {
        g.strokeStyle = p.color;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x - p.size, y);
        g.lineTo(x + p.size, y);
        g.moveTo(x, y - p.size);
        g.lineTo(x, y + p.size);
        g.stroke();
      } else {
        // shard / spark
        g.save();
        g.translate(x, y);
        g.rotate(p.rot);
        g.fillStyle = p.color;
        g.beginPath();
        g.moveTo(0, -p.size);
        g.lineTo(p.size * 0.55, 0);
        g.lineTo(0, p.size);
        g.lineTo(-p.size * 0.55, 0);
        g.closePath();
        g.fill();
        g.restore();
      }
    }
    g.restore();
  },

  _spawnAmbient(dt) {
    const id = this._activeId();
    if (!id || !this.profile.ambient || !dt) return;
    const intensity = this._intensity(id);
    if (intensity <= 0.02) return;
    const rate = this.quality === 'full' ? 16 : 9;
    const candidates = rate * dt * intensity;
    let count = Math.floor(candidates);
    if (Math.random() < candidates - count) count++;
    if (this.particles.length + count > this.cap) return;
    const cols = Math.max(1, this.game.map?.cols || 1);
    const rows = Math.max(1, this.game.map?.rows || 1);
    if (id === 'aurora') {
      for (let i = 0; i < count; i++) {
        this._spawn('snow', Math.random() * cols, Math.random() * rows * 0.8, {
          vx: 0.3 + Math.random() * 0.6,
          vy: 0.6 + Math.random() * 0.8,
          ttl: 1.2 + Math.random() * 1.2,
          size: 1.2 + Math.random() * 1.8,
          rot: Math.random() * Math.PI,
          vr: 1,
          color: 'rgba(214, 246, 255, 0.85)',
        });
      }
    } else if (id === 'meteor') {
      for (let i = 0; i < count; i++) {
        this._spawn('ember', Math.random() * cols, rows * (0.35 + Math.random() * 0.6), {
          vx: (Math.random() - 0.5) * 0.8,
          vy: -0.4 - Math.random() * 0.8,
          ttl: 0.7 + Math.random() * 0.9,
          size: 1.1 + Math.random() * 1.6,
          color: Math.random() > 0.4 ? 'rgba(255, 190, 110, 0.9)' : 'rgba(255, 120, 60, 0.8)',
        });
      }
    } else {
      for (let i = 0; i < count; i++) {
        this._spawn('star', Math.random() * cols, Math.random() * rows, {
          vx: 0.15,
          vy: -0.1 - Math.random() * 0.2,
          ttl: 1 + Math.random() * 1.4,
          size: 1.2 + Math.random() * 1.8,
          color: 'rgba(226, 216, 255, 0.85)',
        });
      }
    }
  },

  _spawnFromEvent(id, event) {
    if (!this.profile.afterglow || this.particles.length >= this.cap) return;
    const kind = String(event.kind || '').toLowerCase();
    const x = event.x ?? this.game.map?.base?.x ?? 0;
    const y = event.y ?? this.game.map?.base?.y ?? 0;
    if (id === 'meteor') {
      const count = this.quality === 'full' ? 10 : 6;
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const speed = 1.2 + Math.random() * 3.2;
        this._spawn('ember', x, y, {
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed * 0.6 - 1,
          ttl: 0.4 + Math.random() * 0.7,
          size: 1.4 + Math.random() * 2.2,
          color: Math.random() > 0.5 ? 'rgba(255, 206, 130, 0.95)' : 'rgba(255, 128, 62, 0.9)',
        });
      }
    } else if (id === 'aurora' || /shatter|crystal|ice|frost/.test(kind)) {
      const count = this.quality === 'full' ? 9 : 5;
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const speed = 1.4 + Math.random() * 2.6;
        this._spawn('shard', x, y, {
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed * 0.7,
          ttl: 0.5 + Math.random() * 0.7,
          size: 1.8 + Math.random() * 2.6,
          rot: a,
          vr: (Math.random() - 0.5) * 6,
          color: 'rgba(214, 246, 255, 0.9)',
        });
      }
    } else {
      const count = this.quality === 'full' ? 7 : 4;
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const speed = 0.8 + Math.random() * 2;
        this._spawn('star', x, y, {
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed * 0.7,
          ttl: 0.6 + Math.random() * 0.8,
          size: 1.4 + Math.random() * 2,
          color: 'rgba(232, 222, 255, 0.9)',
        });
      }
    }
  }
};
