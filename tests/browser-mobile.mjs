// 手机端验收：登录、竖屏提示、横屏无遮挡、选图弹窗、多入口触控建塔。
import {
  startTestServer,
  launchBrowser,
  registerAndLogin,
} from './harness.mjs';

const OUT_DIR = process.env.OUT_DIR || '/tmp';
const TEST_SEED = 'ux-1';
const SEED_SCRIPT = `
  (() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      const headers = new Headers(init.headers || {});
      headers.set('x-test-seed', '${TEST_SEED}');
      return originalFetch(input, { ...init, headers });
    };
  })();
`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 选择入口数最多的候选地图（固定种子下包含三入口地图）。
async function chooseMultiEntryMap(browser) {
  await browser.waitFor(`!!document.querySelector('.map-modal')`, '地图选择弹窗');
  return browser.evaluate(`(() => {
    const cards = [...document.querySelectorAll('.map-card')];
    let best = cards[0];
    for (const card of cards) {
      const count = parseInt(card.querySelector('.map-portals').textContent, 10);
      if (count > parseInt(best.querySelector('.map-portals').textContent, 10)) best = card;
    }
    const index = Number(best.dataset.index);
    const count = parseInt(best.querySelector('.map-portals').textContent, 10);
    best.click();
    return { index, count };
  })()`);
}

