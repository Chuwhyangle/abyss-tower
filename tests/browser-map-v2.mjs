// 地图 v2 验收：三张固定图开局三选一 + 免费可破坏物点击拆除 + 状态变化与刷新保持。
// 使用隔离服务端；地图几何与布点从 shared/maps 推导，不写死坐标以外的东西。
import assert from 'node:assert/strict';
import {
  startTestServer,
  launchBrowser,
  registerAndLogin,
  chooseOpeningHex,
} from './harness.mjs';
import { generateMapCandidates } from '../public/js/shared/mapgen.js';
import { DESTRUCTIBLE_BY_ID } from '../public/js/shared/destructibles.js';

const OUT_DIR = process.env.OUT_DIR || '/tmp';
const EXPECTED = generateMapCandidates('map-v2', 3);
const FREE_CACHE_NAME = DESTRUCTIBLE_BY_ID.cache.name;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function openMapModal(browser) {
  await browser.evaluate(`document.querySelector('#btn-play').click()`);
  await browser.waitFor(`!!document.querySelector('.difficulty-modal')`, '难度弹窗');
  await browser.evaluate(`document.querySelector('.diff-card[data-id="roam"]').click()`);
  await chooseOpeningHex(browser);
  await browser.waitFor(`!!document.querySelector('.map-modal')`, '地图选择弹窗');
}

async function readCards(browser) {
  return browser.evaluate(`(() => {
    const cards = [...document.querySelectorAll('.map-card')].map((card) => ({
      index: Number(card.dataset.index),
      mapId: card.dataset.mapId || null,
      title: card.querySelector('.map-card-head b')?.textContent.trim(),
      portalText: card.querySelector('.map-portals')?.textContent.trim(),
      traitName: card.querySelector('.map-mod b')?.textContent.trim(),
      traitDesc: card.querySelector('.map-mod span')?.textContent.trim(),
      polylines: card.querySelectorAll('polyline').length,
    }));
    return {
      count: cards.length,
      cards,
      candidates: (window.__rtd.state.mapCandidates || []).map((item) => ({
        id: item.id,
        name: item.name,
        portals: item.spawns.length,
      })),
    };
  })()`);
}

async function selectMap(browser, index) {
  await browser.evaluate(`document.querySelector('.map-card[data-index="${index}"]').click()`);
  await browser.waitFor(`!!(window.__rtd && window.__rtd.state.sim)`, '地图加载');
  await browser.waitFor(`document.getElementById('game-screen').hidden === false`, '战斗界面');
  await sleep(150);
  return browser.evaluate(`(() => {
    const sim = window.__rtd.state.sim;
    return {
      id: sim.map.id,
      archetype: sim.map.archetype,
      portals: sim.map.spawns.length,
      lanes: sim.lanes.length,
      gold: sim.gold,
      baseHp: sim.baseHp,
      maxBaseHp: sim.maxBaseHp,
      phase: sim.phase,
      destructibles: sim.destructibles.map((item) => ({
        id: item.id,
        type: item.type,
        c: item.c,
        r: item.r,
        destroyed: item.destroyed,
        cost: item.cost,
      })),
    };
  })()`);
}

// 点击画布上的格子中心：与 renderer.screenToTile 使用同一套坐标换算。
async function clickTile(browser, c, r) {
  return browser.evaluate(`(() => {
    const sim = window.__rtd.state.sim;
    const canvas = document.querySelector('#game-canvas');
    const rect = canvas.getBoundingClientRect();
    const clientX = rect.left + (((${c}) + 0.5) / sim.map.cols) * rect.width;
    const clientY = rect.top + (((${r}) + 0.5) / sim.map.rows) * rect.height;
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX, clientY }));
    return { clientX, clientY };
  })()`);
}

async function abandonAndReset(browser) {
  const abandoned = await browser.evaluate(`(async () => {
    const token = localStorage.getItem('abyss-tower.token');
    const headers = { 'x-player-token': token };
    const active = await fetch('/api/runs/active', { headers }).then((res) => res.json()).catch(() => null);
    const id = active?.run?.id || null;
    if (id) await fetch('/api/runs/' + id + '/abandon', { method: 'POST', headers });
    localStorage.removeItem('abyss-tower.snapshot.v2');
    localStorage.removeItem('abyss-tower.mapselect.v1');
    return id;
  })()`);
  await browser.send('Page.reload', { ignoreCache: true });
  await browser.waitBoot();
  await browser.waitFor(
    `document.getElementById('title-screen') && document.getElementById('title-screen').hidden === false`,
    '放弃后回到标题'
  );
  return abandoned;
}

