// 画质设置 UI：首入自动档（桌面高配）、显式低配持久化、预设应用、局内暂停恢复、损坏存储回退自动解析。
import {
  startTestServer,
  launchBrowser,
  chooseFirstMap,
  registerAndLogin,
} from './harness.mjs';

const SETTINGS_STORAGE_KEY = 'abyss-tower.settings.v1';
const LOCALE_STORAGE_KEY = 'abyss-tower.locale.v1';

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

    // 清空 localStorage（保留语言偏好以免断言文案漂移）后首入：按设备能力解析，桌面应为自动档高配。
    await browser.evaluate(`(() => {
      const locale = localStorage.getItem('${LOCALE_STORAGE_KEY}');
      localStorage.clear();
      if (locale) localStorage.setItem('${LOCALE_STORAGE_KEY}', locale);
    })()`);
    await browser.send('Page.reload', { ignoreCache: true });
    await browser.waitBoot();

    const defaults = await browser.evaluate(`window.__rtd.state.settings`);
    if (defaults.qualityMode !== 'auto') {
      throw new Error(`首入不是自动档：${JSON.stringify(defaults)}`);
    }
    if (defaults.fps !== 60 || defaults.dpr !== 2 || defaults.decorations !== 'full') {
      throw new Error(`桌面首入不是高配：${JSON.stringify(defaults)}`);
    }
    if (defaults.glow !== true || defaults.shake !== true || defaults.floaters !== 'all') {
      throw new Error(`桌面首入缺少光晕/震屏/全部飘字：${JSON.stringify(defaults)}`);
    }

    // 大厅设置：面板显示自动档解析结果
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
    if (
      formDefaults.fps !== '60' ||
      formDefaults.dpr !== '2' ||
      formDefaults.decorations !== 'full' ||
      formDefaults.glow !== true ||
      formDefaults.shake !== true
    ) {
      throw new Error(`设置表单默认值不是自动高配：${JSON.stringify(formDefaults)}`);
    }
    if (!formDefaults.label.includes('自动') || !formDefaults.label.includes('高配')) {
      throw new Error(`自动档标签错误：${formDefaults.label}`);
    }

    // 显式低配：应用后刷新仍为 30fps（不被自动解析覆盖）
    await browser.evaluate(`document.querySelector('#preset-low').click()`);
    const lowForm = await browser.evaluate(`({
      fps: document.querySelector('#set-fps').value,
      dpr: document.querySelector('#set-dpr').value,
      decorations: document.querySelector('#set-decorations').value,
      floaters: document.querySelector('#set-floaters').value,
      glow: document.querySelector('#set-glow').checked,
      shake: document.querySelector('#set-shake').checked,
      label: document.querySelector('#preset-label').textContent,
    })`);
    if (lowForm.fps !== '30' || lowForm.dpr !== '1' || lowForm.decorations !== 'light') {
      throw new Error(`低配预设未填入：${JSON.stringify(lowForm)}`);
    }
    if (lowForm.glow !== false || lowForm.shake !== false) {
      throw new Error(`低配预设未关闭光晕/震屏：${JSON.stringify(lowForm)}`);
    }
    if (lowForm.label.includes('自动')) throw new Error(`低配应转为显式选择：${lowForm.label}`);
    await browser.evaluate(`document.querySelector('#settings-apply').click()`);
    await browser.waitFor(`!document.querySelector('.settings-modal')`, '应用低配关闭');
    const appliedLow = await browser.evaluate(`({
      settings: window.__rtd.state.settings,
      stored: JSON.parse(localStorage.getItem('${SETTINGS_STORAGE_KEY}')),
    })`);
    if (appliedLow.settings.fps !== 30 || appliedLow.settings.qualityMode !== 'manual') {
      throw new Error(`应用低配后的设置错误：${JSON.stringify(appliedLow)}`);
    }
    if (appliedLow.stored.fps !== 30 || appliedLow.stored.qualityMode !== 'manual') {
      throw new Error(`低配未写入 localStorage：${JSON.stringify(appliedLow.stored)}`);
    }

    await browser.send('Page.reload', { ignoreCache: true });
    await browser.waitBoot();
    const restoredLow = await browser.evaluate(`window.__rtd.state.settings`);
    if (restoredLow.fps !== 30 || restoredLow.dpr !== 1) {
      throw new Error(`刷新后未保持显式低配：${JSON.stringify(restoredLow)}`);
    }
    if (restoredLow.glow !== false || restoredLow.shake !== false) {
      throw new Error(`刷新后低配光晕/震屏错误：${JSON.stringify(restoredLow)}`);
    }

    // 再点「自动」：按当前能力重新解析（桌面回到高配）
    await browser.evaluate(`document.querySelector('#btn-settings-title').click()`);
    await browser.waitFor(`!!document.querySelector('.settings-modal')`, '设置弹窗（自动）');
    await browser.evaluate(`document.querySelector('#preset-auto').click()`);
    const autoForm = await browser.evaluate(`({
      fps: document.querySelector('#set-fps').value,
      glow: document.querySelector('#set-glow').checked,
      label: document.querySelector('#preset-label').textContent,
    })`);
    if (autoForm.fps !== '60' || autoForm.glow !== true || !autoForm.label.includes('自动')) {
      throw new Error(`自动档未按能力重新解析：${JSON.stringify(autoForm)}`);
    }
    await browser.evaluate(`document.querySelector('#settings-apply').click()`);
    await browser.waitFor(`!document.querySelector('.settings-modal')`, '应用自动关闭');
    const appliedAuto = await browser.evaluate(`({
      settings: window.__rtd.state.settings,
      stored: JSON.parse(localStorage.getItem('${SETTINGS_STORAGE_KEY}')),
    })`);
    if (appliedAuto.settings.qualityMode !== 'auto' || appliedAuto.settings.fps !== 60) {
      throw new Error(`应用自动档后的设置错误：${JSON.stringify(appliedAuto)}`);
    }
    if (appliedAuto.stored.qualityMode !== 'auto') {
      throw new Error(`自动档未写入 localStorage：${JSON.stringify(appliedAuto.stored)}`);
    }

    // 大厅设置：选择高配并应用（显式选择）
    await browser.evaluate(`document.querySelector('#btn-settings-title').click()`);
    await browser.waitFor(`!!document.querySelector('.settings-modal')`, '大厅设置弹窗（高配）');
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
      stored: JSON.parse(localStorage.getItem('${SETTINGS_STORAGE_KEY}')),
    })`);
    if (applied.settings.fps !== 60 || applied.settings.dpr !== 2) {
      throw new Error(`应用后的设置错误：${JSON.stringify(applied)}`);
    }
    if (applied.stored.fps !== 60 || applied.stored.qualityMode !== 'manual') {
      throw new Error('设置未写入 localStorage');
    }

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
    // 战斗层实际拿到的画质：自动高配的光晕与震屏已开启。
    const inGameSettings = await browser.evaluate(`window.__rtd.state.app.settings`);
    if (inGameSettings.glow !== true || inGameSettings.shake !== true || inGameSettings.fps !== 60) {
      throw new Error(`战斗层未应用高配画质：${JSON.stringify(inGameSettings)}`);
    }

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

    // 自定义：修改任一画质字段后标记为自定义（转为显式选择）
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

    // 损坏设置：回退自动解析（桌面高配）且页面仍可启动
    await browser.evaluate(`localStorage.setItem('${SETTINGS_STORAGE_KEY}', '{broken')`);
    await browser.send('Page.reload', { ignoreCache: true });
    await browser.waitBoot();
    const fallback = await browser.evaluate(`({
      settings: window.__rtd.state.settings,
      boot: document.body.dataset.boot,
    })`);
    if (fallback.boot !== 'ok') throw new Error('损坏设置导致启动失败');
    if (fallback.settings.fps !== 60 || fallback.settings.dpr !== 2) {
      throw new Error(`损坏设置未回退自动解析：${JSON.stringify(fallback.settings)}`);
    }

    if (browser.pageErrors.length) {
      throw new Error(`控制台错误：${browser.pageErrors.join(' | ')}`);
    }

    console.log('[settings] 通过');
    console.log(JSON.stringify({ defaults, formDefaults, lowForm, appliedLow, restoredLow, autoForm, appliedAuto, highForm, applied, restored, pausedWhileOpen, pausedAfterCancel, pausedAfterApply, fallback }, null, 2));
  } finally {
    if (browser) await browser.close();
    await server.stop();
  }
}

main().catch((error) => {
  console.error(`\n[settings] FAIL: ${error.message || error}`);
  process.exit(1);
});
