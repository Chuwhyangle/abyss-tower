// 地图 v2 体验验收：三选一弹窗/预览、放弃与刷新恢复、多入口渲染与 HUD、汇流几何。
// 使用隔离服务端 + 固定测试种子，确保同时覆盖单入口、双入口与三入口地图。
import assert from 'node:assert/strict';
import { startTestServer, launchBrowser } from './harness.mjs';
import { generateMapCandidates } from '../public/js/shared/mapgen.js';

const OUT_DIR = process.env.OUT_DIR || '/tmp';
const TEST_SEED = 'ux-1';
const SERVER_SEED = `test-${TEST_SEED}`;
const EXPECTED = generateMapCandidates(SERVER_SEED, 3);
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

function fingerprint(candidate) {
  return {
    archetype: candidate.archetype,
    portals: candidate.spawns.length,
    modifier: candidate.modifier?.id || null,
    scoreMul: candidate.meta?.scoreMul,
    lanes: candidate.lanes.length,
  };
}

async function openMapModal(browser) {
  await browser.evaluate(`document.querySelector('#btn-play').click()`);
  await browser.waitFor(`!!document.querySelector('.difficulty-modal')`, '难度弹窗');
  await browser.evaluate(`document.querySelector('.diff-card[data-id="roam"]').click()`);
  await browser.waitFor(`!!document.querySelector('.map-modal')`, '地图选择弹窗');
}

async function readMapModal(browser) {
  return browser.evaluate(`(() => {
    const modal = document.querySelector('.map-modal');
    const cards = [...document.querySelectorAll('.map-card')].map((card) => {
      const svg = card.querySelector('svg');
      const circles = [...svg.querySelectorAll('circle')];
      const polylines = [...svg.querySelectorAll('polyline')];
      const rect = card.getBoundingClientRect();
      const modalRect = modal.getBoundingClientRect();
      return {
        index: Number(card.dataset.index),
        portalText: card.querySelector('.map-portals')?.textContent.trim(),
        desc: card.querySelector('.map-desc')?.textContent.trim(),
        scoreText: card.querySelector('.map-foot')?.textContent.trim(),
        modifierName: card.querySelector('.map-mod b')?.textContent.trim(),
        modifierDesc: card.querySelector('.map-mod span')?.textContent.trim(),
        polylines: polylines.map((line) => ({
          stroke: line.getAttribute('stroke'),
          points: line.getAttribute('points'),
        })),
        circles: circles.map((circle) => ({
          fill: circle.getAttribute('fill'),
          cx: Number(circle.getAttribute('cx')),
          cy: Number(circle.getAttribute('cy')),
        })),
        polygons: svg.querySelectorAll('polygon, path, image').length,
        cardRect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
        insideModal:
          rect.left >= modalRect.left - 1 &&
          rect.right <= modalRect.right + 1 &&
          rect.top >= modalRect.top - 1 &&
          rect.bottom <= modalRect.bottom + 1,
      };
    });
    return {
      count: cards.length,
      cards,
      stateCandidates: window.__rtd.state.mapCandidates?.map((item, index) => ({
        index,
        archetype: item.archetype,
        portals: item.spawns.length,
        modifier: item.modifier?.id || null,
        scoreMul: item.meta?.scoreMul,
        lanes: item.lanes.length,
        laneColors: item.lanes.map((lane) => lane.color),
        spawnColors: item.spawns.map((spawn) => spawn.color),
      })),
    };
  })()`);
}

