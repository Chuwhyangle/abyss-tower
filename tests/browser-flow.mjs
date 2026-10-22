// 端到端流程：建塔 → 开波 → 波中刷新续玩重放 → 清波三选一 → 退出 → 排行榜/商店 → 结算。
// 使用隔离服务端、临时数据库与独立 Chrome 配置。
import fs from 'node:fs';
import path from 'node:path';
import { startTestServer, launchBrowser } from './harness.mjs';

const OUT_DIR = process.env.OUT_DIR || '/tmp';

async function main() {
  const server = await startTestServer();
  let browser = null;
  try {
    browser = await launchBrowser({ base: server.base, name: 'rtd-flow' });

    // 开局与预建三塔
    await browser.evaluate(`document.querySelector('#btn-play').click()`);
    await browser.waitFor(`!!document.querySelector('.difficulty-modal')`, '难度弹窗');
    await browser.evaluate(`document.querySelector('.diff-card[data-id="roam"]').click()`);
    await browser.waitFor(`!!(window.__rtd && window.__rtd.state.sim)`, '模拟创建');
    await browser.waitFor(`document.getElementById('game-screen').hidden === false`, '战斗界面');

    const built = await browser.evaluate(`
      (() => {
        const sim = window.__rtd.state.sim;
        const map = sim.map;
        const cells = [];
        for (const p of map.pathCells) {
          for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            const c = p.c + dc, r = p.r + dr;
            if (map.buildable[r]?.[c] && !sim.towerAt(c, r) && !cells.some(x => x.c === c && x.r === r)) {
              cells.push({ c, r });
            }
            if (cells.length >= 3) break;
          }
          if (cells.length >= 3) break;
        }
        const types = ['arrow', 'cannon', 'frost'];
        cells.forEach((cell, i) => sim.placeTower(types[i], cell.c, cell.r));
        return { towers: sim.towers.length, cells };
      })()
    `);
    if (built.towers !== 3) throw new Error(`预建塔失败：${built.towers}`);

    const preWave = await browser.evaluate(`
      (() => {
        const sim = window.__rtd.state.sim;
        return {
          wave: sim.wave,
          clearedWave: sim.clearedWave,
          gold: Math.floor(sim.gold),
          hp: Math.ceil(sim.baseHp),
          towers: sim.towers.length,
          relics: sim.relics.length,
        };
      })()
    `);

    // 开始第 1 波，等敌人出现后刷新
    await browser.evaluate(`document.querySelector('.speed-btn[data-speed="3"]').click()`);
    await browser.evaluate(`document.querySelector('#btn-next-wave').click()`);
    await browser.waitFor(
      `window.__rtd.state.sim.phase === 'wave' && window.__rtd.state.sim.enemies.length > 0`,
      '第 1 波敌人出现',
      20000
    );
    const duringWave = await browser.evaluate(`
      (() => {
        const sim = window.__rtd.state.sim;
        return { wave: sim.wave, clearedWave: sim.clearedWave, enemies: sim.enemies.length };
      })()
    `);
    await browser.screenshot(path.join(OUT_DIR, 'rtd-flow-01-midwave.png'));

    await browser.send('Page.reload', { ignoreCache: true });
    await browser.waitBoot();
    await browser.waitFor(`document.getElementById('btn-resume').hidden === false`, '继续按钮');
    await browser.evaluate(`document.querySelector('#btn-resume').click()`);
    await browser.waitFor(`!!(window.__rtd && window.__rtd.state.sim)`, '续玩加载');
    await browser.waitFor(`document.getElementById('game-screen').hidden === false`, '续玩进入战场');

    const resumed = await browser.evaluate(`
      (() => {
        const sim = window.__rtd.state.sim;
        return {
          wave: sim.wave,
          clearedWave: sim.clearedWave,
          phase: sim.phase,
          gold: Math.floor(sim.gold),
          hp: Math.ceil(sim.baseHp),
          towers: sim.towers.length,
          relics: sim.relics.length,
        };
      })()
    `);
    if (resumed.clearedWave !== 0) throw new Error(`续玩已清波次错误：${JSON.stringify(resumed)}`);
    if (resumed.wave !== 0 || resumed.phase !== 'prep') {
      throw new Error(`续玩未回到波前整备：${JSON.stringify(resumed)}`);
    }
    if (resumed.towers !== preWave.towers) throw new Error('塔未正确恢复');
    if (resumed.gold !== preWave.gold) {
      throw new Error(`金币未正确恢复：preWave=${preWave.gold} after=${resumed.gold}`);
    }
    if (resumed.hp !== preWave.hp) throw new Error('基地生命未正确恢复');
    if (resumed.relics !== preWave.relics) throw new Error('遗物未正确恢复');
    await browser.screenshot(path.join(OUT_DIR, 'rtd-flow-02-resume.png'));

    // 重开：必须是第 1 波，不能跳到第 2 波
    await browser.evaluate(`document.querySelector('#btn-next-wave').click()`);
    await browser.waitFor(`window.__rtd.state.sim.phase === 'wave'`, '重放波次开始');
    const replay = await browser.evaluate(`({
      wave: window.__rtd.state.sim.wave,
      clearedWave: window.__rtd.state.sim.clearedWave,
    })`);
    if (replay.wave !== 1) throw new Error(`续玩跳波：wave=${replay.wave}`);

    // 清波后进入三选一
    await browser.waitFor(`!!document.querySelector('.relic-card')`, '三选一弹窗', 90000);
    const beforeDraft = await browser.evaluate(`({
      wave: window.__rtd.state.sim.wave,
      clearedWave: window.__rtd.state.sim.clearedWave,
      pending: window.__rtd.state.sim.pendingDraft,
    })`);
    if (beforeDraft.clearedWave !== 1) throw new Error('清波未推进已清波次');
    if (!beforeDraft.pending) throw new Error('待选遗物状态未记录');
    await browser.screenshot(path.join(OUT_DIR, 'rtd-flow-03-draft.png'));

    // 必选弹窗期间，设置入口不得覆盖遗物选择
    await browser.evaluate(`document.querySelector('#btn-settings-game').click()`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const modalGuard = await browser.evaluate(`({
      settings: !!document.querySelector('.settings-modal'),
      draft: !!document.querySelector('.draft-modal'),
    })`);
    if (modalGuard.settings || !modalGuard.draft) {
      throw new Error('设置弹窗覆盖了必选的遗物选择');
    }

    // 遗物选择中刷新：续玩应恢复同一组选项
    const offersBeforeReload = await browser.evaluate(
      `[...document.querySelectorAll('.relic-card')].map(card => card.dataset.index)`
    );
    await browser.send('Page.reload', { ignoreCache: true });
    await browser.waitBoot();
    await browser.waitFor(`document.getElementById('btn-resume').hidden === false`, '继续按钮（选遗物）');
    await browser.evaluate(`document.querySelector('#btn-resume').click()`);
    await browser.waitFor(`!!document.querySelector('.draft-modal')`, '恢复遗物选择', 20000);
    const restoredDraft = await browser.evaluate(`({
      pending: window.__rtd.state.sim.pendingDraft,
      cards: document.querySelectorAll('.relic-card').length,
      relics: window.__rtd.state.sim.relics.length,
      clearedWave: window.__rtd.state.sim.clearedWave,
    })`);
    if (!restoredDraft.pending || restoredDraft.cards !== 3) {
      throw new Error(`遗物选择未恢复：${JSON.stringify(restoredDraft)}`);
    }
    if (restoredDraft.relics !== 0 || restoredDraft.clearedWave !== 1) {
      throw new Error(`恢复状态不一致：${JSON.stringify(restoredDraft)}`);
    }
    if (offersBeforeReload.length !== restoredDraft.cards) {
      throw new Error('恢复后的选项数量与刷新前不一致');
    }

    await browser.evaluate(`document.querySelector('.relic-card').click()`);
    await browser.waitFor(`!document.querySelector('.modal')`, '三选一关闭');
    const afterPick = await browser.evaluate(`({
      relics: window.__rtd.state.sim.relics,
      pending: window.__rtd.state.sim.pendingDraft,
      saved: !!localStorage.getItem('abyss-tower.snapshot.v2'),
    })`);
    if (afterPick.relics.length !== 1) throw new Error('遗物未加入');
    if (afterPick.pending) throw new Error('遗物选择状态未清除');
    if (!afterPick.saved) throw new Error('波次快照未写入');

    // 带遗物再次开波并刷新：遗物等级/已清波次需保持一致，重放第 2 波而非跳到第 3 波
    await browser.evaluate(`document.querySelector('.speed-btn[data-speed="3"]').click()`);
    await browser.evaluate(`document.querySelector('#btn-next-wave').click()`);
    await browser.waitFor(
      `window.__rtd.state.sim.phase === 'wave' && window.__rtd.state.sim.enemies.length > 0`,
      '第 2 波敌人出现',
      20000
    );
    await browser.send('Page.reload', { ignoreCache: true });
    await browser.waitBoot();
    await browser.waitFor(`document.getElementById('btn-resume').hidden === false`, '继续按钮（第 2 波）');
    await browser.evaluate(`document.querySelector('#btn-resume').click()`);
    await browser.waitFor(`!!(window.__rtd && window.__rtd.state.sim)`, '续玩（第 2 波）');
    const withRelic = await browser.evaluate(`({
      wave: window.__rtd.state.sim.wave,
      clearedWave: window.__rtd.state.sim.clearedWave,
      relics: window.__rtd.state.sim.relics,
    })`);
    if (withRelic.clearedWave !== 1 || withRelic.wave !== 1) {
      throw new Error(`带遗物续玩波次错误：${JSON.stringify(withRelic)}`);
    }
    if (withRelic.relics.length !== 1 || withRelic.relics[0].level !== 1) {
      throw new Error(`带遗物续玩遗物状态错误：${JSON.stringify(withRelic.relics)}`);
    }
    await browser.evaluate(`document.querySelector('#btn-next-wave').click()`);
    await browser.waitFor(`window.__rtd.state.sim.phase === 'wave'`, '重放第 2 波');
    const replay2 = await browser.evaluate(`window.__rtd.state.sim.wave`);
    if (replay2 !== 2) throw new Error(`带遗物续玩跳波：wave=${replay2}`);

    // 退出远征
    await browser.evaluate(`document.querySelector('#btn-quit').click()`);
    await browser.waitFor(`!!document.querySelector('.confirm-modal')`, '退出确认');
    await browser.evaluate(`document.querySelector('#btn-confirm-yes').click()`);
    await browser.waitFor(`document.getElementById('title-screen').hidden === false`, '返回标题页');

    // 排行榜与商店
    await browser.evaluate(`document.querySelector('#btn-board').click()`);
    await browser.waitFor(`!!document.querySelector('.board-modal')`, '排行榜弹窗');
    const board = await browser.evaluate(`({
      tabs: document.querySelectorAll('.board-modal .tab').length,
      rows: document.querySelectorAll('.board-modal .board-row').length,
    })`);
    if (board.tabs !== 2) throw new Error('排行榜标签异常');
    await browser.screenshot(path.join(OUT_DIR, 'rtd-flow-04-board.png'));
    await browser.evaluate(`document.querySelector('#btn-close-board').click()`);
    await browser.waitFor(`!document.querySelector('.modal')`, '排行榜关闭');

    await browser.evaluate(`document.querySelector('#btn-shop').click()`);
    await browser.waitFor(`!!document.querySelector('.unlock-modal')`, '星核商店');
    const unlockRows = await browser.evaluate(`document.querySelectorAll('.unlock-row').length`);
    if (unlockRows !== 6) throw new Error(`解锁项数量异常：${unlockRows}`);
    await browser.screenshot(path.join(OUT_DIR, 'rtd-flow-05-shop.png'));
    await browser.evaluate(`document.querySelector('#btn-close-unlocks').click()`);
    await browser.waitFor(`!document.querySelector('.modal')`, '商店关闭');

    // 新局触发失败结算
    await browser.evaluate(`document.querySelector('#btn-play').click()`);
    await browser.waitFor(`!!document.querySelector('.difficulty-modal')`, '难度弹窗（第二局）');
    await browser.evaluate(`document.querySelector('.diff-card[data-id="roam"]').click()`);
    await browser.waitFor(`!!(window.__rtd && window.__rtd.state.sim)`, '第二局模拟');
    await browser.evaluate(`document.querySelector('#btn-next-wave').click()`);
    await browser.waitFor(`window.__rtd.state.sim.phase === 'wave'`, '第二局波次开始');
    await browser.evaluate(`
      (() => {
        const sim = window.__rtd.state.sim;
        sim.baseHp = 0;
        sim.update(1 / 60);
      })()
    `);
    await browser.waitFor(`!!document.querySelector('.result-modal')`, '结算弹窗', 20000);
    const resultText = await browser.evaluate(`document.querySelector('.result-modal').textContent`);
    if (!resultText.includes('最终得分')) throw new Error(`结算文案异常：${resultText.slice(0, 120)}`);
    await browser.screenshot(path.join(OUT_DIR, 'rtd-flow-06-result.png'));

    await browser.evaluate(`document.querySelector('#btn-home').click()`);
    await browser.waitFor(`document.getElementById('title-screen').hidden === false`, '结算返回大厅');

    if (browser.pageErrors.length) {
      throw new Error(`控制台错误：${browser.pageErrors.join(' | ')}`);
    }

    console.log('[flow] 通过');
    console.log(JSON.stringify({
      built, preWave, duringWave, resumed, replay, beforeDraft, modalGuard,
      restoredDraft, afterPick, withRelic, replay2, board, unlockRows,
    }, null, 2));
  } finally {
    if (browser) await browser.close();
    await server.stop();
  }
}

main().catch((error) => {
  console.error(`\n[flow] FAIL: ${error.message || error}`);
  process.exit(1);
});
