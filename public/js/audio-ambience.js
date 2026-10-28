// 环境音层：场景铺底（menu/battle/boss）+ 群系/天气联动的程序化氛围。
// 纯数据表、映射纯函数与节点构建；开关/计时器/总线状态在 audio.js 的门面里。
import {
  AMBIENCE_BIOME_IDS,
  AMBIENCE_KIND_BY_BIOME,
  AMBIENCE_KIND_BY_WEATHER,
  AMBIENCE_WEATHER_IDS,
  resolveAmbience,
} from './shared/ambience.js';
import { t } from './i18n.js';

// 环境音是低频氛围底噪，电平低于常规音效。
export const AMBIENT_VOLUME = 0.035;

// 环境音跟着场景切换：大厅更空旷，战斗更低沉，Boss 最低。
export const AMBIENT_TRACKS = {
  menu: { type: 'sine', freqs: [55, 82.5] },
  battle: { type: 'triangle', freqs: [49, 73.42] },
  boss: { type: 'sine', freqs: [41.2, 61.74] },
};

// ---------- 环境音层（群系 / 天气联动） ----------
// 独立于音乐、音效的总线，默认电平低于音乐（0.1 × 50% = 0.05）。
export const AMBIENCE_VOLUME = 0.03;
export const AMBIENCE_ENABLED_KEY = 'abyss-tower.ambience';

// 三类程序化音色，全部由振荡器/噪声合成，不引入音频素材。
// name 用 getter 惰性取词典：模块加载时不能锁定语言。
export const AMBIENCE_KINDS = Object.freeze({
  wind: Object.freeze({
    id: 'wind',
    get name() { return t('audio.ambience.wind'); },
    noise: true,
    filter: 520,
    bed: 0.3,
  }),
  drone: Object.freeze({
    id: 'drone',
    get name() { return t('audio.ambience.drone'); },
    noise: false,
    filter: 420,
    bed: 0,
  }),
  water: Object.freeze({
    id: 'water',
    get name() { return t('audio.ambience.water'); },
    noise: true,
    filter: 900,
    bed: 0.12,
    drip: true,
  }),
});

// 六个群系全部有映射；音色来自 shared/ambience.js 的氛围预设（单一事实来源），
// 这里只保留程序化合成的基频与电平。
const AMBIENCE_FREQS = Object.freeze({
  canyon: Object.freeze([55, 82.5]),
  twin: Object.freeze([196, 293.66]),
  triple: Object.freeze([41.2, 61.74]),
  ring: Object.freeze([49, 73.42]),
  cross: Object.freeze([46.25, 69.3]),
  switchback: Object.freeze([51.91, 77.78]),
});
const AMBIENCE_LEVELS = Object.freeze({
  canyon: 1,
  twin: 0.9,
  triple: 1,
  ring: 0.95,
  cross: 0.9,
  switchback: 1.05,
});

export const AMBIENCE_PROFILES = Object.freeze(
  Object.fromEntries(
    AMBIENCE_BIOME_IDS.map((biome) => [
      biome,
      Object.freeze({
        kind: AMBIENCE_KIND_BY_BIOME[biome],
        freqs: AMBIENCE_FREQS[biome],
        level: AMBIENCE_LEVELS[biome],
      }),
    ])
  )
);

// 天气覆盖音色：kind 来自共享预设，levelMul 是音频层的混音系数。
const AMBIENCE_WEATHER_LEVELS = Object.freeze({ rain: 1.1, fog: 0.85, meteor: 1.15 });
export const AMBIENCE_WEATHER = Object.freeze(
  Object.fromEntries(
    AMBIENCE_WEATHER_IDS.map((weather) => [
      weather,
      Object.freeze({
        kind: AMBIENCE_KIND_BY_WEATHER[weather],
        levelMul: AMBIENCE_WEATHER_LEVELS[weather],
      }),
    ])
  )
);

// 纯函数：群系决定基础音色，天气覆盖音色与电平。未知输入由共享预设回退。
export function ambienceFor(mapMeta, weather = null) {
  const preset = resolveAmbience(mapMeta?.archetype, weather, 'full');
  const base = AMBIENCE_PROFILES[preset.biome];
  const overlay = preset.weather ? AMBIENCE_WEATHER[preset.weather] : null;
  return Object.freeze({
    biome: preset.biome,
    weather: overlay ? preset.weather : null,
    kind: preset.ambienceKind,
    freqs: base.freqs,
    level: AMBIENCE_VOLUME * base.level * (overlay?.levelMul ?? 1),
    key: preset.ambienceId,
  });
}

export function readAmbienceEnabled() {
  try {
    return globalThis.localStorage?.getItem?.(AMBIENCE_ENABLED_KEY) !== 'off';
  } catch {
    return true;
  }
}

