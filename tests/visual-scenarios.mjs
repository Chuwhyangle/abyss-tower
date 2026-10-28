// 打击感证据场景：场景目录 + 纯计划 + 浏览器端确定性注入运行时。
//
// 设计边界（gap-feel-capture-scenarios）：
//   - 这里只产出「按需、可按时间断言地取到帧」的能力，不评判画面，也不改 public/js/**。
//   - 计划（SCENARIO_SPECS / scenarioPlan）是纯数据，可用不启动浏览器的单测覆盖；
//     浏览器部分只有 ScenarioRunner 一层的 evaluate 调用。
//   - 注入不调用 Math.random：场景开始时把 Math.random 换成同 seed 的确定性序列，
//     场景内的随机消费（毒雾粒子等）因此逐次重播；事件触发只用 sim.damage / leak /
//     completeWave 这类确定性入口，不走 computeHit（不消耗 combatRng）。
//   - 每一帧都记录 requestedTime 与 snapshot.time：两者不一致时由 checkFrameTimes 判红，
//     采集器不落盘任何「看似可用」的帧。

// 场景时钟：固定 60Hz 步长，与 tests/visual-scenes.mjs 的 __visual.step 一致。
export const SIM_DT = 1 / 60;
export const FRAME_TIME_TOLERANCE = 0.005;

// 八种防御塔（TOWERS 的全部键）。战旗塔不参与攻击（support），它的组用「光环 + 被增益的
// 弩塔开火」证明存在，manifest 里以 support: true 标注，不伪造弹道。
export const WEAPON_TYPES = Object.freeze([
  'arrow',
  'cannon',
  'frost',
  'arc',
  'poison',
  'shock',
  'sniper',
  'banner',
]);

export const EVENT_SCENARIOS = Object.freeze([
  'crit',
  'kill',
  'boss',
  'shield',
  'leak',
  'waveclear',
  'bossdeath',
]);

export const FLOATER_SCENARIOS = Object.freeze({
  'floaters-all': 'all',
  'floaters-key': 'key',
  'floaters-off': 'off',
});

export const REDUCED_MOTION_SCENARIOS = Object.freeze({
  'reduced-motion-on': true,
  'reduced-motion-off': false,
});

export const QUALITY_SCENARIOS = Object.freeze({
  'quality-auto': 'auto',
  'quality-low': 'low',
  'quality-high': 'high',
});

// 全部场景 id（顺序即 CLI 的 all 展开顺序：武器 → 事件 → 飘字 → reduced-motion → 画质）。
export const SCENARIOS = Object.freeze([
  'weapons',
  ...EVENT_SCENARIOS,
  ...Object.keys(FLOATER_SCENARIOS),
  ...Object.keys(REDUCED_MOTION_SCENARIOS),
  ...Object.keys(QUALITY_SCENARIOS),
]);

// 事件帧的固定节奏：事件前 1s → 事件后 0 / 250 / 500ms。
export const EVENT_SETUP_TICKS = 60;
export const EVENT_AFTER_TICKS = 15;

// 武器组每 0.5s 一帧，覆盖从首发射击到各自节奏的第二轮（含最慢的狙击塔 0.46/s）。
export const WEAPON_FRAME_TICKS = Object.freeze([30, 30, 30, 30, 30, 30]);

export const ticksFor = (seconds) => Math.round(seconds / SIM_DT);

// 一帧的计划：steps 依次执行，sim/visual 推进时钟，带 type 的是注入动作。
// duration = 这一帧自己推进的模拟秒数；requestedTime 由 planGroupFrames 在组内累加，
// 因为「这一帧的模拟时间」是相对组起点的累计值，单帧自己算不出来。
export function planFrame({ id, role = 'frame', event = null, offsetMs = null, steps = [] }) {
  let simSeconds = 0;
  let visualMs = 0;
  for (const step of steps) {
    if (Number.isFinite(step?.sim)) simSeconds += step.sim * SIM_DT;
    else if (Number.isFinite(step?.visual)) visualMs += step.visual;
    else if (!step?.type) throw new Error(`帧 ${id} 的步骤非法：${JSON.stringify(step)}`);
  }
  return Object.freeze({
    id,
    role,
    event,
    offsetMs,
    steps: Object.freeze(steps.map((step) => Object.freeze({ ...step }))),
    duration: Number(simSeconds.toFixed(4)),
    visualMs,
  });
}

// 组内累加：requestedTime = 该帧采集时刻「应当」所在的模拟时间。
// 视觉时钟推进不改变模拟时间，所以漏怪/清波这类演出停表时 requestedTime 保持不变。
export function planGroupFrames(frames) {
  let elapsed = 0;
  return frames.map((frame) => {
    elapsed += frame.duration;
    return Object.freeze({ ...frame, requestedTime: Number(elapsed.toFixed(4)) });
  });
}

const spawn = (enemy, progress, extra = {}) => Object.freeze({ type: 'spawn', enemy, progress, ...extra });
const tower = (name, level = 2) => Object.freeze({ type: 'tower', tower: name, level });
const damage = (target, amount, extra = {}) => Object.freeze({ type: 'damage', target, amount, ...extra });

