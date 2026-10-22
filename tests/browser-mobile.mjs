// 手机端验收：竖屏提示、横屏无遮挡、触控建塔、设置/遗物弹窗。
import { startTestServer, launchBrowser } from './harness.mjs';

const OUT_DIR = process.env.OUT_DIR || '/tmp';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const server = await startTestServer();
  let browser = null;
  try {
    browser = await launchBrowser({ base: server.base, name: 'rtd-mobile' });
    const setViewport = (width, height) =>
      browser.send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 3, mobile: true,
      });
    await browser.send('Emulation.setTouchEmulationEnabled', {
      enabled: true, maxTouchPoints: 5,
    });

    // 竖屏
    await setViewport(390, 844);
    await browser.send('Page.reload', { ignoreCache: true });
    await browser.waitBoot();
    const touchClass = await browser.evaluate(`document.body.classList.contains('is-touch')`);
    if (!touchClass) throw new Error('触屏设备未标记 is-touch');

    await browser.evaluate(`document.querySelector('#btn-play').click()`);
    await browser.waitFor(`!!document.querySelector('.difficulty-modal')`, '难度弹窗');
    await browser.evaluate(`document.querySelector('.diff-card[data-id="roam"]').click()`);
    await browser.waitFor(`!!(window.__rtd && window.__rtd.state.sim)`, '游戏创建');
    await sleep(300);

    const hint = await browser.evaluate(`(() => {
      const el = document.querySelector('#rotate-hint');
      return { display: getComputedStyle(el).display, rect: el.getBoundingClientRect().toJSON() };
    })()`);
    if (hint.display !== 'flex' || hint.rect.width < 300) {
      throw new Error(`竖屏提示未显示：${JSON.stringify(hint)}`);
    }
    await browser.screenshot(`${OUT_DIR}/rtd-mobile-01-portrait-hint.png`);

    await browser.evaluate(`document.querySelector('#btn-rotate-continue').click()`);
    await sleep(200);
    const portrait = await browser.evaluate(`(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      const hud = r('.hud'), shop = r('.shop'), canvas = r('#game-canvas');
      return {
        iw: innerWidth, ih: innerHeight,
        sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight,
        hudBottom: hud.bottom, shopTop: shop.top,
        canvasTop: canvas.top, canvasBottom: canvas.bottom, canvasWidth: canvas.width,
        hint: getComputedStyle(document.querySelector('#rotate-hint')).display,
      };
    })()`);
    if (portrait.hint !== 'none') throw new Error('关闭后竖屏提示仍在');
    if (portrait.sw > portrait.iw + 1) throw new Error('竖屏出现横向溢出');
    if (portrait.canvasTop < portrait.hudBottom - 1) throw new Error('竖屏画布盖住 HUD');
    if (portrait.canvasBottom > portrait.shopTop + 1) throw new Error('竖屏画布压住商店');
    await browser.screenshot(`${OUT_DIR}/rtd-mobile-02-portrait.png`);

    // 设置与遗物弹窗
    await browser.evaluate(`document.querySelector('#btn-settings-game').click()`);
    await browser.waitFor(`!!document.querySelector('.settings-modal')`, '设置弹窗');
    const settingsRect = await browser.evaluate(
      `document.querySelector('.settings-modal').getBoundingClientRect().toJSON()`
    );
    if (settingsRect.left < 0 || settingsRect.right > 391 || settingsRect.bottom > 845) {
      throw new Error(`设置弹窗超出竖屏：${JSON.stringify(settingsRect)}`);
    }
    await browser.screenshot(`${OUT_DIR}/rtd-mobile-03-settings.png`);
    await browser.evaluate(`document.querySelector('#settings-cancel').click()`);

    await browser.evaluate(`window.__rtd.state.sim.addRelic('sharp')`);
    await browser.evaluate(`document.querySelector('#btn-relics-mobile').click()`);
    await browser.waitFor(`!!document.querySelector('.relics-modal')`, '遗物弹窗');
    const relicText = await browser.evaluate(`document.querySelector('.relics-modal').textContent`);
    if (!relicText.includes('锐利箭簇') || !relicText.includes('25%')) {
      throw new Error('移动端遗物列表内容错误');
    }
    await browser.screenshot(`${OUT_DIR}/rtd-mobile-04-relics.png`);
    await browser.evaluate(`document.querySelector('#btn-close-relics').click()`);

    // 横屏：无溢出、无遮挡、触控建塔
    await setViewport(844, 390);
    await sleep(400);
    const landscape = await browser.evaluate(`(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      const hud = r('.hud'), shop = r('.shop'), canvas = r('#game-canvas');
      return {
        iw: innerWidth, ih: innerHeight,
        sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight,
        hudBottom: hud.bottom, shopTop: shop.top,
        canvasTop: canvas.top, canvasBottom: canvas.bottom,
        canvasWidth: canvas.width, canvasHeight: canvas.height,
      };
    })()`);
    if (landscape.sw > landscape.iw + 1) throw new Error('横屏出现横向溢出');
    if (landscape.sh > landscape.ih + 1) throw new Error('横屏出现纵向溢出');
    if (landscape.canvasTop < landscape.hudBottom - 1) throw new Error('横屏画布盖住 HUD');
    if (landscape.canvasBottom > landscape.shopTop + 1) throw new Error('横屏画布压住商店');
    if (landscape.canvasWidth < 380 || landscape.canvasHeight < 200) {
      throw new Error(`横屏画布过小：${landscape.canvasWidth}x${landscape.canvasHeight}`);
    }

    const tap = async (x, y) => {
      await browser.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x, y, radiusX: 2, radiusY: 2, force: 1, id: 1 }],
      });
      await browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(150);
    };

    const card = await browser.evaluate(`(() => {
      const r = document.querySelector('.tower-card[data-type="arrow"]').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    await tap(card.x, card.y);
    const placement = await browser.evaluate(`window.__rtd.state.sim.placementType`);
    if (placement !== 'arrow') throw new Error(`触摸塔卡未选中：${placement}`);

    const target = await browser.evaluate(`(() => {
      const sim = window.__rtd.state.sim;
      const map = sim.map;
      for (const p of map.pathCells) {
        for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const c = p.c + dc, r = p.r + dr;
          if (map.buildable[r]?.[c]) {
            const rect = document.querySelector('#game-canvas').getBoundingClientRect();
            return {
              c, r,
              x: rect.left + ((c + 0.5) / map.cols) * rect.width,
              y: rect.top + ((r + 0.5) / map.rows) * rect.height,
            };
          }
        }
      }
      return null;
    })()`);
    if (!target) throw new Error('没有可建造格');
    await tap(target.x, target.y);
    const towers = await browser.evaluate(`window.__rtd.state.sim.towers.length`);
    if (towers !== 1) throw new Error(`触摸建造失败：towers=${towers}`);
    await browser.screenshot(`${OUT_DIR}/rtd-mobile-05-landscape.png`);

    if (browser.pageErrors.length) {
      throw new Error(`控制台错误：${browser.pageErrors.join(' | ')}`);
    }
    console.log('[mobile] 通过');
    console.log(JSON.stringify({ hint, portrait, settingsRect, landscape, target, towers }, null, 2));
  } finally {
    if (browser) await browser.close();
    await server.stop();
  }
}

main().catch((error) => {
  console.error(`\n[mobile] FAIL: ${error.message || error}`);
  process.exit(1);
});
