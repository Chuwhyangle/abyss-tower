// 纯 WebAudio 合成音效与程序化背景音乐，不依赖任何音频文件。
// 门面：AudioFX 持有开关/音量/调度状态与全部对外方法；合成原语在 audio-synth.js，
// 曲目与阶段强度在 audio-music.js，环境音层在 audio-ambience.js，音效编排留在本文件。
import {
  DEFAULT_MUSIC_VOLUME,
  DEFAULT_SFX_VOLUME,
  loadSettings,
  normalizeVolume,
  saveSettings,
} from './settings.js';
import { ImpactMixer, supportAuraPulse } from './audio-impacts.js';
import { AmbientBed, AmbienceLayer } from './audio-ambience.js';
import {
  CROSSFADE_SECONDS,
  MUSIC_VARIANTS,
  MUSIC_VOLUME,
  bossLayer,
  bossMusicPhase,
  musicWaveIntensity,
  pickBossMusicTrack,
  pickMusicVariant,
  sessionSeed,
} from './audio-music.js';
import {
  MASTER_VOLUME,
  playMusicDrum,
  playMusicTone,
  playNoise,
  playSfx,
  playTone,
  writeCompressorParams,
} from './audio-synth.js';

// 对外导出保持不变：拆分前定义在本文件的常量/纯函数，仍从本门面导出。
export {
  AMBIENCE_ENABLED_KEY,
  AMBIENCE_KINDS,
  AMBIENCE_PROFILES,
  AMBIENCE_VOLUME,
  AMBIENCE_WEATHER,
  ambienceFor,
} from './audio-ambience.js';
export {
  BOSS_INTENSITY_LAYERS,
  BOSS_MUSIC_TRACKS,
  BOSS_PHASE_THRESHOLDS,
  CROSSFADE_SECONDS,
  MUSIC_VARIANTS,
  MUSIC_VOLUME,
  WAVE_INTENSITY_MAX,
  WAVE_INTENSITY_WAVES,
  bossLayer,
  bossLayerGain,
  bossMusicPhase,
  musicWaveIntensity,
  pickBossMusicTrack,
  pickMusicVariant,
  sessionSeed,
} from './audio-music.js';
export { IMPACT_COMPRESSOR } from './audio-synth.js';

class AudioFX {
  constructor() {
    const settings = loadSettings();
    this.enabled = globalThis.localStorage?.getItem?.('abyss-tower.sound') !== 'off';
    this.musicEnabled = settings.music !== false;
    this.sfxVolume = normalizeVolume(settings.sfxVolume, DEFAULT_SFX_VOLUME);
    this.musicVolume = normalizeVolume(settings.musicVolume, DEFAULT_MUSIC_VOLUME);
    this.ctx = null;
    this.masterGain = null;
    this.sfxGain = null;
    // 命中音效总线：impactGain → 压缩/限幅 → sfxGain（见 docs/PHASE_FEEL_ART.md §3.5）。
    this.impactGain = null;
    this.impactCompressor = null;
    this.impactMixer = new ImpactMixer({ voice: (signature, opts) => this.impactVoice(signature, opts) });
    this._auraState = { lastAt: -Infinity };
    this.musicGain = null;
    this.ambientGain = null;
    this.mood = null;
    this.musicWanted = false;
    this._musicTimer = null;
    this._musicStep = 0;
    this.seed = sessionSeed();
    this.intensity = 1;
    this.bossVariant = null;
    this.bossPhase = 1;
    this._spareMusicGain = null;
    this._crossfadeUntil = 0;
    // 环境音（场景铺底）与环境音层（群系/天气）各自一套状态机，与 sfx/music 完全独立。
    this.ambient = new AmbientBed(this);
    this.ambience = new AmbienceLayer(this);
    this._onVisibility = () => this.handleVisibility();
    globalThis.document?.addEventListener?.('visibilitychange', this._onVisibility);
  }

  // 环境音层内部状态对外只读：调试面板与测试沿用拆分前的属性名。
  get ambienceEnabled() {
    return this.ambience.ambienceEnabled;
  }

  get _ambientNodes() {
    return this.ambient.nodes;
  }

  get _ambienceNodes() {
    return this.ambience.nodes;
  }

  get _ambienceTimer() {
    return this.ambience.timer;
  }

