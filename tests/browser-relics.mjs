// 遗物升级 UI：Ⅰ→Ⅱ 展示、升级生效、补位奖励展示与应用。
import { startTestServer, launchBrowser, chooseFirstMap } from './harness.mjs';

async function main() {
  const server = await startTestServer();
  let browser = null;
  try {
    browser = await launchBrowser({ base: server.base, name: 'rtd-relics' });

    await browser.evaluate(`document.querySelector('#btn-play').click()`);
    await browser.waitFor(`!!document.querySelector('.difficulty-modal')`, '难度弹窗');
    await browser.evaluate(`document.querySelector('.diff-card[data-id="roam"]').click()`);
    await chooseFirstMap(browser);

    await browser.evaluate(`window.__rtd.state.sim.addRelic('sharp')`);

    const offers = [
      { kind: 'relic', id: 'sharp', fromLevel: 1, toLevel: 2 },
      { kind: 'gold', amount: 120 },
      { kind: 'repair', amount: 2 },
    ];
    await browser.evaluate(`
      (() => {
        window.__rtd.state.currentOffers = ${JSON.stringify(offers)};
        window.__rtd.ui.showDraft({
          wave: 2,
          offers: ${JSON.stringify(offers)},
          rerolls: { used: 0, max: 1 },
          gold: 150,
        });
      })()
    `);
    await browser.waitFor(`!!document.querySelector('.draft-modal')`, '遗物弹窗');

    const text = await browser.evaluate(`document.querySelector('.draft-modal').textContent`);
    for (const needle of ['Ⅰ → Ⅱ', '当前', '升级', '金币补给', '基地修复']) {
      if (!text.includes(needle)) throw new Error(`遗物卡片缺少文案：${needle}`);
    }
    if (!text.includes('25%') || !text.includes('40%')) {
      throw new Error(`升级前后效果未展示：${text.slice(0, 200)}`);
    }

    await browser.evaluate(`document.querySelectorAll('.relic-card')[0].click()`);
    await browser.waitFor(`!document.querySelector('.modal')`, '升级选择完成');
    const upgraded = await browser.evaluate(`({
      level: window.__rtd.state.sim.getRelicLevel('sharp'),
      chips: document.querySelectorAll('.relic-chip').length,
      chipText: document.querySelector('.relic-chip')?.textContent || '',
    })`);
    if (upgraded.level !== 2) throw new Error(`遗物未升级到Ⅱ级：${upgraded.level}`);
    if (!upgraded.chipText.includes('Ⅱ')) throw new Error('遗物栏未显示等级');

    // 补位奖励：金币选择
    const goldBefore = await browser.evaluate(`Math.floor(window.__rtd.state.sim.gold)`);
    const fallbackOffers = [
      { kind: 'gold', amount: 90 },
      { kind: 'repair', amount: 1 },
      { kind: 'gold', amount: 180 },
    ];
    await browser.evaluate(`
      (() => {
        window.__rtd.state.currentOffers = ${JSON.stringify(fallbackOffers)};
        window.__rtd.ui.showDraft({
          wave: 3,
          offers: ${JSON.stringify(fallbackOffers)},
          rerolls: { used: 1, max: 1 },
          gold: ${goldBefore},
        });
      })()
    `);
    await browser.waitFor(`!!document.querySelector('.draft-modal')`, '补位弹窗');
    await browser.evaluate(`document.querySelectorAll('.relic-card')[0].click()`);
    await browser.waitFor(`!document.querySelector('.modal')`, '补位选择完成');
    const goldAfter = await browser.evaluate(`Math.floor(window.__rtd.state.sim.gold)`);
    if (goldAfter !== goldBefore + 90) {
      throw new Error(`金币补位未生效：${goldBefore} -> ${goldAfter}`);
    }

    if (browser.pageErrors.length) {
      throw new Error(`控制台错误：${browser.pageErrors.join(' | ')}`);
    }

    console.log('[relics] 通过');
    console.log(JSON.stringify({ upgraded, goldBefore, goldAfter }, null, 2));
  } finally {
    if (browser) await browser.close();
    await server.stop();
  }
}

main().catch((error) => {
  console.error(`\n[relics] FAIL: ${error.message || error}`);
  process.exit(1);
});
