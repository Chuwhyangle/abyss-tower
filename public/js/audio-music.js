// 程序化背景音乐：曲目表、首领变体与阶段强度层，全部由振荡器循环合成，不引入音频素材。
// 纯数据 + 纯函数；发声原语在 audio-synth.js，调度与状态在 audio.js 的门面里。

// 音乐走独立增益节点，100% 时仍明显低于音效主增益（0.45）。
export const MUSIC_VOLUME = 0.1;

// 三套程序化氛围：menu / battle / boss。每套提供两首变体，全部由振荡器循环合成。
// 会话开始时抽一个种子，同一会话内每个场景固定选同一首，换一局再重新抽。
export const MUSIC_VARIANTS = {
  menu: {
    variants: [
      {
        id: 'menu-a',
        type: 'triangle',
        chordDur: 2.4,
        chords: [
          [261.63, 329.63, 392.0],
          [220.0, 261.63, 329.63],
          [174.61, 220.0, 261.63],
          [196.0, 246.94, 293.66],
        ],
      },
      {
        id: 'menu-b',
        type: 'sine',
        chordDur: 2.8,
        chords: [
          [246.94, 293.66, 349.23],
          [220.0, 277.18, 329.63],
          [196.0, 246.94, 293.66],
          [174.61, 220.0, 261.63],
        ],
      },
    ],
  },
  battle: {
    variants: [
      {
        id: 'battle-a',
        type: 'square',
        chordDur: 1.2,
        chords: [
          [220.0, 261.63, 329.63],
          [174.61, 220.0, 261.63],
          [196.0, 246.94, 293.66],
          [164.81, 196.0, 246.94],
        ],
      },
      {
        id: 'battle-b',
        type: 'triangle',
        chordDur: 1.0,
        chords: [
          [246.94, 311.13, 369.99],
          [220.0, 277.18, 329.63],
          [196.0, 246.94, 293.66],
          [185.0, 233.08, 277.18],
        ],
      },
    ],
  },
  boss: {
    variants: [
      {
        id: 'boss-a',
        type: 'sawtooth',
        chordDur: 0.9,
        chords: [
          [110.0, 130.81, 164.81],
          [103.83, 123.47, 155.56],
          [98.0, 116.54, 146.83],
          [92.5, 110.0, 138.59],
        ],
      },
      {
        id: 'boss-b',
        type: 'square',
        chordDur: 0.8,
        chords: [
          [116.54, 138.59, 174.61],
          [110.0, 138.59, 164.81],
          [103.83, 123.47, 155.56],
          [98.0, 123.47, 146.83],
        ],
      },
    ],
  },
};

// 首领变体专属曲目：键与 shared/data/enemies.js 的 BOSS_VARIANT_ROTATION 一一对应。
// 三种变体各一首，全部由振荡器循环合成，不引入任何音频素材。
export const BOSS_MUSIC_TRACKS = {
  armored: {
    id: 'boss-armored',
    type: 'sawtooth',
    chordDur: 1.1,
    chords: [
      [73.42, 87.31, 110.0],
      [69.3, 82.41, 103.83],
      [65.41, 77.78, 98.0],
      [61.74, 73.42, 92.5],
    ],
  },
  summoner: {
    id: 'boss-summoner',
    type: 'triangle',
    chordDur: 0.9,
    chords: [
      [82.41, 98.0, 123.47],
      [77.78, 92.5, 116.54],
      [73.42, 87.31, 110.0],
      [69.3, 82.41, 103.83],
    ],
  },
  berserk: {
    id: 'boss-berserk',
    type: 'square',
    chordDur: 0.72,
    chords: [
      [87.31, 110.0, 130.81],
      [82.41, 103.83, 123.47],
      [77.78, 98.0, 116.54],
      [73.42, 92.5, 110.0],
    ],
  },
};

// 没有变体信息时回退到 boss 通用曲目（旧存档/旧模式）。
export function pickBossMusicTrack(variant) {
  return BOSS_MUSIC_TRACKS[variant] || null;
}

// 首领血量比例 → 音乐阶段；阈值与 sim.js 的 66% / 33% 阶段线保持一致。
export const BOSS_PHASE_THRESHOLDS = Object.freeze([0.66, 0.33]);

export function bossMusicPhase(hpRatio) {
  const ratio = Number.isFinite(hpRatio) ? Math.min(1, Math.max(0, hpRatio)) : 1;
  if (ratio <= BOSS_PHASE_THRESHOLDS[1]) return 3;
  if (ratio <= BOSS_PHASE_THRESHOLDS[0]) return 2;
  return 1;
}

// 阶段强度层：每升一阶段多一层鼓点，低音略抬；三层的合成电平始终低于音乐总线基准。
export const BOSS_INTENSITY_LAYERS = Object.freeze({
  1: { drums: 0, chord: 0.04, bass: 0.032, drum: 0 },
  2: { drums: 1, chord: 0.04, bass: 0.036, drum: 0.018 },
  3: { drums: 2, chord: 0.04, bass: 0.038, drum: 0.01 },
});

export function bossLayer(phase) {
  return BOSS_INTENSITY_LAYERS[phase] || BOSS_INTENSITY_LAYERS[1];
}

// 该阶段所有声部叠加后的名义电平，供「不超总线」约束与测试使用。
export function bossLayerGain(phase) {
  const layer = bossLayer(phase);
  return layer.chord + layer.bass + layer.drums * layer.drum;
}

// 曲目切换的交叉淡入淡出时长（秒）：新旧两路音乐总线交叠，避免切换爆音。
export const CROSSFADE_SECONDS = 1.2;

// 波次强度对音乐总线的轻微加成：开局为 1，高波次最多 +18%，音效总线不受影响。
export const WAVE_INTENSITY_MAX = 0.18;
export const WAVE_INTENSITY_WAVES = 20;

export function musicWaveIntensity(wave) {
  const step = Number.isFinite(wave) ? Math.max(0, wave) : 0;
  return 1 + Math.min(1, step / WAVE_INTENSITY_WAVES) * WAVE_INTENSITY_MAX;
}

// FNV-1a：把场景名和会话种子混成稳定的 32 位整数。
function hashVariant(scene, seed) {
  let hash = 0x811c9dc5;
  const text = `${scene}:${seed}`;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

// 确定性纯函数：同一场景 + 同一种子永远挑到同一首变体。
export function pickMusicVariant(scene, seed) {
  const entry = MUSIC_VARIANTS[scene];
  if (!entry || entry.variants.length === 0) return null;
  return entry.variants[hashVariant(scene, seed) % entry.variants.length];
}

// 会话种子：默认由随机数生成，测试可注入固定随机源。
export function sessionSeed(random = Math.random) {
  return (Math.floor(random() * 0x100000000) >>> 0);
}

