// 命中音效层（AC-014）真机/无头驱动：
//   node tests/impact-audio-drive.mjs            → 固定 seed 真实对局：2 波 8 塔、8/8 签名发声、同 seed 挂/不挂对比
//   node tests/impact-audio-drive.mjs --browser  → 无头浏览器：建塔开波 ≥30s、120ms 节点预算、压缩总线、无启动错误
// 用法（浏览器模式需中文 locale）：LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node tests/impact-audio-drive.mjs --browser
import {
  startTestServer,
  launchBrowser,
  chooseFirstMap,
  registerAndLogin,
  TEST_SEED_SCRIPT,
} from './harness.mjs';
import { Simulation } from '../public/js/sim.js';
import { generateMap } from '../public/js/shared/mapgen.js';
import { generateWave } from '../public/js/shared/waves.js';
import { RELIC_BY_ID, TOWERS } from '../public/js/shared/data.js';
import {
  IMPACT_LIMITS,
  IMPACT_SIGNATURES,
  ImpactMixer,
  supportAuraPulse,
} from '../public/js/audio-impacts.js';

const SEED = 'gap-audio-impacts-dod';
const STEP = 1 / 60;
const FRAME_MS = 1000 / 60;
// 固定建造顺序（八塔各一座）：聚成一簇时按此顺序分配格子（离路径最近 → 最远），
// 让七座攻击塔的首次开火错开优先级（否则同帧齐射会把最低伤害的武器挤出预算）。
const TYPES = ['arrow', 'cannon', 'frost', 'arc', 'poison', 'banner', 'shock', 'sniper'];

function check(condition, message) {
  if (!condition) throw new Error(message);
}

// ---------- 固定 seed 真实对局 ----------

function traceCombatRng(sim) {
  const sequence = [];
  const wrap = () => {
    const rng = sim.combatRng;
    if (!rng || rng.__traced) return;
    const original = rng.float;
    rng.float = function tracedFloat() {
      const value = original.call(this);
      sequence.push(value);
      return value;
    };
    rng.__traced = true;
  };
  wrap();
  const beginWave = sim.beginWave.bind(sim);
  sim.beginWave = (waveDef) => {
    const started = beginWave(waveDef);
    wrap();
    return started;
  };
  return sequence;
}

function makeSim() {
  const map = generateMap(SEED);
  return new Simulation({
    map,
    seed: SEED,
    difficulty: 'standard',
    gold: 100000,
    baseHp: 500,
    maxBaseHp: 500,
    towers: [],
    // 暴击遗物让 combatRng 真的被消费，RNG 序列对比才有意义。
    relics: [{ id: 'crit', level: 1, ...RELIC_BY_ID.crit }],
    unlockedTowers: Object.keys(TOWERS),
    onToast: () => {},
  });
}

function placeTowers(sim) {
  const map = sim.map;
  const buildable = [];
  for (let r = 0; r < map.rows; r += 1) {
    for (let c = 0; c < map.cols; c += 1) {
      if (sim.canBuild(c, r)) buildable.push({ c, r });
    }
  }
  // 找覆盖窗口最宽的路径点：把 8 塔聚成一簇，保证每座塔都能对同一批敌人开火。
  let anchor = map.pathCells[0];
  let best = -1;
  for (const cell of map.pathCells) {
    const near = buildable.filter((b) => Math.hypot(b.c - cell.c, b.r - cell.r) <= 3).length;
    if (near > best) {
      best = near;
      anchor = cell;
    }
  }
  const picked = buildable
    .map((b) => ({ ...b, d: Math.hypot(b.c - anchor.c, b.r - anchor.r) }))
    .filter((b) => b.d <= 3)
    .sort((a, b) => a.d - b.d)
    .slice(0, TYPES.length);
  for (let i = 0; i < picked.length; i += 1) sim.placeTower(TYPES[i], picked[i].c, picked[i].r);
  return sim.towers.map((tower) => tower.type);
}