// 事件场景：三只静止的敌人在镜头里提供上下文，目标固定为中间那只。
const EVENT_SPECS = Object.freeze({
  crit: Object.freeze({
    setup: Object.freeze([spawn('tank', 2.6, { hpMul: 4 }), spawn('tank', 3.0, { hpMul: 4 }), spawn('tank', 3.4, { hpMul: 4 })]),
    action: damage(1, 30, { crit: true, weapon: 'arrow' }),
    event: 'crit',
    description: '暴击命中：金色暴击飘字 + ! 后缀 + 受击闪白',
  }),
  kill: Object.freeze({
    setup: Object.freeze([spawn('tank', 2.6, { hp: 40 }), spawn('tank', 3.2, { hpMul: 4 })]),
    action: damage(0, 80, { weapon: 'cannon' }),
    event: 'kill',
    description: '击杀：死亡迸发 + 击杀飘字 + 金币结算',
  }),
  boss: Object.freeze({
    setup: Object.freeze([spawn('boss', 3.0, { hpMul: 1 }), spawn('tank', 2.4, { hpMul: 4 })]),
    action: damage(0, 80, { weapon: 'sniper' }),
    event: 'bossHit',
    description: '首领命中：首领血条 + 粉紫 bossHit 飘字/爆裂层',
  }),
  shield: Object.freeze({
    setup: Object.freeze([spawn('shielder', 3.0, { hpMul: 1 }), spawn('tank', 2.4, { hpMul: 4 })]),
    action: damage(0, 80, { weapon: 'arc' }),
    event: 'shieldBreak',
    description: '破盾：护盾吸收后仍有扣血 → 破盾飘字 + 六边环',
  }),
  leak: Object.freeze({
    setup: Object.freeze([spawn('grunt', 6.0, { hpMul: 1 }), spawn('tank', 3.0, { hpMul: 4 })]),
    action: Object.freeze({ type: 'leak', target: 0 }),
    event: 'leak',
    description: '漏怪：红边框 + 基地同心环 + 横幅（模拟时钟继续走）',
  }),
  waveclear: Object.freeze({
    setup: Object.freeze([spawn('tank', 3.0, { hpMul: 4 }), Object.freeze({ type: 'wave' })]),
    action: Object.freeze({ type: 'complete-wave' }),
    event: 'waveClear',
    description: '清波：金色横扫 + 居中横幅（清波后模拟时钟停在 prep，改用视觉时钟）',
    afterClock: 'visual',
  }),
  bossdeath: Object.freeze({
    setup: Object.freeze([spawn('boss', 3.0, { hp: 60, maxHp: 60 }), spawn('tank', 2.4, { hpMul: 4 })]),
    action: damage(0, 80, { weapon: 'sniper' }),
    event: 'bossKill',
    description: '首领死亡：白闪 + 多层扩散环 + 首领名横幅',
  }),
});

function eventFrames(scenario, spec) {
  const frames = [
    planFrame({ id: 'before', role: 'before', event: spec.event, steps: [{ sim: EVENT_SETUP_TICKS }] }),
    planFrame({ id: 't0', role: 'after', event: spec.event, offsetMs: 0, steps: [spec.action] }),
  ];
  if (spec.afterClock === 'visual') {
    // 清波后 sim.phase 离开 wave，模拟时间不再前进：用视觉时钟推进演出，requestedTime 保持不变。
    frames.push(planFrame({ id: 't250', role: 'after', event: spec.event, offsetMs: 250, steps: [{ visual: 250 }] }));
    frames.push(planFrame({ id: 't500', role: 'after', event: spec.event, offsetMs: 500, steps: [{ visual: 250 }] }));
  } else {
    frames.push(planFrame({ id: 't250', role: 'after', event: spec.event, offsetMs: 250, steps: [{ sim: EVENT_AFTER_TICKS }] }));
    frames.push(planFrame({ id: 't500', role: 'after', event: spec.event, offsetMs: 500, steps: [{ sim: EVENT_AFTER_TICKS }] }));
  }
  return frames;
}

// 武器组：同 seed 下单独建一座塔、四只静止的重甲敌人，按 0.5s 步长取 6 帧。
function weaponGroup(type) {
  const setup = [spawn('tank', 2.4, { hpMul: 3 }), spawn('tank', 2.8, { hpMul: 3 }), spawn('tank', 3.2, { hpMul: 3 }), spawn('tank', 3.6, { hpMul: 3 })];
  if (type === 'banner') {
    // 战旗塔不攻击：同格放一座弩塔，帧里同时能看到光环与「被增益后开火」的弹道。
    setup.push(tower('banner', 2), tower('arrow', 2));
  } else {
    setup.push(tower(type, 2));
  }
  const frames = WEAPON_FRAME_TICKS.map((ticks, index) =>
    planFrame({
      id: `f${index + 1}`,
      role: 'evidence',
      steps: [{ sim: ticks }],
    })
  );
  return Object.freeze({
    key: `weapons-${type}`,
    towerType: type,
    support: type === 'banner',
    setup: Object.freeze(setup),
    frames: Object.freeze(frames),
  });
}

