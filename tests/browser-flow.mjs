// 端到端 UI 流程：清波三选一 → 刷新续玩 → 退出 → 排行榜/商店 → 死亡结算。
// 用法：先启动服务，再运行 node tests/browser-flow.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const CDP_PORT = Number(process.env.CDP_PORT || 9334);
const PROFILE_DIR = '/tmp/rtd-chrome-flow';
const OUT_DIR = process.env.OUT_DIR || '/tmp';

let chrome = null;
let ws = null;
const pageErrors = [];

function cleanup() {
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  if (chrome && !chrome.killed) {
    try {
      chrome.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }
}

function fail(message) {
  console.error(`\n[flow] FAIL: ${message}`);
  if (pageErrors.length) console.error('[flow] pageErrors:', pageErrors.join('\n'));
  cleanup();
  process.exit(1);
}

async function findTarget() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const target = list.find(
        (item) => item.type === 'page' && item.url.startsWith(BASE) && item.webSocketDebuggerUrl
      );
      if (target) return target;
    } catch {
      /* wait */
    }
    await sleep(150);
  }
  return null;
}

async function main() {
  fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
  chrome = spawn(
    'google-chrome',
    [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
      '--autoplay-policy=no-user-gesture-required',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${PROFILE_DIR}`,
      '--window-size=1440,1000',
      `${BASE}/`,
    ],
    { stdio: 'ignore' }
  );

  const target = await findTarget();
  if (!target) return fail('无法连接 Chrome CDP');

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('WebSocket 连接失败'));
  });

  let nextId = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      pageErrors.push(
        message.params?.exceptionDetails?.exception?.description ||
          message.params?.exceptionDetails?.text ||
          'exception'
      );
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
      pageErrors.push(
        (message.params.args || []).map((arg) => arg.value ?? arg.description ?? '').join(' ')
      );
    }
  };

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description || result.exceptionDetails.text
      );
    }
    return result.result?.value;
  }

  async function waitFor(expression, label, timeout = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        if (await evaluate(expression)) return;
      } catch {
        /* page busy */
      }
      await sleep(120);
    }
    throw new Error(`等待超时：${label}`);
  }

  async function screenshot(name) {
    const result = await send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(OUT_DIR, name);
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
    console.log(`[flow] 截图 ${file}`);
  }

  async function bootReady() {
    await waitFor(`document.body.dataset.boot === 'ok'`, '页面启动');
  }

  await send('Page.enable');
  await send('Runtime.enable');
  await bootReady();

  // 开一局漫游，直接建造三座塔加速清波。
  await evaluate(`document.querySelector('#btn-play').click()`);
  await waitFor(`!!document.querySelector('.difficulty-modal')`, '难度弹窗');
  await evaluate(`document.querySelector('.diff-card[data-id="roam"]').click()`);
  await waitFor(`!!(window.__rtd && window.__rtd.state.sim)`, '模拟创建');
  await waitFor(`document.getElementById('game-screen').hidden === false`, '战斗界面');

  const built = await evaluate(`
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
  if (built.towers !== 3) fail(`预建塔失败：${built.towers}`);

  await evaluate(`document.querySelector('.speed-btn[data-speed="3"]').click()`);
  await evaluate(`document.querySelector('#btn-next-wave').click()`);
  await waitFor(`window.__rtd.state.sim.phase === 'wave'`, '波次开始');
  await waitFor(`!!document.querySelector('.relic-card')`, '三选一弹窗', 60000);
  await screenshot('rtd-flow-01-draft.png');

  const offers = await evaluate(`document.querySelectorAll('.relic-card').length`);
  if (offers !== 3) fail(`遗物选项数量异常：${offers}`);

  await evaluate(`document.querySelector('.relic-card').click()`);
  await waitFor(`!document.querySelector('.modal')`, '三选一关闭');
  const afterPick = await evaluate(`({
    relics: window.__rtd.state.sim.relics.length,
    phase: window.__rtd.state.sim.phase,
    wave: window.__rtd.state.sim.wave,
    towers: window.__rtd.state.sim.towers.length,
    saved: !!localStorage.getItem('abyss-tower.snapshot.v2'),
  })`);
  if (afterPick.relics !== 1) fail('遗物未加入');
  if (!afterPick.saved) fail('波次快照未写入');

  // 刷新续玩
  await send('Page.reload', { ignoreCache: true });
  await bootReady();
  await waitFor(`document.getElementById('btn-resume').hidden === false`, '继续按钮出现');
  await evaluate(`document.querySelector('#btn-resume').click()`);
  await waitFor(`!!(window.__rtd && window.__rtd.state.sim)`, '续玩加载');
  await waitFor(`document.getElementById('game-screen').hidden === false`, '续玩进入战场');
  const resumed = await evaluate(`({
    wave: window.__rtd.state.sim.wave,
    towers: window.__rtd.state.sim.towers.length,
    relics: window.__rtd.state.sim.relics.length,
    gold: Math.floor(window.__rtd.state.sim.gold),
  })`);
  if (resumed.wave !== 1 || resumed.towers !== 3 || resumed.relics !== 1) {
    fail(`续玩状态不正确：${JSON.stringify(resumed)}`);
  }
  await screenshot('rtd-flow-02-resume.png');

  // 退出远征
  await evaluate(`document.querySelector('#btn-quit').click()`);
  await waitFor(`!!document.querySelector('.confirm-modal')`, '退出确认');
  await evaluate(`document.querySelector('#btn-confirm-yes').click()`);
  await waitFor(`document.getElementById('title-screen').hidden === false`, '返回标题页');

  // 排行榜与商店
  await evaluate(`document.querySelector('#btn-board').click()`);
  await waitFor(`!!document.querySelector('.board-modal')`, '排行榜弹窗');
  const board = await evaluate(`({
    tabs: document.querySelectorAll('.board-modal .tab').length,
    rows: document.querySelectorAll('.board-modal .board-row').length,
  })`);
  if (board.tabs !== 2) fail('排行榜标签异常');
  await screenshot('rtd-flow-03-board.png');
  await evaluate(`document.querySelector('#btn-close-board').click()`);
  await waitFor(`!document.querySelector('.modal')`, '排行榜关闭');

  await evaluate(`document.querySelector('#btn-shop').click()`);
  await waitFor(`!!document.querySelector('.unlock-modal')`, '星核商店');
  const unlockRows = await evaluate(`document.querySelectorAll('.unlock-row').length`);
  if (unlockRows !== 6) fail(`解锁项数量异常：${unlockRows}`);
  await screenshot('rtd-flow-04-shop.png');
  await evaluate(`document.querySelector('#btn-close-unlocks').click()`);
  await waitFor(`!document.querySelector('.modal')`, '商店关闭');

  // 新局直接触发失败结算
  await evaluate(`document.querySelector('#btn-play').click()`);
  await waitFor(`!!document.querySelector('.difficulty-modal')`, '难度弹窗（第二局）');
  await evaluate(`document.querySelector('.diff-card[data-id="roam"]').click()`);
  await waitFor(`!!(window.__rtd && window.__rtd.state.sim)`, '第二局模拟');
  await evaluate(`document.querySelector('#btn-next-wave').click()`);
  await waitFor(`window.__rtd.state.sim.phase === 'wave'`, '第二局波次开始');
  await evaluate(`
    (() => {
      const sim = window.__rtd.state.sim;
      sim.baseHp = 0;
      sim.update(1 / 60);
    })()
  `);
  await waitFor(`!!document.querySelector('.result-modal')`, '结算弹窗', 20000);
  const resultText = await evaluate(`document.querySelector('.result-modal').textContent`);
  if (!resultText.includes('最终得分')) fail(`结算文案异常：${resultText.slice(0, 120)}`);
  await screenshot('rtd-flow-05-result.png');

  await evaluate(`document.querySelector('#btn-home').click()`);
  await waitFor(`document.getElementById('title-screen').hidden === false`, '结算返回大厅');

  const bootErrors = await evaluate(`window.__bootErrors || []`);
  if (bootErrors.length) fail(`页面错误：${bootErrors.join(' | ')}`);
  if (pageErrors.length) fail(`控制台错误：${pageErrors.join(' | ')}`);

  console.log('[flow] 通过');
  console.log(JSON.stringify({ built, afterPick, resumed, board, unlockRows }, null, 2));
  cleanup();
  process.exit(0);
}

main().catch((error) => fail(error.message || String(error)));
