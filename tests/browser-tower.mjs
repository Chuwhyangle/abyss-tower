// 爬塔模式 · 阶段 2 集成浏览器验收：标题页入口 → 难度选择 →（无选图）开局进节点地图 →
// 第 1 层战斗节点开波（难度映射 A：波次索引 = 节点层）→ 清波遗物 → 节点地图选路 → 节点分流。
// 使用隔离服务端、临时数据库与独立 Chrome 配置。服务端三类节点分流的 API 断言见 tower-server.test.mjs，
// 这里只验收客户端集成：入口、跳过选图、tower 模式启动、难度映射、节点地图渲染与选路后的分流 UI。
import path from 'node:path';
import {
  startTestServer,
  launchBrowser,
  registerAndLogin,
} from './harness.mjs';

const OUT_DIR = process.env.OUT_DIR || '/tmp';

async function main() {
  const server = await startTestServer();
  const session = await registerAndLogin(server.base);
  let browser = null;
  try {
    browser = await launchBrowser({
      base: server.base,
      name: 'rtd-tower',
      cookie: session.rawCookie,
    });

    const bootErrors = await browser.evaluate(`window.__bootErrors || []`);
    if (bootErrors.length) throw new Error(`页面启动错误：${bootErrors.join(' | ')}`);

    // 标题页爬塔入口：排在无尽模式之后，副标题非空。
    await browser.waitFor(`!!document.querySelector('#btn-tower')`, '爬塔入口按钮');
    const towerEntry = await browser.evaluate(`
      (() => {
        const btn = document.querySelector('#btn-tower');
        const label = document.querySelector('#tower-label');
        const endless = document.querySelector('#btn-endless');
        return {
          label: label ? label.textContent.trim() : '',
          afterEndless: !!(endless && btn && (endless.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING)),
        };
      })()
    `);
    if (!towerEntry.label) throw new Error('爬塔入口副标题为空');
    if (!towerEntry.afterEndless) throw new Error('爬塔入口未排在无尽模式之后');
    await browser.screenshot(path.join(OUT_DIR, 'rtd-tower-01-entry.png'));

    // 爬塔难度弹窗：eyebrow 为 TOWER CLIMB（两语种一致，locale 无关）。
    await browser.evaluate(`document.querySelector('#btn-tower').click()`);
    await browser.waitFor(`!!document.querySelector('.difficulty-modal')`, '爬塔难度弹窗');
    const modal = await browser.evaluate(`
      (() => ({
        eyebrow: document.querySelector('.difficulty-modal .eyebrow')?.textContent?.trim() || '',
        chips: document.querySelectorAll('.difficulty-modal .skill-chip').length,
      }))()
    `);
    if (modal.eyebrow !== 'TOWER CLIMB') throw new Error(`爬塔难度弹窗 eyebrow 异常：${modal.eyebrow}`);
    if (modal.chips < 1) throw new Error('爬塔难度弹窗缺少技能条');
    await browser.screenshot(path.join(OUT_DIR, 'rtd-tower-02-difficulty.png'));

    // 选难度 → 信物 → 海克斯；爬塔无地图三选一，直接开局。
    await browser.evaluate(`document.querySelector('.diff-card[data-id="roam"]').click()`);
    await browser.waitFor(`!!document.querySelector('.starter-select')`, '信物三选一');
    await browser.evaluate(`document.querySelector('.relic-card').click()`);
    await browser.evaluate(`document.querySelector('#btn-confirm-starter').click()`);
    await browser.waitFor(`!!document.querySelector('.hex-modal')`, '海克斯三选一');
    await browser.evaluate(`document.querySelector('.hex-card').click()`);
    await browser.evaluate(`document.querySelector('#btn-confirm-hex').click()`);

    // 爬塔跳过选图：确认全程未出现地图三选一，直接进入战斗界面。
    await browser.waitFor(`document.getElementById('game-screen').hidden === false`, '爬塔战斗界面', 30000);
    const boot = await browser.evaluate(`
      (() => {
        const state = window.__rtd.state;
        const sim = state.sim;
        return {
          runMode: state.run.mode,
          simMode: sim.mode,
          node: state.run.tower?.route?.node ?? null,
          clearedWave: sim.clearedWave,
          phase: sim.phase,
          mapModal: !!document.querySelector('.map-modal'),
        };
      })()
    `);
    if (boot.mapModal) throw new Error('爬塔开局错误地弹出了地图三选一');
    if (boot.runMode !== 'tower' || boot.simMode !== 'tower') {
      throw new Error(`爬塔模式未生效：${JSON.stringify(boot)}`);
    }
    if (boot.node !== '1:0') throw new Error(`起点节点异常：${boot.node}`);
    await browser.screenshot(path.join(OUT_DIR, 'rtd-tower-03-game.png'));

    // 难度映射 A：第 1 层战斗节点开波，波次索引 = 节点层，且不带地图词缀。
    await browser.evaluate(`document.querySelector('#btn-next-wave').click()`);
    await browser.waitFor(`window.__rtd.state.sim.phase === 'wave'`, '第 1 层开波');
    const wave1 = await browser.evaluate(`
      (() => {
        const state = window.__rtd.state;
        return {
          wave: state.sim.wave,
          wavesServed: state.run.wavesServed,
          modifier: state.sim.modifier ?? null,
        };
      })()
    `);
    if (wave1.wave !== 1) throw new Error(`第 1 层波次索引异常：${wave1.wave}`);
    if (wave1.wavesServed !== 1) throw new Error(`wavesServed 未落到节点层：${wave1.wavesServed}`);
    if (wave1.modifier) throw new Error(`爬塔战斗波次不应带地图词缀：${wave1.modifier}`);

    // 快速清波：把剩余敌人斩杀并推进波末（无词缀战斗波次无 portal/分裂连锁风险）。
    await browser.evaluate(`
      (() => {
        const sim = window.__rtd.state.sim;
        sim.spawnIndex = sim.spawnQueue.length;
        for (let i = 0; i < 300 && sim.phase === 'wave'; i++) {
          for (const e of [...sim.enemies]) if (!e.dead) sim.killEnemy(e);
          sim.update(1 / 60);
        }
      })()
    `);
    // 战斗节点是唯一免费遗物来源：清波后进入遗物三选一。
    await browser.waitFor(`!!document.querySelector('.relic-card')`, '战斗节点遗物三选一', 30000);
    await browser.evaluate(`document.querySelector('.relic-card').click()`);
    await browser.evaluate(`document.querySelector('#btn-confirm-draft').click()`);

    // 选遗物后进入节点地图：30 层、当前游标仍是起点、存在可达后继。
    await browser.waitFor(`!!document.querySelector('.tower-map-modal')`, '节点地图');
    const nodeMap = await browser.evaluate(`
      (() => ({
        layers: document.querySelectorAll('.tower-layer').length,
        current: document.querySelector('.tower-node.current')?.dataset.key ?? null,
        reachable: [...document.querySelectorAll('.tower-node.reachable')].map((b) => b.dataset.key),
      }))()
    `);
    if (nodeMap.layers !== 30) throw new Error(`节点地图层数异常：${nodeMap.layers}`);
    if (nodeMap.current !== '1:0') throw new Error(`当前节点游标异常：${nodeMap.current}`);
    if (nodeMap.reachable.length < 1) throw new Error('节点地图没有可选后继');
    await browser.screenshot(path.join(OUT_DIR, 'rtd-tower-04-nodemap.png'));

    // 选路推进：按后继节点类型分流（战斗/事件/商人/精英/宝藏）。
    const chosen = nodeMap.reachable[0];
    const chosenInfo = await browser.evaluate(`
      (() => {
        const graph = window.__rtd.state.towerGraph;
        const node = graph.byKey.get(${JSON.stringify(chosen)});
        return { type: node?.type ?? null, layer: node?.layer ?? null };
      })()
    `);
    await browser.evaluate(`document.querySelector('.tower-node.reachable[data-key=${JSON.stringify(chosen)}]').click()`);

    if (chosenInfo.type === 'fight' || chosenInfo.type === 'elite') {
      await browser.waitFor(`window.__rtd.state.sim.phase === 'wave'`, '战斗节点开波');
      const dispatch = await browser.evaluate(`
        (() => {
          const state = window.__rtd.state;
          return { node: state.run.tower.route.node, wave: state.sim.wave, wavesServed: state.run.wavesServed };
        })()
      `);
      if (dispatch.node !== chosen) throw new Error(`选路游标未推进：${dispatch.node}`);
      if (dispatch.wave !== dispatch.wavesServed || dispatch.wavesServed !== chosenInfo.layer) {
        throw new Error(`难度映射 A 未按节点层开波：${JSON.stringify(dispatch)}`);
      }
    } else if (chosenInfo.type === 'event') {
      await browser.waitFor(`!!document.querySelector('.event-modal')`, '事件节点弹窗');
      await browser.evaluate(`
        (() => {
          const card = [...document.querySelectorAll('.event-modal .event-card')].find((c) => !c.disabled);
          if (card) card.click();
        })()
      `);
      await browser.waitFor(`!!document.querySelector('.tower-map-modal')`, '事件结算后返回节点地图');
      const current = await browser.evaluate(
        `document.querySelector('.tower-node.current')?.dataset.key ?? null`
      );
      if (current !== chosen) throw new Error(`事件节点游标未推进：${current}`);
    } else if (chosenInfo.type === 'merchant') {
      await browser.waitFor(`!!document.querySelector('.tower-merchant-modal')`, '商人节点弹窗');
      await browser.screenshot(path.join(OUT_DIR, 'rtd-tower-05-merchant.png'));
      await browser.evaluate(`document.querySelector('#btn-merchant-close').click()`);
      await browser.waitFor(`!!document.querySelector('.tower-map-modal')`, '商人关闭后返回节点地图');
      const current = await browser.evaluate(
        `document.querySelector('.tower-node.current')?.dataset.key ?? null`
      );
      if (current !== chosen) throw new Error(`商人节点游标未推进：${current}`);
    } else {
      // 宝藏：抵达即完成（阶段 1 无服务端端点），直接回到节点地图。
      await browser.waitFor(`!!document.querySelector('.tower-map-modal')`, '宝藏节点回到节点地图');
      const current = await browser.evaluate(
        `document.querySelector('.tower-node.current')?.dataset.key ?? null`
      );
      if (current !== chosen) throw new Error(`宝藏节点游标未推进：${current}`);
    }

    if (browser.pageErrors.length) {
      throw new Error(`控制台错误：${browser.pageErrors.join(' | ')}`);
    }

    console.log('[tower] 通过');
    console.log(JSON.stringify({
      towerEntry, modal, boot, wave1, nodeMap, chosen, chosenInfo,
    }, null, 2));
  } finally {
    if (browser) await browser.close();
    await server.stop();
  }
}

main().catch((error) => {
  console.error(`\n[tower] FAIL: ${error.message || error}`);
  process.exit(1);
});
