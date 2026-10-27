// 武器命中签名（AC-015）真机验收驱动：真实对局跑满 2 波 + 36 敌混战压测 + 同种子开/关两局对比。
// 用法：LANG=zh_CN.UTF-8 LANGUAGE=zh_CN node tests/impact-vfx-drive.mjs
//
// 渲染层计数钩子直接读 EffectRenderer 的观测计数（impactDrawn / impactPeak / impactDegraded / auraPulses），
// 混战帧额外包一层 canvas 2D 上下文来证明「降级后命中仍画出图元」，全过程不改任何产品行为。
import {
  ROOT,
  startTestServer,
  launchBrowser,
  chooseFirstMap,
  registerAndLogin,
  TEST_SEED_SCRIPT,
} from './harness.mjs';
import { IMPACT_BUDGETS, impactBudget } from '../public/js/render/impact-vfx.js';
import { EFFECT_PROFILES } from '../public/js/render/effect-renderer.js';

const OUT_DIR = process.env.OUT_DIR || '/tmp';
const ATTACK_WEAPONS = ['arrow', 'cannon', 'frost', 'arc', 'poison', 'shock', 'sniper'];

function check(condition, message) {
  if (!condition) throw new Error(message);
}

// 页面内工具：确定性重置 + 8 塔布阵 + 武器命中统计。
const PAGE_HELPERS = `
  (() => {
    const sim = () => window.__rtd.state.sim;
    const app = () => window.__rtd.state.app;
    const fx = () => window.__rtd.state.app.renderer.effects;

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

    // 与生产相同的塔对象/属性计算，只是跳过金币与解锁门槛（测试场景）。
    const buildEightTowers = (types) => {
      const s = sim();
      const cells = pathCellsNear(s.map, types.length);
      if (cells.length < types.length) throw new Error('可建造格不足：' + cells.length);
      s.towers = [];
      types.forEach((type, i) => {
        const tower = s.makeTower(type, cells[i].c, cells[i].r, 0, 0);
        s.towers.push(tower);
      });
      s.recomputeTowerStats();
      return { cells, types };
    };

    window.__impactSetup = async ({ waves, renderEvery, effectsLevel }) => {
      const { generateWave } = await import('/js/shared/waves.js');
      const { QUALITY_PRESETS } = await import('/js/settings.js');
      const s = sim();
      const a = app();
      a.paused = true;
      a.setPaused?.(true);
      s.phase = 'prep';
      s.paused = false;
      s.time = 0;
      s.waveTime = 0;
      s.shake = 0;
      s.nextId = 1;
      s.enemies = [];
      s.projectiles = [];
      s.effects = [];
      s.floaters = [];
      s.gold = 1000000;
      s.baseHp = 200;
      s.maxBaseHp = 200;
      s.kills = 0;
      s.wave = 0;
      s.clearedWave = 0;
      s.pendingDraft = false;
      s.relics = [];
      s.skill = null;
      s.skillFx = [];
      s.skillPending = [];
      s.stasis = null;
      s.towerOverdrive = null;
      // 波次结算回调在测试里由本驱动接管，避免触发服务端三选一流程。
      s.opts.onWaveClear = null;
      s.opts.onGameOver = null;
      s.opts.onSave = null;
      s.recomputeMods();
      s.setVisualQuality({ effects: effectsLevel, floaters: 'all' });
      const layout = buildEightTowers(['arrow', 'cannon', 'frost', 'arc', 'poison', 'banner', 'shock', 'sniper']);
      // 渲染观测计数归零。
      const renderer = fx();
      renderer.impactDrawn = Object.create(null);
      renderer.impactDegraded = 0;
      renderer.impactPeak = 0;
      renderer.auraPulses = 0;
      a.applySettings(QUALITY_PRESETS.high);
      return { seed: s.seed, waves, renderEvery, effectsLevel, towers: layout.types.length, cells: layout.cells.length };
    };

    // 真实对局推进：模拟按固定步长，渲染按 renderEvery 抽样（生产同一套 sim/render 代码路径）。
    window.__impactRunWaves = async ({ waves, renderEvery, effectsLevel }) => {
      await window.__impactSetup({ waves, renderEvery, effectsLevel });
      const { generateWave } = await import('/js/shared/waves.js');
      const s = sim();
      const a = app();
      const renderer = a.renderer;
      const fxr = renderer.effects;
      const mapMeta = s.mapMeta;
      for (let wave = 1; wave <= waves; wave++) {
        s.phase = 'prep';
        s.wave = wave - 1;
        s.clearedWave = wave - 1;
        s.enemies = [];
        s.projectiles = [];
        s.effects = [];
        s.floaters = [];
        s.pendingDraft = false;
        s.beginWave(generateWave(s.seed, wave, s.difficulty, mapMeta));
        let steps = 0;
        while (s.phase === 'wave' && steps < 60 * 180) {
          s.update(1 / 60);
          s.updateVisuals(1 / 60);
          if (steps % renderEvery === 0) renderer.render(1 / 60);
          steps++;
        }
        if (s.phase === 'over') break;
        s.pendingDraft = false;
      }
      return {
        seed: s.seed,
        wave: s.wave,
        clearedWave: s.clearedWave,
        phase: s.phase,
        gold: Math.floor(s.gold),
        baseHp: Math.round(s.baseHp * 1000) / 1000,
        kills: s.kills,
        enemies: s.enemies.length,
        perWeapon: { ...fxr.impactDrawn },
        auraPulses: fxr.auraPulses,
        impactPeak: fxr.impactPeak,
        impactDegraded: fxr.impactDegraded,
        profile: a.renderer.settings.decorations,
      };
    };

    // 36 敌混战压测：铺 36 个敌人，同帧注入 36 个武器命中，渲染一帧并统计绘制图元。
    window.__impactStress36 = async () => {
      await window.__impactSetup({ waves: 1, renderEvery: 1, effectsLevel: 'full' });
      const { generateWave } = await import('/js/shared/waves.js');
      const s = sim();
      const a = app();
      const renderer = a.renderer;
      const fxr = renderer.effects;
      s.phase = 'prep';
      s.wave = 0;
      s.clearedWave = 0;
      s.beginWave(generateWave(s.seed, 1, s.difficulty, s.mapMeta));
      // 先把本波敌人清掉，换成 36 个均匀铺开的压力敌人（不改变种子/波次定义）。
      s.spawnQueue = [];
      s.spawnIndex = 0;
      s.enemies = [];
      const kinds = ['grunt', 'runner', 'tank'];
      for (let i = 0; i < 36; i++) s.spawnEnemy(kinds[i % kinds.length], i % s.lanes.length);
      for (const enemy of s.enemies) {
        const t = (enemy.progress || 0) * 0.5;
        enemy.progress = 0.15 + (enemy.id % 7) * 0.1;
        enemy.x = 2 + (enemy.id % 9) * 1.2;
        enemy.y = 2 + Math.floor((enemy.id % 36) / 9) * 1.4;
      }
      // 同帧 36 次命中：3 类命中层事件轮转，覆盖 spark / 溅射 ring / bolt。
      const weapons = ${JSON.stringify(ATTACK_WEAPONS)};
      s.effects.length = 0;
      for (let i = 0; i < 36; i++) {
        const weapon = weapons[i % weapons.length];
        const x = 2 + (i % 9) * 1.2;
        const y = 2 + Math.floor(i / 9) * 1.4;
        if (weapon === 'cannon' || weapon === 'shock') {
          s.effects.push({ kind: 'ring', x, y, r0: 0.15, r1: 1, ttl: 0.25, maxTtl: 0.25, weapon });
        } else if (weapon === 'arc') {
          s.effects.push({ kind: 'bolt', points: [{ x, y }, { x: x + 1, y: y + 1 }], ttl: 0.18, maxTtl: 0.18, weapon });
        } else {
          s.effects.push({ kind: 'spark', x, y, ttl: 0.15, maxTtl: 0.15, weapon });
        }
      }
      fxr.impactDrawn = Object.create(null);
      fxr.impactDegraded = 0;
      fxr.impactPeak = 0;
      // 注入 canvas 2D 计数钩子：降级后是否仍有图元。
      const g = renderer.ctx;
      const orig = { arc: g.arc, stroke: g.stroke, fill: g.fill };
      let arcs = 0, strokes = 0, fills = 0;
      g.arc = function (...args) { arcs++; return orig.arc.apply(g, args); };
      g.stroke = function (...args) { strokes++; return orig.stroke.apply(g, args); };
      g.fill = function (...args) { fills++; return orig.fill.apply(g, args); };
      let error = null;
      try {
        renderer.render(1 / 60);
      } catch (err) {
        error = String(err && err.message || err);
      } finally {
        g.arc = orig.arc;
        g.stroke = orig.stroke;
        g.fill = orig.fill;
      }
      return {
        enemies: s.enemies.length,
        effects: s.effects.length,
        impactPeak: fxr.impactPeak,
        impactDegraded: fxr.impactDegraded,
        perWeapon: { ...fxr.impactDrawn },
        draws: { arcs, strokes, fills },
        error,
      };
    };
  })();
`;