function runMatch({ withAudio }) {
  const sim = makeSim();
  const placed = placeTowers(sim);
  const rng = traceCombatRng(sim);
  const seen = new WeakSet();
  const events = [];
  const auraEvents = [];
  const frames = [];
  const auraState = { lastAt: -Infinity };
  const mixer = withAudio
    ? new ImpactMixer({ voice: (signature, plan) => frames.push({ at: plan.at, weapon: plan.weapon }) })
    : null;

  let frame = 0;
  for (let wave = 1; wave <= 2; wave += 1) {
    const def = generateWave(SEED, wave, 'standard', sim.map.meta || {}, { endless: false });
    if (!sim.beginWave(def)) throw new Error(`第 ${wave} 波无法开始（phase=${sim.phase}）`);
    let steps = 0;
    while (sim.phase === 'wave' && steps < 60 * 180) {
      sim.update(STEP);
      steps += 1;
      frame += 1;
      for (const event of sim.impactEvents) {
        if (seen.has(event)) continue;
        seen.add(event);
        events.push(event);
      }
      if (withAudio) {
        // 按 60fps 的 nowMs 序列回放：本帧把环形缓冲当前内容 + 光环脉冲喂给同一个混音器。
        mixer.handle(sim.impactEvents, frame * FRAME_MS);
        const aura = supportAuraPulse(sim, frame * FRAME_MS, auraState);
        if (aura) {
          auraEvents.push(aura);
          mixer.handleEvent(aura, frame * FRAME_MS);
        }
      }
    }
    if (sim.phase === 'over') break;
  }

  return {
    placed,
    rng,
    events,
    auraEvents,
    frames,
    snapshot: JSON.stringify({
      wave: sim.wave,
      gold: Math.round(sim.gold * 100) / 100,
      kills: sim.kills ?? null,
      baseHp: sim.baseHp,
      enemies: sim.enemies.length,
      towers: sim.towers.length,
      time: Math.round(sim.time * 1000) / 1000,
    }),
  };
}

function runNodeDrive() {
  const withAudio = runMatch({ withAudio: true });
  const withoutAudio = runMatch({ withAudio: false });

  const signatureCounts = {};
  for (const frame of withAudio.frames) {
    signatureCounts[frame.weapon] = (signatureCounts[frame.weapon] || 0) + 1;
  }
  let maxWindow = 0;
  for (const frame of withAudio.frames) {
    const count = withAudio.frames.filter(
      (other) => other.at >= frame.at && other.at - frame.at < IMPACT_LIMITS.windowMs
    ).length;
    if (count > maxWindow) maxWindow = count;
  }
  const weaponCoverage = [...new Set(withAudio.events.map((event) => event.weapon))].sort();
  const missingVoices = Object.keys(IMPACT_SIGNATURES).filter((weapon) => !signatureCounts[weapon]);
  const sameSnapshot = withAudio.snapshot === withoutAudio.snapshot;
  const sameRng =
    withAudio.rng.length === withoutAudio.rng.length &&
    withAudio.rng.every((value, index) => value === withoutAudio.rng[index]);

  const summary = {
    seed: SEED,
    towers: withAudio.placed,
    impactEvents: withAudio.events.length,
    attackWeaponsWithEvents: weaponCoverage.length,
    weaponsWithEvents: weaponCoverage,
    auraPulses: withAudio.auraEvents.length,
    voices: withAudio.frames.length,
    signatureVoices: signatureCounts,
    missingVoices,
    maxVoicesIn120ms: maxWindow,
    maxVoicesPerWindow: IMPACT_LIMITS.maxVoicesPerWindow,
    determinism: { sameSnapshot, sameRng, rngCalls: [withAudio.rng.length, withoutAudio.rng.length], snapshot: withAudio.snapshot },
  };
  console.log(JSON.stringify(summary, null, 2));

  check(missingVoices.length === 0, `有签名一次都没发声：${missingVoices.join(',')}`);
  check(maxWindow <= IMPACT_LIMITS.maxVoicesPerWindow, `120ms 窗口发声 ${maxWindow} 超过上限`);
  check(weaponCoverage.length >= 7, `命中事件只覆盖 ${weaponCoverage.length} 种攻击塔`);
  check(sameSnapshot, '挂/不挂命中音效层改变了模拟结果');
  check(sameRng, '挂/不挂命中音效层改变了 combatRng 序列');
  console.log('[impact-audio] Node 驱动通过');
}