async function main() {
  const server = await startTestServer({ seedHeader: true });
  const session = await registerAndLogin(server.base);
  let browser = null;
  try {
    browser = await launchBrowser({
      base: server.base,
      name: 'rtd-mobile',
      initScript: SEED_SCRIPT,
      cookie: session.rawCookie,
    });
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
    await browser.waitFor(`!!document.querySelector('.map-modal')`, '地图选择弹窗');
    // 竖屏选图弹窗：卡片可读、在视口内、可滚动到第三张。
    const portraitMapModal = await browser.evaluate(`(() => {
      const modal = document.querySelector('.map-modal');
      const cards = [...document.querySelectorAll('.map-card')].map((card) => {
        const rect = card.getBoundingClientRect();
        const style = getComputedStyle(card.querySelector('.map-desc'));
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, fontSize: parseFloat(style.fontSize) };
      });
      return {
        modalRect: modal.getBoundingClientRect().toJSON(),
        scrollHeight: modal.scrollHeight,
        clientHeight: modal.clientHeight,
        cards,
        iw: innerWidth,
        ih: innerHeight,
      };
    })()`);
    if (portraitMapModal.cards.length !== 3) throw new Error('竖屏选图卡片数量异常');
    for (const card of portraitMapModal.cards) {
      if (card.left < 0 || card.right > portraitMapModal.iw + 1) throw new Error('竖屏选图卡片横向溢出');
      if (card.bottom <= card.top) throw new Error('竖屏选图卡片无高度');
      if (card.fontSize < 10) throw new Error(`竖屏选图文字过小：${card.fontSize}`);
    }
    if (portraitMapModal.scrollHeight <= portraitMapModal.clientHeight) {
      throw new Error('竖屏三张地图未启用滚动布局');
    }
    await browser.screenshot(`${OUT_DIR}/rtd-mobile-00-map-select.png`);
    const chosenMap = await chooseMultiEntryMap(browser);
    if (chosenMap.count < 2) throw new Error(`未选中多入口地图：${JSON.stringify(chosenMap)}`);
    await browser.waitFor(`!!(window.__rtd && window.__rtd.state.sim)`, '地图加载完成');
    const mapSetup = await browser.evaluate(`({
      spawns: window.__rtd.state.sim.map.spawns.length,
      lanes: window.__rtd.state.sim.lanes.length,
      index: window.__rtd.state.sim.map.index,
    })`);
    if (mapSetup.spawns < 2 || mapSetup.lanes !== mapSetup.spawns) {
      throw new Error(`移动端多入口地图未正确加载：${JSON.stringify(mapSetup)}`);
    }
    await sleep(300);

    const hint = await browser.evaluate(`(() => {
      const el = document.querySelector('#rotate-hint');
      return { display: getComputedStyle(el).display, rect: el.getBoundingClientRect().toJSON() };
    })()`);
    if (hint.display !== 'flex' || hint.rect.width < 300) {
      throw new Error(`竖屏提示未显示：${JSON.stringify(hint)}`);
    }
    await browser.screenshot(`${OUT_DIR}/rtd-mobile-01-portrait-hint.png`);

    if (await browser.evaluate(`!!document.querySelector('#btn-rotate-continue')`)) {
      throw new Error('竖屏提示仍允许手动继续');
    }

    // 模拟设备旋转到横屏；真实设备由系统旋转 + 自动锁定完成
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
        hint: getComputedStyle(document.querySelector('#rotate-hint')).display,
      };
    })()`);
    if (landscape.hint !== 'none') throw new Error('横屏后提示未隐藏');
    if (landscape.sw > landscape.iw + 1) throw new Error('横屏出现横向溢出');
    if (landscape.sh > landscape.ih + 1) throw new Error('横屏出现纵向溢出');
    if (landscape.canvasTop < landscape.hudBottom - 1) throw new Error('横屏画布盖住 HUD');
    if (landscape.canvasBottom > landscape.shopTop + 1) throw new Error('横屏画布压住商店');
    if (landscape.canvasWidth < 380 || landscape.canvasHeight < 200) {
      throw new Error(`横屏画布过小：${landscape.canvasWidth}x${landscape.canvasHeight}`);
    }
    await browser.screenshot(`${OUT_DIR}/rtd-mobile-02-landscape.png`);

    // 设置与遗物弹窗（横屏）
    await browser.evaluate(`document.querySelector('#btn-settings-game').click()`);
    await browser.waitFor(`!!document.querySelector('.settings-modal')`, '设置弹窗');
    const settingsRect = await browser.evaluate(
      `document.querySelector('.settings-modal').getBoundingClientRect().toJSON()`
    );
    if (settingsRect.left < 0 || settingsRect.right > 845 || settingsRect.bottom > 391) {
      throw new Error(`设置弹窗超出横屏：${JSON.stringify(settingsRect)}`);
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
    const builtMap = await browser.evaluate(`({
      spawns: window.__rtd.state.sim.map.spawns.length,
      towers: window.__rtd.state.sim.towers.map((t) => [t.type, t.c, t.r]),
      hintHidden: document.querySelector('#portal-hint')?.hidden,
      portalChips: document.querySelectorAll('#portal-hint .portal-chip').length,
    })`);
    if (builtMap.spawns < 2) throw new Error('触控建塔未发生在多入口地图');
    if (builtMap.hintHidden || builtMap.portalChips !== builtMap.spawns) {
      throw new Error(`横屏 HUD 入口提示异常：${JSON.stringify(builtMap)}`);
    }
    await browser.screenshot(`${OUT_DIR}/rtd-mobile-05-landscape.png`);

    // 右下角技能按钮：触控尺寸达标、不被面板遮挡、可点释放并显示冷却。
    await browser.evaluate(`document.querySelector('#btn-next-wave').click()`);
    await browser.waitFor(`window.__rtd.state.sim.phase === 'wave'`, '移动端开波');
    const skillTarget = await browser.evaluate(`(() => {
      const btn = document.getElementById('btn-skill');
      const sim = window.__rtd.state.sim;
      const rect = btn.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      return {
        hidden: btn.hidden,
        skill: sim.skill ? sim.skill.id : null,
        width: rect.width,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        iw: innerWidth,
        ih: innerHeight,
        x: cx,
        y: cy,
        hitOk: !!hit?.closest('#btn-skill'),
        pointerEvents: getComputedStyle(btn).pointerEvents,
      };
    })()`);
    if (!skillTarget.skill) throw new Error('移动端本局未携带技能');
    if (skillTarget.hidden) throw new Error('移动端技能按钮未显示');
    if (skillTarget.width < 48 || skillTarget.height < 48) {
      throw new Error(`移动端技能按钮过小：${skillTarget.width}x${skillTarget.height}`);
    }
    if (skillTarget.left < 0 || skillTarget.right > skillTarget.iw + 1 || skillTarget.bottom > skillTarget.ih + 1) {
      throw new Error(`移动端技能按钮超出视口：${JSON.stringify(skillTarget)}`);
    }
    if (!skillTarget.hitOk) throw new Error('移动端技能按钮被其他面板遮挡');
    if (skillTarget.pointerEvents === 'none') throw new Error('移动端技能按钮不可点击');

    await tap(skillTarget.x, skillTarget.y);
    await browser.waitFor(
      `(() => { const s = window.__rtd.state.sim; return s.skillCastCount === 1 && s.skill.cooldown > 0; })()`,
      '移动端触摸释放技能',
      5000
    );
    const mobileSkill = await browser.evaluate(`(() => {
      const sim = window.__rtd.state.sim;
      const btn = document.getElementById('btn-skill');
      return {
        casts: sim.skillCastCount,
        cooldown: sim.skill.cooldown,
        state: btn.dataset.state,
        count: document.getElementById('skill-count').textContent,
      };
    })()`);
    if (!(mobileSkill.cooldown > 0)) throw new Error('移动端技能冷却未开始');
    if (!mobileSkill.count) throw new Error('移动端冷却秒数未显示');
    await browser.screenshot(`${OUT_DIR}/rtd-mobile-07-skill.png`);

    // 横屏选图弹窗：三张卡与“放弃本局”按钮需在首屏内可读可点。
    await browser.evaluate(`document.querySelector('#btn-quit').click()`);
    await browser.waitFor(`!!document.querySelector('.confirm-modal')`, '退出确认');
    await browser.evaluate(`document.querySelector('#btn-confirm-yes').click()`);
    await browser.waitFor(`document.getElementById('title-screen').hidden === false`, '返回标题');
    await browser.evaluate(`document.querySelector('#btn-play').click()`);
    await browser.waitFor(`!!document.querySelector('.difficulty-modal')`, '难度弹窗（横屏）');
    await browser.evaluate(`document.querySelector('.diff-card[data-id="roam"]').click()`);
    await browser.waitFor(`!!document.querySelector('.map-modal')`, '地图选择弹窗（横屏）');
    const landscapeMapModal = await browser.evaluate(`(() => {
      const modal = document.querySelector('.map-modal');
      const cards = [...document.querySelectorAll('.map-card')].map((card) => {
        const r = card.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height };
      });
      const cancel = document.querySelector('#btn-cancel-map').getBoundingClientRect();
      return { cards, cancel: cancel.toJSON(), iw: innerWidth, ih: innerHeight, scrollTop: modal.scrollTop };
    })()`);
    for (const card of landscapeMapModal.cards) {
      if (card.left < 0 || card.right > landscapeMapModal.iw + 1) {
        throw new Error(`横屏选图卡片横向溢出：${JSON.stringify(card)}`);
      }
      if (card.top < 0 || card.bottom > landscapeMapModal.ih + 1) {
        throw new Error(`横屏选图卡片超出首屏：${JSON.stringify(card)}`);
      }
    }
    if (landscapeMapModal.cancel.bottom > landscapeMapModal.ih + 1) {
      throw new Error(`横屏“放弃本局”按钮不可见：${JSON.stringify(landscapeMapModal.cancel)}`);
    }
    await browser.screenshot(`${OUT_DIR}/rtd-mobile-06-map-select-landscape.png`);
    await browser.evaluate(`document.querySelector('#btn-cancel-map').click()`);
    await browser.waitFor(`!document.querySelector('.map-modal')`, '放弃后关闭选图弹窗');
    await browser.waitFor(`document.getElementById('title-screen').hidden === false`, '放弃后返回标题');

    if (browser.pageErrors.length) {
      throw new Error(`控制台错误：${browser.pageErrors.join(' | ')}`);
    }
    console.log('[mobile] 通过');
    console.log(JSON.stringify({
      hint,
      settingsRect,
      landscape,
      chosenMap,
      mapSetup,
      target,
      towers,
      builtMap,
      skillTarget,
      mobileSkill,
      landscapeMapModal,
    }, null, 2));
  } finally {
    if (browser) await browser.close();
    await server.stop();
  }
}

main().catch((error) => {
  console.error(`\n[mobile] FAIL: ${error.message || error}`);
  process.exit(1);
});