// 三档飘字：同一组伤害事件（暴击 + 两次普通命中）在固定时刻取一帧。
function floaterSpec(id, tier) {
  return Object.freeze({
    kind: 'floaters',
    viewports: Object.freeze(['desktop']),
    quality: null,
    floaters: tier,
    description: `飘字档位 ${tier}：同 seed 同 t（t=1.25s）的一帧`,
    groups: Object.freeze([
      Object.freeze({
        key: id,
        setup: Object.freeze([
          Object.freeze({ type: 'floaters', value: tier }),
          spawn('tank', 2.6, { hpMul: 3 }),
          spawn('tank', 3.0, { hpMul: 3 }),
          spawn('tank', 3.4, { hpMul: 3 }),
        ]),
        frames: Object.freeze([
          planFrame({
            id: 't1250',
            role: 'evidence',
            steps: [
              { sim: EVENT_SETUP_TICKS },
              damage(0, 40, { crit: true, weapon: 'arrow' }),
              damage(1, 25, { weapon: 'cannon' }),
              damage(2, 18, { weapon: 'frost' }),
              { sim: EVENT_AFTER_TICKS },
            ],
          }),
        ]),
      }),
    ]),
  });
}

function reducedMotionSpec(id, reduced) {
  return Object.freeze({
    kind: 'reduced-motion',
    viewports: Object.freeze(['desktop']),
    quality: null,
    reducedMotion: reduced,
    description: `reduced-motion ${reduced ? '开' : '关'}：同一次漏怪演出在 +250ms 的一帧`,
    groups: Object.freeze([
      Object.freeze({
        key: id,
        setup: Object.freeze([
          Object.freeze({ type: 'reduced-motion', value: reduced }),
          spawn('grunt', 3.0, { hpMul: 1 }),
          spawn('tank', 2.4, { hpMul: 4 }),
        ]),
        frames: Object.freeze([
          planFrame({
            id: 't250',
            role: 'evidence',
            event: 'leak',
            offsetMs: 250,
            steps: [{ sim: EVENT_SETUP_TICKS }, Object.freeze({ type: 'leak', target: 0 }), { visual: 250 }],
          }),
        ]),
      }),
    ]),
  });
}

function qualitySpec(id, quality) {
  return Object.freeze({
    kind: 'quality',
    viewports: Object.freeze(['desktop']),
    quality,
    description: `画质 ${quality}：同 seed 同 t（t=1.5s）的一帧，manifest 记录实际解析档`,
    groups: Object.freeze([
      Object.freeze({
        key: id,
        setup: Object.freeze([
          Object.freeze({ type: 'quality', value: quality }),
          spawn('tank', 2.4, { hpMul: 3 }),
          spawn('tank', 2.8, { hpMul: 3 }),
          spawn('tank', 3.2, { hpMul: 3 }),
          tower('arrow', 2),
        ]),
        frames: Object.freeze([
          planFrame({ id: 't1500', role: 'evidence', steps: [{ sim: ticksFor(1.5) }] }),
        ]),
      }),
    ]),
  });
}

const SPECS = Object.freeze({
  weapons: Object.freeze({
    kind: 'weapons',
    viewports: Object.freeze(['desktop']),
    quality: null,
    description: '八种防御塔各自开火：每塔一组 6 帧（t=0.5…3.0s），同 seed 同步骤',
    groups: Object.freeze(WEAPON_TYPES.map((type) => weaponGroup(type))),
  }),
  ...Object.fromEntries(EVENT_SCENARIOS.map((scenario) => [
    scenario,
    Object.freeze({
      kind: 'event',
      viewports: Object.freeze(['desktop']),
      quality: null,
      description: EVENT_SPECS[scenario].description,
      groups: Object.freeze([
        Object.freeze({
          key: scenario,
          event: EVENT_SPECS[scenario].event,
          setup: EVENT_SPECS[scenario].setup,
          frames: Object.freeze(eventFrames(scenario, EVENT_SPECS[scenario])),
        }),
      ]),
    }),
  ])),
  ...Object.fromEntries(Object.entries(FLOATER_SCENARIOS).map(([id, tier]) => [id, floaterSpec(id, tier)])),
  ...Object.fromEntries(Object.entries(REDUCED_MOTION_SCENARIOS).map(([id, reduced]) => [id, reducedMotionSpec(id, reduced)])),
  ...Object.fromEntries(Object.entries(QUALITY_SCENARIOS).map(([id, quality]) => [id, qualitySpec(id, quality)])),
});

// 计划出口：把每组的帧做一次组内累加（requestedTime），结果冻结并缓存。
const MATERIALIZED = new Map();
function materialize(id, spec) {
  return Object.freeze({
    ...spec,
    groups: Object.freeze(spec.groups.map((group) => Object.freeze({
      ...group,
      frames: Object.freeze(planGroupFrames(group.frames)),
    }))),
  });
}

export function scenarioPlan(id) {
  const spec = SPECS[id];
  if (!spec) throw new Error(`未知场景：${id}（可选 ${SCENARIOS.join(' / ')}）`);
  if (!MATERIALIZED.has(id)) MATERIALIZED.set(id, materialize(id, spec));
  return MATERIALIZED.get(id);
}