  ensure() {
    if (!this.ctx) {
      // 音效、音乐、环境音（两层）都关闭时不必创建上下文。
      if (
        !this.enabled &&
        !this.musicEnabled &&
        !this.musicWanted &&
        !this.ambient.wanted &&
        !this.ambience.wanted
      ) {
        return null;
      }
      const AC = globalThis.window?.AudioContext || globalThis.window?.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = MASTER_VOLUME;
      this.masterGain.connect(this.ctx.destination);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.sfxLevel();
      this.sfxGain.connect(this.masterGain);

      // 命中音效：独立增益 → 压缩/限幅 → sfxGain。环境不支持压缩节点时直连 sfxGain 降级。
      this.impactGain = this.ctx.createGain();
      this.impactGain.gain.value = 1;
      this.impactCompressor = null;
      const compressor =
        typeof this.ctx.createDynamicsCompressor === 'function' ? this.ctx.createDynamicsCompressor() : null;
      if (compressor && typeof compressor.connect === 'function') {
        this.impactCompressor = compressor;
        writeCompressorParams(compressor);
        this.impactGain.connect(compressor).connect(this.sfxGain);
      } else {
        this.impactGain.connect(this.sfxGain);
      }

      // 两路音乐总线：切歌时一路淡出、一路淡入，1.2s 交叠完成交叉淡化。
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.0001;
      this.musicGain.connect(this.masterGain);
      this._spareMusicGain = this.ctx.createGain();
      this._spareMusicGain.gain.value = 0.0001;
      this._spareMusicGain.connect(this.masterGain);

      // 环境音属于音效层，挂在 sfx 总线之后，音效静音时一并静音。
      this.ambientGain = this.ctx.createGain();
      this.ambientGain.gain.value = 0.0001;
      this.ambientGain.connect(this.sfxGain);

      // 环境音层走自己的总线，直接接 master，音量/开关与 sfx、music 互不影响。
      this.ambienceGain = this.ctx.createGain();
      this.ambienceGain.gain.value = 0.0001;
      this.ambienceGain.connect(this.masterGain);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume()
        .then(() => {
          this.maybeBeginMusic();
          this.maybeBeginAmbient();
          this.maybeBeginAmbience();
        })
        .catch(() => {});
    } else {
      this.maybeBeginMusic();
      this.maybeBeginAmbient();
      this.maybeBeginAmbience();
    }
    return this.ctx;
  }

  // 压缩/限幅参数写入（实现见 audio-synth.js）：真实 AudioParam 走 setValueAtTime，测试假参数直接赋值。
  applyCompressorParams(compressor) {
    writeCompressorParams(compressor);
  }

  setEnabled(value) {
    this.enabled = value;
    globalThis.localStorage?.setItem?.('abyss-tower.sound', value ? 'on' : 'off');
    if (value) {
      this.ensure();
      this.maybeBeginAmbient();
      this.maybeBeginAmbience();
    } else {
      this.pauseAmbient();
      this.pauseAmbience();
    }
  }

  // ---------- 音量总线 ----------

  sfxLevel() {
    return this.sfxVolume / 100;
  }

  musicLevel() {
    return MUSIC_VOLUME * (this.musicVolume / 100);
  }

  // 音乐目标电平 = 用户音乐音量 × 波次强度；只作用于 music 总线，音效总线不动。
  musicTargetLevel() {
    return this.musicLevel() * this.intensity;
  }

  // 音量设置写回 settings.js 的存储；画质设置与其他字段保持不变。
  persistVolumes() {
    saveSettings({ ...loadSettings(), sfxVolume: this.sfxVolume, musicVolume: this.musicVolume });
  }

  setSfxVolume(value) {
    this.sfxVolume = normalizeVolume(value, this.sfxVolume);
    if (this.sfxGain && this.ctx) {
      const now = this.ctx.currentTime;
      this.sfxGain.gain.cancelScheduledValues(now);
      this.sfxGain.gain.setTargetAtTime(this.sfxLevel(), now, 0.03);
    }
    this.persistVolumes();
    return this.sfxVolume;
  }