// ---------- 节点构建（纯函数：显式传入 ctx / 输出总线 / 音色表） ----------

// 两个低频振荡器 + 极慢的颤音，形成没有旋律的氛围底噪。
export function buildAmbientBedNodes(ctx, gain, track) {
  const nodes = [];
  track.freqs.forEach((freq, index) => {
    const osc = ctx.createOscillator();
    osc.type = track.type;
    osc.frequency.value = freq;
    const trem = ctx.createGain();
    trem.gain.value = 0.5 / track.freqs.length;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.08 + index * 0.03;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.25 / track.freqs.length;
    lfo.connect(lfoDepth).connect(trem.gain);
    osc.connect(trem).connect(gain);
    osc.start();
    lfo.start();
    nodes.push(osc, lfo);
  });
  return nodes;
}

// 三类音色共享低频铺底；风声/水滴额外叠一层低通噪声（噪声缓冲区按需惰性取，避免白建节点）。
// 返回 { nodes, drip }：drip 由门面据此排布随机滴答。
export function buildAmbienceLayerNodes(ctx, gain, spec, noiseBuffer) {
  const kind = AMBIENCE_KINDS[spec.kind] || AMBIENCE_KINDS.wind;
  const nodes = [];

  spec.freqs.forEach((freq, index) => {
    const osc = ctx.createOscillator();
    osc.type = kind.id === 'water' ? 'sine' : 'triangle';
    osc.frequency.value = freq;
    const trem = ctx.createGain();
    trem.gain.value = 0.35 / spec.freqs.length;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.07 + index * 0.02;
    const depth = ctx.createGain();
    depth.gain.value = 0.2 / spec.freqs.length;
    lfo.connect(depth).connect(trem.gain);
    osc.connect(trem).connect(gain);
    osc.start();
    lfo.start();
    nodes.push(osc, lfo);
  });

  if (kind.noise) {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer();
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = kind.filter;
    const bed = ctx.createGain();
    bed.gain.value = kind.bed;
    source.connect(filter).connect(bed).connect(gain);
    source.start();
    nodes.push(source);
  }

  return { nodes, drip: !!kind.drip };
}

// 2 秒白噪声循环，只用一个缓冲区，不引入素材文件。
export function ambienceNoiseBuffer(ctx) {
  const frames = Math.max(1, Math.floor(ctx.sampleRate * 2));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

// 一次水滴：随机基频的短促下滑音，自带包络与停止时间，不占用循环节点表。
export function playDripNote(ctx, gain, spec) {
  const base = spec.freqs[Math.floor(Math.random() * spec.freqs.length)] || 220;
  const freq = base * (2 + Math.random() * 2);
  const when = ctx.currentTime + 0.04;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, when);
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.55), when + 0.22);
  env.gain.setValueAtTime(0.0001, when);
  env.gain.exponentialRampToValueAtTime(0.12, when + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, when + 0.26);
  osc.connect(env).connect(gain);
  osc.start(when);
  osc.stop(when + 0.3);
}


// ---------- 场景铺底状态机（menu / battle / boss） ----------
// 宿主（audio.js 的 AudioFX）提供 ctx / ambientGain / enabled / ensure()；本类只管期望氛围与节点生命周期。
export class AmbientBed {
  constructor(host) {
    this.host = host;
    this.wanted = false;
    this.mood = null;
    this.nodes = null;
  }

  startAmbient(mood = 'menu') {
    const next = AMBIENT_TRACKS[mood] ? mood : 'menu';
    this.wanted = true;
    if (this.mood === next) {
      if (this.host.ctx && !this.nodes) this.maybeBeginAmbient();
      return;
    }
    this.pauseAmbient();
    this.mood = next;
    const ctx = this.host.ensure();
    if (ctx) this.maybeBeginAmbient();
  }

  stopAmbient() {
    this.wanted = false;
    this.mood = null;
    this.pauseAmbient();
  }

  maybeBeginAmbient() {
    const host = this.host;
    if (!host.enabled || !this.wanted || !host.ctx || !host.ambientGain) return;
    if (host.ctx.state !== 'running') return;
    if (!this.nodes) this.buildAmbientNodes();
    const now = host.ctx.currentTime;
    host.ambientGain.gain.cancelScheduledValues(now);
    host.ambientGain.gain.setTargetAtTime(AMBIENT_VOLUME, now, 0.6);
  }

  buildAmbientNodes() {
    const track = AMBIENT_TRACKS[this.mood] || AMBIENT_TRACKS.menu;
    this.nodes = buildAmbientBedNodes(this.host.ctx, this.host.ambientGain, track);
  }

  pauseAmbient() {
    this.stopAmbientNodes();
    const host = this.host;
    if (host.ambientGain && host.ctx) {
      const now = host.ctx.currentTime;
      host.ambientGain.gain.cancelScheduledValues(now);
      host.ambientGain.gain.setTargetAtTime(0.0001, now, 0.2);
    }
  }