async function main() {
  const server = await startTestServer({ seedHeader: true });
  const session = await registerAndLogin(server.base);
  let browser = null;
  try {
    browser = await launchBrowser({
      base: server.base,
      name: 'rtd-impact-vfx',
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
    await browser.evaluate(PAGE_HELPERS);

    // ---- DoD 1：8 塔（战旗仅光环）真实对局跑满 2 波 ----
    const match = await browser.evaluate(`window.__impactRunWaves({ waves: 2, renderEvery: 3, effectsLevel: 'full' })`);
    check(match.seed, '对局缺少种子');
    for (const weapon of ATTACK_WEAPONS) {
      check((match.perWeapon[weapon] || 0) >= 1, `2 波内没有画出 ${weapon} 的命中签名：${JSON.stringify(match.perWeapon)}`);
    }
    check(match.auraPulses >= 1, '战旗光环脉冲一次都没画');
    check(match.impactPeak <= IMPACT_BUDGETS.high, `单帧命中粒子峰值 ${match.impactPeak} 超过高配预算 ${IMPACT_BUDGETS.high}`);
    check(match.impactPeak <= impactBudget(EFFECT_PROFILES.high), '峰值超过 impactBudget(high)');
    check(match.perWeapon.banner === undefined, '战旗不应有攻击命中签名（只应有光环脉冲）');
    await browser.screenshot(`${OUT_DIR}/rtd-impact-01-two-waves.png`);

    const afterMatchBootErrors = await browser.evaluate(`window.__bootErrors || []`);
    check(afterMatchBootErrors.length === 0, `对局期间出现启动/运行错误：${afterMatchBootErrors.join(' | ')}`);

    // ---- DoD 2：36 敌混战压测 ----
    const stress = await browser.evaluate(`window.__impactStress36()`);
    check(stress.error === null, `混战帧渲染抛错：${stress.error}`);
    check(stress.enemies === 36, `压力敌人数量异常：${stress.enemies}`);
    check(stress.impactPeak <= impactBudget(EFFECT_PROFILES.high), `混战峰值 ${stress.impactPeak} 超过预算`);
    check(stress.impactDegraded > 0, '36 敌混战未触发降级路径');
    check(stress.draws.arcs >= 36 && stress.draws.strokes >= 36, `降级后命中表现疑似整块消失：${JSON.stringify(stress.draws)}`);
    await browser.screenshot(`${OUT_DIR}/rtd-impact-02-stress36.png`);

    // ---- DoD 3：同 seed 两局（命中层开 / 关）实跑对比 ----
    const withImpact = await browser.evaluate(`window.__impactRunWaves({ waves: 1, renderEvery: 2, effectsLevel: 'full' })`);
    const withoutImpact = await browser.evaluate(`window.__impactRunWaves({ waves: 1, renderEvery: 2, effectsLevel: 'off' })`);
    check(withImpact.seed === withoutImpact.seed, '两局种子不一致，对比无效');
    for (const field of ['gold', 'baseHp', 'kills', 'wave', 'clearedWave']) {
      check(
        withImpact[field] === withoutImpact[field],
        `命中层开关改变了 ${field}：${withImpact[field]} vs ${withoutImpact[field]}`
      );
    }
    check(withImpact.perWeapon && Object.keys(withImpact.perWeapon).length > 0, '开启命中层的一局没有画出任何武器签名');

    const pageErrors = browser.pageErrors || [];
    check(pageErrors.length === 0, `控制台错误：${pageErrors.join(' | ')}`);
    const finalBootErrors = await browser.evaluate(`window.__bootErrors || []`);
    check(finalBootErrors.length === 0, `收尾时存在启动错误：${finalBootErrors.join(' | ')}`);

    console.log('[impact-vfx] 通过');
    console.log(JSON.stringify({
      root: ROOT,
      match,
      stress,
      determinism: {
        seed: withImpact.seed,
        on: { gold: withImpact.gold, baseHp: withImpact.baseHp, kills: withImpact.kills, wave: withImpact.wave, clearedWave: withImpact.clearedWave },
        off: { gold: withoutImpact.gold, baseHp: withoutImpact.baseHp, kills: withoutImpact.kills, wave: withoutImpact.wave, clearedWave: withoutImpact.clearedWave },
      },
      budgets: { high: IMPACT_BUDGETS.high, low: IMPACT_BUDGETS.low, impactBudgetHigh: impactBudget(EFFECT_PROFILES.high) },
    }, null, 2));
  } finally {
    if (browser) await browser.close();
    await server.stop();
  }
}

main().catch((error) => {
  console.error(`\n[impact-vfx] FAIL: ${error.message || error}`);
  process.exit(1);
});
