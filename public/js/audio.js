// 纯 WebAudio 合成音效与程序化背景音乐，不依赖任何音频文件。
import {
  DEFAULT_MUSIC_VOLUME,
  DEFAULT_SFX_VOLUME,
  loadSettings,
  normalizeVolume,
  saveSettings,
} from './settings.js';

// 混音总线：master ← sfx / music。各总线增益由 0–100 的音量设置换算。
const MASTER_VOLUME = 0.45;
// 音乐走独立增益节点，100% 时仍明显低于音效主增益（0.45）。
const MUSIC_VOLUME = 0.1;
// 环境音是低频氛围底噪，电平低于常规音效。
const AMBIENT_VOLUME = 0.035;

// 环境音跟着场景切换：大厅更空旷，战斗更低沉，Boss 最低。
const AMBIENT_TRACKS = {
  menu: { type: 'sine', freqs: [55, 82.5] },
  battle: { type: 'triangle', freqs: [49, 73.42] },
  boss: { type: 'sine', freqs: [41.2, 61.74] },
};

// 三套程序化氛围：menu / battle / boss。每套是一段和弦进行，由振荡器循环合成。
const MUSIC_TRACKS = {
  menu: {
    type: 'triangle',
    chordDur: 2.4,
    chords: [
      [261.63, 329.63, 392.0],
      [220.0, 261.63, 329.63],
      [174.61, 220.0, 261.63],
      [196.0, 246.94, 293.66],
    ],
  },
  battle: {
    type: 'square',
    chordDur: 1.2,
    chords: [
      [220.0, 261.63, 329.63],
      [174.61, 220.0, 261.63],
      [196.0, 246.94, 293.66],
      [164.81, 196.0, 246.94],
    ],
  },
  boss: {
    type: 'sawtooth',
    chordDur: 0.9,
    chords: [
      [110.0, 130.81, 164.81],
      [103.83, 123.47, 155.56],
      [98.0, 116.54, 146.83],
      [92.5, 110.0, 138.59],
    ],
  },
};

class AudioFX {
  constructor() {
    const settings = loadSettings();
    this.enabled = localStorage.getItem('abyss-tower.sound') !== 'off';
    this.musicEnabled = settings.music !== false;
    this.sfxVolume = normalizeVolume(settings.sfxVolume, DEFAULT_SFX_VOLUME);
    this.musicVolume = normalizeVolume(settings.musicVolume, DEFAULT_MUSIC_VOLUME);
    this.ctx = null;
    this.masterGain = null;
    this.sfxGain = null;
    this.musicGain = null;
    this.ambientGain = null;
    this.mood = null;
    this.musicWanted = false;
    this.ambientMood = null;
    this.ambientWanted = false;
    this._ambientNodes = null;
    this._musicTimer = null;
    this._musicStep = 0;
    this._onVisibility = () => this.handleVisibility();
    document.addEventListener('visibilitychange', this._onVisibility);
  }

  ensure() {
    if (!this.ctx) {
      // 音效、音乐、环境音都关闭时不必创建上下文。
      if (!this.enabled && !this.musicEnabled && !this.musicWanted && !this.ambientWanted) return null;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = MASTER_VOLUME;
      this.masterGain.connect(this.ctx.destination);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.sfxLevel();
      this.sfxGain.connect(this.masterGain);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.0001;
      this.musicGain.connect(this.masterGain);

      // 环境音属于音效层，挂在 sfx 总线之后，音效静音时一并静音。
      this.ambientGain = this.ctx.createGain();
      this.ambientGain.gain.value = 0.0001;
      this.ambientGain.connect(this.sfxGain);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume()
        .then(() => {
          this.maybeBeginMusic();
          this.maybeBeginAmbient();
        })
        .catch(() => {});
    } else {
      this.maybeBeginMusic();
      this.maybeBeginAmbient();
    }
    return this.ctx;
  }

  setEnabled(value) {
    this.enabled = value;
    localStorage.setItem('abyss-tower.sound', value ? 'on' : 'off');
    if (value) {
      this.ensure();
      this.maybeBeginAmbient();
    } else {
      this.pauseAmbient();
    }
  }

  // ---------- 音量总线 ----------

  sfxLevel() {
    return this.sfxVolume / 100;
  }

