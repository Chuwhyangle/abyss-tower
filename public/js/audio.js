// 纯 WebAudio 合成音效，不依赖任何音频文件。
class AudioFX {
  constructor() {
    this.enabled = localStorage.getItem('abyss-tower.sound') !== 'off';
    this.ctx = null;
    this.master = null;
  }

  ensure() {
    if (!this.enabled && this.ctx) return this.ctx;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.45;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  setEnabled(value) {
    this.enabled = value;
    localStorage.setItem('abyss-tower.sound', value ? 'on' : 'off');
    if (value) this.ensure();
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
      case 'victory':
        this.tone(523.25, 0.14, 'triangle', 0.05, 0, t);
        this.tone(659.25, 0.14, 'triangle', 0.05, 0, t + 0.12);
        this.tone(783.99, 0.16, 'triangle', 0.05, 0, t + 0.24);
        this.tone(1046.5, 0.4, 'triangle', 0.048, 0, t + 0.36);
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
