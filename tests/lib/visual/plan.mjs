// 场景计划（纯数据 + 纯函数）：场景目录、帧计划、计划自检与时间断言。
//
// 设计边界（gap-feel-capture-scenarios）：
//   - 计划是纯数据：不启动浏览器、不 import public/js/**，可在单测里完整覆盖。
//   - 浏览器的注入运行时与取帧驱动在 tests/visual-scenarios.mjs（ScenarioRunner / captureScenario）。
//   - `requestedTime` 由 `planGroupFrames` 在组内累加；每一帧都记录 requestedTime 与 snapshot.time，
//     两者不一致时由 `checkFrameTimes` 判红，采集器不落盘任何「看似可用」的帧。

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
