// 音乐多曲目变体、确定性选择与交叉淡入淡出。
// 纯函数直接从 audio.js 导入（Node 下没有 AudioContext 也能安全加载），总线行为做源码级检查。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  MUSIC_VARIANTS,
  CROSSFADE_SECONDS,
  WAVE_INTENSITY_MAX,
  musicWaveIntensity,
  pickMusicVariant,
  sessionSeed,
  audio,
} from '../public/js/audio.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readSource = (relative) => readFileSync(join(root, relative), 'utf8');
const SCENES = ['menu', 'battle', 'boss'];

test('每个场景至少两首程序化变体，且不依赖音频素材', () => {
  for (const scene of SCENES) {
    const entry = MUSIC_VARIANTS[scene];
    assert.ok(entry, `缺少 ${scene} 场景`);
    assert.ok(entry.variants.length >= 2, `${scene} 至少需要 2 首变体`);

    const ids = new Set();
    for (const variant of entry.variants) {
      assert.equal(typeof variant.id, 'string');
      ids.add(variant.id);
      assert.equal(typeof variant.type, 'string', `${variant.id} 缺少振荡器类型`);
      assert.ok(variant.chordDur > 0 && variant.chordDur < 8, `${variant.id} 和弦时长异常`);
      assert.ok(variant.chords.length >= 2, `${variant.id} 和弦进行过短`);
      for (const chord of variant.chords) {
        assert.ok(chord.length >= 2, `${variant.id} 和弦至少两个音`);
        for (const freq of chord) {
          assert.ok(Number.isFinite(freq) && freq >= 20 && freq <= 4000, `${variant.id} 频率越界`);
        }
      }
    }
    assert.equal(ids.size, entry.variants.length, `${scene} 变体 id 不能重复`);
  }

  const src = readSource('public/js/audio.js');
  assert.doesNotMatch(src, /\.(mp3|ogg|wav|m4a)\b/, '不应引入音频素材');
  assert.doesNotMatch(src, /decodeAudioData|new Audio\(/, '音乐应全部由 WebAudio 合成');
});

test('变体选择是确定性纯函数', () => {
  for (const scene of SCENES) {
    const first = pickMusicVariant(scene, 12345);
    assert.ok(first, `${scene} 应能选中变体`);
    for (let i = 0; i < 5; i += 1) {
      assert.equal(pickMusicVariant(scene, 12345).id, first.id, `${scene} 选择应稳定`);
    }
  }
  assert.equal(pickMusicVariant('unknown', 1), null, '未知场景应返回 null');

  // 不同会话种子应覆盖同一场景的全部变体，保证跨局轮换。
  for (const scene of SCENES) {
    const seen = new Set();
    for (let seed = 0; seed < 64; seed += 1) seen.add(pickMusicVariant(scene, seed).id);
    assert.equal(seen.size, MUSIC_VARIANTS[scene].variants.length, `${scene} 变体未被轮换覆盖`);
  }
});

test('会话种子可注入且落在 32 位无符号范围', () => {
  assert.equal(sessionSeed(() => 0), 0);
  assert.equal(sessionSeed(() => 0.5), 0x80000000);
  const seed = sessionSeed();
  assert.ok(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff, '种子应为 32 位整数');
});

test('波次强度只轻微抬高音乐电平', () => {
  assert.equal(musicWaveIntensity(0), 1);
  assert.equal(musicWaveIntensity(10), 1 + WAVE_INTENSITY_MAX / 2);
  assert.equal(musicWaveIntensity(20), 1 + WAVE_INTENSITY_MAX);
  assert.equal(musicWaveIntensity(999), 1 + WAVE_INTENSITY_MAX, '强度应有上限');
  assert.equal(musicWaveIntensity(-5), 1, '负波次按 0 处理');
  assert.equal(musicWaveIntensity('nope'), 1, '非法值回退基准');
  assert.ok(musicWaveIntensity(5) > musicWaveIntensity(1), '波次越高越紧张');
  assert.ok(musicWaveIntensity(20) < 1.25, '强度变化必须轻微');
});

test('切歌使用 1.2s 交叉淡入淡出', () => {
  assert.ok(
    CROSSFADE_SECONDS >= 0.8 && CROSSFADE_SECONDS <= 2,
    `交叉淡化时长应在 0.8–2s，当前 ${CROSSFADE_SECONDS}`
  );

  const src = readSource('public/js/audio.js');
  const body = src.match(/crossfadeMusicBus\(\)\s*\{[\s\S]*?\n  \}/)?.[0] || '';
  assert.ok(body, '缺少 crossfadeMusicBus 实现');
  assert.match(body, /CROSSFADE_SECONDS/, '交叉淡化未使用统一时长');
  assert.match(body, /outgoing\.gain\.setTargetAtTime\(0\.0001/, '旧音轨未淡出');
  assert.match(body, /incoming\.gain\.setTargetAtTime/, '新音轨未淡入');

  // 两路音乐总线都接在 master 上，切换时才有交叠。
  assert.match(src, /this\._spareMusicGain\s*=\s*this\.ctx\.createGain\(\)/, '缺少备用音乐总线');
  assert.match(src, /this\._spareMusicGain\.connect\(this\.masterGain\)/, '备用音乐总线未接到 master');
});

test('场景切换走变体选择与交叉淡化，波次强度已接线', () => {
  const src = readSource('public/js/audio.js');
  assert.match(src, /pickMusicVariant\(this\.mood, this\.seed\)/, '调度未按变体选择');
  assert.match(src, /crossfadeMusicBus\(\)/, '场景切换未交叉淡化');
  assert.match(src, /setMusicIntensity\(wave\)/, '缺少波次强度入口');

  const app = readSource('public/js/game-app.js');
  assert.match(app, /audio\.setMusicIntensity\(/, '波次强度未接到音频层');
});

test('波次强度只作用于音乐总线，不改音效', () => {
  const src = readSource('public/js/audio.js');
  const body = src.match(/setMusicIntensity\(wave\)\s*\{[\s\S]*?\n  \}/)?.[0] || '';
  assert.ok(body, '缺少 setMusicIntensity 实现');
  assert.match(body, /musicTargetLevel\(\)/, '未按目标电平缩放音乐');
  assert.doesNotMatch(body, /sfxGain|setSfxVolume/, '波次强度不得改音效总线');
});

test('音乐与音效开关仍各自独立', () => {
  const soundBefore = audio.enabled;
  const musicBefore = audio.musicEnabled;

  audio.setMusicEnabled(false);
  assert.equal(audio.musicEnabled, false);
  assert.equal(audio.enabled, soundBefore, '关闭音乐不应静音音效');

  audio.setMusicEnabled(musicBefore);
  audio.setEnabled(false);
  assert.equal(audio.enabled, false);
  assert.equal(audio.musicEnabled, musicBefore, '关闭音效不应关闭音乐');

  audio.setEnabled(soundBefore);

  const src = readSource('public/js/audio.js');
  const body = src.match(/setMusicEnabled\(value\)\s*\{[\s\S]*?\n  \}/)?.[0] || '';
  assert.ok(body, '缺少 setMusicEnabled 实现');
  assert.doesNotMatch(body, /this\.enabled\s*=/, '音乐开关不得改写音效开关');
});

test('页面隐藏时暂停，回到前台续播', () => {
  const src = readSource('public/js/audio.js');
  assert.match(src, /visibilitychange/, '缺少页面可见性监听');
  assert.match(src, /document\.hidden/, '缺少后台判断');
  assert.match(src, /pauseMusicLoop\(\)/, '后台未暂停音乐');
  assert.match(src, /\.suspend\(\)/, '后台未挂起上下文');
  assert.match(src, /maybeBeginMusic\(\)/, '恢复时未续播音乐');
});