function assertModalMatchesCandidates(modal, expected) {
  assert.equal(modal.count, expected.length, '候选卡片数量');
  assert.equal(modal.stateCandidates.length, expected.length, '页面候选数据数量');
  expected.forEach((candidate, index) => {
    const card = modal.cards[index];
    const stateCandidate = modal.stateCandidates[index];
    assert.deepEqual(fingerprint(candidate), {
      archetype: stateCandidate.archetype,
      portals: stateCandidate.portals,
      modifier: stateCandidate.modifier,
      scoreMul: stateCandidate.scoreMul,
      lanes: stateCandidate.lanes,
    }, `候选 ${index} 与服务端生成不一致`);

    assert.equal(card.portalText, `${candidate.spawns.length} 入口`, `卡片 ${index} 入口数文案`);
    assert.equal(card.polylines.length, candidate.lanes.length, `卡片 ${index} 预览路径数`);
    assert.equal(card.circles.length, candidate.spawns.length + 1, `卡片 ${index} 预览入口+基地数`);
    assert.equal(card.polygons, 0, `卡片 ${index} 预览不应包含岩石/其它图形`);
    assert.ok(card.insideModal, `卡片 ${index} 超出弹窗`);
    assert.ok(card.cardRect.right > card.cardRect.left && card.cardRect.bottom > card.cardRect.top);

    card.polylines.forEach((line, laneIndex) => {
      assert.equal(line.stroke, candidate.lanes[laneIndex].color, `卡片 ${index} 路径颜色`);
      assert.ok(line.points.split(' ').length >= 2, `卡片 ${index} 路径点数`);
    });
    candidate.spawns.forEach((spawn, spawnIndex) => {
      assert.equal(card.circles[spawnIndex].fill, spawn.color, `卡片 ${index} 入口配色`);
    });
    assert.equal(card.circles.at(-1).fill, '#4fd8c8', `卡片 ${index} 基地标记`);

    if (candidate.spawns.length <= 1) {
      assert.ok(card.desc.includes('单路推进'), `单入口卡片 ${index} 不应显示汇流文案：${card.desc}`);
    } else if (candidate.archetype === 'cross') {
      assert.ok(card.desc.includes('二次分配'), `交叉回廊卡片 ${index} 文案`);
    } else {
      assert.ok(card.desc.includes('汇流'), `多入口卡片 ${index} 文案`);
    }
    assert.ok(card.scoreText.includes(`×${candidate.meta.scoreMul.toFixed(2)}`), `卡片 ${index} 分数`);
    assert.equal(card.modifierName, candidate.modifier?.name || '无词缀', `卡片 ${index} 词缀名`);
    assert.equal(card.modifierDesc, candidate.modifier?.desc || '标准地图', `卡片 ${index} 词缀说明`);
  });
}

async function readRunStatus(browser, runId) {
  return browser.evaluate(`(async () => {
    const token = localStorage.getItem('abyss-tower.token');
    const res = await fetch('/api/runs/${runId}', { headers: { 'x-player-token': token } });
    let body = null;
    try { body = await res.json(); } catch { /* ignore */ }
    return { status: res.status, runStatus: body?.run?.status || null, mapChoice: body?.run?.mapChoice };
  })()`);
}

