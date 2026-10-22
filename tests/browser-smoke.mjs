// 无头浏览器冒烟：选难度 → 建塔 → 开波。使用隔离服务端与临时数据库。
// 用法：node tests/browser-smoke.mjs
import path from 'node:path';
import { startTestServer, launchBrowser, chooseFirstMap } from './harness.mjs';

const OUT_DIR = process.env.OUT_DIR || '/tmp';

async function main() {
  const server = await startTestServer();
  let browser = null;
  try {
    browser = await launchBrowser({ base: server.base, name: 'rtd-smoke' });

    const bootErrors = await browser.evaluate(`window.__bootErrors || []`);
    if (bootErrors.length) throw new Error(`页面启动错误：${bootErrors.join(' | ')}`);
    await browser.screenshot(path.join(OUT_DIR, 'rtd-01-title.png'));

    await browser.evaluate(`document.querySelector('#btn-play').click()`);
    await browser.waitFor(`!!document.querySelector('.difficulty-modal')`, '难度弹窗');
    await browser.screenshot(path.join(OUT_DIR, 'rtd-02-difficulty.png'));

    await browser.evaluate(`document.querySelector('.diff-card[data-id="roam"]').click()`);
    await chooseFirstMap(browser);
    await browser.waitFor(
      `document.getElementById('game-screen').hidden === false`,
      '战斗界面'
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    await browser.screenshot(path.join(OUT_DIR, 'rtd-03-game.png'));

    const setup = await browser.evaluate(`
      (() => {
        const sim = window.__rtd.state.sim;
        const map = sim.map;
        let cell = null;
        for (const p of map.pathCells) {
          for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            const c = p.c + dc, r = p.r + dr;
            if (map.buildable[r]?.[c] && !sim.towerAt(c, r)) { cell = { c, r }; break; }
          }
          if (cell) break;
        }
        if (!cell) return { error: '没有可建造格' };
        document.querySelector('.tower-card[data-type="arrow"]').click();
        const rect = document.querySelector('#game-canvas').getBoundingClientRect();
        return {
          cell,
          x: rect.left + ((cell.c + 0.5) / map.cols) * rect.width,
          y: rect.top + ((cell.r + 0.5) / map.rows) * rect.height,
          diff: sim.difficulty,
          gold: sim.gold,
        };
      })()
    `);
    if (!setup || setup.error) throw new Error(setup?.error || '无法定位建造格');

    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: setup.x, y: setup.y });
    await browser.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: setup.x, y: setup.y, button: 'left', clickCount: 1,
    });
    await browser.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: setup.x, y: setup.y, button: 'left', clickCount: 1,
    });

    const towerCount = await browser.evaluate(`window.__rtd.state.sim.towers.length`);
    if (towerCount !== 1) throw new Error(`建塔失败，towers=${towerCount}`);
    await browser.screenshot(path.join(OUT_DIR, 'rtd-04-built.png'));

    await browser.evaluate(`document.querySelector('.speed-btn[data-speed="3"]').click()`);
    await browser.evaluate(`document.querySelector('#btn-next-wave').click()`);
    await browser.waitFor(`window.__rtd.state.sim.phase === 'wave'`, '波次开始');
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await browser.screenshot(path.join(OUT_DIR, 'rtd-05-battle.png'));

    const battle = await browser.evaluate(`
      (() => {
        const sim = window.__rtd.state.sim;
        return {
          wave: sim.wave,
          phase: sim.phase,
          enemies: sim.enemies.length,
          towers: sim.towers.length,
          gold: Math.floor(sim.gold),
          hp: Math.ceil(sim.baseHp),
          kills: sim.kills,
          difficulty: sim.difficulty,
        };
      })()
    `);
    if (battle.wave !== 1) throw new Error(`波次异常：${battle.wave}`);
    if (battle.towers < 1) throw new Error('塔数量异常');
    if (battle.difficulty !== 'roam') throw new Error(`难度异常：${battle.difficulty}`);
    if (browser.pageErrors.length) throw new Error(`控制台错误：${browser.pageErrors.join(' | ')}`);

    console.log('[smoke] 通过');
    console.log(JSON.stringify({ setup, battle }, null, 2));
  } finally {
    if (browser) await browser.close();
    await server.stop();
  }
}

main().catch((error) => {
  console.error(`\n[smoke] FAIL: ${error.message || error}`);
  process.exit(1);
});