  stopAmbientNodes() {
    if (!this.nodes) return;
    for (const node of this.nodes) {
      try {
        node.stop();
        node.disconnect();
      } catch {
        /* 节点可能已停止 */
      }
    }
    this.nodes = null;
  }
}

// ---------- 环境音层状态机（群系 / 天气） ----------
// 独立于 sfx/music：自己的开关、总线（宿主提供 ambienceGain）、节点与计时器。
export class AmbienceLayer {
  constructor(host) {
    this.host = host;
    this.ambienceEnabled = readAmbienceEnabled();
    this.wanted = false;
    this.spec = null;
    this.key = null;
    this.nodes = null;
    this.noise = null;
    this.timer = null;
  }

  // 低配可关闭：独立开关持久化在自己的键上，不触碰 sfx/music 的任何状态。
  setAmbienceEnabled(value) {
    this.ambienceEnabled = !!value;
    try {
      globalThis.localStorage?.setItem?.(AMBIENCE_ENABLED_KEY, this.ambienceEnabled ? 'on' : 'off');
    } catch {
      /* 存储不可用：只在本次会话生效 */
    }
    if (!this.ambienceEnabled) {
      this.pauseAmbience();
      return false;
    }
    if (this.wanted) {
      const ctx = this.host.ensure();
      if (ctx) this.maybeBeginAmbient();
    }
    return true;
  }

  // 入口：群系由 mapMeta.archetype 决定，天气由调用方用 weatherFor() 求得。
  startAmbience(mapMeta = null, weather = null) {
    const spec = ambienceFor(mapMeta, weather);
    this.spec = spec;
    this.wanted = true;
    if (this.key === spec.key && this.nodes) {
      this.maybeBeginAmbient();
      return spec;
    }
    this.stopAmbienceNodes();
    this.clearAmbienceTimer();
    this.key = spec.key;
    const ctx = this.host.ensure();
    if (ctx) this.maybeBeginAmbient();
    return spec;
  }

  stopAmbience() {
    this.wanted = false;
    this.key = null;
    this.spec = null;
    this.pauseAmbience();
  }

  maybeBeginAmbient() {
    const host = this.host;
    if (!this.ambienceEnabled || !this.wanted || !host.ctx || !host.ambienceGain) return;
    if (host.ctx.state !== 'running') return;
    if (!this.nodes) this.buildAmbienceNodes();
    const now = host.ctx.currentTime;
    const level = Math.max(0.0002, this.spec?.level ?? AMBIENCE_VOLUME);
    host.ambienceGain.gain.cancelScheduledValues(now);
    host.ambienceGain.gain.setTargetAtTime(level, now, 0.8);
  }

  // 三类音色共享低频铺底；风声/水滴额外叠一层低通噪声，水滴再排布随机滴答。
  buildAmbienceNodes() {
    const { ctx, ambienceGain } = this.host;
    const spec = this.spec || ambienceFor(null);
    if (!ctx || !ambienceGain) return;
    const { nodes, drip } = buildAmbienceLayerNodes(ctx, ambienceGain, spec, () =>
      this.ambienceNoiseBuffer()
    );
    this.nodes = nodes;
    if (drip) this.scheduleDrip();
  }

  // 2 秒白噪声循环，只用一个缓冲区，不引入素材文件。
  ambienceNoiseBuffer() {
    if (this.noise) return this.noise;
    this.noise = ambienceNoiseBuffer(this.host.ctx);
    return this.noise;
  }

  // 水滴：随机间隔的短促下滑音，自带包络与停止时间，不占用循环节点表。
  scheduleDrip() {
    const host = this.host;
    if (!this.ambienceEnabled || !this.wanted || !host.ctx || host.ctx.state !== 'running') {
      this.timer = null;
      return;
    }
    const spec = this.spec || ambienceFor(null);
    playDripNote(host.ctx, host.ambienceGain, spec);
    const timer = setTimeout(() => this.scheduleDrip(), (1.2 + Math.random() * 2.4) * 1000);
    timer?.unref?.();
    this.timer = timer;
  }

  clearAmbienceTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  pauseAmbience() {
    this.clearAmbienceTimer();
    this.stopAmbienceNodes();
    const host = this.host;
    if (host.ambienceGain && host.ctx) {
      const now = host.ctx.currentTime;
      host.ambienceGain.gain.cancelScheduledValues(now);
      host.ambienceGain.gain.setTargetAtTime(0.0001, now, 0.35);
    }
  }

  stopAmbienceNodes() {
    if (!this.nodes) return;
    for (const node of this.nodes) {
      try {
        node.stop();
        node.disconnect();
      } catch {
        /* 节点可能已停止 */
      }
    }
    this.nodes = null;
  }
}
