// 打击感证据场景：浏览器端确定性注入运行时 + 取帧驱动 + manifest 条目。
//
// 设计边界（gap-feel-capture-scenarios）：
//   - 这里只产出「按需、可按时间断言地取到帧」的能力，不评判画面，也不改 public/js/**。
//   - 场景计划（SCENARIO_SPECS / scenarioPlan）是从 `tests/lib/visual/plan.mjs` 复用的纯数据，
//     浏览器部分只有 ScenarioRunner 一层的 evaluate 调用。
//   - 注入不调用 Math.random：场景开始时把 Math.random 换成同 seed 的确定性序列，
//     场景内的随机消费（毒雾粒子等）因此逐次重播；事件触发只用 sim.damage / leak /
//     completeWave 这类确定性入口，不走 computeHit（不消耗 combatRng）。
import { scenarioPlan } from './lib/visual/plan.mjs';

// 计划与时间断言的对外导出保持不变：入口文件只做编排，符号仍从这里可取得。
export {
  EVENT_AFTER_TICKS,
  EVENT_SCENARIOS,
  EVENT_SETUP_TICKS,
  FLOATER_SCENARIOS,
  FRAME_TIME_TOLERANCE,
  QUALITY_SCENARIOS,
  REDUCED_MOTION_SCENARIOS,
  SIM_DT,
  SCENARIOS,
  TimeDriftError,
  WEAPON_FRAME_TICKS,
  WEAPON_TYPES,
  checkFrameTimes,
  frameKey,
  planFrame,
  planGroupFrames,
  scenarioPlan,
  ticksFor,
  validateScenarioPlans,
} from './lib/visual/plan.mjs';

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
