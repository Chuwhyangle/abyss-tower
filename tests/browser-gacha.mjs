// 抽卡页实机验收（AC：全屏抽卡页 + 三态切屏 + 出货动画 + 概率公示/历史弹窗）。
// 服务端 /api/gacha/* 由注入脚本按冻结契约模拟，聚焦前端行为：
// 三屏互斥、余额/碎片/保底刷新、单抽与十连结果、分档动画、弹窗、切屏清理、切语言刷新。
// 用法：node tests/browser-gacha.mjs（需要本机 Chrome）
import path from 'node:path';
import {
  startTestServer,
  launchBrowser,
  registerAndLogin,
} from './harness.mjs';

const OUT_DIR = process.env.OUT_DIR || '/tmp';
const CJK_RE = /[㐀-䶿一-鿿豈-﫿]/;

// 注入的假服务端：只接管 /api/gacha/*，其余请求透传，账号/会话仍走真实服务端。
const MOCK_GACHA = `(() => {
  const realFetch = window.fetch.bind(window);
  const draws = [];
  const reply = (data) =>
    Promise.resolve(
      new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
  window.__gachaState = {
    balance: 300,
    pity6: 12,
    owned: ['poison'],
    shards: { poison: 5 },
    draws,
  };
  const pool = () => ({
    currency: 'cores',
    balance: window.__gachaState.balance,
    price: { single: 15, ten: 150 },
    rates: { 6: 0.05, 5: 0.12, 4: 0.28, 3: 0.55 },
    pity6: window.__gachaState.pity6,
    owned: window.__gachaState.owned,
    shards: window.__gachaState.shards,
  });
  const TEN = [
    { towerId: 'poison', rarity: 'common', star: 3, isNew: false, shards: 5 },
    { towerId: 'shock', rarity: 'common', star: 3, isNew: true, shards: 0 },
    { towerId: 'banner', rarity: 'rare', star: 4, isNew: true, shards: 0 },
    { towerId: 'poison', rarity: 'common', star: 3, isNew: false, shards: 5 },
    { towerId: 'shock', rarity: 'common', star: 3, isNew: false, shards: 5 },
    { towerId: 'sniper', rarity: 'legendary', star: 6, isNew: true, shards: 0 },
    { towerId: 'arc', rarity: 'epic', star: 5, isNew: true, shards: 0 },
    { towerId: 'poison', rarity: 'common', star: 3, isNew: false, shards: 5 },
    { towerId: 'shock', rarity: 'common', star: 3, isNew: false, shards: 5 },
    { towerId: 'banner', rarity: 'rare', star: 4, isNew: false, shards: 10 },
  ];
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : String(input && input.url ? input.url : '');
    if (url.includes('/api/gacha/pool')) return reply(pool());
    if (url.includes('/api/gacha/draw')) {
      const body = init.body ? JSON.parse(init.body) : {};
      draws.push(body);
      if (body.count === 10) {
        window.__gachaState.balance = 135;
        window.__gachaState.pity6 = 0;
        window.__gachaState.owned = ['poison', 'shock', 'banner', 'sniper', 'arc'];
        return reply({ results: TEN, balance: 135, pity6: 0 });
      }
      window.__gachaState.balance = 285;
      window.__gachaState.pity6 = 13;
      window.__gachaState.owned = ['poison', 'arc'];
      return reply({
        results: [{ towerId: 'arc', rarity: 'epic', star: 5, isNew: true, shards: 0 }],
        balance: 285,
        pity6: 13,
      });
    }
    if (url.includes('/api/gacha/history')) {
      return reply({
        entries: [
          { tower_id: 'arc', rarity: 'epic', is_new: true, shards: 0, drawn_at: Date.now() - 60000 },
          { tower_id: 'poison', rarity: 'common', is_new: false, shards: 5, drawn_at: Date.now() - 120000 },
          { tower_id: 'sniper', rarity: 'legendary', is_new: true, shards: 0, drawn_at: Date.now() - 180000 },
        ],
      });
    }
    return realFetch(input, init);
  };
})()`;

async function click(browser, selector) {
  await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
}

async function openGacha(browser) {
  await click(browser, '#btn-gacha');
  await browser.waitFor(`document.getElementById('gacha-screen').hidden === false`, '抽卡页显示');
  await browser.waitFor(
    `document.querySelectorAll('#gacha-pool .gacha-pool-chip').length === 5`,
    '卡池加载'
  );
}