async function main() {
  const server = await startTestServer({ seedHeader: true });
  let browser = null;
  try {
    assert.equal(EXPECTED.length, 3);
    assert.ok(EXPECTED.some((item) => item.spawns.length === 1), '固定种子需包含单入口地图');
    assert.ok(EXPECTED.some((item) => item.spawns.length === 3), '固定种子需包含三入口地图');

    browser = await launchBrowser({
      base: server.base,
      name: 'rtd-map',
      initScript: SEED_SCRIPT,
      width: 1440,
      height: 1000,
    });

    // ---------- 1. 三选一弹窗：预览、文案、入口数 ----------
    await openMapModal(browser);
    const modalBefore = await readMapModal(browser);
    assertModalMatchesCandidates(modalBefore, EXPECTED);
    await browser.screenshot(`${OUT_DIR}/rtd-map-01-select.png`);

    // ---------- 2. 放弃本局：关闭弹窗、删除待选记录、服务端远征作废 ----------
    const pendingBeforeCancel = await browser.evaluate(
      `JSON.parse(localStorage.getItem('abyss-tower.mapselect.v1'))`
    );
    assert.ok(pendingBeforeCancel?.runId, '选图阶段应记录待选远征');
    await browser.evaluate(`document.querySelector('#btn-cancel-map').click()`);
    await browser.waitFor(`!document.querySelector('.map-modal')`, '放弃后关闭选图弹窗');
    await browser.waitFor(`document.getElementById('title-screen').hidden === false`, '放弃后返回标题');
    const afterCancel = await browser.evaluate(`({
      modal: !!document.querySelector('.map-modal'),
      pending: localStorage.getItem('abyss-tower.mapselect.v1'),
      snapshot: localStorage.getItem('abyss-tower.snapshot.v2'),
    })`);
    assert.equal(afterCancel.modal, false, '放弃后弹窗未关闭');
    assert.equal(afterCancel.pending, null, '放弃后待选记录未清理');
    assert.equal(afterCancel.snapshot, null, '放弃后不应留下快照');
    const cancelledRun = await readRunStatus(browser, pendingBeforeCancel.runId);
    assert.ok(
      cancelledRun.status === 409 || cancelledRun.runStatus !== 'active',
      `放弃后远征仍为 active：${JSON.stringify(cancelledRun)}`
    );
    await browser.screenshot(`${OUT_DIR}/rtd-map-02-cancelled.png`);

    // ---------- 3. 选图阶段刷新：恢复同一远征与同一组候选 ----------
    await openMapModal(browser);
    const beforeReload = await readMapModal(browser);
    const pendingBeforeReload = await browser.evaluate(
      `JSON.parse(localStorage.getItem('abyss-tower.mapselect.v1'))`
    );
    assert.ok(pendingBeforeReload?.runId);
    await browser.send('Page.reload', { ignoreCache: true });
    await browser.waitBoot();
    await browser.waitFor(`!!document.querySelector('.map-modal')`, '刷新后恢复选图弹窗');
    const afterReload = await readMapModal(browser);
    assertModalMatchesCandidates(afterReload, EXPECTED);
    const pendingAfterReload = await browser.evaluate(
      `JSON.parse(localStorage.getItem('abyss-tower.mapselect.v1'))`
    );
    assert.equal(pendingAfterReload.runId, pendingBeforeReload.runId, '刷新后远征 ID 变化');
    assert.deepEqual(
      afterReload.cards.map((card) => `${card.portalText}|${card.modifierName}`),
      beforeReload.cards.map((card) => `${card.portalText}|${card.modifierName}`),
      '刷新后候选地图变化'
    );
    await browser.screenshot(`${OUT_DIR}/rtd-map-03-restored-select.png`);

    // ---------- 4. 选择三入口地图：地图、塔位、HUD 入口提示 ----------
    const tripleIndex = EXPECTED.findIndex((item) => item.spawns.length === 3);
    await browser.evaluate(`document.querySelector('.map-card[data-index="${tripleIndex}"]').click()`);
    await browser.waitFor(`!!(window.__rtd && window.__rtd.state.sim)`, '地图加载');
    await browser.waitFor(`document.getElementById('game-screen').hidden === false`, '战斗界面');
    await sleep(250);

    const game = await browser.evaluate(`(() => {
      const sim = window.__rtd.state.sim;
      const states = window.__rtd.state.app.renderer.portalStates();
      return {
        mapIndex: sim.map.index,
        archetype: sim.map.archetype,
        portals: sim.map.spawns.length,
        lanes: sim.lanes.length,
        laneColors: sim.lanes.map((lane) => lane.color),
        spawnColors: sim.map.spawns.map((spawn) => spawn.color),
        base: { x: sim.map.base.x, y: sim.map.base.y },
        laneEnds: sim.lanes.map((lane) => lane.pts[lane.pts.length - 1]),
        laneStarts: sim.lanes.map((lane) => lane.pts[0]),
        activePortals: sim.activePortals.slice(),
        portalStates: states,
        chipCount: document.querySelectorAll('#portal-hint .portal-chip').length,
        chipIdle: document.querySelectorAll('#portal-hint .portal-chip.idle').length,
        chipLabel: document.querySelector('#portal-hint .portal-label')?.textContent,
        hintHidden: document.querySelector('#portal-hint')?.hidden,
        pending: localStorage.getItem('abyss-tower.mapselect.v1'),
        saved: !!localStorage.getItem('abyss-tower.snapshot.v2'),
      };
    })()`);
    assert.equal(game.mapIndex, tripleIndex, '选中的地图索引不正确');
    assert.equal(game.archetype, EXPECTED[tripleIndex].archetype);
    assert.equal(game.portals, 3, '三入口地图入口数');
    assert.equal(game.lanes, 3, '三入口地图 lane 数');
    assert.deepEqual(game.laneColors, EXPECTED[tripleIndex].lanes.map((lane) => lane.color));
    assert.deepEqual(game.spawnColors, EXPECTED[tripleIndex].spawns.map((spawn) => spawn.color));
    game.laneEnds.forEach((point) => {
      assert.equal(point.x, game.base.x, '路径未抵达基地 x');
      assert.equal(point.y, game.base.y, '路径未抵达基地 y');
    });
    game.laneStarts.forEach((point, index) => {
      assert.equal(point.x, EXPECTED[tripleIndex].spawns[index].x, '路径起点不是入口 x');
      assert.equal(point.y, EXPECTED[tripleIndex].spawns[index].y, '路径起点不是入口 y');
    });
    assert.deepEqual(game.activePortals, [], '整备阶段不应有激活入口');
    assert.ok(game.portalStates.every((state) => state.active && !state.dimmed), '整备阶段入口应全部常态');
    assert.equal(game.chipCount, 3, 'HUD 入口提示数量');
    assert.equal(game.chipIdle, 0, '整备阶段 HUD 入口不应变暗');
    assert.equal(game.chipLabel, '入口');
    assert.equal(game.hintHidden, false, 'HUD 入口提示未显示');
    assert.equal(game.pending, null, '开局后待选记录未清理');
    assert.equal(game.saved, true, '开局后未写入快照');

    // 汇流几何：每条 lane 都经过汇流点，且共享主干连续、轴对齐。
    const geometry = await browser.evaluate(`(() => {
      const sim = window.__rtd.state.sim;
      const lanes = sim.lanes.map((lane) => lane.pts);
      const cells = sim.map.lanes.map((lane) => lane.cells);
      const merge = sim.map.meta.merge;
      const onPolyline = (pts, x, y) => {
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1];
          const b = pts[i];
          const cross = (x - a.x) * (b.y - a.y) - (y - a.y) * (b.x - a.x);
          if (Math.abs(cross) > 1e-9) continue;
          if (x < Math.min(a.x, b.x) - 1e-9 || x > Math.max(a.x, b.x) + 1e-9) continue;
          if (y < Math.min(a.y, b.y) - 1e-9 || y > Math.max(a.y, b.y) + 1e-9) continue;
          return true;
        }
        return false;
      };
      const mergeX = merge.c + 0.5;
      const mergeY = merge.r + 0.5;
      const containsMerge = lanes.map((pts) => onPolyline(pts, mergeX, mergeY));
      const cellsMerge = cells.map((item) =>
        item.some((cell) => cell.c === merge.c && cell.r === merge.r)
      );
      const aligned = lanes.every((pts) =>
        pts.every((p, i) => i === 0 || p.x === pts[i - 1].x || p.y === pts[i - 1].y)
      );
      let suffix = 0;
      const minLen = Math.min(...cells.map((item) => item.length));
      while (
        suffix < minLen &&
        cells.every(
          (item) =>
            item[item.length - 1 - suffix].c === cells[0][cells[0].length - 1 - suffix].c &&
            item[item.length - 1 - suffix].r === cells[0][cells[0].length - 1 - suffix].r
        )
      ) suffix++;
      return { merge, containsMerge, cellsMerge, aligned, suffix };
    })()`);
    assert.ok(geometry.containsMerge.every(Boolean), `汇流点不在每条路径上：${JSON.stringify(geometry)}`);
    assert.ok(geometry.cellsMerge.every(Boolean), `汇流点不在每条 lane 的格子中：${JSON.stringify(geometry)}`);
    assert.ok(geometry.aligned, '路径存在斜线段');
    assert.ok(geometry.suffix >= 2, `汇流后未共享连续主干：${geometry.suffix}`);

    // 放置一座塔，随后验证刷新续玩。
    const built = await browser.evaluate(`(() => {
      const sim = window.__rtd.state.sim;
      const map = sim.map;
      for (const cell of map.pathCells) {
        for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const c = cell.c + dc, r = cell.r + dr;
          if (map.buildable[r]?.[c] && sim.placeTower('arrow', c, r)) {
            return { c, r, towers: sim.towers.length };
          }
        }
      }
      return { c: null, r: null, towers: sim.towers.length };
    })()`);
    assert.equal(built.towers, 1, '三入口地图无法建塔');
    await browser.evaluate(`window.__rtd.state.app.emitHud(true)`);
    await browser.screenshot(`${OUT_DIR}/rtd-map-04-triple-map.png`);

    // ---------- 5. 多入口波次：激活入口、变暗、HUD、出生 lane ----------
    const portalWave = await browser.evaluate(`(async () => {
      const { generateWave } = await import('/js/shared/waves.js');
      const sim = window.__rtd.state.sim;
      const ui = window.__rtd.ui;
      const app = window.__rtd.state.app;
      app.setPaused(true);
      sim.opts.onWaveClear = null;
      sim.opts.onGameOver = null;
      sim.opts.onSave = null;
      sim.phase = 'prep';
      sim.enemies = [];
      sim.waveDef = null;
      sim.activePortals = [];
      const early = generateWave(sim.seed, 3, sim.difficulty, sim.mapMeta);
      sim.beginWave(early);
      const queuePortals = [...new Set(sim.spawnQueue.map((item) => item.portal))];
      const earlyStates = app.renderer.portalStates();
      ui.updateHud(sim.getHud());
      const earlyChips = document.querySelectorAll('#portal-hint .portal-chip').length;
      const earlyIdle = document.querySelectorAll('#portal-hint .portal-chip.idle').length;
      const earlyLabel = document.querySelector('#portal-hint .portal-label')?.textContent;
      const earlyChipTexts = [...document.querySelectorAll('#portal-hint .portal-chip')].map((chip) =>
        chip.textContent.trim()
      );
      const spawned = [];
      for (let lane = 0; lane < sim.lanes.length; lane++) {
        sim.spawnEnemy('grunt', lane);
        const enemy = sim.enemies[sim.enemies.length - 1];
        spawned.push({
          lane: enemy.lane,
          x: enemy.x,
          y: enemy.y,
          spawn: sim.map.spawns[lane],
        });
      }
      return {
        earlyPortals: early.portals,
        active: sim.activePortals.slice(),
        queuePortals,
        earlyStates,
        earlyChips,
        earlyIdle,
        earlyLabel,
        earlyChipTexts,
        spawned,
      };
    })()`);
    assert.equal(portalWave.earlyPortals.length, 1, '第 3 波应只激活一个入口');
    assert.deepEqual(portalWave.active, portalWave.earlyPortals, '激活入口与波次计划不一致');
    assert.ok(
      portalWave.queuePortals.every((portal) => portalWave.earlyPortals.includes(portal)),
      `出怪入口超出本波激活入口：${JSON.stringify(portalWave)}`
    );
    assert.equal(portalWave.earlyStates.filter((state) => state.active).length, 1);
    assert.equal(portalWave.earlyStates.filter((state) => state.dimmed).length, 2, '非激活入口未变暗');
    assert.equal(portalWave.earlyChips, 3, 'HUD 应显示全部入口');
    assert.equal(portalWave.earlyIdle, 2, 'HUD 非激活入口未变暗');
    assert.equal(portalWave.earlyLabel, '本波入口');
    assert.deepEqual(
      portalWave.earlyStates.map((state) => state.label),
      [1, 2, 3],
      '传送门编号'
    );
    assert.deepEqual(portalWave.earlyChipTexts, ['1', '2', '3'], 'HUD 传送门编号');
    portalWave.spawned.forEach((item, lane) => {
      assert.equal(item.lane, lane, '敌人 lane 绑定错误');
      assert.equal(item.x, item.spawn.x, `lane ${lane} 出生 x 错误`);
      assert.equal(item.y, item.spawn.y, `lane ${lane} 出生 y 错误`);
    });
    await browser.screenshot(`${OUT_DIR}/rtd-map-05-single-portal-wave.png`);

    const allPortalWave = await browser.evaluate(`(async () => {
      const { generateWave } = await import('/js/shared/waves.js');
      const sim = window.__rtd.state.sim;
      const ui = window.__rtd.ui;
      const app = window.__rtd.state.app;
      sim.phase = 'prep';
      sim.enemies = [];
      sim.waveDef = null;
      sim.activePortals = [];
      const late = generateWave(sim.seed, 25, sim.difficulty, sim.mapMeta);
      sim.beginWave(late);
      const queuePortals = [...new Set(sim.spawnQueue.map((item) => item.portal))];
      const states = app.renderer.portalStates();
      ui.updateHud(sim.getHud());
      for (let lane = 0; lane < sim.lanes.length; lane++) sim.spawnEnemy('grunt', lane);
      return {
        portals: late.portals,
        active: sim.activePortals.slice(),
        queuePortals,
        states,
        idle: document.querySelectorAll('#portal-hint .portal-chip.idle').length,
        chips: document.querySelectorAll('#portal-hint .portal-chip').length,
        enemies: sim.enemies.map((enemy) => enemy.lane),
      };
    })()`);
    assert.equal(allPortalWave.portals.length, 3, '第 25 波应激活全部入口');
    assert.deepEqual(allPortalWave.active, [0, 1, 2], '第 25 波激活入口错误');
    assert.ok(allPortalWave.queuePortals.every((portal) => portal >= 0 && portal <= 2));
    assert.ok(allPortalWave.states.every((state) => state.active && !state.dimmed), '全入口波仍有入口变暗');
    assert.equal(allPortalWave.idle, 0, '全入口波 HUD 不应有变暗入口');
    assert.equal(allPortalWave.chips, 3);
    assert.deepEqual(allPortalWave.enemies, [0, 1, 2], '敌人未按 lane 出生');
    await sleep(300);
    await browser.screenshot(`${OUT_DIR}/rtd-map-06-all-portals-wave.png`);

    // ---------- 6. 选图后刷新续玩：地图与塔位恢复 ----------
    const beforeResume = await browser.evaluate(`(() => {
      const sim = window.__rtd.state.sim;
      return {
        mapIndex: sim.map.index,
        portals: sim.map.spawns.length,
        towers: sim.towers.map((tower) => [tower.type, tower.c, tower.r]),
      };
    })()`);
    await browser.send('Page.reload', { ignoreCache: true });
    await browser.waitBoot();
    await browser.waitFor(`document.getElementById('btn-resume').hidden === false`, '继续按钮');
    await browser.evaluate(`document.querySelector('#btn-resume').click()`);
    await browser.waitFor(`!!(window.__rtd && window.__rtd.state.sim)`, '续玩加载');
    await browser.waitFor(`document.getElementById('game-screen').hidden === false`, '续玩进入战场');
    const resumed = await browser.evaluate(`(() => {
      const sim = window.__rtd.state.sim;
      return {
        mapIndex: sim.map.index,
        portals: sim.map.spawns.length,
        laneEnds: sim.lanes.map((lane) => lane.pts[lane.pts.length - 1]),
        base: { x: sim.map.base.x, y: sim.map.base.y },
        towers: sim.towers.map((tower) => [tower.type, tower.c, tower.r]),
        pending: localStorage.getItem('abyss-tower.mapselect.v1'),
      };
    })()`);
    assert.equal(resumed.mapIndex, beforeResume.mapIndex, '续玩地图索引不一致');
    assert.equal(resumed.portals, beforeResume.portals, '续玩地图入口数不一致');
    assert.deepEqual(resumed.towers, beforeResume.towers, '续玩塔位不一致');
    resumed.laneEnds.forEach((point) => {
      assert.equal(point.x, resumed.base.x);
      assert.equal(point.y, resumed.base.y);
    });
    assert.equal(resumed.pending, null, '续玩后残留待选记录');
    await browser.screenshot(`${OUT_DIR}/rtd-map-07-resume.png`);

    if (browser.pageErrors.length) {
      throw new Error(`控制台错误：${browser.pageErrors.join(' | ')}`);
    }
    console.log('[map] 通过');
    console.log(JSON.stringify({
      candidates: EXPECTED.map(fingerprint),
      tripleIndex,
      geometry,
      built,
      early: { portals: portalWave.earlyPortals, idle: portalWave.earlyIdle, states: portalWave.earlyStates },
      late: { portals: allPortalWave.portals, enemies: allPortalWave.enemies },
      resumed,
    }, null, 2));
  } finally {
    if (browser) await browser.close();
    await server.stop();
  }
}

main().catch((error) => {
  console.error(`\n[map] FAIL: ${error.message || error}`);
  process.exit(1);
});
