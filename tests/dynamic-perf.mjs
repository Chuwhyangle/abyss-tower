// 动态战斗性能验收：固定种子/塔布局/遗物，真实运行战斗，覆盖 1x/3x、低/高/自定义画质。
// 使用隔离服务端 + 临时数据库 + 独立 Chrome，不触碰线上数据。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import {
  startTestServer,
  launchBrowser,
  chooseFirstMap,
  registerAndLogin,
  TEST_SEED_SCRIPT,
  ROOT,
} from './harness.mjs';

const OUT_DIR = process.env.OUT_DIR || '/tmp';
// --quick（或 PERF_QUICK=1）用于日常回归：少场景、短采样，不写 docs/PERFORMANCE.md。
const QUICK = process.argv.includes('--quick') || process.env.PERF_QUICK === '1';
const MEASURE_MS = Number(process.env.PERF_MS || (QUICK ? 1200 : 4000));
const HASH_STEPS = QUICK ? 450 : 900;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const LOW = { fps: 30, dpr: 1, decorations: 'light', floaters: 'key', glow: false, shake: false, showFps: false };
const HIGH = { fps: 60, dpr: 2, decorations: 'full', floaters: 'all', glow: true, shake: true, showFps: true };
const CUSTOM = { fps: 60, dpr: 1, decorations: 'off', floaters: 'off', glow: false, shake: false, showFps: true };

const RELICS_MID = [['sharp', 2], ['warlord', 1], ['frostheart', 1], ['crit', 1]];
const RELICS_LATE = [
  ['sharp', 3], ['warlord', 3], ['warhorn', 3], ['powder', 3],
  ['static', 3], ['toxin', 3], ['crit', 3], ['bosslayer', 3], ['pierce', 3],
];

// 技能场景统一用 Lv.7：同时覆盖 L4/L7 里程碑（霜纹、流火、迟滞/回声）。
const SKILL_IDS = ['aurora', 'meteor', 'chrono'];
const SKILL_LEVEL = 7;
const SKILL_SCENARIO = {
  wave: 20,
  towerCount: 14,
  towerLevel: 2,
  relicLevels: RELICS_LATE,
  extraEnemies: 80,
  skills: SKILL_IDS,
  skillLevel: SKILL_LEVEL,
};

function scenario(name, options) {
  return { name, ...options };
}

const SCENARIOS = [
  scenario('normal-1x-low', { wave: 12, towerCount: 8, towerLevel: 1, relicLevels: RELICS_MID, extraEnemies: 0, speed: 1, quality: LOW }),
  scenario('normal-1x-high', { wave: 12, towerCount: 8, towerLevel: 1, relicLevels: RELICS_MID, extraEnemies: 0, speed: 1, quality: HIGH }),
  scenario('late-3x-low', { wave: 25, towerCount: 18, towerLevel: 2, relicLevels: RELICS_LATE, extraEnemies: 0, speed: 3, quality: LOW }),
  scenario('late-3x-high', { wave: 25, towerCount: 18, towerLevel: 2, relicLevels: RELICS_LATE, extraEnemies: 0, speed: 3, quality: HIGH }),
  scenario('stress-3x-low', { wave: 29, towerCount: 18, towerLevel: 2, relicLevels: RELICS_LATE, extraEnemies: 250, speed: 3, quality: LOW }),
  scenario('stress-3x-high', { wave: 29, towerCount: 18, towerLevel: 2, relicLevels: RELICS_LATE, extraEnemies: 250, speed: 3, quality: HIGH }),
  scenario('custom-1x-stress', { wave: 20, towerCount: 14, towerLevel: 2, relicLevels: RELICS_LATE, extraEnemies: 120, speed: 1, quality: CUSTOM }),
  // 技能释放：三个技能各释放一次（极光冻结 → 流星落点 → 星海时停/过载叠加）。
  scenario('skills-1x-low', { ...SKILL_SCENARIO, speed: 1, quality: LOW }),
  scenario('skills-1x-high', { ...SKILL_SCENARIO, speed: 1, quality: HIGH }),
  scenario('skills-3x-high', { ...SKILL_SCENARIO, wave: 25, towerCount: 18, extraEnemies: 120, speed: 3, quality: HIGH }),
  // 连续释放：按模拟时间轮换技能（缩短实战冷却以制造持续特效负载）。
  scenario('skills-auto-3x-low', { ...SKILL_SCENARIO, wave: 25, towerCount: 18, extraEnemies: 120, speed: 3, quality: LOW, autoCast: true }),
  scenario('skills-auto-3x-high', { ...SKILL_SCENARIO, wave: 25, towerCount: 18, extraEnemies: 120, speed: 3, quality: HIGH, autoCast: true }),
];

