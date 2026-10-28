// 合成原语与压缩总线：振荡器/噪声/包络、命中音效的压缩限幅参数。
// 只接受显式的 ctx 与输出总线，不持有任何会话状态——状态与调度在 audio.js 的门面里。

// 混音总线：master ← sfx / music。各总线增益由 0–100 的音量设置换算。
export const MASTER_VOLUME = 0.45;

// 命中音效压缩/限幅参数：WebAudio 没有专用限幅器，用高压缩比 + 快速启动近似限幅。
export const IMPACT_COMPRESSOR = Object.freeze({
  threshold: -16,
  knee: 10,
  ratio: 12,
  attack: 0.003,
  release: 0.25,
});

// 压缩/限幅参数写入：真实 AudioParam 走 setValueAtTime，测试假参数退化为直接赋值。
export function writeCompressorParams(compressor) {
  if (!compressor) return;
  for (const key of ['threshold', 'knee', 'ratio', 'attack', 'release']) {
    const param = compressor[key];
    if (!param || typeof param !== 'object') continue;
    if (typeof param.setValueAtTime === 'function') param.setValueAtTime(IMPACT_COMPRESSOR[key], 0);
    else param.value = IMPACT_COMPRESSOR[key];
  }
}

// 一次振荡器发声：滑音用指数斜坡，包络 8ms 起振、尾部收敛到 0.0001。
// options.detune 是音分级变调（命中音效专用），输出总线由调用方决定（默认 sfx）。
export function playTone(ctx, bus, { freq, duration, type, gain, slide = 0, when = 0, detune = 0 }) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(20, freq), when);
  if (slide) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), when + duration);
  }
  if (detune && osc.detune?.setValueAtTime) osc.detune.setValueAtTime(detune, when);
  env.gain.setValueAtTime(0.0001, when);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), when + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  osc.connect(env).connect(bus);
  osc.start(when);
  osc.stop(when + duration + 0.02);
}

// 一段带线性衰减包络的噪声：低通（可换滤波类型）后按增益淡出。
// options.filterType 选择滤波类型（默认 lowpass），输出总线由调用方决定（默认 sfx）。
export function playNoise(ctx, bus, { duration, gain, cutoff = 1200, when = 0, filterType = 'lowpass' }) {
  if (!ctx) return;
  const frames = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = cutoff;
  const env = ctx.createGain();
  env.gain.setValueAtTime(gain, when);
  env.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  source.connect(filter).connect(env).connect(bus);
  source.start(when);
  source.stop(when + duration + 0.02);
}

// 音乐声部：12ms 淡入 + 92% 处收敛，走 music 总线。
export function playMusicTone(ctx, bus, freq, duration, type, level, when) {
  if (!ctx || !bus) return;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, when);
  env.gain.setValueAtTime(0.0001, when);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), when + 0.12);
  env.gain.exponentialRampToValueAtTime(0.0001, when + duration * 0.92);
  osc.connect(env).connect(bus);
  osc.start(when);
  osc.stop(when + duration);
}

// 阶段鼓点：低频快速下坠 + 短包络，和旋律一样走音乐总线，切换时不会越过总线电平。
export function playMusicDrum(ctx, bus, level, when) {
  if (!ctx || !bus) return;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(140, when);
  osc.frequency.exponentialRampToValueAtTime(45, when + 0.12);
  env.gain.setValueAtTime(0.0001, when);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), when + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, when + 0.18);
  osc.connect(env).connect(bus);
  osc.start(when);
  osc.stop(when + 0.2);
}

