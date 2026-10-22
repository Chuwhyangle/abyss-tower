// 画质设置 UI：默认低配、预设应用、持久化、局内暂停恢复、损坏存储回退。
import {
  startTestServer,
  launchBrowser,
  chooseFirstMap,
  registerAndLogin,
} from './harness.mjs';

async function main() {
  const server = await startTestServer();
  const session = await registerAndLogin(server.base);
  let browser = null;
  try {
    browser = await launchBrowser({
      base: server.base,
      name: 'rtd-settings',
      cookie: session.rawCookie,
    });

    const defaults = await browser.evaluate(`window.__rtd.state.settings`);
    if (defaults.fps !== 30 || defaults.dpr !== 1 || defaults.decorations !== 'light') {
      throw new Error(`默认画质不是低配：${JSON.stringify(defaults)}`);
    }

    // 大厅设置：选择高配并应用
    await browser.evaluate(`document.querySelector('#btn-settings-title').click()`);
    await browser.waitFor(`!!document.querySelector('.settings-modal')`, '大厅设置弹窗');
    const formDefaults = await browser.evaluate(`({
      fps: document.querySelector('#set-fps').value,
      dpr: document.querySelector('#set-dpr').value,
      decorations: document.querySelector('#set-decorations').value,
      floaters: document.querySelector('#set-floaters').value,
      glow: document.querySelector('#set-glow').checked,
      shake: document.querySelector('#set-shake').checked,
      label: document.querySelector('#preset-label').textContent,
    })`);
    if (formDefaults.fps !== '30' || formDefaults.decorations !== 'light') {
      throw new Error(`设置表单默认值错误：${JSON.stringify(formDefaults)}`);
    }
    await browser.evaluate(`document.querySelector('#preset-high').click()`);
    const highForm = await browser.evaluate(`({
      fps: document.querySelector('#set-fps').value,
      dpr: document.querySelector('#set-dpr').value,
      decorations: document.querySelector('#set-decorations').value,
      floaters: document.querySelector('#set-floaters').value,
      glow: document.querySelector('#set-glow').checked,
      shake: document.querySelector('#set-shake').checked,
      label: document.querySelector('#preset-label').textContent,
    })`);
    if (highForm.fps !== '60' || highForm.dpr !== '2' || highForm.decorations !== 'full') {
      throw new Error(`高配预设未填入：${JSON.stringify(highForm)}`);
    }
    await browser.evaluate(`document.querySelector('#settings-apply').click()`);
    await browser.waitFor(`!document.querySelector('.settings-modal')`, '设置应用关闭');
    const applied = await browser.evaluate(`({
      settings: window.__rtd.state.settings,
      stored: JSON.parse(localStorage.getItem('abyss-tower.settings.v1')),
    })`);
    if (applied.settings.fps !== 60 || applied.settings.dpr !== 2) {
      throw new Error(`应用后的设置错误：${JSON.stringify(applied)}`);
    }
    if (applied.stored.fps !== 60) throw new Error('设置未写入 localStorage');

    // 刷新后恢复
    await browser.send('Page.reload', { ignoreCache: true });
    await browser.waitBoot();
    const restored = await browser.evaluate(`window.__rtd.state.settings`);
    if (restored.fps !== 60 || restored.decorations !== 'full') {
      throw new Error(`刷新后未恢复设置：${JSON.stringify(restored)}`);
    }

    // 开局后局内设置：打开暂停、取消恢复
    await browser.evaluate(`document.querySelector('#btn-play').click()`);
    await browser.waitFor(`!!document.querySelector('.difficulty-modal')`, '难度弹窗');
    await browser.evaluate(`document.querySelector('.diff-card[data-id="roam"]').click()`);
    await chooseFirstMap(browser);
    const before = await browser.evaluate(`window.__rtd.state.app.paused`);
    if (before !== false) throw new Error('新开局不应处于暂停');

    await browser.evaluate(`document.querySelector('#btn-settings-game').click()`);
    await browser.waitFor(`!!document.querySelector('.settings-modal')`, '局内设置弹窗');
    const pausedWhileOpen = await browser.evaluate(`window.__rtd.state.app.paused`);
    if (pausedWhileOpen !== true) throw new Error('打开局内设置未暂停');
    await browser.evaluate(`document.querySelector('#settings-cancel').click()`);
    await browser.waitFor(`!document.querySelector('.settings-modal')`, '取消设置');
    const pausedAfterCancel = await browser.evaluate(`window.__rtd.state.app.paused`);
    if (pausedAfterCancel !== false) throw new Error('取消设置未恢复暂停状态');

    // 保留手动暂停状态
    await browser.evaluate(`window.__rtd.state.app.setPaused(true)`);
    await browser.evaluate(`document.querySelector('#btn-settings-game').click()`);
    await browser.waitFor(`!!document.querySelector('.settings-modal')`, '设置弹窗（手动暂停）');
    await browser.evaluate(`document.querySelector('#settings-apply').click()`);
    await browser.waitFor(`!document.querySelector('.settings-modal')`, '应用设置（手动暂停）');
    const pausedAfterApply = await browser.evaluate(`window.__rtd.state.app.paused`);
    if (pausedAfterApply !== true) throw new Error('应用设置后未保留手动暂停');
    await browser.evaluate(`window.__rtd.state.app.setPaused(false)`);

    // 自定义：修改任一字段后标记为自定义
    await browser.evaluate(`document.querySelector('#btn-settings-game').click()`);
    await browser.waitFor(`!!document.querySelector('.settings-modal')`, '设置弹窗（自定义）');
    await browser.evaluate(`
      (() => {
        const fps = document.querySelector('#set-fps');
        fps.value = '30';
        fps.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);
    const customLabel = await browser.evaluate(
      `document.querySelector('#preset-label').textContent`
    );
    if (!customLabel.includes('自定义')) throw new Error(`未标记自定义：${customLabel}`);
    await browser.evaluate(`document.querySelector('#settings-cancel').click()`);
    await browser.waitFor(`!document.querySelector('.settings-modal')`, '关闭自定义设置');

    // 损坏设置：回退默认值且页面仍可启动
    await browser.evaluate(`localStorage.setItem('abyss-tower.settings.v1', '{broken')`);
    await browser.send('Page.reload', { ignoreCache: true });
    await browser.waitBoot();
    const fallback = await browser.evaluate(`({
      settings: window.__rtd.state.settings,
      boot: document.body.dataset.boot,
    })`);
    if (fallback.boot !== 'ok') throw new Error('损坏设置导致启动失败');
    if (fallback.settings.fps !== 30 || fallback.settings.dpr !== 1) {
      throw new Error(`损坏设置未回退默认：${JSON.stringify(fallback.settings)}`);
    }

    if (browser.pageErrors.length) {
      throw new Error(`控制台错误：${browser.pageErrors.join(' | ')}`);
    }

    console.log('[settings] 通过');
    console.log(JSON.stringify({ defaults, formDefaults, highForm, applied, restored, pausedWhileOpen, pausedAfterCancel, pausedAfterApply, fallback }, null, 2));
  } finally {
    if (browser) await browser.close();
    await server.stop();
  }
}

main().catch((error) => {
  console.error(`\n[settings] FAIL: ${error.message || error}`);
  process.exit(1);
});