// quick 模式只跑代表场景：正常低配、中后期高配、压力高配，外加技能单次/连续释放。
const QUICK_SCENARIOS = new Set([
  'normal-1x-low',
  'late-3x-high',
  'stress-3x-high',
  'skills-1x-high',
  'skills-auto-3x-high',
]);

// 投射物渲染优化前的完整记录（2026-10-23），用于 docs/PERFORMANCE.md 的前后对比。
const BASELINE = {
  generatedAt: '2026-10-23T02:40:24.508Z',
  results: {
    'normal-1x-low': { renderFps: 29.96, avgRenderMs: 0.482, p95FrameMs: 16.7 },
    'normal-1x-high': { renderFps: 60.16, avgRenderMs: 0.598, p95FrameMs: 16.8 },
    'late-3x-low': { renderFps: 30.09, avgRenderMs: 1.113, p95FrameMs: 16.7 },
    'late-3x-high': { renderFps: 60.05, avgRenderMs: 1.286, p95FrameMs: 16.8 },
    'stress-3x-low': { renderFps: 30.09, avgRenderMs: 2.902, p95FrameMs: 16.8 },
    'stress-3x-high': { renderFps: 47.63, avgRenderMs: 3.067, p95FrameMs: 33.4 },
    'custom-1x-stress': { renderFps: 60.15, avgRenderMs: 1.343, p95FrameMs: 16.7 },
  },
};

// 同宿主、同 Chrome 条件（2026-10-23 18:29）用 develop 原投射物渲染复测的结果。
// 02:40 基线所在的宿主与 Chrome 版本都已变化，绝对帧率不可直接比较，以本表为准。
const HOST_AB_BASELINE = {
  generatedAt: '2026-10-23T18:29Z',
  environment: 'Intel Xeon W-2102 · 4 vCPU · Chromium 155.0.8059.79 · headless --disable-gpu',
  results: {
    'normal-1x-low': { renderFps: 29.74, avgRenderMs: 0.913 },
    'normal-1x-high': { renderFps: 56.43, avgRenderMs: 1.471 },
    'late-3x-low': { renderFps: 29.88, avgRenderMs: 2.371 },
    'late-3x-high': { renderFps: 57.59, avgRenderMs: 1.904 },
    'stress-3x-low': { renderFps: 27.44, avgRenderMs: 4.863 },
    'stress-3x-high': { renderFps: 30.53, avgRenderMs: 4.651 },
    'custom-1x-stress': { renderFps: 56.05, avgRenderMs: 2.032 },
  },
};

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

