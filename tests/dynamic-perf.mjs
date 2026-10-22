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
  TEST_SEED_SCRIPT,
  ROOT,
} from './harness.mjs';

const OUT_DIR = process.env.OUT_DIR || '/tmp';
const MEASURE_MS = Number(process.env.PERF_MS || 4000);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const LOW = { fps: 30, dpr: 1, decorations: 'light', floaters: 'key', glow: false, shake: false, showFps: false };
const HIGH = { fps: 60, dpr: 2, decorations: 'full', floaters: 'all', glow: true, shake: true, showFps: true };
const CUSTOM = { fps: 60, dpr: 1, decorations: 'off', floaters: 'off', glow: false, shake: false, showFps: true };

const RELICS_MID = [['sharp', 2], ['warlord', 1], ['frostheart', 1], ['crit', 1]];
const RELICS_LATE = [
  ['sharp', 3], ['warlord', 3], ['warhorn', 3], ['powder', 3],
  ['static', 3], ['toxin', 3], ['crit', 3], ['bosslayer', 3], ['pierce', 3],
];

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
];

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

async function main() {
  const server = await startTestServer({ seedHeader: true });
  let browser = null;
  try {
    browser = await launchBrowser({
      base: server.base,
      name: 'rtd-perf',
      initScript: TEST_SEED_SCRIPT,
    });

    await browser.evaluate(`document.querySelector('#btn-play').click()`);
    await browser.waitFor(`!!document.querySelector('.difficulty-modal')`, '难度弹窗');
    await browser.evaluate(`document.querySelector('.diff-card[data-id="standard"]').click()`);
    await chooseFirstMap(browser);

    // 页面内固定场景构造器
    await browser.evaluate(`
      window.__perfSetup = async (options) => {
        const { generateWave } = await import('/js/shared/waves.js');
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

        sim.beginWave(generateWave(sim.seed, options.wave, sim.difficulty));
        for (let i = 0; i < (options.extraEnemies || 0); i++) {
          sim.spawnEnemy(i % 7 === 0 ? 'tank' : i % 3 === 0 ? 'runner' : 'grunt');
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
          dpr: app.renderer.dpr,
          targetFps: app.settings.fps,
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
          enemies: sim.enemies.map((e) => [e.type, Number(e.hp.toFixed(3)), Number(e.progress.toFixed(3))]),
          towers: sim.towers.map((t) => [t.type, t.level, Number(t.stats.dmg.toFixed(3))]),
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
          sim.beginWave(generateWave(sim.seed, wave, sim.difficulty));
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

    const results = [];
    for (const item of SCENARIOS) {
      const setup = await browser.evaluate(
        `window.__perfSetup(${JSON.stringify({ ...item, run: true })})`
      );
      await sleep(MEASURE_MS);
      const metrics = await browser.evaluate(`window.__rtd.state.app.getMetricsSummary()`);
      await browser.evaluate(`window.__rtd.state.app.setPaused(true)`);
      const shot = path.join(OUT_DIR, `rtd-perf-${item.name}.png`);
      await browser.screenshot(shot);
      const allowedEffects = await browser.evaluate(
        `window.__rtd.state.sim.effects.every(e => ['bolt','ring','leak'].includes(e.kind))`
      );
      results.push({ name: item.name, setup, metrics, allowedEffects, screenshot: shot });
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
      hashes[name] = await browser.evaluate(`window.__perfHash(900)`);
    }
    if (!(hashes.low === hashes.high && hashes.high === hashes.custom)) {
      throw new Error('不同画质下的战斗结果不一致');
    }

    // 内存趋势：一次完整 30 波模拟 + 重复场景构造
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

    // 后台暂停：隐藏期间不推进模拟，返回后不补算
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
    if (visHidden.time - visBefore.time > 0.01) throw new Error('后台期间仍在推进模拟');
    if (visHidden.paused !== visBefore.paused) throw new Error('后台暂停改变了手动暂停状态');
    const resumedDelta = visVisible.time - visHidden.time;
    if (resumedDelta > 1.2) throw new Error(`返回前台后集中补算：${resumedDelta}s`);

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
      if (row.setup.targetFps === 30) {
        if (m.renderFps > 38 || m.renderFps < 20) {
          throw new Error(`${row.name} 低配帧率异常：${m.renderFps}`);
        }
        if (m.simSteps <= m.renders * 1.4) {
          throw new Error(`${row.name} 30FPS 限帧影响到了模拟步数`);
        }
      } else if (m.renderFps < 35) {
        throw new Error(`${row.name} 高配帧率过低：${m.renderFps}`);
      }
      if (m.slowFrames > m.frames * 0.35) {
        throw new Error(`${row.name} 慢帧过多：${m.slowFrames}/${m.frames}`);
      }
    }

    const heapGrowth = heapAfterRepeats.usedSize - heapBefore.usedSize;
    if (heapGrowth > 80 * 1024 * 1024) {
      throw new Error(`重复场景后堆增长过大：${(heapGrowth / 1024 / 1024).toFixed(1)} MB`);
    }

    const chromeVersion = execSync('google-chrome --version').toString().trim();
    const report = {
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
      memory: {
        beforeMB: +(heapBefore.usedSize / 1024 / 1024).toFixed(2),
        afterFullRunMB: +(heapAfterRun.usedSize / 1024 / 1024).toFixed(2),
        afterRepeatsMB: +(heapAfterRepeats.usedSize / 1024 / 1024).toFixed(2),
        growthMB: +(heapGrowth / 1024 / 1024).toFixed(2),
        fullRun,
      },
      backgroundPause: { visBefore, visHidden, visVisible, resumedDelta },
    };

    fs.writeFileSync(path.join(OUT_DIR, 'rtd-perf.json'), JSON.stringify(report, null, 2));
    writeDoc(report);
    console.log('[perf] 通过');
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
    '## 画质一致性',
    '',
    `- 同种子、同塔布局、同 900 个固定模拟步下，低配/高配/自定义的战斗状态哈希一致：**${report.qualityEquality ? '通过' : '失败'}**。`,
    '- 画质只改变绘制频率、DPR、装饰/飘字/光晕/震动与效果生成，不改变伤害、攻速、敌人数、掉落或计分。',
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
    '- 压力场景通过额外注入敌人实现，只用于观察上限，不作为平衡依据。',
    '- 未覆盖移动端、Safari/Firefox 以及真实玩家网络/存档数据。',
    '',
  ];
  fs.writeFileSync(path.join(ROOT, 'docs', 'PERFORMANCE.md'), lines.join('\n'));
}

main().catch((error) => {
  console.error(`\n[perf] FAIL: ${error.message || error}`);
  process.exit(1);
});