  setMusicVolume(value) {
    this.musicVolume = normalizeVolume(value, this.musicVolume);
    if (this.musicGain && this.ctx && this.musicWanted && this.musicEnabled) {
      const now = this.ctx.currentTime;
      this.musicGain.gain.cancelScheduledValues(now);
      this.musicGain.gain.setTargetAtTime(this.musicTargetLevel(), now, 0.12);
    }
    this.persistVolumes();
    return this.musicVolume;
  }

  // 波次越高音乐越紧张：只微调音乐总线电平，音效与控制语义不变。
  setMusicIntensity(wave) {
    const intensity = musicWaveIntensity(wave);
    if (intensity === this.intensity) return this.intensity;
    this.intensity = intensity;
    if (this.ctx && this.ctx.state === 'running' && this.musicWanted && this.musicEnabled && this._musicTimer) {
      const now = this.ctx.currentTime;
      this.musicGain.gain.cancelScheduledValues(now);
      this.musicGain.gain.setTargetAtTime(this.musicTargetLevel(), now, 0.8);
    }
    return this.intensity;
  }

  // 首领曲目与阶段强度层。variant 变化走 1.2s 交叉淡化；同一首内的阶段变化
  // 只改变下一个调度步的声部（鼓点/低音），新声部自带淡入包络，不会产生爆音。
  setBossContext(variant, hpRatio) {
    const nextVariant = pickBossMusicTrack(variant) ? variant : null;
    const nextPhase = bossMusicPhase(hpRatio);
    if (nextVariant === this.bossVariant && nextPhase === this.bossPhase) return false;
    const variantChanged = nextVariant !== this.bossVariant;
    this.bossVariant = nextVariant;
    this.bossPhase = nextPhase;
    if (this.mood !== 'boss') return true;
    if (variantChanged) {
      this._musicStep = 0;
      if (this.ctx && this._musicTimer) this.crossfadeMusicBus();
      if (this.ctx) this.maybeBeginMusic();
    }
    return true;
  }

  // ---------- 背景音乐 ----------

  setMusicEnabled(value) {
    this.musicEnabled = !!value;
    if (!this.musicEnabled) {
      this.pauseMusicLoop();
      return;
    }
    const ctx = this.ensure();
    if (ctx) this.maybeBeginMusic();
  }

  startMusic(mood = 'menu') {
    const next = MUSIC_VARIANTS[mood] ? mood : 'menu';
    this.musicWanted = true;
    // 离开首领战就清掉变体/阶段，下一场首领从第一阶段和新曲目开始。
    if (next !== 'boss') {
      this.bossVariant = null;
      this.bossPhase = 1;
    }
    // 环境音跟随场景，与音乐共用同一套 menu/battle/boss 氛围切换点。
    this.startAmbient(next);
    if (this.mood === next) {
      // 同一氛围重复请求（HUD 每帧刷新）不重排，等首次用户手势再启动。
      if (this.ctx && !this._musicTimer) this.maybeBeginMusic();
      return;
    }
    const playing = !!this._musicTimer;
    this.pauseMusicLoop();
    this._musicStep = 0;
    this.mood = next;
    // 大厅不属于波次，回到菜单时把强度复位，避免带着上一局的紧张感。
    if (next === 'menu') this.setMusicIntensity(0);
    const ctx = this.ensure();
    if (ctx && playing) this.crossfadeMusicBus();
    if (ctx) this.maybeBeginMusic();
  }

  stopMusic() {
    this.musicWanted = false;
    this.mood = null;
    this.intensity = 1;
    this.bossVariant = null;
    this.bossPhase = 1;
    this.pauseMusicLoop();
    this.stopAmbient();
    this.stopAmbience();
  }