async function main() {
  const server = await startTestServer({ seedHeader: true });
  const session = await registerAndLogin(server.base);
  let browser = null;
  try {
    browser = await launchBrowser({
      base: server.base,
      name: 'rtd-perf',
      initScript: TEST_SEED_SCRIPT,
      cookie: session.rawCookie,
    });

    await browser.evaluate(`document.querySelector('#btn-play').click()`);
    await browser.waitFor(`!!document.querySelector('.difficulty-modal')`, '难度弹窗');
    await browser.evaluate(`document.querySelector('.diff-card[data-id="standard"]').click()`);
    await chooseFirstMap(browser);

    // 页面内固定场景构造器
    await browser.evaluate(`
      // 战斗状态哈希的组成：技能/时停/过载都参与，画质不得影响其中任何一项。
      const perfSkillState = (sim) =>
        sim.skill
          ? [sim.skill.id, sim.skill.level, Number(sim.skill.cooldown.toFixed(4))]
          : null;
      const perfEnemyState = (sim) =>
        sim.enemies.map((e) => [
          e.type,
          Number(e.hp.toFixed(3)),
          Number(e.progress.toFixed(3)),
          Number((e.freezeUntil || 0).toFixed(4)),
          Number((e.burnUntil || 0).toFixed(4)),
          Number((e.skillVulnUntil || 0).toFixed(4)),
          Number((e.slowUntil || 0).toFixed(4)),
        ]);
      const perfTowerState = (sim) =>
        sim.towers.map((t) => [
          t.type,
          t.level,
          Number(t.stats.dmg.toFixed(3)),
          Number((t.skillOverdriveUntil || 0).toFixed(4)),
        ]);

      window.__perfSetup = async (options) => {
        const { generateWave } = await import('/js/shared/waves.js');
        const { skillStats } = await import('/js/shared/data.js');
        const sim = window.__rtd.state.sim;
        const app = window.__rtd.state.app;
        app.setPaused(true);
        sim.phase = 'prep';
        sim.paused = false;
        sim.time = 0;
        sim.waveTime = 0;
        sim.shake = 0;
        sim.nextId = 1;
        sim.enemies = [];
        sim.projectiles = [];
        sim.effects = [];
        sim.floaters = [];
        sim.towers = [];
        sim.gold = 1000000;
        sim.baseHp = 100;
        sim.maxBaseHp = 100;
        sim.kills = 0;
        sim.clearedWave = options.wave - 1;
        sim.pendingDraft = false;
        sim.relics = options.relicLevels.map(([id, level]) => ({ id, level }));
        sim.recomputeMods();
        sim.opts.onWaveClear = null;
        sim.opts.onGameOver = null;
        sim.opts.onSave = null;
        sim.opts.onSkillCast = null;
        // 技能状态必须逐场景重置，避免上一场景的时停/过载/事件泄漏。
        sim.skill = null;
        sim.skillFx = [];
        sim.skillPending = [];
        sim.stasis = null;
        sim.towerOverdrive = null;
        sim.skillCastCount = 0;
        sim.skillRng = null;
        sim.skillCastState = null;
        sim.__perfAutoSkills = null;
        sim.__perfAutoIndex = 0;
        sim.__perfAutoNext = 0;

        // 连续释放：在模拟步内按固定节奏轮换技能，保证负载可复现（不依赖真实时间定时器）。
        if (!sim.__perfSkillPatched) {
          sim.__perfSkillPatched = true;
          const originalUpdateSkill = sim.updateSkill.bind(sim);
          sim.updateSkill = function (dt) {
            originalUpdateSkill(dt);
            const list = this.__perfAutoSkills;
            if (!list || !list.length || this.phase !== 'wave' || this.paused) return;
            if (this.time < (this.__perfAutoNext || 0)) return;
            const next = list[this.__perfAutoIndex % list.length];
            this.__perfAutoIndex++;
            this.__perfAutoNext = this.time + (this.__perfAutoInterval || 2.5);
            this.skill = {
              id: next.id,
              level: next.level,
              stats: skillStats(next.id, next.level),
              cooldown: 0,
            };
            this.castSkill();
          };
        }

        const map = sim.map;
        const cells = [];
        outer: for (const p of map.pathCells) {
          for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            const c = p.c + dc;
            const r = p.r + dr;
            if (map.buildable[r]?.[c] && !cells.some(x => x.c === c && x.r === r)) {
              cells.push({ c, r });
              if (cells.length >= options.towerCount) break outer;
            }
          }
        }
        const types = ['arrow', 'cannon', 'frost', 'arc', 'poison'];
        cells.forEach((cell, i) => {
          const tower = sim.makeTower(types[i % types.length], cell.c, cell.r, options.towerLevel, 0);
          sim.towers.push(tower);
          sim.refreshTowerStats(tower);
        });

        // 传入地图 meta：多入口地图按本波入口计划出怪，覆盖多 lane 模拟/渲染。
        sim.beginWave(generateWave(sim.seed, options.wave, sim.difficulty, sim.mapMeta));
        for (let i = 0; i < (options.extraEnemies || 0); i++) {
          // 压力敌人分散到所有 lane，避免只压单条路径。
          sim.spawnEnemy(
            i % 7 === 0 ? 'tank' : i % 3 === 0 ? 'runner' : 'grunt',
            i % sim.lanes.length
          );
        }

        // 技能场景：贴图/粒子状态在敌人就位后建立。
        let skill = null;
        let skillAuto = false;
        if (Array.isArray(options.skills) && options.skills.length) {
          const list = options.skills.map((id) => ({ id, level: options.skillLevel || 1 }));
          skill = list[0].id;
          if (options.autoCast) {
            sim.skill = {
              id: list[0].id,
              level: list[0].level,
              stats: skillStats(list[0].id, list[0].level),
              cooldown: 0,
            };
            sim.__perfAutoSkills = list;
            sim.__perfAutoIndex = 0;
            sim.__perfAutoNext = 0;
            sim.__perfAutoInterval = options.skillInterval || 2.5;
            skillAuto = true;
          } else {
            // 每个技能各释放一次；后释放的技能不会覆盖已生效的冻结/灼烧/时停状态。
            for (const entry of list) {
              sim.skill = {
                id: entry.id,
                level: entry.level,
                stats: skillStats(entry.id, entry.level),
                cooldown: 0,
              };
              sim.paused = false;
              sim.castSkill();
            }
          }
        }

        app.applySettings(options.quality);
        app.speed = options.speed;
        app.paused = !options.run;
        app.resetMetrics();
        return {
          wave: sim.wave,
          enemies: sim.enemies.length,
          towers: sim.towers.length,
          seed: sim.seed,
          lanes: sim.lanes.length,
          portals: sim.map.spawns?.length || 1,
          activePortals: sim.activePortals.length,
          dpr: app.renderer.dpr,
          targetFps: app.settings.fps,
          skill,
          skillAuto,
        };
      };

      window.__perfHash = (steps) => {
        const sim = window.__rtd.state.sim;
        const app = window.__rtd.state.app;
        app.paused = true;
        for (let i = 0; i < steps && sim.phase === 'wave'; i++) sim.update(1 / 60);
        return JSON.stringify({
          phase: sim.phase,
          time: Number(sim.time.toFixed(4)),
          wave: sim.wave,
          cleared: sim.clearedWave,
          kills: sim.kills,
          gold: Number(sim.gold.toFixed(4)),
          hp: Number(sim.baseHp.toFixed(4)),
          enemies: perfEnemyState(sim),
          towers: perfTowerState(sim),
          skill: perfSkillState(sim),
          stasis: sim.stasis ? Number(sim.stasis.until.toFixed(4)) : null,
          pending: sim.skillPending.map((ev) => [ev.type, Number(ev.at.toFixed(4)), Number((ev.x || 0).toFixed(4)), Number((ev.y || 0).toFixed(4))]),
          projectiles: sim.projectiles.length,
        });
      };

      // 技能画质一致性：同样本步数、同一释放计划（按模拟步触发），只换画质。
      window.__perfSkillHash = async (steps, casts) => {
        const { skillStats } = await import('/js/shared/data.js');
        const sim = window.__rtd.state.sim;
        const app = window.__rtd.state.app;
        app.paused = true;
        const plan = new Map((casts || []).map((cast) => [cast.at, cast]));
        for (let i = 0; i < steps && sim.phase === 'wave'; i++) {
          const cast = plan.get(i);
          if (cast) {
            sim.skill = {
              id: cast.id,
              level: cast.level,
              stats: skillStats(cast.id, cast.level),
              cooldown: 0,
            };
            sim.paused = false;
            sim.castSkill();
          }
          sim.update(1 / 60);
        }
        return JSON.stringify({
          phase: sim.phase,
          time: Number(sim.time.toFixed(4)),
          wave: sim.wave,
          cleared: sim.clearedWave,
          kills: sim.kills,
          gold: Number(sim.gold.toFixed(4)),
          hp: Number(sim.baseHp.toFixed(4)),
          enemies: perfEnemyState(sim),
          towers: perfTowerState(sim),
          skill: perfSkillState(sim),
          stasis: sim.stasis ? Number(sim.stasis.until.toFixed(4)) : null,
          pending: sim.skillPending.map((ev) => [ev.type, Number(ev.at.toFixed(4)), Number((ev.x || 0).toFixed(4)), Number((ev.y || 0).toFixed(4))]),
          projectiles: sim.projectiles.length,
        });
      };

      window.__perfFullRun = async () => {
        const { generateWave } = await import('/js/shared/waves.js');
        const sim = window.__rtd.state.sim;
        const app = window.__rtd.state.app;
        await window.__perfSetup({
          wave: 1,
          towerCount: 18,
          towerLevel: 2,
          relicLevels: ${JSON.stringify(RELICS_LATE)},
          extraEnemies: 0,
          speed: 1,
          quality: ${JSON.stringify(HIGH)},
          run: false,
        });
        app.paused = true;
        let steps = 0;
        for (let wave = 1; wave <= 30; wave++) {
          if (sim.phase === 'over') break;
          sim.phase = 'prep';
          sim.wave = wave - 1;
          sim.clearedWave = wave - 1;
          sim.enemies = [];
          sim.projectiles = [];
          sim.beginWave(generateWave(sim.seed, wave, sim.difficulty, sim.mapMeta));
          let waveSteps = 0;
          while (sim.phase === 'wave' && waveSteps < 60 * 120) {
            sim.update(1 / 60);
            waveSteps++;
            steps++;
          }
          if (sim.phase === 'over') break;
          sim.clearedWave = wave;
          sim.wave = wave;
          sim.phase = 'prep';
          sim.maxBaseHp = 100;
          sim.baseHp = 100;
        }
        return {
          wavesCleared: sim.clearedWave,
          kills: sim.kills,
          steps,
          phase: sim.phase,
          effects: sim.effects.length,
          projectiles: sim.projectiles.length,
        };
      };
    `);

    const scenarios = QUICK ? SCENARIOS.filter((item) => QUICK_SCENARIOS.has(item.name)) : SCENARIOS;
    const results = [];
    for (const item of scenarios) {
      const setup = await browser.evaluate(
        `window.__perfSetup(${JSON.stringify({ ...item, run: true })})`
      );
      await sleep(MEASURE_MS);
      const metrics = await browser.evaluate(`window.__rtd.state.app.getMetricsSummary()`);
      const castCount = await browser.evaluate(`window.__rtd.state.sim.skillCastCount || 0`);
      await browser.evaluate(`window.__rtd.state.app.setPaused(true)`);
      let shot = null;
      if (!QUICK) {
        shot = path.join(OUT_DIR, `rtd-perf-${item.name}.png`);
        await browser.screenshot(shot);
      }
      const allowedEffects = await browser.evaluate(
        `window.__rtd.state.sim.effects.every(e => ['bolt','ring','leak'].includes(e.kind))`
      );
      console.log(`[perf] ${item.name}: ${metrics.renderFps} FPS · render ${metrics.avgRenderMs} ms/frame`);
      results.push({ name: item.name, setup, metrics, skillCasts: castCount, allowedEffects, screenshot: shot });
    }

    // 同场景、同模拟步数下，不同画质战斗结果必须一致
    const hashes = {};
    for (const [name, quality] of [['low', LOW], ['high', HIGH], ['custom', CUSTOM]]) {
      await browser.evaluate(`
        window.__perfSetup(${JSON.stringify({
          wave: 20,
          towerCount: 12,
          towerLevel: 2,
          relicLevels: RELICS_LATE,
          extraEnemies: 40,
          speed: 1,
          quality,
          run: false,
        })})
      `);
      hashes[name] = await browser.evaluate(`window.__perfHash(${HASH_STEPS})`);
    }
    if (!(hashes.low === hashes.high && hashes.high === hashes.custom)) {
      throw new Error('不同画质下的战斗结果不一致');
    }

    // 技能画质一致性：同种子、同释放计划与步数，三档画质的技能战斗状态必须一致。
    // 释放顺序固定：流星(0) → 星海(120) → 极光(300)，让碎晶/解冻在极光仍为当前技能时结算。
    const skillCasts = [
      { at: 0, id: 'meteor', level: SKILL_LEVEL },
      { at: 120, id: 'chrono', level: SKILL_LEVEL },
      { at: 300, id: 'aurora', level: SKILL_LEVEL },
    ];
    const skillHashes = {};
    for (const [name, quality] of [['low', LOW], ['high', HIGH], ['custom', CUSTOM]]) {
      await browser.evaluate(`
        window.__perfSetup(${JSON.stringify({
          wave: 25,
          towerCount: 14,
          towerLevel: 2,
          relicLevels: RELICS_LATE,
          extraEnemies: 90,
          speed: 1,
          quality,
          run: false,
        })})
      `);
      skillHashes[name] = await browser.evaluate(
        `window.__perfSkillHash(${HASH_STEPS}, ${JSON.stringify(skillCasts)})`
      );
    }
    if (!(skillHashes.low === skillHashes.high && skillHashes.high === skillHashes.custom)) {
      throw new Error('不同画质下的技能战斗结果不一致');
    }

    // 内存趋势：一次完整 30 波模拟 + 重复场景构造（quick 模式跳过）
    let memory = null;
    if (!QUICK) {
      await browser.collectGarbage();
      const heapBefore = await browser.heapUsage();
      const fullRun = await browser.evaluate(`window.__perfFullRun()`);
      await browser.collectGarbage();
      const heapAfterRun = await browser.heapUsage();
      for (let i = 0; i < 3; i++) {
        await browser.evaluate(`
          window.__perfSetup(${JSON.stringify({
            wave: 20,
            towerCount: 14,
            towerLevel: 2,
            relicLevels: RELICS_LATE,
            extraEnemies: 120,
            speed: 1,
            quality: HIGH,
            run: false,
          })})
        `);
      }
      await browser.evaluate(`window.__rtd.state.sim.enemies = []; window.__rtd.state.sim.projectiles = []; window.__rtd.state.sim.effects = []; window.__rtd.state.sim.floaters = [];`);
      await browser.collectGarbage();
      const heapAfterRepeats = await browser.heapUsage();
      const heapGrowth = heapAfterRepeats.usedSize - heapBefore.usedSize;
      if (heapGrowth > 80 * 1024 * 1024) {
        throw new Error(`重复场景后堆增长过大：${(heapGrowth / 1024 / 1024).toFixed(1)} MB`);
      }
      memory = {
        beforeMB: +(heapBefore.usedSize / 1024 / 1024).toFixed(2),
        afterFullRunMB: +(heapAfterRun.usedSize / 1024 / 1024).toFixed(2),
        afterRepeatsMB: +(heapAfterRepeats.usedSize / 1024 / 1024).toFixed(2),
        growthMB: +(heapGrowth / 1024 / 1024).toFixed(2),
        fullRun,
      };
    }

    // 后台暂停：隐藏期间不推进模拟，返回后不补算（quick 模式跳过）
    let backgroundPause = null;
    if (!QUICK) {
      await browser.evaluate(`
        window.__perfSetup(${JSON.stringify({
          wave: 15,
          towerCount: 10,
          towerLevel: 2,
          relicLevels: RELICS_MID,
          extraEnemies: 30,
          speed: 1,
          quality: LOW,
          run: true,
        })})
      `);
      await sleep(500);
      const visBefore = await browser.evaluate(`({
        time: window.__rtd.state.sim.time,
        paused: window.__rtd.state.app.paused,
      })`);
      await browser.evaluate(`
        (() => {
          Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
          document.dispatchEvent(new Event('visibilitychange'));
        })()
      `);
      // 隐藏生效与上一帧之间可能还有不到一帧的时间；以隐藏后 150ms 为基线再测漂移。
      await sleep(150);
      const visHiddenStart = await browser.evaluate(`({
        time: window.__rtd.state.sim.time,
        paused: window.__rtd.state.app.paused,
      })`);
      await sleep(900);
      const visHidden = await browser.evaluate(`({
        time: window.__rtd.state.sim.time,
        paused: window.__rtd.state.app.paused,
      })`);
      await browser.evaluate(`
        (() => {
          Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
          document.dispatchEvent(new Event('visibilitychange'));
        })()
      `);
      await sleep(500);
      const visVisible = await browser.evaluate(`({
        time: window.__rtd.state.sim.time,
        paused: window.__rtd.state.app.paused,
      })`);
      if (visHidden.time - visHiddenStart.time > 0.01) throw new Error('后台期间仍在推进模拟');
      if (visHidden.paused !== visBefore.paused) throw new Error('后台暂停改变了手动暂停状态');
      const resumedDelta = visVisible.time - visHidden.time;
      if (resumedDelta > 1.2) throw new Error(`返回前台后集中补算：${resumedDelta}s`);
      backgroundPause = { visBefore, visHiddenStart, visHidden, visVisible, resumedDelta };
    }

    // 基本断言：低配限帧不限制模拟，且保留关键战斗实体
    for (const row of results) {
      const m = row.metrics;
      if (m.entities.enemies < 1) throw new Error(`${row.name} 没有存活敌人，压力场景无效`);
      if (m.entities.towers < 1) throw new Error(`${row.name} 没有塔`);
      if (m.simSteps < 1) throw new Error(`${row.name} 没有推进模拟`);
      if (m.settings.decorations === 'off' && !row.allowedEffects) {
        throw new Error(`${row.name} 低画质保留了非必要特效`);
      }
      if (m.settings.floaters === 'off' && m.entities.floaters !== 0) {
        throw new Error(`${row.name} 关闭飘字后仍在生成飘字`);
      }
      // 技能场景必须真的释放过技能；连续释放场景要释放多次。
      if (row.name.startsWith('skills')) {
        if (!row.setup.skill) throw new Error(`${row.name} 未启用技能`);
        if (row.skillCasts < 1) throw new Error(`${row.name} 没有释放技能`);
        if (row.name.includes('auto') && (row.skillCasts < 2 || !row.setup.skillAuto)) {
          throw new Error(`${row.name} 连续释放无效：${row.skillCasts} 次`);
        }
      }
      // 压力/技能场景只要求如实记录（AC），不设帧率下限；正常/中后期场景仍受预算约束。
      const recordedOnly = row.name.startsWith('stress') || row.name.startsWith('skills');
      if (row.setup.targetFps === 30) {
        if (!recordedOnly && (m.renderFps > 38 || m.renderFps < 20)) {
          throw new Error(`${row.name} 低配帧率异常：${m.renderFps}`);
        }
        if (m.simSteps <= m.renders * 1.4) {
          throw new Error(`${row.name} 30FPS 限帧影响到了模拟步数`);
        }
      } else if (!recordedOnly && m.renderFps < 35) {
        throw new Error(`${row.name} 高配帧率过低：${m.renderFps}`);
      }
      if (m.slowFrames > m.frames * 0.35) {
        throw new Error(`${row.name} 慢帧过多：${m.slowFrames}/${m.frames}`);
      }
    }

    const chromeVersion = execSync(`${process.env.CHROME_BIN || 'google-chrome'} --version`).toString().trim();
    const report = {
      quick: QUICK,
      environment: {
        host: os.hostname(),
        cpus: os.cpus().length,
        cpuModel: os.cpus()[0]?.model,
        totalMemMB: Math.round(os.totalmem() / 1024 / 1024),
        node: process.version,
        chrome: chromeVersion,
        mode: 'headless --disable-gpu（软件渲染）',
        measureMs: MEASURE_MS,
      },
      results,
      qualityEquality: true,
      skillQuality: {
        equal: true,
        casts: skillCasts,
        steps: HASH_STEPS,
        scenarios: ['low', 'high', 'custom'],
      },
      memory,
      backgroundPause,
    };

    fs.writeFileSync(path.join(OUT_DIR, 'rtd-perf.json'), JSON.stringify(report, null, 2));
    if (QUICK) {
      console.log('[perf:quick] 通过（未写 docs/PERFORMANCE.md）');
    } else {
      writeDoc(report);
      console.log('[perf] 通过');
    }
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (browser) await browser.close();
    await server.stop();
  }
}