// ---------- 无头浏览器 ----------

const PAGE = `
  (() => {
    const sim = () => window.__rtd.state.sim;
    const app = () => window.__rtd.state.app;

    window.__impactAudio = { voices: [], nodes: { oscillator: 0, bufferSource: 0 }, patched: false };

    const pathCellsNear = (map, count) => {
      const cells = [];
      outer: for (const p of map.pathCells) {
        for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const c = p.c + dc;
          const r = p.r + dr;
          if (map.buildable[r]?.[c] && !cells.some((cell) => cell.c === c && cell.r === r)) {
            cells.push({ c, r });
            if (cells.length >= count) break outer;
          }
        }
      }
      return cells;
    };

    window.__impactAudioSetup = async () => {
      const { audio } = await import('/js/audio.js');
      const s = sim();
      const a = app();
      a.running = false;
      a.paused = true;
      s.phase = 'prep';
      s.paused = false;
      s.time = 0;
      s.waveTime = 0;
      s.enemies = [];
      s.projectiles = [];
      s.effects = [];
      s.floaters = [];
      s.impactEvents = [];
      s.gold = 1000000;
      s.baseHp = 200;
      s.maxBaseHp = 200;
      s.kills = 0;
      s.wave = 0;
      s.clearedWave = 0;
      s.pendingDraft = false;
      s.opts.onWaveClear = null;
      s.opts.onGameOver = null;
      s.opts.onSave = null;
      s.recomputeMods();

      const cells = pathCellsNear(s.map, 8);
      const types = ['arrow', 'cannon', 'frost', 'arc', 'poison', 'banner', 'shock', 'sniper'];
      s.towers = [];
      types.forEach((type, i) => s.towers.push(s.makeTower(type, cells[i].c, cells[i].r, 0, 0)));
      s.recomputeTowerStats();

      // 节点创建计数：只统计 impactVoice 调用期间创建的振荡器/噪声源。
      const ACProto = window.AudioContext.prototype;
      if (!window.__impactAudio.patched) {
        const origOsc = ACProto.createOscillator;
        ACProto.createOscillator = function (...args) {
          window.__impactAudio.nodes.oscillator += 1;
          return origOsc.apply(this, args);
        };
        const origBuf = ACProto.createBufferSource;
        ACProto.createBufferSource = function (...args) {
          window.__impactAudio.nodes.bufferSource += 1;
          return origBuf.apply(this, args);
        };
        const originVoice = audio.impactVoice.bind(audio);
        audio.impactVoice = (signature, options = {}) => {
          const before = { ...window.__impactAudio.nodes };
          const result = originVoice(signature, options);
          const after = window.__impactAudio.nodes;
          window.__impactAudio.voices.push({
            at: options.at ?? performance.now(),
            weapon: signature ? signature.type : 'unknown',
            nodes: after.oscillator - before.oscillator + (after.bufferSource - before.bufferSource),
          });
          return result;
        };
        window.__impactAudio.patched = true;
      }

      await audio.ensure();
      return {
        towers: s.towers.length,
        types: s.towers.map((tower) => tower.type),
        compressor: !!audio.impactCompressor,
        ctxState: audio.ctx ? audio.ctx.state : null,
      };
    };

    window.__impactAudioRun = async ({ minSeconds = 30, maxWaves = 8 } = {}) => {
      const { generateWave } = await import('/js/shared/waves.js');
      const audio = (await import('/js/audio.js')).audio;
      const s = sim();
      let frame = 0;
      let wave = 1;
      while (wave <= maxWaves && s.time < minSeconds) {
        s.phase = 'prep';
        s.wave = wave - 1;
        s.clearedWave = wave - 1;
        s.enemies = [];
        s.projectiles = [];
        s.effects = [];
        s.floaters = [];
        s.pendingDraft = false;
        s.beginWave(generateWave(s.seed, wave, s.difficulty, s.mapMeta || s.map.meta || {}));
        let steps = 0;
        while (s.phase === 'wave' && steps < 60 * 180) {
          s.update(1 / 60);
          frame += 1;
          s.updateVisuals(1 / 60);
          audio.followCombatImpacts(s, frame * (1000 / 60));
          steps += 1;
        }
        s.pendingDraft = false;
        if (s.phase === 'over') break;
        wave += 1;
      }
      return {
        simSeconds: Math.round(s.time * 100) / 100,
        wave: s.wave,
        kills: s.kills,
        towers: s.towers.length,
        voices: window.__impactAudio.voices.length,
        nodes: { ...window.__impactAudio.nodes },
        compressor: !!audio.impactCompressor,
        mixerStats: { ...audio.impactMixer.stats, lastPlans: undefined },
      };
    };
  })();
`;