// 计划自检：采集器在启动浏览器之前先跑一遍，计划本身不成立就不该产生任何帧。
export function validateScenarioPlans() {
  const errors = [];
  const specs = Object.fromEntries(SCENARIOS.map((id) => [id, scenarioPlan(id)]));
  const ids = Object.keys(specs);
  if (ids.length !== SCENARIOS.length) errors.push(`场景数量不一致：${ids.length} vs ${SCENARIOS.length}`);
  for (const id of SCENARIOS) if (!specs[id]) errors.push(`场景目录缺计划：${id}`);
  for (const [id, spec] of Object.entries(specs)) {
    if (!spec.groups?.length) {
      errors.push(`${id}：没有帧组`);
      continue;
    }
    const groupKeys = new Set();
    for (const group of spec.groups) {
      if (!group.key) errors.push(`${id}：帧组缺少 key`);
      if (groupKeys.has(group.key)) errors.push(`${id}：帧组 key 重复 ${group.key}`);
      groupKeys.add(group.key);
      if (!group.frames?.length) errors.push(`${id}/${group.key}：没有帧`);
      const frameIds = new Set();
      let last = -1;
      for (const frame of group.frames) {
        if (frameIds.has(frame.id)) errors.push(`${id}/${group.key}：帧 id 重复 ${frame.id}`);
        frameIds.add(frame.id);
        if (!Number.isFinite(frame.requestedTime) || frame.requestedTime < 0) {
          errors.push(`${id}/${group.key}/${frame.id}：requestedTime 非法`);
        }
        if (frame.requestedTime < last) errors.push(`${id}/${group.key}/${frame.id}：requestedTime 倒退`);
        last = frame.requestedTime;
        for (const step of frame.steps) {
          const known = Number.isFinite(step.sim) || Number.isFinite(step.visual) || typeof step.type === 'string';
          if (!known) errors.push(`${id}/${group.key}/${frame.id}：未知步骤 ${JSON.stringify(step)}`);
        }
      }
    }
    if (spec.kind === 'weapons') {
      const types = spec.groups.map((group) => group.towerType);
      if (types.length !== WEAPON_TYPES.length) errors.push(`${id}：必须覆盖 ${WEAPON_TYPES.length} 种塔`);
      if (new Set(types).size !== types.length) errors.push(`${id}：towerType 有重复`);
      for (const type of WEAPON_TYPES) if (!types.includes(type)) errors.push(`${id}：缺少塔 ${type}`);
      for (const group of spec.groups) {
        if (!group.setup?.some((step) => step.type === 'tower' && step.tower === group.towerType)) {
          errors.push(`${id}/${group.key}：setup 没有放置 ${group.towerType}`);
        }
      }
    }
    if (spec.kind === 'event') {
      const frames = spec.groups[0].frames;
      if (frames.length < 2) errors.push(`${id}：事件场景至少要有前后两帧`);
      if (!frames.some((frame) => frame.role === 'before')) errors.push(`${id}：缺少事件前帧`);
      if (!frames.some((frame) => frame.role === 'after')) errors.push(`${id}：缺少事件后帧`);
      if (!frames.some((frame) => frame.steps.some((step) => typeof step.type === 'string'))) {
        errors.push(`${id}：没有任何注入动作`);
      }
    }
    if (['floaters', 'reduced-motion', 'quality'].includes(spec.kind)) {
      const total = spec.groups.reduce((sum, group) => sum + group.frames.length, 0);
      if (total !== 1) errors.push(`${id}：必须恰好一帧（实际 ${total}）`);
    }
  }
  return { ok: errors.length === 0, errors };
}

// ── 时间断言 ────────────────────────────────────────────────────────────────

export function frameKey(result, frame) {
  const scope = result.scenario || result.scene;
  const towerType = result.towerType || frame.towerType;
  const group = towerType ? `:${towerType}` : '';
  return `${scope}@${result.viewport}${group}#${frame.id}`;
}

export function checkFrameTimes(frames, { tolerance = FRAME_TIME_TOLERANCE } = {}) {
  const drifts = [];
  for (const frame of frames) {
    const requested = frame.requestedTime;
    if (!Number.isFinite(requested)) continue;
    const actual = frame.snapshot?.time;
    if (!Number.isFinite(actual)) {
      drifts.push({ key: frame.key, requestedTime: requested, actualTime: null, reason: '缺少 snapshot.time' });
      continue;
    }
    if (Math.abs(actual - requested) > tolerance) {
      drifts.push({ key: frame.key, requestedTime: requested, actualTime: actual, reason: '时间漂移' });
    }
  }
  return { ok: drifts.length === 0, drifts };
}

export class TimeDriftError extends Error {
  constructor(drifts) {
    const lines = drifts.map((drift) => {
      const actual = Number.isFinite(drift.actualTime) ? `t=${drift.actualTime}s` : '（缺失）';
      return `${drift.key}：请求 t=${drift.requestedTime}s，实际 ${actual}${drift.reason ? `（${drift.reason}）` : ''}`;
    });
    super(`帧时间漂移，不产出可对照的帧：\n  - ${lines.join('\n  - ')}`);
    this.name = 'TimeDriftError';
    this.drifts = drifts;
  }
}

// ── manifest 条目 ───────────────────────────────────────────────────────────