function writeDoc(report) {
  const lines = [
    '# 动态性能测试记录',
    '',
    `- 生成时间：${new Date().toISOString()}`,
    `- 环境：${report.environment.host} · ${report.environment.cpus} vCPU · ${report.environment.cpuModel} · ${report.environment.totalMemMB} MB · Node ${report.environment.node} · ${report.environment.chrome}`,
    `- 浏览器模式：${report.environment.mode}`,
    `- 单场景采样：${report.environment.measureMs} ms；固定种子、固定塔布局与遗物配置`,
    '- 压力场景通过直接注入额外敌人构造，超出正常单波规模；不代表正常难度。',
    '- 技能场景：`skills-*` 为极光/流星/星海各释放一次（Lv.7）；`skills-auto-*` 为按模拟时间每 2.5s 轮换连续释放（缩短实战冷却以制造持续特效负载）。',
    '',
    '## 场景结果',
    '',
    '| 场景 | 目标FPS | 实际渲染FPS | 模拟步数 | 渲染帧 | 模拟耗时/帧(ms) | 渲染耗时/帧(ms) | HUD耗时/次(ms) | 帧间隔P95/P99(ms) | >50ms慢帧 | 实体(敌/塔/投射) |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...report.results.map((row) => {
      const m = row.metrics;
      return `| ${row.name} | ${row.setup.targetFps} | ${m.renderFps} | ${m.simSteps} | ${m.renders} | ${m.avgSimMs} | ${m.avgRenderMs} | ${m.avgHudMs} | ${m.p95FrameMs}/${m.p99FrameMs} | ${m.slowFrames}/${m.frames} | ${m.entities.enemies}/${m.entities.towers}/${m.entities.projectiles} |`;
    }),
    '',
    '## 优化前后对比（投射物渲染）',
    '',
    `- 基线：${BASELINE.generatedAt} 的完整记录（优化前）。`,
    '- 优化：投射物按类型分桶批量绘制；轨迹与弹体改为缓存贴图；低配整帧关闭拖尾；每帧零临时对象。',
    '- 视觉语义不变：五种投射物（炮弹/冰锥/电球/毒液/箭矢）形状与配色保持原样，仅低配省略装饰性拖尾。',
    '',
    '| 场景 | 优化前渲染FPS | 优化后渲染FPS | 优化前渲染耗时/帧(ms) | 优化后渲染耗时/帧(ms) |',
    '| --- | --- | --- | --- | --- |',
    ...report.results.map((row) => {
      const base = BASELINE.results[row.name];
      const beforeFps = base ? base.renderFps : '-';
      const beforeMs = base ? base.avgRenderMs : '-';
      return `| ${row.name} | ${beforeFps} | ${row.metrics.renderFps} | ${beforeMs} | ${row.metrics.avgRenderMs} |`;
    }),
    '',
    '- 注意：02:40 基线在 AMD EPYC 7K62 + Chrome 152 上取得，本次记录在 Intel Xeon W-2102 + Chromium 155 上取得；宿主与浏览器均变化，绝对帧率不能直接相减。',
    '',
    '### 同宿主同条件 A/B（对照 develop 原投射物渲染）',
    '',
    `- 复测时间：${HOST_AB_BASELINE.generatedAt}；环境：${HOST_AB_BASELINE.environment}。`,
    '',
    '| 场景 | 原实现渲染FPS | 优化后渲染FPS | 原实现渲染耗时/帧(ms) | 优化后渲染耗时/帧(ms) |',
    '| --- | --- | --- | --- | --- |',
    ...report.results.map((row) => {
      const base = HOST_AB_BASELINE.results[row.name];
      const beforeFps = base ? base.renderFps : '-';
      const beforeMs = base ? base.avgRenderMs : '-';
      return `| ${row.name} | ${beforeFps} | ${row.metrics.renderFps} | ${beforeMs} | ${row.metrics.avgRenderMs} |`;
    }),
    '',
    '- 同条件下渲染耗时是稳定指标；帧率受宿主调度影响更大（本机软件渲染常见 33ms 帧间隔，p95 见上表）。',
    '',
    '## 画质一致性',
    '',
    `- 同种子、同塔布局、同 900 个固定模拟步下，低配/高配/自定义的战斗状态哈希一致：**${report.qualityEquality ? '通过' : '失败'}**。`,
    '- 画质只改变绘制频率、DPR、装饰/飘字/光晕/震动与效果生成，不改变伤害、攻速、敌人数、掉落或计分。',
    '',
    '## 技能画面与预算',
    '',
    `- 技能释放场景（极光帘幕 / 流星落点 / 星海时停与塔过载）：见上表 \`skills-*\` 与 \`skills-auto-*\` 行。`,
    `- 同种子、同释放计划（流星@步 0 / 星海@步 120 / 极光@步 300）、同 ${report.skillQuality.steps} 个固定模拟步下，低配/高配/自定义的技能战斗状态哈希一致：**${report.skillQuality.equal ? '通过' : '失败'}**。`,
    '- 哈希覆盖技能冷却、时停、塔过载、冻结/灼烧/易伤/减速计时与待落陨星；画质不改变任何一项。',
    '- 技能粒子按画质封顶：full 180 / standard 120 / minimal 48；事件粒子数与降档裁剪由 `tests/render-budget.test.mjs` 单元测试守住。',
    '- 全屏色层、极光帘幕、星空、光柱、焦痕全部预烘焙，绘制时只 drawImage，不使用 shadowBlur / getImageData / 每帧渐变。',
    '',
    '## 内存趋势',
    '',
    `- 基线（GC 后）：${report.memory.beforeMB} MB`,
    `- 完整 30 波模拟后（GC 后）：${report.memory.afterFullRunMB} MB`,
    `- 重复构造压力场景 3 次后（GC 后）：${report.memory.afterRepeatsMB} MB`,
    `- 堆增长：${report.memory.growthMB} MB`,
    `- 完整模拟结果：清波 ${report.memory.fullRun.wavesCleared} 波，击杀 ${report.memory.fullRun.kills}，步数 ${report.memory.fullRun.steps}`,
    '',
    '## 后台暂停',
    '',
    `- 隐藏期间模拟时间变化：${(report.backgroundPause.visHidden.time - report.backgroundPause.visBefore.time).toFixed(3)} s`,
    `- 返回前台后 0.5s 内模拟推进：${report.backgroundPause.resumedDelta.toFixed(3)} s（未集中补算）`,
    `- 手动暂停状态在隐藏/恢复前后保持一致：${report.backgroundPause.visBefore.paused === report.backgroundPause.visHidden.paused ? '是' : '否'}`,
    '',
    '## 限制',
    '',
    '- 无头 Chrome 关闭 GPU，使用软件渲染，不等同真实显卡；数据用于相对比较与回归。',
    '- 压力场景通过额外注入敌人实现，只用于观察上限，不作为平衡依据；未达目标 FPS 时如实记录，不修饰数据。',
    '- 技能场景同样在无头软件渲染下取得；粒子上限/分层预烘焙属于渲染层预算，绝对帧率随宿主与浏览器版本变化，只用于同机同版本的前后对比。',
    '- 未覆盖移动端、Safari/Firefox 以及真实玩家网络/存档数据。',
    '',
  ];
  fs.writeFileSync(path.join(ROOT, 'docs', 'PERFORMANCE.md'), lines.join('\n'));
}

main().catch((error) => {
  console.error(`\n[perf] FAIL: ${error.message || error}`);
  process.exit(1);
});