async function switchLocale(browser, locale) {
  await browser.evaluate(`document.querySelector('#btn-settings-title').click()`);
  await browser.waitFor(`!!document.querySelector('#set-locale')`, '设置面板');
  await browser.evaluate(`(() => {
    const select = document.querySelector('#set-locale');
    select.value = ${JSON.stringify(locale)};
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await browser.waitFor(
    `document.documentElement.lang === ${JSON.stringify(locale)}`,
    `切到 ${locale}`
  );
  await browser.evaluate(`document.querySelector('#settings-cancel').click()`);
  await browser.waitFor(`!document.querySelector('.settings')`, '设置面板关闭');
}

async function main() {
  const server = await startTestServer();
  const session = await registerAndLogin(server.base);
  let browser = null;
  try {
    browser = await launchBrowser({
      base: server.base,
      name: 'rtd-gacha',
      cookie: session.rawCookie,
      initScript: MOCK_GACHA,
    });
    await browser.waitFor(
      `document.getElementById('title-screen').hidden === false`,
      '标题页',
      20000
    );
    const bootErrors = await browser.evaluate(`window.__bootErrors || []`);
    if (bootErrors.length) throw new Error(`页面启动错误：${bootErrors.join(' | ')}`);
    await browser.screenshot(path.join(OUT_DIR, 'rtd-gacha-01-title.png'));

    // ---------- 三态互斥 / 入口 ----------
    await openGacha(browser);
    const screens = await browser.evaluate(`({
      title: document.getElementById('title-screen').hidden,
      game: document.getElementById('game-screen').hidden,
      gacha: document.getElementById('gacha-screen').hidden,
    })`);
    if (!screens.title || !screens.game || screens.gacha) {
      throw new Error(`三屏互斥失败：${JSON.stringify(screens)}`);
    }
    const menuBackground = await browser.evaluate(
      `window.__rtd.ui._menuBackground ? window.__rtd.ui._menuBackground.running : null`
    );
    if (menuBackground !== false) throw new Error('进抽卡页后菜单背景动画仍在运行');
    await browser.screenshot(path.join(OUT_DIR, 'rtd-gacha-02-page.png'));

    // ---------- 移动端不横向溢出 ----------
    await browser.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    const mobile = await browser.evaluate(`({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      bodyWidth: document.body.scrollWidth,
    })`);
    await browser.screenshot(path.join(OUT_DIR, 'rtd-gacha-02b-mobile.png'));
    await browser.send('Emulation.clearDeviceMetricsOverride');
    if (mobile.scrollWidth > mobile.innerWidth + 1 || mobile.bodyWidth > mobile.innerWidth + 1) {
      throw new Error(`抽卡页在移动端横向溢出：${JSON.stringify(mobile)}`);
    }

    // ---------- 余额 / 碎片 / 保底 / 价格 ----------
    const header = await browser.evaluate(`({
      cores: document.getElementById('gacha-cores').textContent,
      shards: document.getElementById('gacha-shards').textContent,
      pity: document.getElementById('gacha-pity').textContent,
      single: document.getElementById('gacha-single-price').textContent,
      ten: document.getElementById('gacha-ten-price').textContent,
      pool: [...document.querySelectorAll('#gacha-pool .gacha-pool-chip')].map((n) => n.innerText),
    })`);
    if (header.cores !== '300') throw new Error(`星核余额未刷新：${header.cores}`);
    if (!header.shards.includes('5')) throw new Error(`碎片合计未刷新：${header.shards}`);
    if (!header.pity.includes('48')) throw new Error(`保底剩余抽数不对：${header.pity}`);
    if (!header.single.includes('15') || !header.ten.includes('150')) {
      throw new Error(`单抽/十连价格不对：${header.single} / ${header.ten}`);
    }
    if (header.pool.length !== 5) throw new Error(`卡池塔数量异常：${header.pool.length}`);

    // ---------- 概率公示与接口一致 ----------
    await click(browser, '#btn-gacha-rates');
    await browser.waitFor(`!!document.querySelector('.gacha-rates')`, '概率公示弹窗');
    const rates = await browser.evaluate(`
      [...document.querySelectorAll('.gacha-rate-row')].map((row) => ({
        star: row.querySelector('.gacha-rate-star').textContent,
        value: row.querySelector('.gacha-rate-value').textContent,
      }))
    `);
    const expected = { '★★★★★★': '5%', '★★★★★': '12%', '★★★★': '28%', '★★★': '55%' };
    for (const row of rates) {
      if (expected[row.star] !== row.value) {
        throw new Error(`概率公示与 /api/gacha/pool 不一致：${row.star} → ${row.value}`);
      }
    }
    if (rates.length !== 4) throw new Error(`概率档位数量异常：${rates.length}`);
    await browser.screenshot(path.join(OUT_DIR, 'rtd-gacha-03-rates.png'));
    await click(browser, '.gacha-modal [data-gacha-close]');
    await browser.waitFor(`!document.querySelector('.gacha-rates')`, '概率公示关闭');

    // ---------- 抽卡历史（snake_case 行） ----------
    await click(browser, '#btn-gacha-history');
    await browser.waitFor(`!!document.querySelector('.gacha-history')`, '历史弹窗');
    const history = await browser.evaluate(`({
      rows: document.querySelectorAll('.gacha-history-row').length,
      text: document.querySelector('.gacha-history').innerText,
    })`);
    if (history.rows !== 3) throw new Error(`历史条数异常：${history.rows}`);
    if (!history.text.includes('狙击')) throw new Error('历史未展示塔名（snake_case 未归一化）');
    await browser.screenshot(path.join(OUT_DIR, 'rtd-gacha-04-history.png'));
    await click(browser, '.gacha-modal [data-gacha-close]');
    await browser.waitFor(`!document.querySelector('.gacha-history')`, '历史关闭');

    // ---------- 单抽：请求体 + 结果卡 + 余额刷新 ----------
    await click(browser, '#btn-gacha-single');
    await browser.waitFor(`document.querySelectorAll('.gacha-card').length === 1`, '单抽结果');
    await browser.waitFor(`!!document.querySelector('.gacha-card.revealed')`, '单抽翻开');
    const single = await browser.evaluate(`({
      star: document.querySelector('.gacha-card').dataset.star,
      rarity: document.querySelector('.gacha-card').dataset.rarity,
      cores: document.getElementById('gacha-cores').textContent,
      draw: window.__gachaState.draws[0],
    })`);
    if (single.star !== '5' || single.rarity !== 'epic') {
      throw new Error(`单抽结果卡异常：${JSON.stringify(single)}`);
    }
    if (single.cores !== '285') throw new Error(`单抽后余额未刷新：${single.cores}`);
    if (single.draw.count !== 1 || !single.draw.request_id) {
      throw new Error(`单抽请求体异常：${JSON.stringify(single.draw)}`);
    }
    await browser.screenshot(path.join(OUT_DIR, 'rtd-gacha-05-single.png'));

    // ---------- 十连：逐张翻开 + 4★+/6★ 高亮 + 全屏闪 ----------
    await browser.waitFor(`window.__rtd.ui._gachaPage.busy === false`, '单抽动画结束');
    await click(browser, '#btn-gacha-ten');
    await browser.waitFor(`document.querySelectorAll('.gacha-card').length === 10`, '十连结果');
    await browser.waitFor(
      `document.querySelectorAll('.gacha-card.pending').length === 0`,
      '十连逐张翻开完成',
      25000
    );
    await browser.waitFor(`window.__rtd.ui._gachaPage.busy === false`, '十连动画收尾');
    const ten = await browser.evaluate(`({
      stars: [...document.querySelectorAll('.gacha-card')].map((n) => n.dataset.star),
      six: document.querySelectorAll('.gacha-card[data-star="6"]').length,
      five: document.querySelectorAll('.gacha-card[data-star="5"]').length,
      four: document.querySelectorAll('.gacha-card[data-star="4"]').length,
      flash: document.getElementById('gacha-flash').classList.contains('active'),
      cores: document.getElementById('gacha-cores').textContent,
      grid: document.getElementById('gacha-result').classList.contains('gacha-result-grid'),
      draw: window.__gachaState.draws[1],
    })`);
    if (ten.stars.length !== 10) throw new Error(`十连卡数异常：${ten.stars.length}`);
    if (ten.six !== 1 || ten.five !== 1 || ten.four < 2) {
      throw new Error(`十连稀有度分布异常：6★${ten.six} 5★${ten.five} 4★${ten.four}`);
    }
    if (!ten.flash) throw new Error('6★ 出货没有触发全屏金光');
    if (!ten.grid) throw new Error('十连结果没有切换为网格布局');
    if (ten.cores !== '135') throw new Error(`十连后余额未刷新：${ten.cores}`);
    if (ten.draw.count !== 10 || !ten.draw.request_id) {
      throw new Error(`十连请求体异常：${JSON.stringify(ten.draw)}`);
    }
    const timers = await browser.evaluate(`window.__rtd.ui._gachaPage.timers.size`);
    if (timers !== 0) throw new Error(`翻牌结束后仍有孤儿计时器：${timers}`);
    await browser.screenshot(path.join(OUT_DIR, 'rtd-gacha-06-ten.png'));

    // ---------- 抽卡中途切屏：计时器必须清零 ----------
    await click(browser, '#btn-gacha-single');
    await browser.waitFor(
      `document.getElementById('gacha-result').classList.contains('gacha-result-revealing')`,
      '动画进行中'
    );
    const beforeBack = await browser.evaluate(
      `(() => {
        const page = window.__rtd.ui._gachaPage;
        const timers = page.timers.size;
        document.querySelector('#btn-gacha-back').click();
        return { timers, gachaHidden: document.getElementById('gacha-screen').hidden };
      })()`
    );
    if (beforeBack.timers === 0) throw new Error('动画期间应存在翻牌计时器');
    if (!beforeBack.gachaHidden) throw new Error('返回后抽卡页仍显示（三态翻转不对称）');
    await browser.waitFor(`document.getElementById('title-screen').hidden === false`, '返回标题页');
    const afterBack = await browser.evaluate(`({
      timers: window.__rtd.ui._gachaPage.timers.size,
      busy: window.__rtd.ui._gachaPage.busy,
    })`);
    if (afterBack.timers !== 0) throw new Error(`切屏后遗留 ${afterBack.timers} 个孤儿计时器`);
    if (afterBack.busy) throw new Error('切屏后抽卡页仍处于 busy 状态');
    await browser.screenshot(path.join(OUT_DIR, 'rtd-gacha-07-back.png'));

    // ---------- 切语言：抽卡动态文案刷新 ----------
    await openGacha(browser);
    await switchLocale(browser, 'en-US');
    await browser.waitFor(
      `document.querySelector('#btn-gacha-single b').textContent === 'Single'`,
      '抽卡文案切英文'
    );
    const en = await browser.evaluate(`({
      text: document.getElementById('gacha-screen').innerText,
      pity: document.getElementById('gacha-pity').textContent,
      pool: document.querySelector('#gacha-pool .gacha-pool-chip').innerText,
      single: document.querySelector('#btn-gacha-single b').textContent,
    })`);
    const cjk = CJK_RE.exec(en.text);
    if (cjk) {
      const around = en.text.slice(Math.max(0, cjk.index - 40), cjk.index + 40);
      throw new Error(`英文抽卡页仍含中文：…${around}…`);
    }
    if (!en.pity.includes('draws') && !en.pity.includes('guaranteed')) {
      throw new Error(`英文保底文案未刷新：${en.pity}`);
    }
    if (!/[A-Za-z]/.test(en.pool)) throw new Error(`英文卡池塔名未刷新：${en.pool}`);
    await browser.screenshot(path.join(OUT_DIR, 'rtd-gacha-08-en.png'));
    await switchLocale(browser, 'zh-CN');
    await browser.waitFor(
      `document.querySelector('#btn-gacha-single b').textContent === '单抽'`,
      '抽卡文案切回中文'
    );

    const bootAfter = await browser.evaluate(`window.__bootErrors || []`);
    if (bootAfter.length) throw new Error(`页面运行错误：${bootAfter.join(' | ')}`);
    console.log('[gacha] 浏览器验收通过');
  } finally {
    if (browser) await browser.close();
    await server.stop();
  }
}

main().catch((error) => {
  console.error(`[gacha] 验收失败：${error.stack || error.message}`);
  process.exitCode = 1;
});