// 帧组证据：把「这一组到底拍到了什么」压成可读字段，供评审与测试直接读取。
function groupEvidence(result, group) {
  const frames = result.frames.filter((frame) => frame.group === group.key);
  // 帧只在固定时刻采样，短特效（muzzle 0.1s / spark 0.15s）会被漏掉；
  // 逐步累计的 trace 才是「这一组确实开过火、命中过什么」的机械证据。
  const trace = group.trace || {};
  const effectKinds = new Set(trace.effectKinds || []);
  const effectSignatures = new Set(trace.effectSignatures || []);
  let maxProjectiles = trace.maxProjectiles || 0;
  let maxEffects = trace.maxEffects || 0;
  let maxFloaters = trace.maxFloaters || 0;
  for (const frame of frames) {
    for (const kind of frame.snapshot?.effectKinds || []) effectKinds.add(kind);
    for (const signature of frame.snapshot?.effectSignatures || []) effectSignatures.add(signature);
    maxProjectiles = Math.max(maxProjectiles, frame.snapshot?.projectiles || 0);
    maxEffects = Math.max(maxEffects, frame.snapshot?.effects || 0);
    maxFloaters = Math.max(maxFloaters, frame.snapshot?.floaters || 0);
  }
  const towerType = group.towerType ?? null;
  // 特效带 weapon 归属：`spark:arrow` 这类签名能直接证明「该武器打过这一击」。
  const weaponSignatures = towerType
    ? [...effectSignatures].filter((signature) => signature.endsWith(`:${towerType}`)).sort()
    : [];
  const firingKinds = [...effectKinds].filter((kind) => kind !== 'place' && kind !== 'spawn');
  const culminations = new Set();
  for (const frame of frames) {
    for (const kind of frame.snapshot?.culminations || []) culminations.add(kind);
  }
  return {
    key: group.key,
    towerType,
    support: group.support === true,
    event: group.event ?? null,
    frameIds: frames.map((frame) => frame.id),
    fired: maxProjectiles > 0 || weaponSignatures.length > 0 || firingKinds.length > 0,
    weaponSignatures,
    maxProjectiles,
    maxEffects,
    maxFloaters,
    effectKinds: [...effectKinds].sort(),
    effectSignatures: [...effectSignatures].sort(),
    culminations: [...culminations].sort(),
  };
}

// 一帧的 manifest 记录：requestedTime / snapshot.time 并列，漂移可直接从文件看出来。
// 指纹函数由调用方传入（Node 侧用 scripts/lib/visual-metrics.mjs 的实现），
// 这一层因此不依赖 PNG 指标模块，纯结构可在单测里断言。
export function frameManifestEntry(frame, file, { pixelHash, lumaSignature } = {}) {
  return {
    id: frame.id,
    group: frame.group ?? null,
    towerType: frame.towerType ?? null,
    role: frame.role ?? null,
    event: frame.event ?? null,
    offsetMs: frame.offsetMs ?? null,
    requestedTime: frame.requestedTime,
    timeDriven: frame.timeDriven ?? 'sim',
    visualMs: frame.visualMs ?? 0,
    file,
    width: frame.image.width,
    height: frame.image.height,
    pixelHash: typeof pixelHash === 'function' ? pixelHash(frame.image) : null,
    lumaSignature: typeof lumaSignature === 'function' ? lumaSignature(frame.image) : null,
    snapshot: frame.snapshot ?? null,
  };
}

export function buildScenarioManifestEntry(result, { commit, seed, fingerprints = () => ({}) } = {}) {
  return {
    scenario: result.scenario,
    scene: result.scene ?? 'combat',
    seed,
    commit,
    viewport: result.viewport,
    quality: result.quality,
    qualityActual: result.qualityActual ?? null,
    floaters: result.floaters ?? null,
    reducedMotion: result.reducedMotion ?? null,
    description: result.description ?? '',
    notes: result.notes ?? '',
    elapsedMs: result.elapsedMs,
    groups: (result.groups || []).map((group) => groupEvidence(result, group)),
    frames: (result.frames || []).map((frame, index) => frameManifestEntry(frame, result.files?.[index] ?? null, fingerprints(frame))),
  };
}