async function main() {
  assert.equal(EXPECTED.length, 3, '固定地图池必须恰好三张');
  assert.deepEqual(
    EXPECTED.map((map) => map.id),
    ['canyon', 'twin', 'ring'],
    '固定地图顺序必须为 canyon → twin → ring'
  );

  const server = await startTestServer();
  const session = await registerAndLogin(server.base);
  let browser = null;
  try {
    browser = await launchBrowser({
      base: server.base,
      name: 'rtd-map-v2',
      cookie: session.rawCookie,
      width: 1440,
      height: 1000,
    });

    // ---------- 1. 开局三选一：三张固定图同时出现，顺序/入口/固定特性一致 ----------
    await openMapModal(browser);
    const modal = await readCards(browser);
    assert.equal(modal.count, 3, '选图弹窗应有三张卡片');
    assert.equal(modal.candidates.length, 3, '页面候选数据应有三张');
    modal.cards.forEach((card, index) => {
      const expected = EXPECTED[index];
      assert.equal(card.index, index, `卡片 ${index} 索引`);
      assert.equal(card.mapId, expected.id, `卡片 ${index} 固定地图 id`);
      assert.equal(card.title, expected.name, `卡片 ${index} 固定地图名`);
      assert.equal(card.portalText, `${expected.spawns.length} 入口`, `卡片 ${index} 入口数`);
      assert.equal(
        card.traitName,
        expected.modifier?.name || '无固定特性',
        `卡片 ${index} 固定特性名`
      );
      assert.equal(
        card.traitDesc,
        expected.modifier?.desc || '标准规则，无额外修正',
        `卡片 ${index} 固定特性说明`
      );
      assert.equal(card.polylines, expected.lanes.length, `卡片 ${index} 预览路径数`);
      assert.deepEqual(
        { id: modal.candidates[index].id, portals: modal.candidates[index].portals },
        { id: expected.id, portals: expected.spawns.length },
        `页面候选 ${index} 与服务端固定图不一致`
      );
    });
    await browser.screenshot(`${OUT_DIR}/rtd-map-v2-01-select.png`);

    // ---------- 2. 选第一张（裂谷关隘）：开局状态与布点 ----------
    const canyon = await selectMap(browser, 0);
    assert.equal(canyon.id, EXPECTED[0].id, '选中的不是裂谷关隘');
    assert.equal(canyon.portals, EXPECTED[0].spawns.length);
    assert.equal(canyon.lanes, EXPECTED[0].lanes.length);
    assert.equal(canyon.phase, 'prep', '开局应处于整备阶段');
    assert.deepEqual(
      canyon.destructibles.map((item) => item.type),
      EXPECTED[0].destructibles.map((item) => item.type),
      '固定可破坏物类型与地图数据不一致'
    );

    // ---------- 3. 点击免费物件（补给箱）：确认面板 → 拆除 → 状态变化 ----------
    const cache = canyon.destructibles.find((item) => item.type === 'cache');
    assert.ok(cache, '裂谷关隘缺少补给箱（免费物件）');
    assert.equal(cache.destroyed, false, '补给箱开局应存活');
    const before = await browser.evaluate(`(() => {
      const sim = window.__rtd.state.sim;
      const item = sim.destructibles.find((entry) => entry.id === '${cache.id}');
      const visual = window.__rtd.state.app.renderer.destructibleRenderer
        .visuals()
        .find((entry) => entry.id === '${cache.id}');
      return {
        gold: sim.gold,
        baseHp: sim.baseHp,
        maxBaseHp: sim.maxBaseHp,
        canBuild: sim.canBuild(${cache.c}, ${cache.r}),
        visualState: visual?.state || null,
      };
    })()`);
    assert.equal(before.canBuild, false, '存活物件所在格不应可建造');
    assert.equal(before.visualState, 'alive', '渲染层未把补给箱标记为存活');

    await clickTile(browser, cache.c, cache.r);
    await browser.waitFor(`!!document.querySelector('.destructible-modal')`, '可破坏物确认面板');
    const panel = await browser.evaluate(`(() => {
      const modal = document.querySelector('.destructible-modal');
      return {
        title: modal.querySelector('.destructible-title')?.textContent.trim(),
        facts: [...modal.querySelectorAll('.destructible-fact')].map((el) => el.textContent.trim()),
        buttons: [...modal.querySelectorAll('button')].map((el) => el.textContent.trim()),
      };
    })()`);
    assert.ok(panel.title.includes(FREE_CACHE_NAME), `确认面板标题缺少物件名：${panel.title}`);
    assert.ok(
      panel.facts.some((text) => text.includes('免费')),
      `确认面板未标出免费：${panel.facts.join(' / ')}`
    );
    await browser.screenshot(`${OUT_DIR}/rtd-map-v2-02-destructible-panel.png`);

    await browser.evaluate(`document.querySelector('#btn-destructible-yes').click()`);
    await browser.waitFor(`!document.querySelector('.destructible-modal')`, '拆除后关闭面板');
    await browser.waitFor(
      `window.__rtd.state.sim.destructibles.find((entry) => entry.id === '${cache.id}').destroyed === true`,
      '物件拆除状态落盘'
    );
    const after = await browser.evaluate(`(() => {
      const sim = window.__rtd.state.sim;
      const item = sim.destructibles.find((entry) => entry.id === '${cache.id}');
      const visual = window.__rtd.state.app.renderer.destructibleRenderer
        .visuals()
        .find((entry) => entry.id === '${cache.id}');
      const snapshot = JSON.parse(localStorage.getItem('abyss-tower.snapshot.v2') || 'null');
      return {
        destroyed: item.destroyed,
        gold: sim.gold,
        baseHp: sim.baseHp,
        maxBaseHp: sim.maxBaseHp,
        canBuild: sim.canBuild(${cache.c}, ${cache.r}),
        destructibleAt: sim.destructibleAt(${cache.c}, ${cache.r}),
        visualState: visual?.state || null,
        saved: snapshot?.destructibles?.destroyed || [],
      };
    })()`);
    assert.equal(after.destroyed, true, '补给箱未标记为已拆除');
    assert.equal(
      after.gold,
      before.gold + 25 - cache.cost,
      `拆除补给箱后的金币不正确：${before.gold} → ${after.gold}`
    );
    assert.equal(
      after.baseHp,
      Math.min(before.maxBaseHp, before.baseHp + 1),
      `拆除补给箱后的基地生命不正确：${before.baseHp} → ${after.baseHp}`
    );
    assert.equal(after.canBuild, true, '拆除后原格应恢复可建造');
    assert.equal(after.destructibleAt, null, '拆除后该格不应再命中物件');
    assert.equal(after.visualState, 'ruined', '渲染层未把已拆物件切到废墟态');
    assert.ok(after.saved.includes(cache.id), `快照未记录已拆物件：${after.saved.join(',')}`);
    await browser.screenshot(`${OUT_DIR}/rtd-map-v2-03-destroyed.png`);

    // 再点一次：已拆物件不再响应，不应弹出确认面板。
    await clickTile(browser, cache.c, cache.r);
    await sleep(250);
    const reopened = await browser.evaluate(`!!document.querySelector('.destructible-modal')`);
    assert.equal(reopened, false, '已拆物件再次点击仍弹出确认面板');

    // ---------- 4. 刷新续玩：拆除状态保持 ----------
    await browser.send('Page.reload', { ignoreCache: true });
    await browser.waitBoot();
    await browser.waitFor(`document.getElementById('btn-resume').hidden === false`, '继续按钮');
    await browser.evaluate(`document.querySelector('#btn-resume').click()`);
    await browser.waitFor(`!!(window.__rtd && window.__rtd.state.sim)`, '续玩加载');
    await browser.waitFor(`document.getElementById('game-screen').hidden === false`, '续玩进入战场');
    const resumed = await browser.evaluate(`(() => {
      const sim = window.__rtd.state.sim;
      const item = sim.destructibles.find((entry) => entry.id === '${cache.id}');
      return {
        mapId: sim.map.id,
        destroyed: item.destroyed,
        canBuild: sim.canBuild(${cache.c}, ${cache.r}),
      };
    })()`);
    assert.equal(resumed.mapId, canyon.id, '续玩后地图变化');
    assert.equal(resumed.destroyed, true, '刷新后续玩，已拆物件复活');
    assert.equal(resumed.canBuild, true, '续玩后原格应保持可建造');
    await browser.screenshot(`${OUT_DIR}/rtd-map-v2-04-resume.png`);

    // ---------- 5. 另两张固定图同样可从开局三选一进入 ----------
    for (const [index, expected] of [[1, EXPECTED[1]], [2, EXPECTED[2]]]) {
      await abandonAndReset(browser);
      await openMapModal(browser);
      const selected = await selectMap(browser, index);
      assert.equal(selected.id, expected.id, `选择第 ${index + 1} 张图后地图 id 不正确`);
      assert.equal(selected.portals, expected.spawns.length, `第 ${index + 1} 张图入口数不正确`);
      assert.equal(selected.lanes, expected.lanes.length, `第 ${index + 1} 张图 lane 数不正确`);
      assert.equal(selected.phase, 'prep', `第 ${index + 1} 张图开局阶段不正确`);
      await browser.screenshot(`${OUT_DIR}/rtd-map-v2-0${index + 5}-${expected.id}.png`);
    }

    if (browser.pageErrors.length) {
      throw new Error(`控制台错误：${browser.pageErrors.join(' | ')}`);
    }
    console.log('[map-v2] 通过');
    console.log(
      JSON.stringify(
        {
          maps: EXPECTED.map((map) => ({
            id: map.id,
            name: map.name,
            portals: map.spawns.length,
            trait: map.modifier?.id || null,
          })),
          canyon: { id: canyon.id, gold: before.gold, cache: cache.id },
          destroyed: {
            id: cache.id,
            goldGain: after.gold - before.gold,
            baseHp: `${before.baseHp}→${after.baseHp}`,
            canBuild: after.canBuild,
            persisted: resumed.destroyed,
          },
        },
        null,
        2
      )
    );
  } finally {
    if (browser) await browser.close();
    await server.stop();
  }
}

main().catch((error) => {
  console.error(`\n[map-v2] FAIL: ${error.message || error}`);
  process.exit(1);
});