async function runBrowserDrive() {
  const server = await startTestServer({ seedHeader: true });
  const session = await registerAndLogin(server.base);
  let browser = null;
  try {
    browser = await launchBrowser({
      base: server.base,
      name: 'rtd-impact-audio',
      initScript: TEST_SEED_SCRIPT,
      cookie: session.rawCookie,
    });
    const bootErrors = await browser.evaluate(`window.__bootErrors || []`);
    check(bootErrors.length === 0, `页面启动错误：${bootErrors.join(' | ')}`);

    await browser.evaluate(`document.querySelector('#btn-play').click()`);
    await browser.waitFor(`!!document.querySelector('.difficulty-modal')`, '难度弹窗');
    await browser.evaluate(`document.querySelector('.diff-card[data-id="standard"]').click()`);
    await chooseFirstMap(browser);
    await browser.waitFor(`document.getElementById('game-screen').hidden === false`, '战斗界面');
    await browser.evaluate(PAGE);

    const setup = await browser.evaluate(`window.__impactAudioSetup()`);
    check(setup.towers === 8, `建塔失败：${setup.towers}`);
    check(setup.compressor, 'audio.impactCompressor 为空');
    check(setup.ctxState !== null, 'AudioContext 未创建');

    const run = await browser.evaluate(`window.__impactAudioRun({ minSeconds: 30, maxWaves: 8 })`);
    const voices = await browser.evaluate(`window.__impactAudio.voices`);

    let peak = 0;
    let peakWindow = null;
    for (const voice of voices) {
      const windowVoices = voices.filter(
        (other) => other.at >= voice.at && other.at - voice.at < IMPACT_LIMITS.windowMs
      );
      const nodes = windowVoices.reduce((total, item) => total + item.nodes, 0);
      if (nodes > peak) {
        peak = nodes;
        peakWindow = { at: voice.at, count: windowVoices.length };
      }
    }
    const budget = IMPACT_LIMITS.maxVoicesPerWindow * 2;
    const summary = {
      setup,
      run,
      peakNodesIn120ms: peak,
      peakWindow,
      budget,
      signaturesHeard: [...new Set(voices.map((voice) => voice.weapon))].sort(),
      bootErrors: await browser.evaluate(`window.__bootErrors || []`),
      pageErrors: browser.pageErrors || [],
    };
    console.log(JSON.stringify(summary, null, 2));

    check(run.simSeconds >= 30, `对局时长不足 30s：${run.simSeconds}`);
    check(peak <= budget, `120ms 窗口命中层节点峰值 ${peak} 超过预算 ${budget}`);
    check(run.compressor, '对局后 impactCompressor 为空');
    check(summary.bootErrors.length === 0, `对局出现启动错误：${summary.bootErrors.join(' | ')}`);
    check(summary.pageErrors.length === 0, `控制台错误：${summary.pageErrors.join(' | ')}`);
    console.log('[impact-audio] 浏览器驱动通过');
  } finally {
    try {
      await browser?.close();
    } catch {
      /* 已关闭 */
    }
    await server.stop();
  }
}

const browserMode = process.argv.includes('--browser');
const drive = browserMode ? runBrowserDrive : async () => runNodeDrive();
drive().catch((error) => {
  console.error('[impact-audio] 失败：', error.message);
  process.exit(1);
});