// ── 浏览器端运行时 ──────────────────────────────────────────────────────────
// 一个 IIFE：装好 window.__visualScenario。注入动作只用确定性入口，
// 场景开始时用 seed 重播 Math.random，保证同 seed 两次采集的帧指纹一致。
export function buildScenarioRuntimeSource(seed) {
  return `(async () => {
  const state = window.__rtd && window.__rtd.state;
  const sim = state && state.sim;
  const app = state && state.app;
  if (!sim || !app) throw new Error('场景运行时需要已加载的模拟与 GameApp');
  const [dataMod, rngMod, settingsMod, gameAppMod] = await Promise.all([
    import('/js/shared/data.js'),
    import('/js/shared/rng.js'),
    import('/js/settings.js'),
    import('/js/game-app.js'),
  ]);
  const TOWERS = dataMod.TOWERS;
  const RNG = rngMod.RNG;
  const SEED = ${JSON.stringify(String(seed))};
  const DT = 1 / 60;
  const WAVE_INDEX = 9;
  const spawned = [];
  const canvasEl = () => app.canvas || document.querySelector('#game-canvas');
  // 帧间轨迹：特效 ttl 只有 0.1–0.25s，0.5s 采样会漏掉命中瞬间。
  // 这里逐步累计「出现过什么」（含特效的 weapon 归属），作为帧之外的机械证据。
  let trace = null;
  const freshTrace = () => ({
    effectKinds: new Set(),
    effectSignatures: new Set(),
    maxProjectiles: 0,
    maxEffects: 0,
    maxFloaters: 0,
  });
  const sampleTrace = () => {
    if (!trace) return;
    for (const effect of sim.effects) {
      trace.effectKinds.add(effect.kind);
      trace.effectSignatures.add(effect.weapon ? effect.kind + ':' + effect.weapon : effect.kind);
    }
    trace.maxProjectiles = Math.max(trace.maxProjectiles, sim.projectiles.length);
    trace.maxEffects = Math.max(trace.maxEffects, sim.effects.length);
    trace.maxFloaters = Math.max(trace.maxFloaters, sim.floaters.length);
  };

  // 与 buildInitScript 同一个生成器：字符串哈希播种，场景内随机消费从固定起点重播。
  const hashText = (text) => {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0 || 1;
  };
  const seededRandom = (key) => {
    let words = hashText(key);
    return function deterministicRandom() {
      words = (words + 0x6D2B79F5) >>> 0;
      let t = Math.imul(words ^ (words >>> 15), 1 | words);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  const snapshot = () => {
    const rect = canvasEl().getBoundingClientRect();
    const settings = app.settings || {};
    const alive = sim.enemies.filter((enemy) => !enemy.dead);
    return {
      time: Number(sim.time.toFixed(4)),
      phase: sim.phase,
      wave: sim.wave,
      towers: sim.towers.length,
      towerTypes: [...new Set(sim.towers.map((item) => item.type))].sort(),
      enemies: alive.length,
      enemyTypes: [...new Set(alive.map((enemy) => enemy.type))].sort(),
      projectiles: sim.projectiles.length,
      effects: sim.effects.length,
      floaters: sim.floaters.length,
      skillFx: sim.skillFx.length,
      effectKinds: [...new Set(sim.effects.map((effect) => effect.kind))].sort(),
      effectSignatures: [...new Set(sim.effects.map((effect) => (effect.weapon ? effect.kind + ':' + effect.weapon : effect.kind)))].sort(),
      floaterTexts: sim.floaters.map((floater) => floater.text),
      floatersMode: sim.floatersMode,
      culminations: sim.culminations.map((entry) => entry.kind),
      impactEvents: sim.impactEvents.length,
      reducedMotion: app.reducedMotion === true,
      quality: {
        mode: settings.qualityMode || 'manual',
        actual: settingsMod.detectPreset(settings),
        fps: settings.fps,
        dpr: settings.dpr,
        decorations: settings.decorations,
        floaters: settings.floaters,
        glow: settings.glow,
        shake: settings.shake,
      },
      canvas: { left: rect.left + scrollX, top: rect.top + scrollY, width: rect.width, height: rect.height },
      dpr: app.renderer.dpr,
    };
  };

  const reset = (key) => {
    app.destroy();
    app.paused = false;
    app.speed = 1;
    app.renderer.time = 0;
    app.renderer.lastBaseHp = null;
    app.renderer.hurtFlash = 0;
    sim.opts.onSave = () => {};
    sim.opts.onSound = () => {};
    sim.opts.onToast = () => {};
    sim.opts.onGameOver = () => {};
    sim.time = 0;
    sim.waveTime = 0;
    sim.phase = 'wave';
    sim.paused = false;
    sim.wave = WAVE_INDEX;
    sim.clearedWave = WAVE_INDEX - 1;
    sim.waveDef = null;
    sim.spawnQueue.length = 0;
    sim.spawnIndex = 0;
    sim.enemies.length = 0;
    sim.projectiles.length = 0;
    sim.effects.length = 0;
    sim.floaters.length = 0;
    sim.skillFx.length = 0;
    sim.skillPending.length = 0;
    sim.towers.length = 0;
    sim.pendingSplits.length = 0;
    sim.allies.length = 0;
    sim.shake = 0;
    sim.gold = 99999;
    sim.kills = 0;
    sim.baseHp = sim.maxBaseHp;
    sim.skill = null;
    sim.skillCastCount = 0;
    sim.culminations.length = 0;
    sim.culminationSeq = 0;
    sim.impactEvents.length = 0;
    sim.stasis = null;
    sim.towerOverdrive = null;
    sim.unlockedTowers = Object.keys(TOWERS);
    if (sim.map.destructibles) sim.map.destructibles.forEach((entry) => { entry.destroyed = false; });
    sim.combatRng = new RNG(sim.seed + ':combat:0');
    // 场景内的随机消费（毒雾粒子等）不继承页面此前的消费历史。
    Math.random = seededRandom(SEED + ':' + key);
    app.impactFeedback = new gameAppMod.ImpactFeedbackConsumer(sim);
    spawned.length = 0;
    trace = freshTrace();
    return snapshot();
  };

  // 塔位：离路径 progress=3 最近的空地；已占用的格子 canBuild 会拒绝，因此连续调用自然错开。
  const pickCell = () => {
    const anchor = sim.posAt(3, 0);
    let best = null;
    for (let r = 0; r < sim.map.rows; r++) {
      for (let c = 0; c < sim.map.cols; c++) {
        if (!sim.canBuild(c, r)) continue;
        const d = (anchor.x - (c + 0.5)) ** 2 + (anchor.y - (r + 0.5)) ** 2;
        if (!best || d < best.d) best = { c, r, d };
      }
    }
    if (!best) throw new Error('没有可建造的空地');
    return best;
  };

  const placeTower = (type, level) => {
    if (!TOWERS[type]) throw new Error('未知塔：' + type);
    const cell = pickCell();
    if (!sim.placeTower(type, cell.c, cell.r)) throw new Error('建塔失败：' + type);
    const tower = sim.towers[sim.towers.length - 1];
    for (let i = 0; i < (level || 0); i++) sim.upgradeTower(tower);
    sim.recomputeTowerStats();
    return { type: tower.type, c: cell.c, r: cell.r, level: tower.level };
  };

  const spawn = (spec) => {
    const before = sim.enemies.length;
    sim.spawnEnemy(spec.enemy, spec.lane || 0, spec.hpMul == null ? 1 : spec.hpMul, spec.progress);
    if (sim.enemies.length === before) throw new Error('生成敌人失败：' + spec.enemy);
    const enemy = sim.enemies[sim.enemies.length - 1];
    // 显式血量：地图/可破坏物会给 hpMul 带来浮动，击杀类事件不能依赖某个固定数值刚好致死。
    if (Number.isFinite(spec.maxHp)) enemy.maxHp = spec.maxHp;
    if (Number.isFinite(spec.hp)) enemy.hp = spec.hp;
    if (spec.freeze !== false) enemy.baseSpeed = 0;
    spawned.push(enemy);
    return { id: enemy.id, type: enemy.type, progress: Number(enemy.progress.toFixed(3)) };
  };

  const target = (index) => {
    const enemy = spawned[index == null ? 0 : index];
    if (!enemy) throw new Error('目标不存在：' + index);
    return enemy;
  };

  const ACTIONS = {
    spawn,
    tower: (spec) => placeTower(spec.tower, spec.level),
    damage: (spec) => sim.damage(target(spec.target), spec.amount, {
      crit: spec.crit === true,
      weapon: spec.weapon || null,
      source: 'tower',
    }),
    leak: (spec) => sim.leak(target(spec.target)),
    wave: () => {
      // 清波需要非空 waveDef：只提供结算所需字段，不生成敌人。
      sim.waveDef = { index: sim.wave, reward: 40, hpMul: 1, groups: [], totalCount: 0, boss: false };
      sim.phase = 'wave';
      return true;
    },
    'complete-wave': () => sim.completeWave(),
    quality: (spec) => {
      const next = spec.value === 'auto'
        ? settingsMod.applyAutoQuality({ ...settingsMod.DEFAULT_SETTINGS, qualityMode: 'auto' }, window)
        : { ...settingsMod.presetSettings(spec.value), qualityMode: 'manual' };
      state.settings = next;
      app.applySettings(next);
      return { requested: spec.value, actual: settingsMod.detectPreset(next) };
    },
    floaters: (spec) => {
      app.applySettings({ ...app.settings, floaters: spec.value, qualityMode: 'manual' });
      return sim.floatersMode;
    },
    'reduced-motion': (spec) => {
      app.reducedMotion = spec.value === true;
      app.feedback.setSettings(app.settings, { reducedMotion: app.reducedMotion });
      app.renderer.setReducedMotion(app.reducedMotion);
      return app.reducedMotion;
    },
  };

  const apply = (actions) => {
    const results = [];
    for (const action of actions || []) {
      const handler = ACTIONS[action.type];
      if (!handler) throw new Error('未知注入动作：' + action.type);
      results.push(handler(action));
    }
    return results;
  };

  // 模拟时钟：一步 = sim.update + 视觉衰减 + 演出层推进 + 命中事件消费（不消耗 RNG）。
  const stepSim = (ticks) => {
    for (let i = 0; i < ticks; i++) {
      sim.update(DT);
      sim.updateVisuals(DT);
      app.renderer.culmination.update(sim, DT);
      app.impactFeedback.consume(sim.impactEvents);
      sampleTrace();
    }
  };
  // 视觉时钟：模拟时间停住时（清波后的 prep）只推进表现层。
  const stepVisual = (ms) => {
    const seconds = ms / 1000;
    sim.updateVisuals(seconds);
    app.renderer.culmination.update(sim, seconds);
    app.impactFeedback.consume(sim.impactEvents);
    sampleTrace();
  };

  // 等两帧再截图：HUD 文本是 DOM，emitHud 后立刻截图可能拍到抗锯齿尚未稳定的中间态。
  const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  const play = async (steps) => {
    for (const step of steps || []) {
      if (step.type) {
        const handler = ACTIONS[step.type];
        if (!handler) throw new Error('未知注入动作：' + step.type);
        handler(step);
      } else if (Number.isFinite(step.sim)) {
        stepSim(step.sim);
      } else if (Number.isFinite(step.visual)) {
        stepVisual(step.visual);
      } else {
        throw new Error('未知步骤：' + JSON.stringify(step));
      }
    }
    // 本帧注入的命中事件要在截图前变成类别飘字/特效（与 GameApp.tick 的消费顺序一致）。
    app.impactFeedback.consume(sim.impactEvents);
    sampleTrace();
    app.renderer.render(0);
    app.emitHud(true);
    await settle();
    return snapshot();
  };

  window.__visualScenario = {
    reset,
    apply,
    play,
    snapshot,
    placeTower,
    spawn,
    damage: (index, amount, opts) => sim.damage(target(index), amount, opts || {}),
    trace: () => ({
      effectKinds: [...trace.effectKinds].sort(),
      effectSignatures: [...trace.effectSignatures].sort(),
      maxProjectiles: trace.maxProjectiles,
      maxEffects: trace.maxEffects,
      maxFloaters: trace.maxFloaters,
    }),
    describe: () => {
      const info = snapshot();
      return { ...info, scenarioSeed: SEED, towers: sim.towers.map((item) => ({ type: item.type, x: item.x, y: item.y })) };
    },
  };
  return true;
})()`;
}