  musicLevel() {
    return MUSIC_VOLUME * (this.musicVolume / 100);
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
      this.musicGain.gain.setTargetAtTime(this.musicLevel(), now, 0.12);
    }
    this.persistVolumes();
    return this.musicVolume;
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
    const next = MUSIC_TRACKS[mood] ? mood : 'menu';
    this.musicWanted = true;
    // 环境音跟随场景，与音乐共用同一套 menu/battle/boss 氛围切换点。
    this.startAmbient(next);
    if (this.mood === next) {
      // 同一氛围重复请求（HUD 每帧刷新）不重排，等首次用户手势再启动。
      if (this.ctx && !this._musicTimer) this.maybeBeginMusic();
      return;
    }
    this.pauseMusicLoop();
    this._musicStep = 0;
    this.mood = next;
    const ctx = this.ensure();
    if (ctx) this.maybeBeginMusic();
  }

  stopMusic() {
    this.musicWanted = false;
    this.mood = null;
    this.pauseMusicLoop();
    this.stopAmbient();
  }

  // 浏览器要求首次用户手势后才能出声：上下文未 running 时只排队，不调度音符。
  maybeBeginMusic() {
    if (!this.musicEnabled || !this.musicWanted || !this.ctx || !this.masterGain || !this.musicGain) return;
    if (this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    this.musicGain.gain.cancelScheduledValues(now);
    this.musicGain.gain.setTargetAtTime(this.musicLevel(), now, 0.25);
    if (!this._musicTimer) this.scheduleMusicStep();
  }

  pauseMusicLoop() {
    if (this._musicTimer) {
      clearTimeout(this._musicTimer);
      this._musicTimer = null;
    }
    if (this.musicGain && this.ctx) {
      const now = this.ctx.currentTime;
      this.musicGain.gain.cancelScheduledValues(now);
      this.musicGain.gain.setTargetAtTime(0.0001, now, 0.08);
    }
  }

  scheduleMusicStep() {
    if (!this.musicWanted || !this.musicEnabled || !this.ctx || this.ctx.state !== 'running') {
      this._musicTimer = null;
      return;
    }
    const track = MUSIC_TRACKS[this.mood] || MUSIC_TRACKS.menu;
    const chord = track.chords[this._musicStep % track.chords.length];
    const when = this.ctx.currentTime + 0.06;
    const level = this.mood === 'menu' ? 0.06 : 0.045;
    for (const freq of chord) {
      this.musicTone(freq, track.chordDur * 0.95, track.type, level, when);
    }
    this.musicTone(chord[0] / 2, track.chordDur * 0.95, 'sine', level * 0.8, when);
    this._musicStep += 1;
    this._musicTimer = setTimeout(() => this.scheduleMusicStep(), track.chordDur * 1000);
  }

  musicTone(freq, duration, type, level, when) {
    const ctx = this.ctx;
    if (!ctx || !this.musicGain) return;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    env.gain.setValueAtTime(0.0001, when);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), when + 0.12);
    env.gain.exponentialRampToValueAtTime(0.0001, when + duration * 0.92);
    osc.connect(env).connect(this.musicGain);
    osc.start(when);
    osc.stop(when + duration);
  }

  // ---------- 环境音 ----------

  startAmbient(mood = 'menu') {
    const next = AMBIENT_TRACKS[mood] ? mood : 'menu';
    this.ambientWanted = true;
    if (this.ambientMood === next) {
      if (this.ctx && !this._ambientNodes) this.maybeBeginAmbient();
      return;
    }
    this.pauseAmbient();
    this.ambientMood = next;
    const ctx = this.ensure();
    if (ctx) this.maybeBeginAmbient();
  }

  stopAmbient() {
    this.ambientWanted = false;
    this.ambientMood = null;
    this.pauseAmbient();
  }

  maybeBeginAmbient() {
    if (!this.enabled || !this.ambientWanted || !this.ctx || !this.ambientGain) return;
    if (this.ctx.state !== 'running') return;
    if (!this._ambientNodes) this.buildAmbientNodes();
    const now = this.ctx.currentTime;
    this.ambientGain.gain.cancelScheduledValues(now);
    this.ambientGain.gain.setTargetAtTime(AMBIENT_VOLUME, now, 0.6);
  }

  // 两个低频振荡器 + 极慢的颤音，形成没有旋律的氛围底噪。
  buildAmbientNodes() {
    const track = AMBIENT_TRACKS[this.ambientMood] || AMBIENT_TRACKS.menu;
    const nodes = [];
    track.freqs.forEach((freq, index) => {
      const osc = this.ctx.createOscillator();
      osc.type = track.type;
      osc.frequency.value = freq;
      const trem = this.ctx.createGain();
      trem.gain.value = 0.5 / track.freqs.length;
      const lfo = this.ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.08 + index * 0.03;
      const lfoDepth = this.ctx.createGain();
      lfoDepth.gain.value = 0.25 / track.freqs.length;
      lfo.connect(lfoDepth).connect(trem.gain);
      osc.connect(trem).connect(this.ambientGain);
      osc.start();
      lfo.start();
      nodes.push(osc, lfo);
    });
    this._ambientNodes = nodes;
  }

  pauseAmbient() {
    this.stopAmbientNodes();
    if (this.ambientGain && this.ctx) {
      const now = this.ctx.currentTime;
      this.ambientGain.gain.cancelScheduledValues(now);
      this.ambientGain.gain.setTargetAtTime(0.0001, now, 0.2);
    }
  }

  stopAmbientNodes() {
    if (!this._ambientNodes) return;
    for (const node of this._ambientNodes) {
      try {
        node.stop();
        node.disconnect();
      } catch {
        /* 节点可能已停止 */
      }
    }
    this._ambientNodes = null;
  }

  // 页面切到后台时暂停音乐与环境音并挂起上下文，回到前台再续播。
  handleVisibility() {
    if (!this.ctx) return;
    if (document.hidden) {
      this.pauseMusicLoop();
      this.pauseAmbient();
      this.ctx.suspend().catch(() => {});
    } else {
      this.ctx.resume()
        .then(() => {
          this.maybeBeginMusic();
          this.maybeBeginAmbient();
        })
        .catch(() => {});
    }
  }

  play(name) {
    if (!this.enabled) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;

    switch (name) {
      case 'shoot_arrow':
        this.tone(940, 0.055, 'square', 0.028, -420, t);
        break;
      case 'shoot_cannon':
        this.tone(110, 0.16, 'sine', 0.06, -55, t);
        this.noise(0.13, 0.035, 700, t);
        break;
      case 'shoot_frost':
        this.tone(1500, 0.07, 'triangle', 0.022, 500, t);
        break;
      case 'shoot_arc':
        this.tone(520, 0.09, 'sawtooth', 0.022, -300, t);
        this.noise(0.08, 0.025, 2400, t);
        break;
      case 'shoot_poison':
        this.tone(330, 0.1, 'sine', 0.03, -120, t);
        break;
      case 'shoot_banner':
        this.tone(660, 0.12, 'triangle', 0.025, 180, t);
        break;
      case 'shoot_shock':
        this.tone(240, 0.11, 'square', 0.03, -80, t);
        this.noise(0.09, 0.02, 1200, t);
        break;
      case 'shoot_sniper':
        this.tone(180, 0.16, 'sawtooth', 0.03, -140, t);
        this.noise(0.12, 0.03, 2600, t);
        break;
      case 'kill':
        this.tone(300, 0.035, 'triangle', 0.012, 120, t);
        break;
      case 'place':
        this.tone(320, 0.09, 'triangle', 0.05, 90, t);
        this.tone(520, 0.11, 'triangle', 0.04, 120, t + 0.07);
        break;
      case 'upgrade':
        this.tone(520, 0.1, 'triangle', 0.04, 160, t);
        this.tone(760, 0.12, 'triangle', 0.04, 200, t + 0.08);
        break;
      case 'sell':
        this.tone(560, 0.1, 'sine', 0.04, -220, t);
        break;
      case 'hurt':
        this.tone(120, 0.22, 'sawtooth', 0.06, -50, t);
        this.noise(0.16, 0.03, 420, t);
        break;
      case 'wave':
        this.tone(340, 0.14, 'triangle', 0.04, 60, t);
        this.tone(460, 0.18, 'triangle', 0.035, 80, t + 0.12);
        break;
      case 'boss':
        this.tone(70, 0.6, 'sawtooth', 0.07, 20, t);
        this.tone(110, 0.5, 'square', 0.03, -30, t + 0.08);
        break;
      case 'bossKill':
        this.noise(0.5, 0.09, 500, t);
        this.tone(90, 0.5, 'sine', 0.06, -40, t);
        break;
      case 'victory':
        this.tone(523.25, 0.14, 'triangle', 0.05, 0, t);
        this.tone(659.25, 0.14, 'triangle', 0.05, 0, t + 0.12);
        this.tone(783.99, 0.16, 'triangle', 0.05, 0, t + 0.24);
        this.tone(1046.5, 0.4, 'triangle', 0.048, 0, t + 0.36);
        break;
      case 'bossCast':
        // 蓄力：低频上扬 + 逐渐收紧的噪声，提示即将出招。
        this.tone(56, 0.75, 'sawtooth', 0.05, 46, t);
        this.tone(84, 0.7, 'triangle', 0.03, 62, t + 0.05);
        this.noise(0.62, 0.028, 320, t + 0.08);
        break;
      case 'bossRoar':
        // 咆哮：双低音下滑叠加中频噪声，冲击感强。
        this.tone(72, 0.55, 'sawtooth', 0.085, -34, t);
        this.tone(43, 0.62, 'sine', 0.06, -12, t);
        this.tone(104, 0.42, 'square', 0.04, -44, t + 0.03);
        this.noise(0.45, 0.075, 900, t);
        break;
      case 'bossSummon':
        // 召唤：三连低音爬升 + 高频嘶声，像裂隙打开。
        this.tone(196, 0.45, 'triangle', 0.035, 70, t);
        this.tone(262, 0.42, 'triangle', 0.03, 96, t + 0.09);
        this.tone(349, 0.4, 'sine', 0.024, 120, t + 0.18);
        this.noise(0.36, 0.022, 1800, t + 0.04);
        break;
      case 'bossSlam':
        // 震击：极低频下坠 + 两段噪声冲击。
        this.tone(54, 0.5, 'sine', 0.1, -24, t);
        this.tone(96, 0.28, 'square', 0.045, -48, t);
        this.noise(0.28, 0.1, 380, t);
        this.noise(0.5, 0.05, 140, t + 0.05);
        break;
      case 'gameover':
        this.tone(300, 0.35, 'sine', 0.05, -120, t);
        this.tone(220, 0.4, 'sine', 0.05, -100, t + 0.25);
        this.tone(150, 0.6, 'sine', 0.05, -60, t + 0.5);
        break;
      case 'draft':
        this.tone(660, 0.12, 'triangle', 0.035, 120, t);
        this.tone(990, 0.16, 'triangle', 0.03, 140, t + 0.1);
        break;
      case 'skill_aurora':
        // 极光：高音冰晶上行 + 细碎高频噪声，清冷通透。
        this.tone(1320, 0.18, 'triangle', 0.03, 480, t);
        this.tone(1760, 0.26, 'sine', 0.024, 320, t + 0.06);
        this.noise(0.3, 0.02, 3200, t);
        break;
      case 'skill_meteor':
        // 陨石：低频下坠 + 两段冲击噪声，沉重。
        this.tone(190, 0.3, 'sawtooth', 0.06, -140, t);
        this.tone(92, 0.42, 'sine', 0.05, -40, t + 0.04);
        this.noise(0.34, 0.06, 800, t);
        this.noise(0.22, 0.04, 240, t + 0.12);
        break;
      case 'skill_chrono':
        // 时停：三连上行琶音后拉长泛音，制造时间凝滞感。
        this.tone(330, 0.12, 'triangle', 0.03, 0, t);
        this.tone(440, 0.12, 'triangle', 0.028, 0, t + 0.09);
        this.tone(660, 0.5, 'sine', 0.03, 60, t + 0.18);
        break;
      case 'click':
        this.tone(720, 0.04, 'square', 0.02, 0, t);
        break;
      default:
        break;
    }
  }

  tone(freq, duration, type, gain, slide = 0, when = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freq), when);
    if (slide) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), when + duration);
    }
    env.gain.setValueAtTime(0.0001, when);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), when + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    osc.connect(env).connect(this.sfxGain);
    osc.start(when);
    osc.stop(when + duration + 0.02);
  }

  noise(duration, gain, cutoff = 1200, when = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const frames = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, when);
    env.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    source.connect(filter).connect(env).connect(this.sfxGain);
    source.start(when);
    source.stop(when + duration + 0.02);
  }
}

export const audio = new AudioFX();
