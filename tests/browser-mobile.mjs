// 手机端验收：登录、竖屏提示、横屏无遮挡、选图弹窗、多入口触控建塔。
import {
  startTestServer,
  launchBrowser,
  registerAndLogin,
  chooseOpeningHex,
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
    // 无头 Chrome 里 requestFullscreen / orientation.lock 会让渲染进程主线程挂起（CDP 停摆）。
    // 移动端验收用 CDP 视口模拟控制横竖屏，不依赖真实全屏/方向锁定，故在本环境降级为 no-op。
    Element.prototype.requestFullscreen = () => Promise.resolve();
    try {
      Object.defineProperty(screen, 'orientation', {
        value: { lock: () => Promise.resolve(), unlock: () => {} },
        configurable: true,
      });
    } catch {
      /* screen.orientation 只读的环境忽略 */
    }
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
    await chooseOpeningHex(browser);
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

    // AC-1：塔卡在移动端直接显示伤害/射程/对空对地，无需悬浮提示。
    const cardStats = await browser.evaluate(`(() => {
      const card = document.querySelector('.tower-card[data-type="arrow"]');
      const stats = card.querySelector('.stats');
      const hint = document.querySelector('.shop-scroll-hint');
      return {
        statsText: stats ? stats.textContent : null,
        statsDisplay: stats ? getComputedStyle(stats).display : null,
        hintText: hint ? hint.textContent : null,
        hintDisplay: hint ? getComputedStyle(hint).display : null,
      };
    })()`);
    if (!cardStats.statsText || cardStats.statsDisplay === 'none') {
      throw new Error('移动端塔卡未显示属性行');
    }
    if (
      !/伤害/.test(cardStats.statsText) ||
      !/射程/.test(cardStats.statsText) ||
      !/对空/.test(cardStats.statsText)
    ) {
      throw new Error(`塔卡属性行文案缺失：${cardStats.statsText}`);
    }
    if (!cardStats.hintText || cardStats.hintDisplay === 'none') {
      throw new Error('移动端商店缺少横滚提示');
    }

    // AC-2：下一波情报在横屏无需打开遗物抽屉即可见（挂在战场左上角）。
    const nextWaveReachable = await browser.evaluate(`(() => {
      const panel = document.getElementById('next-wave-panel');
      const rect = panel.getBoundingClientRect();
      return {
        hidden: panel.hidden,
        h: rect.height,
        inStage: !!panel.closest('.stage'),
        drawerOpen: document.querySelector('.relic-panel').classList.contains('open'),
      };
    })()`);
    if (nextWaveReachable.hidden || nextWaveReachable.h <= 0 || !nextWaveReachable.inStage) {
      throw new Error(`下一波情报横屏不可达：${JSON.stringify(nextWaveReachable)}`);
    }

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
    await browser.waitFor(`document.querySelector('.relic-panel').classList.contains('open')`, '遗物抽屉');
    const drawerInfo = await browser.evaluate(`(() => {
      const panel = document.querySelector('.relic-panel');
      // 起始遗物会排在新增遗物之前：升级效果只在对应 chip 的 data-tip 里，聚合全部 chip 再断言。
      const tips = [...panel.querySelectorAll('.relic-chip')].map((chip) => chip.dataset.tip || '').join(' ');
      const nextWave = document.querySelector('#next-wave-panel');
      const bonus = document.querySelector('#btn-bonus-summary');
      return {
        text: panel.textContent,
        tips,
        nextWaveHidden: nextWave.hidden,
        nextWaveH: nextWave.getBoundingClientRect().height,
        bonusH: bonus.getBoundingClientRect().height,
      };
    })()`);
    if (!drawerInfo.text.includes('锐利箭簇') || !drawerInfo.tips.includes('25%')) {
      throw new Error('移动端遗物抽屉内容错误');
    }
    // AC-1：下一波情报与加成一览入口也随抽屉可见，不再被 display:none 丢失。
    if (drawerInfo.nextWaveHidden || drawerInfo.nextWaveH <= 0) {
      throw new Error('移动端抽屉缺少下一波情报');
    }
    if (drawerInfo.bonusH <= 0) {
      throw new Error('移动端抽屉缺少加成一览入口');
    }
    await browser.screenshot(`${OUT_DIR}/rtd-mobile-04-relics.png`);
    await browser.evaluate(`document.querySelector('#btn-relic-collapse').click()`);
    await browser.waitFor(`!document.querySelector('.relic-panel').classList.contains('open')`, '遗物抽屉关闭');

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
      // 触屏在可破坏物吸附半径内会优先打开矿脉面板：建造格必须避开可破坏物，否则点塔建塔都会被劫持。
      const destructibles = (sim.destructibles || []).filter((d) => !d.destroyed);
      const nearDestructible = (c, r) => destructibles.some((d) => {
        const dc = d.c - c, dr = d.r - r;
        return dc * dc + dr * dr <= 1.2 * 1.2;
      });
      for (const p of map.pathCells) {
        for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const c = p.c + dc, r = p.r + dr;
          if (map.buildable[r]?.[c] && !nearDestructible(c, r)) {
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

    // 塔面板与触控目标（AC-2/AC-3）：触屏再次点塔打开面板，升级/出售/进化、倍速/暂停 ≥44px。
    await tap(target.x, target.y);
    await browser.waitFor(`!document.querySelector('#tower-panel').hidden`, '塔面板打开');
    const towerPanel = await browser.evaluate(`(() => {
      const tp = document.querySelector('#tower-panel');
      const rect = tp.getBoundingClientRect();
      const btns = [...tp.querySelectorAll('.btn')].map((b) => {
        const r = b.getBoundingClientRect();
        return { cls: b.className, w: r.width, h: r.height };
      });
      return { rect: rect.toJSON(), btns, iw: innerWidth, ih: innerHeight };
    })()`);
    if (towerPanel.btns.length < 2) throw new Error('塔面板缺少升级/出售按钮');
    for (const b of towerPanel.btns) {
      if (b.w < 44 || b.h < 44) throw new Error(`塔面板按钮触控目标不足 44px：${JSON.stringify(b)}`);
    }
    if (
      towerPanel.rect.left < 0 ||
      towerPanel.rect.right > towerPanel.iw + 1 ||
      towerPanel.rect.bottom > towerPanel.ih + 1
    ) {
      throw new Error(`塔面板超出视口：${JSON.stringify(towerPanel.rect)}`);
    }
    // 满级进化按钮同样 ≥44px
    const evolveTargets = await browser.evaluate(`(() => {
      const sim = window.__rtd.state.sim;
      const tower = sim.towers[0];
      tower.level = sim.towerMaxLevel(tower) - 1;
      window.__rtd.ui.showTowerPanel(tower);
      return [...document.querySelectorAll('#tower-panel .tp-evolution-actions .btn')].map((b) => {
        const r = b.getBoundingClientRect();
        return { cls: b.className, w: r.width, h: r.height };
      });
    })()`);
    if (!evolveTargets.length) throw new Error('满级塔面板未显示进化按钮');
    for (const b of evolveTargets) {
      if (b.w < 44 || b.h < 44) throw new Error(`进化按钮触控目标不足 44px：${JSON.stringify(b)}`);
    }
    await browser.evaluate(`window.__rtd.ui.hideTowerPanel()`);
    // 倍速与暂停按钮触控目标（AC-2）
    const speedTargets = await browser.evaluate(`(() => [...document.querySelectorAll('.speed-btn')].map((b) => {
      const r = b.getBoundingClientRect();
      return { speed: b.dataset.speed, w: r.width, h: r.height };
    }))()`);
    if (speedTargets.length < 4) throw new Error('倍速/暂停按钮数量异常');
    for (const s of speedTargets) {
      if (s.w < 44 || s.h < 44) throw new Error(`倍速/暂停触控目标不足 44px：${JSON.stringify(s)}`);
    }
    await browser.screenshot(`${OUT_DIR}/rtd-mobile-05b-tower-panel.png`);

    // 出售确认（AC-2）：点出售先弹确认框，取消不卖、确认才卖，按钮 ≥44px。
    await browser.evaluate(`window.__rtd.ui.showTowerPanel(window.__rtd.state.sim.towers[0])`);
    await browser.evaluate(`document.querySelector('#tower-panel .sell').click()`);
    await browser.waitFor(`!!document.querySelector('.confirm-modal')`, '出售确认弹窗');
    // 弹窗入场动画（scale 0.99 → 1）未结束时按钮只有 43.5px；等动画走完再量触控目标。
    await browser.waitFor(`document.getElementById('btn-confirm-yes').getBoundingClientRect().height >= 44`, '出售确认按钮入场动画结束');
    const sellConfirm = await browser.evaluate(`(() => {
      const yes = document.getElementById('btn-confirm-yes');
      const no = document.getElementById('btn-confirm-no');
      return {
        text: document.querySelector('.confirm-modal').textContent,
        yes: { w: yes.getBoundingClientRect().width, h: yes.getBoundingClientRect().height },
        no: { w: no.getBoundingClientRect().width, h: no.getBoundingClientRect().height },
      };
    })()`);
    if (sellConfirm.yes.w < 44 || sellConfirm.yes.h < 44 || sellConfirm.no.w < 44 || sellConfirm.no.h < 44) {
      throw new Error(`出售确认按钮触控目标不足 44px：${JSON.stringify(sellConfirm)}`);
    }
    await browser.evaluate(`document.getElementById('btn-confirm-no').click()`);
    if ((await browser.evaluate(`window.__rtd.state.sim.towers.length`)) !== 1) {
      throw new Error('取消出售仍卖掉了塔');
    }
    await browser.evaluate(`window.__rtd.ui.showTowerPanel(window.__rtd.state.sim.towers[0])`);
    await browser.evaluate(`document.querySelector('#tower-panel .sell').click()`);
    await browser.waitFor(`!!document.querySelector('.confirm-modal')`, '再次出售确认弹窗');
    await browser.evaluate(`document.getElementById('btn-confirm-yes').click()`);
    if ((await browser.evaluate(`window.__rtd.state.sim.towers.length`)) !== 0) {
      throw new Error('确认出售未卖掉塔');
    }
    await browser.screenshot(`${OUT_DIR}/rtd-mobile-05b2-sell-confirm.png`);

    // offer 弹窗（遗物三选一，AC-3）：三张卡在视口内可读，选卡后确定可用。
    const offers = [
      { kind: 'relic', id: 'sharp', fromLevel: 1, toLevel: 2 },
      { kind: 'gold', amount: 120 },
      { kind: 'repair', amount: 2 },
    ];
    await browser.evaluate(`(() => {
      window.__rtd.state.currentOffers = ${JSON.stringify(offers)};
      window.__rtd.ui.showDraft({ wave: 2, offers: ${JSON.stringify(offers)}, rerolls: { used: 0, max: 1 }, gold: 150 });
    })()`);
    await browser.waitFor(`!!document.querySelector('.draft-modal')`, 'offer 弹窗');
    const offerInfo = await browser.evaluate(`(() => {
      const cards = [...document.querySelectorAll('.draft-modal .relic-card')].map((c) => {
        const r = c.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height };
      });
      return { cards, iw: innerWidth, ih: innerHeight };
    })()`);
    if (offerInfo.cards.length !== 3) throw new Error('offer 弹窗卡片数量异常');
    for (const c of offerInfo.cards) {
      if (c.left < 0 || c.right > offerInfo.iw + 1 || c.top < 0 || c.bottom > offerInfo.ih + 1) {
        throw new Error(`offer 卡片超出视口：${JSON.stringify(c)}`);
      }
    }
    await browser.evaluate(`document.querySelectorAll('.draft-modal .relic-card')[0].click()`);
    if (!(await browser.evaluate(`!document.querySelector('#btn-confirm-draft').disabled`))) {
      throw new Error('offer 选卡后确定未启用');
    }
    await browser.screenshot(`${OUT_DIR}/rtd-mobile-05c-offer.png`);
    await browser.evaluate(`document.querySelector('#btn-confirm-draft').click()`);
    await browser.waitFor(`!document.querySelector('.modal')`, 'offer 选择完成');

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

    // 结算（AC-3）：开波后把基地血量归零触发失败结算，结算面板可读且可返回大厅。
    await browser.evaluate(`document.querySelector('#btn-next-wave').click()`);
    await browser.waitFor(`window.__rtd.state.sim.phase === 'wave'`, '结算开波');
    await browser.evaluate(`(() => {
      const sim = window.__rtd.state.sim;
      sim.baseHp = 0;
      sim.update(1 / 60);
    })()`);
    await browser.waitFor(`!!document.querySelector('.result-modal')`, '结算弹窗', 20000);
    const resultText = await browser.evaluate(`document.querySelector('.result-modal').textContent`);
    if (!resultText.includes('最终得分')) throw new Error(`结算文案异常：${resultText.slice(0, 120)}`);
    await browser.screenshot(`${OUT_DIR}/rtd-mobile-08-result.png`);
    await browser.evaluate(`document.querySelector('#btn-home').click()`);
    await browser.waitFor(`document.getElementById('title-screen').hidden === false`, '结算返回大厅');

    // 横屏选图弹窗：三张卡与“放弃本局”按钮需在首屏内可读可点。
    await browser.evaluate(`document.querySelector('#btn-play').click()`);
    await browser.waitFor(`!!document.querySelector('.difficulty-modal')`, '难度弹窗（横屏）');
    await browser.evaluate(`document.querySelector('.diff-card[data-id="roam"]').click()`);
    await chooseOpeningHex(browser);
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
  } finally {
    if (browser) await browser.close();
    await server.stop();
  }
}

main().catch((error) => {
  console.error(`\n[mobile] FAIL: ${error.message || error}`);
  process.exit(1);
});