// 音效编曲表：sim 的 playSound 事件名 → 合成参数，全部由振荡器/噪声合成，不引入素材。
// fx 是发起这次发声的门面（提供 tone/noise 与 ensure 后的上下文），输出总线由门面决定。
export function playSfx(fx, name) {
  const t = fx.ctx.currentTime;

  switch (name) {
    case 'shoot_arrow':
      fx.tone(940, 0.055, 'square', 0.028, -420, t);
      break;
    case 'shoot_cannon':
      fx.tone(110, 0.16, 'sine', 0.06, -55, t);
      fx.noise(0.13, 0.035, 700, t);
      break;
    case 'shoot_frost':
      fx.tone(1500, 0.07, 'triangle', 0.022, 500, t);
      break;
    case 'shoot_arc':
      fx.tone(520, 0.09, 'sawtooth', 0.022, -300, t);
      fx.noise(0.08, 0.025, 2400, t);
      break;
    case 'shoot_poison':
      fx.tone(330, 0.1, 'sine', 0.03, -120, t);
      break;
    case 'shoot_banner':
      fx.tone(660, 0.12, 'triangle', 0.025, 180, t);
      break;
    case 'shoot_shock':
      fx.tone(240, 0.11, 'square', 0.03, -80, t);
      fx.noise(0.09, 0.02, 1200, t);
      break;
    case 'shoot_sniper':
      fx.tone(180, 0.16, 'sawtooth', 0.03, -140, t);
      fx.noise(0.12, 0.03, 2600, t);
      break;
    case 'kill':
      fx.tone(300, 0.035, 'triangle', 0.012, 120, t);
      break;
    case 'place':
      fx.tone(320, 0.09, 'triangle', 0.05, 90, t);
      fx.tone(520, 0.11, 'triangle', 0.04, 120, t + 0.07);
      break;
    case 'upgrade':
      fx.tone(520, 0.1, 'triangle', 0.04, 160, t);
      fx.tone(760, 0.12, 'triangle', 0.04, 200, t + 0.08);
      break;
    case 'sell':
      fx.tone(560, 0.1, 'sine', 0.04, -220, t);
      break;
    case 'destructible':
      // 拆除：低频碎裂 + 砂石噪声，收尾一声清亮奖励音；全部由振荡器/噪声合成。
      fx.tone(170, 0.2, 'square', 0.05, -95, t);
      fx.tone(88, 0.26, 'sine', 0.05, -30, t + 0.03);
      fx.noise(0.22, 0.05, 880, t);
      fx.tone(660, 0.12, 'triangle', 0.028, 220, t + 0.1);
      break;
    case 'hurt':
      fx.tone(120, 0.22, 'sawtooth', 0.06, -50, t);
      fx.noise(0.16, 0.03, 420, t);
      break;
    case 'wave':
      fx.tone(340, 0.14, 'triangle', 0.04, 60, t);
      fx.tone(460, 0.18, 'triangle', 0.035, 80, t + 0.12);
      break;
    case 'boss':
      fx.tone(70, 0.6, 'sawtooth', 0.07, 20, t);
      fx.tone(110, 0.5, 'square', 0.03, -30, t + 0.08);
      break;
    case 'bossKill':
      fx.noise(0.5, 0.09, 500, t);
      fx.tone(90, 0.5, 'sine', 0.06, -40, t);
      break;
    case 'victory':
      fx.tone(523.25, 0.14, 'triangle', 0.05, 0, t);
      fx.tone(659.25, 0.14, 'triangle', 0.05, 0, t + 0.12);
      fx.tone(783.99, 0.16, 'triangle', 0.05, 0, t + 0.24);
      fx.tone(1046.5, 0.4, 'triangle', 0.048, 0, t + 0.36);
      break;
    case 'bossCast':
      // 蓄力：低频上扬 + 逐渐收紧的噪声，提示即将出招。
      fx.tone(56, 0.75, 'sawtooth', 0.05, 46, t);
      fx.tone(84, 0.7, 'triangle', 0.03, 62, t + 0.05);
      fx.noise(0.62, 0.028, 320, t + 0.08);
      break;
    case 'bossRoar':
      // 咆哮：双低音下滑叠加中频噪声，冲击感强。
      fx.tone(72, 0.55, 'sawtooth', 0.085, -34, t);
      fx.tone(43, 0.62, 'sine', 0.06, -12, t);
      fx.tone(104, 0.42, 'square', 0.04, -44, t + 0.03);
      fx.noise(0.45, 0.075, 900, t);
      break;
    case 'bossSummon':
      // 召唤：三连低音爬升 + 高频嘶声，像裂隙打开。
      fx.tone(196, 0.45, 'triangle', 0.035, 70, t);
      fx.tone(262, 0.42, 'triangle', 0.03, 96, t + 0.09);
      fx.tone(349, 0.4, 'sine', 0.024, 120, t + 0.18);
      fx.noise(0.36, 0.022, 1800, t + 0.04);
      break;
    case 'bossSlam':
      // 震击：极低频下坠 + 两段噪声冲击。
      fx.tone(54, 0.5, 'sine', 0.1, -24, t);
      fx.tone(96, 0.28, 'square', 0.045, -48, t);
      fx.noise(0.28, 0.1, 380, t);
      fx.noise(0.5, 0.05, 140, t + 0.05);
      break;
    case 'gameover':
      fx.tone(300, 0.35, 'sine', 0.05, -120, t);
      fx.tone(220, 0.4, 'sine', 0.05, -100, t + 0.25);
      fx.tone(150, 0.6, 'sine', 0.05, -60, t + 0.5);
      break;
    case 'resultVictory':
      // 结算页胜利：上行大调号角 + 高频泛音，让情绪落在结算展示的瞬间。
      fx.tone(523.25, 0.16, 'triangle', 0.05, 0, t);
      fx.tone(659.25, 0.16, 'triangle', 0.05, 0, t + 0.1);
      fx.tone(783.99, 0.2, 'triangle', 0.048, 0, t + 0.2);
      fx.tone(1046.5, 0.5, 'sine', 0.04, 0, t + 0.3);
      fx.tone(1567.98, 0.36, 'triangle', 0.016, 0, t + 0.34);
      fx.noise(0.28, 0.016, 4200, t + 0.3);
      break;
    case 'resultDefeat':
      // 结算页失败：下行小调短句 + 低音尾坠，收束克制、不刺耳。
      fx.tone(392, 0.22, 'triangle', 0.045, 0, t);
      fx.tone(311.13, 0.24, 'triangle', 0.045, 0, t + 0.16);
      fx.tone(233.08, 0.5, 'sine', 0.05, -40, t + 0.34);
      fx.tone(116.54, 0.6, 'sine', 0.04, -20, t + 0.4);
      fx.noise(0.24, 0.018, 700, t + 0.2);
      break;
    case 'draft':
      fx.tone(660, 0.12, 'triangle', 0.035, 120, t);
      fx.tone(990, 0.16, 'triangle', 0.03, 140, t + 0.1);
      break;
    case 'skill_aurora':
      // 极光：高音冰晶上行 + 细碎高频噪声，清冷通透。
      fx.tone(1320, 0.18, 'triangle', 0.03, 480, t);
      fx.tone(1760, 0.26, 'sine', 0.024, 320, t + 0.06);
      fx.noise(0.3, 0.02, 3200, t);
      break;
    case 'skill_meteor':
      // 陨石：低频下坠 + 两段冲击噪声，沉重。
      fx.tone(190, 0.3, 'sawtooth', 0.06, -140, t);
      fx.tone(92, 0.42, 'sine', 0.05, -40, t + 0.04);
      fx.noise(0.34, 0.06, 800, t);
      fx.noise(0.22, 0.04, 240, t + 0.12);
      break;
    case 'skill_chrono':
      // 时停：三连上行琶音后拉长泛音，制造时间凝滞感。
      fx.tone(330, 0.12, 'triangle', 0.03, 0, t);
      fx.tone(440, 0.12, 'triangle', 0.028, 0, t + 0.09);
      fx.tone(660, 0.5, 'sine', 0.03, 60, t + 0.18);
      break;
    case 'click':
      fx.tone(720, 0.04, 'square', 0.02, 0, t);
      break;
    default:
      break;
  }
}