  // 浏览器要求首次用户手势后才能出声：上下文未 running 时只排队，不调度音符。
  maybeBeginMusic() {
    if (!this.musicEnabled || !this.musicWanted || !this.ctx || !this.masterGain || !this.musicGain) return;
    if (this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    // 交叉淡化期间不要再叠一次淡入，否则新旧两路的曲线会互相覆盖。
    if (now >= this._crossfadeUntil) {
      this.musicGain.gain.cancelScheduledValues(now);
      this.musicGain.gain.setTargetAtTime(this.musicTargetLevel(), now, 0.25);
    }
    if (!this._musicTimer) this.scheduleMusicStep();
  }

  // 新旧两路音乐总线在 CROSSFADE_SECONDS 内交叠：旧路淡出、新路淡入，切换不产生爆音。
  crossfadeMusicBus() {
    if (!this.ctx || !this.musicGain || !this._spareMusicGain) return;
    const now = this.ctx.currentTime;
    const outgoing = this.musicGain;
    const incoming = this._spareMusicGain;
    const curve = CROSSFADE_SECONDS / 3;
    incoming.gain.cancelScheduledValues(now);
    incoming.gain.setValueAtTime(0.0001, now);
    incoming.gain.setTargetAtTime(this.musicTargetLevel(), now, curve);
    outgoing.gain.cancelScheduledValues(now);
    outgoing.gain.setTargetAtTime(0.0001, now, curve);
    this.musicGain = incoming;
    this._spareMusicGain = outgoing;
    this._crossfadeUntil = now + CROSSFADE_SECONDS;
  }

  clearMusicTimer() {
    if (this._musicTimer) {
      clearTimeout(this._musicTimer);
      this._musicTimer = null;
    }
  }

  pauseMusicLoop() {
    this.clearMusicTimer();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const gain of [this.musicGain, this._spareMusicGain]) {
      if (!gain) continue;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(0.0001, now, 0.08);
    }
  }

  scheduleMusicStep() {
    if (!this.musicWanted || !this.musicEnabled || !this.ctx || this.ctx.state !== 'running') {
      this._musicTimer = null;
      return;
    }
    const bossTrack = this.mood === 'boss' ? pickBossMusicTrack(this.bossVariant) : null;
    const track =
      bossTrack || pickMusicVariant(this.mood, this.seed) || pickMusicVariant('menu', this.seed);
    const chord = track.chords[this._musicStep % track.chords.length];
    const when = this.ctx.currentTime + 0.06;
    if (bossTrack) {
      const layer = bossLayer(this.bossPhase);
      for (const freq of chord) {
        this.musicTone(freq, track.chordDur * 0.95, track.type, layer.chord, when);
      }
      this.musicTone(chord[0] / 2, track.chordDur * 0.95, 'sine', layer.bass, when);
      for (let i = 0; i < layer.drums; i += 1) {
        const offset = (track.chordDur * (i + 0.5)) / layer.drums;
        this.musicDrum(layer.drum, when + offset);
      }
    } else {
      const level = this.mood === 'menu' ? 0.06 : 0.045;
      for (const freq of chord) {
        this.musicTone(freq, track.chordDur * 0.95, track.type, level, when);
      }
      this.musicTone(chord[0] / 2, track.chordDur * 0.95, 'sine', level * 0.8, when);
    }
    this._musicStep += 1;
    this._musicTimer = setTimeout(() => this.scheduleMusicStep(), track.chordDur * 1000);
  }

  musicTone(freq, duration, type, level, when) {
    playMusicTone(this.ctx, this.musicGain, freq, duration, type, level, when);
  }

  musicDrum(level, when) {
    playMusicDrum(this.ctx, this.musicGain, level, when);
  }

  // ---------- 环境音（场景铺底：状态机在 audio-ambience.js 的 AmbientBed） ----------

  startAmbient(mood = 'menu') {
    this.ambient.startAmbient(mood);
  }

  stopAmbient() {
    this.ambient.stopAmbient();
  }

  maybeBeginAmbient() {
    this.ambient.maybeBeginAmbient();
  }

  buildAmbientNodes() {
    this.ambient.buildAmbientNodes();
  }

  pauseAmbient() {
    this.ambient.pauseAmbient();
  }

  stopAmbientNodes() {
    this.ambient.stopAmbientNodes();
  }

  // ---------- 环境音层（群系 / 天气：状态机在 audio-ambience.js 的 AmbienceLayer） ----------

  setAmbienceEnabled(value) {
    return this.ambience.setAmbienceEnabled(value);
  }

  startAmbience(mapMeta = null, weather = null) {
    return this.ambience.startAmbience(mapMeta, weather);
  }

  stopAmbience() {
    this.ambience.stopAmbience();
  }

  maybeBeginAmbience() {
    this.ambience.maybeBeginAmbient();
  }

  buildAmbienceNodes() {
    this.ambience.buildAmbienceNodes();
  }

  ambienceNoiseBuffer() {
    return this.ambience.ambienceNoiseBuffer();
  }

