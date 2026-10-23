// 纯 WebAudio 合成音效与程序化背景音乐，不依赖任何音频文件。
import { loadSettings } from './settings.js';

// 音乐走独立增益节点，默认音量明显低于音效主增益（0.45）。
const MUSIC_VOLUME = 0.1;

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
    this.enabled = localStorage.getItem('abyss-tower.sound') !== 'off';
    this.musicEnabled = loadSettings().music !== false;
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.mood = null;
    this.musicWanted = false;
    this._musicTimer = null;
    this._musicStep = 0;
    this._onVisibility = () => this.handleVisibility();
    document.addEventListener('visibilitychange', this._onVisibility);
  }

  ensure() {
    if (!this.ctx) {
      // 音效和音乐都关闭时不必创建上下文。
      if (!this.enabled && !this.musicEnabled && !this.musicWanted) return null;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.45;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().then(() => this.maybeBeginMusic()).catch(() => {});
    } else {
      this.maybeBeginMusic();
    }
    return this.ctx;
  }

  setEnabled(value) {
    this.enabled = value;
    localStorage.setItem('abyss-tower.sound', value ? 'on' : 'off');
    if (value) this.ensure();
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
  }

  // 浏览器要求首次用户手势后才能出声：上下文未 running 时只排队，不调度音符。
  maybeBeginMusic() {
    if (!this.musicEnabled || !this.musicWanted || !this.ctx || !this.master) return;
    if (this.ctx.state !== 'running') return;
    if (!this.musicGain) {
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.0001;
      this.musicGain.connect(this.master);
    }
    const now = this.ctx.currentTime;
    this.musicGain.gain.cancelScheduledValues(now);
    this.musicGain.gain.setTargetAtTime(MUSIC_VOLUME, now, 0.25);
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

  // 页面切到后台时暂停音乐与音频上下文，回到前台再续播。
  handleVisibility() {
    if (!this.ctx) return;
    if (document.hidden) {
      this.pauseMusicLoop();
      this.ctx.suspend().catch(() => {});
    } else if (this.musicWanted && this.musicEnabled) {
      this.ctx.resume().then(() => this.maybeBeginMusic()).catch(() => {});
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
    osc.connect(env).connect(this.master);
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
    source.connect(filter).connect(env).connect(this.master);
    source.start(when);
    source.stop(when + duration + 0.02);
  }
}

export const audio = new AudioFX();
