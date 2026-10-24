// 氛围预设：群系 × 天气 → 色调 / 粒子 / 环境音 id。
// 纯数据与纯函数，不读浏览器状态、不读战斗模拟状态、不引入任何素材文件。

// 昼夜色调：全屏低透明度叠加，alpha 上限 0.08，路径与单位轮廓仍然最清晰。
// 渲染层的 DAY_PHASES 直接复用这份数据，保证预设与环境表现只有一处定义。
export const AMBIENCE_TINTS = Object.freeze({
  dawn: Object.freeze({ id: 'dawn', name: '黎明', color: '255, 190, 140', alpha: 0.05 }),
  day: Object.freeze({ id: 'day', name: '白昼', color: '255, 244, 210', alpha: 0.02 }),
  dusk: Object.freeze({ id: 'dusk', name: '黄昏', color: '255, 150, 110', alpha: 0.07 }),
  night: Object.freeze({ id: 'night', name: '夜晚', color: '70, 100, 170', alpha: 0.08 }),
});

// 与 render/background-renderer.js 的 BIOME_SCENES 键、天气 id 保持一致。
export const AMBIENCE_BIOME_IDS = Object.freeze([
  'canyon',
  'twin',
  'triple',
  'ring',
  'cross',
  'switchback',
]);
export const AMBIENCE_WEATHER_IDS = Object.freeze(['rain', 'fog', 'meteor']);
export const AMBIENCE_WEATHER_NONE = 'none';

export const DEFAULT_BIOME = 'canyon';
export const DEFAULT_WEATHER = AMBIENCE_WEATHER_NONE;

// 群系决定基础环境音音色；天气覆盖音色。音频层只从这里取 id/kind，
// 具体合成参数（基频、电平）仍归音频层所有。
export const AMBIENCE_KIND_BY_BIOME = Object.freeze({
  canyon: 'wind',
  twin: 'water',
  triple: 'drone',
  ring: 'drone',
  cross: 'wind',
  switchback: 'wind',
});
export const AMBIENCE_KIND_BY_WEATHER = Object.freeze({
  rain: 'water',
  fog: 'wind',
  meteor: 'drone',
});

// 天气粒子预算：与渲染层 WEATHER_TYPES 的上限/尺寸/漂移保持一致。
export const AMBIENCE_PARTICLE_BUDGETS = Object.freeze({
  rain: Object.freeze({ max: 64, size: 2.2, drift: 0.9 }),
  fog: Object.freeze({ max: 10, size: 3.2, drift: 0.3 }),
  meteor: Object.freeze({ max: 14, size: 2.6, drift: 0.6 }),
});

// 每个群系在各天气下的色调选择（纯数据表）。
const TINT_BY_BIOME_WEATHER = Object.freeze({
  canyon: Object.freeze({ none: 'day', rain: 'dawn', fog: 'dusk', meteor: 'night' }),
  twin: Object.freeze({ none: 'day', rain: 'dawn', fog: 'dawn', meteor: 'dusk' }),
  triple: Object.freeze({ none: 'dusk', rain: 'dawn', fog: 'dusk', meteor: 'night' }),
  ring: Object.freeze({ none: 'night', rain: 'dusk', fog: 'dawn', meteor: 'night' }),
  cross: Object.freeze({ none: 'dusk', rain: 'dawn', fog: 'dusk', meteor: 'night' }),
  switchback: Object.freeze({ none: 'dawn', rain: 'dawn', fog: 'day', meteor: 'night' }),
});

function buildPreset(biome, weather) {
  const tintId = TINT_BY_BIOME_WEATHER[biome][weather];
  const kind = weather === AMBIENCE_WEATHER_NONE
    ? AMBIENCE_KIND_BY_BIOME[biome]
    : AMBIENCE_KIND_BY_WEATHER[weather];
  const budget = weather === AMBIENCE_WEATHER_NONE ? null : AMBIENCE_PARTICLE_BUDGETS[weather];
  return Object.freeze({
    biome,
    weather: weather === AMBIENCE_WEATHER_NONE ? null : weather,
    tint: AMBIENCE_TINTS[tintId],
    particles: budget ? Object.freeze({ id: weather, ...budget }) : null,
    ambienceKind: kind,
    ambienceId: `${biome}:${kind}:${weather}`,
  });
}

// 六个群系 ×（无天气 + 三种天气）的完整预设表，全部冻结。
export const AMBIENCE_PRESETS = Object.freeze(
  Object.fromEntries(
    AMBIENCE_BIOME_IDS.map((biome) => [
      biome,
      Object.freeze(
        Object.fromEntries(
          [AMBIENCE_WEATHER_NONE, ...AMBIENCE_WEATHER_IDS].map((weather) => [
            weather,
            buildPreset(biome, weather),
          ])
        )
      ),
    ])
  )
);

export function normalizeAmbienceBiome(value) {
  return Object.prototype.hasOwnProperty.call(AMBIENCE_PRESETS, value) ? value : DEFAULT_BIOME;
}

export function normalizeAmbienceWeather(value) {
  if (value === null || value === undefined) return AMBIENCE_WEATHER_NONE;
  return AMBIENCE_WEATHER_IDS.includes(value) ? value : AMBIENCE_WEATHER_NONE;
}

// full/high 保留全部层；light/low 及未知档位只保留色调；off 同样只保留色调。
export function normalizeAmbienceQuality(value) {
  if (value === 'full' || value === 'high') return 'full';
  if (value === 'off') return 'off';
  return 'light';
}

// 未知群系 / 天气回退默认预设（canyon + 无天气），空输入不抛错。
export function ambiencePreset(biome, weather) {
  const b = normalizeAmbienceBiome(biome);
  const w = normalizeAmbienceWeather(weather);
  return AMBIENCE_PRESETS[b][w];
}

// 解析调用方真正要用的预设：低配/关闭档位把粒子清零，只保留色调；
// 环境音 id 仍完整解析，启停由音频层自己的开关决定。
export function resolveAmbience(biome, weather, quality = 'full') {
  const preset = ambiencePreset(biome, weather);
  const resolvedQuality = normalizeAmbienceQuality(quality);
  const withParticles = resolvedQuality === 'full';
  return Object.freeze({
    ...preset,
    quality: resolvedQuality,
    particles: withParticles ? preset.particles : null,
    particleCount: withParticles && preset.particles ? preset.particles.max : 0,
  });
}