  scheduleDrip() {
    this.ambience.scheduleDrip();
  }

  clearAmbienceTimer() {
    this.ambience.clearAmbienceTimer();
  }

  pauseAmbience() {
    this.ambience.pauseAmbience();
  }

  stopAmbienceNodes() {
    this.ambience.stopAmbienceNodes();
  }

  // 页面切到后台时暂停音乐与环境音并挂起上下文，回到前台再续播。
  handleVisibility() {
    if (!this.ctx) return;
    if (document.hidden) {
      this.pauseMusicLoop();
      this.pauseAmbient();
      this.pauseAmbience();
      this.ctx.suspend().catch(() => {});
    } else {
      this.ctx.resume()
        .then(() => {
          this.maybeBeginMusic();
          this.maybeBeginAmbient();
          this.maybeBeginAmbience();
        })
        .catch(() => {});
    }
  }

  play(name) {
    if (!this.enabled) return;
    const ctx = this.ensure();
    if (!ctx) return;
    playSfx(this, name);
  }

  // options.bus 指定输出目标（默认 sfxGain），options.detune 是音分级变调（命中音效专用）。
  tone(freq, duration, type, gain, slide = 0, when = 0, options = {}) {
    const bus = options.bus && options.bus !== this.sfxGain ? options.bus : this.sfxGain;
    playTone(this.ctx, bus, { freq, duration, type, gain, slide, when, detune: options.detune });
  }

  // options.bus 指定输出目标（默认 sfxGain），options.filterType 选择滤波类型（默认 lowpass）。
  noise(duration, gain, cutoff = 1200, when = 0, options = {}) {
    const bus = options.bus && options.bus !== this.sfxGain ? options.bus : this.sfxGain;
    playNoise(this.ctx, bus, {
      duration,
      gain,
      cutoff,
      when,
      filterType: options.filterType || 'lowpass',
    });
  }

  // 一次命中声：签名主音 + 可选噪声；暴击叠高频亮度层，致死叠 60Hz 低频层（都计入同一声预算）。
  // 只有这里走 impactGain，其它 play() 音效仍直连 sfxGain。
  impactVoice(signature, options = {}) {
    if (!this.enabled || !signature || !this.ctx) return false;
    const bus = this.impactGain || this.sfxGain;
    const gainMul = Number.isFinite(options.gainMul) ? options.gainMul : 1;
    const pitchCents = Number.isFinite(options.pitchCents) ? options.pitchCents : 0;
    const delayMs = Number.isFinite(options.delayMs) ? Math.max(0, options.delayMs) : 0;
    const when = this.ctx.currentTime + delayMs / 1000;
    const gain = Math.max(0.0002, Math.min(0.06, signature.gain * gainMul));
    this.tone(signature.freq, signature.duration, signature.type, gain, signature.slide, when, {
      bus,
      detune: pitchCents,
    });
    if (signature.noise) {
      const noiseGain = Math.max(0.0002, signature.noise.gain * gainMul);
      this.noise(signature.noise.duration, noiseGain, signature.noise.cutoff, when, {
        bus,
        filterType: signature.noise.filter,
      });
    }
    if (options.accent) {
      this.tone(signature.freq * 2.2, 0.05, 'triangle', 0.012, 0, when, { bus, detune: pitchCents });
    }
    if (options.lethal) {
      this.tone(60, 0.18, 'sine', 0.02, -18, when, { bus });
    }
    return true;
  }

  // 命中层入口：消费本帧新增的 sim.impactEvents + 战旗光环脉冲，全部走同一个混音器。
  // 关闭音效时直接返回，不创建上下文、不创建任何振荡器/噪声节点。
  followCombatImpacts(sim, nowMs = 0) {
    if (!this.enabled) return { played: 0, suppressed: 0, plans: [] };
    if (!this.ensure()) return { played: 0, suppressed: 0, plans: [] };
    const result = this.impactMixer.handle(sim?.impactEvents || [], nowMs);
    const aura = supportAuraPulse(sim, nowMs, this._auraState);
    if (aura) {
      const extra = this.impactMixer.handleEvent(aura, nowMs);
      result.played += extra.played;
      result.suppressed += extra.suppressed;
      result.plans.push(...extra.plans);
    }
    return result;
  }
}

export const audio = new AudioFX();