// ── Node 侧驱动 ─────────────────────────────────────────────────────────────
// 只做三件事：安装运行时、按计划注入、取帧。画面判断、manifest 落盘都在调用方（visual-scenes）。
export class ScenarioRunner {
  constructor(session, { seed }) {
    this.session = session;
    this.seed = seed;
    this.installed = false;
  }

  get browser() {
    return this.session.browser;
  }

  async install() {
    await this.browser.evaluate(buildScenarioRuntimeSource(this.seed));
    await this.browser.waitFor('!!window.__visualScenario', '场景运行时');
    this.installed = true;
    return this;
  }

  async reset(key) {
    if (!this.installed) await this.install();
    return this.browser.evaluate(`window.__visualScenario.reset(${JSON.stringify(String(key))})`);
  }

  async apply(actions = []) {
    if (!actions.length) return [];
    return this.browser.evaluate(`window.__visualScenario.apply(${JSON.stringify(actions)})`);
  }

  // 执行一帧的全部步骤（含注入动作），返回采集时刻的页面快照。
  async play(steps = []) {
    return this.browser.evaluate(`window.__visualScenario.play(${JSON.stringify(steps)})`);
  }

  // 本组的逐步累计证据（特效/弹道/飘字在整个窗口里的最大值与签名）。
  async trace() {
    return this.browser.evaluate('window.__visualScenario.trace()');
  }
}

