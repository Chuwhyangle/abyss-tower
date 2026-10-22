// 登录门槛端到端：未登录只显示登录/注册页 → 注册 → 恢复码 → 进入大厅 → 退出 → 登录。
import path from 'node:path';
import { startTestServer, launchBrowser, testUsername } from './harness.mjs';

const OUT_DIR = process.env.OUT_DIR || '/tmp';
const PASSWORD = 'rtd-test-password';

function setInputsScript(username, password, confirm) {
  return `
    (() => {
      const form = document.querySelector('.auth-form');
      const set = (name, value) => {
        const input = form.elements[name];
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('username', ${JSON.stringify(username)});
      set('password', ${JSON.stringify(password)});
      if (form.elements.confirm) set('confirm', ${JSON.stringify(confirm)});
      form.requestSubmit();
      return true;
    })()
  `;
}

async function main() {
  const server = await startTestServer();
  let browser = null;
  try {
    browser = await launchBrowser({
      base: server.base,
      name: 'rtd-auth-ui',
      awaitBoot: false,
    });

    await browser.waitFor(`!!document.querySelector('.auth-overlay')`, '未登录显示登录门槛');
    const beforeBoot = await browser.evaluate(`document.body.dataset.boot || ''`);
    if (beforeBoot === 'ok') throw new Error('未登录不应完成启动');
    const gameHidden = await browser.evaluate(`document.getElementById('game-screen').hidden`);
    if (!gameHidden) throw new Error('未登录不应显示战斗界面');
    await browser.screenshot(path.join(OUT_DIR, 'rtd-auth-01-gate.png'));

    // 注册
    await browser.evaluate(
      `document.querySelector('.auth-tabs button[data-mode="register"]').click()`
    );
    const username = testUsername('ui');
    await browser.evaluate(setInputsScript(username, PASSWORD, PASSWORD));
    await browser.waitFor(`!!document.querySelector('.auth-recovery')`, '注册后展示恢复码');
    const recoveryCode = await browser.evaluate(
      `document.querySelector('.auth-recovery').textContent`
    );
    if (!/^[A-Z0-9]{4}(-[A-Z0-9]{4}){7}$/.test(recoveryCode)) {
      throw new Error(`恢复码格式异常：${recoveryCode}`);
    }
    await browser.screenshot(path.join(OUT_DIR, 'rtd-auth-02-recovery.png'));

    await browser.evaluate(`document.querySelector('.auth-done').click()`);
    await browser.waitFor(`document.body.dataset.boot === 'ok'`, '注册后进入大厅');
    const name = await browser.evaluate(`window.__rtd?.state?.profile?.name || ''`);
    if (name !== username) throw new Error(`进入大厅后昵称异常：${name}`);
    const cores = await browser.evaluate(`window.__rtd?.state?.profile?.cores`);
    if (!Number.isInteger(cores)) throw new Error(`星核读取异常：${cores}`);

    // 退出
    await browser.evaluate(`document.querySelector('.auth-widget-logout').click()`);
    await browser.waitFor(`!!document.querySelector('.auth-overlay')`, '退出后回到登录页');
    const afterLogout = await browser.evaluate(`document.body.dataset.boot || ''`);
    if (afterLogout === 'ok') throw new Error('退出后不应保持已启动状态');

    // 重新登录
    await browser.evaluate(setInputsScript(username, PASSWORD, PASSWORD));
    await browser.waitFor(`document.body.dataset.boot === 'ok'`, '重新登录进入大厅');
    const nameAgain = await browser.evaluate(`window.__rtd?.state?.profile?.name || ''`);
    if (nameAgain !== username) throw new Error(`重新登录后昵称异常：${nameAgain}`);
    await browser.screenshot(path.join(OUT_DIR, 'rtd-auth-03-login.png'));

    console.log(
      JSON.stringify(
        { username, recoveryCodeSaved: true, name: nameAgain, cores },
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
  console.error('[browser-auth] 失败', error);
  process.exitCode = 1;
});