// 一帧的时钟归属：只有视觉推进时标记 visual，否则按模拟时钟断言。
function frameClock(frame) {
  const hasVisual = frame.steps.some((step) => Number.isFinite(step.visual));
  const hasSim = frame.steps.some((step) => Number.isFinite(step.sim) && step.sim > 0);
  return hasVisual && !hasSim ? 'visual' : 'sim';
}

// 一个场景 = 若干帧组；每组先 reset（同 seed 同起点），再按计划取帧。
export async function captureScenario(session, id, { seed, quality = 'high', log = () => {} } = {}) {
  const started = Date.now();
  const spec = scenarioPlan(id);
  const runner = await new ScenarioRunner(session, { seed }).install();
  // 场景之间不共享表现设置：每个场景的起点都是「基准画质 + 未降级 + reduced-motion 关」。
  const baseActions = [
    { type: 'reduced-motion', value: false },
    { type: 'quality', value: quality },
  ];
  const frames = [];
  const groups = [];
  let lastSnapshot = null;
  for (const group of spec.groups) {
    log(`[visual]   ${id} / ${group.key}`);
    await runner.reset(`${id}:${group.key}`);
    await runner.apply(baseActions);
    await runner.apply(group.setup || []);
    for (const frame of group.frames) {
      const snapshot = await runner.play(frame.steps);
      const image = await session.screenshot();
      lastSnapshot = snapshot;
      frames.push({
        id: frame.id,
        group: group.key,
        towerType: group.towerType ?? null,
        role: frame.role,
        event: frame.event ?? group.event ?? null,
        offsetMs: frame.offsetMs,
        requestedTime: frame.requestedTime,
        timeDriven: frameClock(frame),
        visualMs: frame.visualMs,
        image,
        snapshot,
      });
    }
    groups.push({
      key: group.key,
      towerType: group.towerType ?? null,
      support: group.support === true,
      event: group.event ?? null,
      trace: await runner.trace(),
    });
  }
  const qualityInfo = lastSnapshot?.quality || {};
  return {
    scenario: id,
    scene: 'combat',
    viewport: session.viewport.id,
    quality: spec.quality ?? quality,
    qualityActual: qualityInfo.actual ?? null,
    floaters: spec.floaters ?? lastSnapshot?.floatersMode ?? null,
    reducedMotion: spec.reducedMotion ?? lastSnapshot?.reducedMotion ?? false,
    description: spec.description || '',
    notes: `场景 ${id}：${groups.length} 组 / ${frames.length} 帧`,
    groups,
    frames,
    elapsedMs: Date.now() - started,
  };
}
