// 无头 Chrome 冒烟测试：选难度 → 建塔 → 开波，并收集页面错误。
// 用法：先启动服务（npm start），再运行 node tests/browser-smoke.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const CDP_PORT = Number(process.env.CDP_PORT || 9333);
const PROFILE_DIR = '/tmp/rtd-chrome-smoke';
const OUT_DIR = process.env.OUT_DIR || '/tmp';

let chrome = null;
let ws = null;
const pageErrors = [];

function fail(message) {
  console.error(`\n[smoke] FAIL: ${message}`);
  if (pageErrors.length) console.error('[smoke] pageErrors:', pageErrors.join('\n'));
  cleanup();
  process.exit(1);
}

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

async function findTarget() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const target = list.find(
        (item) => item.type === 'page' && item.url.startsWith(BASE) && item.webSocketDebuggerUrl
      );
      if (target) return target;
    } catch {
      /* chrome 还没起来 */
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
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--hide-scrollbars',
      '--autoplay-policy=no-user-gesture-required',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${PROFILE_DIR}`,
      '--window-size=1440,1000',
      `${BASE}/`,
    ],
    { stdio: 'ignore' }
  );

  const target = await findTarget();
  if (!target) fail('无法连接 Chrome CDP');

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
      const detail = message.params?.exceptionDetails;
      pageErrors.push(
        detail?.exception?.description || detail?.text || 'unknown exception'
      );
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
      pageErrors.push(
        (message.params.args || [])
          .map((arg) => arg.value ?? arg.description ?? '')
          .join(' ')
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
        result.exceptionDetails.exception?.description ||
          result.exceptionDetails.text ||
          'evaluate failed'
      );
    }
    return result.result?.value;
  }

  async function waitFor(expression, label, timeout = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        if (await evaluate(expression)) return;
      } catch {
        /* 页面尚未就绪 */
      }
      await sleep(120);
    }
    throw new Error(`等待超时：${label}`);
  }

  async function screenshot(name) {
    const result = await send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(OUT_DIR, name);
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
    console.log(`[smoke] 截图 ${file}`);
  }

  await send('Page.enable');
  await send('Runtime.enable');

  await waitFor(`document.body.dataset.boot === 'ok'`, '页面启动');
  await screenshot('rtd-01-title.png');

  await evaluate(`document.querySelector('#btn-play').click()`);
  await waitFor(`!!document.querySelector('.difficulty-modal')`, '难度弹窗');
  await screenshot('rtd-02-difficulty.png');

  await evaluate(`document.querySelector('.diff-card[data-id="roam"]').click()`);
  await waitFor(`!!(window.__rtd && window.__rtd.state.sim)`, '战斗界面');
  await waitFor(`document.getElementById('game-screen').hidden === false`, '战斗界面可见');
  await sleep(500);
  await screenshot('rtd-03-game.png');

  const setup = await evaluate(`
    (() => {
      const sim = window.__rtd.state.sim;
      const map = sim.map;
      let cell = null;
      for (const p of map.pathCells) {
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const c = p.c + dc;
          const r = p.r + dr;
          if (map.buildable[r]?.[c]) { cell = { c, r }; break; }
        }
        if (cell) break;
      }
      if (!cell) return { error: '没有可建造格' };
      document.querySelector('.tower-card[data-type="arrow"]').click();
      const rect = document.querySelector('#game-canvas').getBoundingClientRect();
      return {
        cell,
        x: rect.left + ((cell.c + 0.5) / map.cols) * rect.width,
        y: rect.top + ((cell.r + 0.5) / map.rows) * rect.height,
        diff: sim.difficulty,
        gold: sim.gold,
      };
    })()
  `);
  if (!setup || setup.error) fail(setup?.error || '无法定位建造格');

  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: setup.x, y: setup.y });
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: setup.x, y: setup.y, button: 'left', clickCount: 1,
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: setup.x, y: setup.y, button: 'left', clickCount: 1,
  });

  const towerCount = await evaluate(`window.__rtd.state.sim.towers.length`);
  if (towerCount !== 1) fail(`建塔失败，towers=${towerCount}`);
  await screenshot('rtd-04-built.png');

  await evaluate(`document.querySelector('.speed-btn[data-speed="3"]').click()`);
  await evaluate(`document.querySelector('#btn-next-wave').click()`);
  await waitFor(`window.__rtd.state.sim.phase === 'wave'`, '波次开始');
  await sleep(4000);
  await screenshot('rtd-05-battle.png');

  const battle = await evaluate(`
    (() => {
      const sim = window.__rtd.state.sim;
      return {
        wave: sim.wave,
        phase: sim.phase,
        enemies: sim.enemies.length,
        towers: sim.towers.length,
        gold: Math.floor(sim.gold),
        hp: Math.ceil(sim.baseHp),
        kills: sim.kills,
        difficulty: sim.difficulty,
      };
    })()
  `);
  // 渲染压力基准：20 座塔 + 200 敌人，测量 2 秒 rAF 帧率。
  const perf = await evaluate(`
    new Promise((resolve) => {
      const sim = window.__rtd.state.sim;
      sim.paused = true;
      sim.gold = 100000;
      const map = sim.map;
      const cells = [];
      for (const p of map.pathCells) {
        for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const c = p.c + dc, r = p.r + dr;
          if (map.buildable[r]?.[c] && !sim.towerAt(c, r)) cells.push({ c, r });
        }
      }
      const types = ['arrow', 'cannon', 'frost'];
      for (let i = 0; i < 20 && i < cells.length; i++) {
        sim.placeTower(types[i % types.length], cells[i].c, cells[i].r);
      }
      for (let i = 0; i < 200; i++) sim.spawnEnemy('grunt');
      let frames = 0;
      const start = performance.now();
      function loop() {
        frames++;
        if (performance.now() - start < 2000) requestAnimationFrame(loop);
        else resolve({
          fps: frames / ((performance.now() - start) / 1000),
          towers: sim.towers.length,
          enemies: sim.enemies.length,
        });
      }
      requestAnimationFrame(loop);
    })
  `);

  const bootErrors = await evaluate(`window.__bootErrors || []`);

  if (battle.wave !== 1) fail(`波次异常：${battle.wave}`);
  if (battle.towers < 1) fail('塔数量异常');
  if (battle.difficulty !== 'roam') fail(`难度异常：${battle.difficulty}`);
  if (perf.fps < 40) fail(`渲染帧率过低：${perf.fps.toFixed(1)} fps`);
  if (bootErrors.length) fail(`页面启动错误：${bootErrors.join(' | ')}`);
  if (pageErrors.length) fail(`控制台错误：${pageErrors.join(' | ')}`);

  console.log('[smoke] 通过');
  console.log(JSON.stringify({ setup, battle, perf }, null, 2));
  cleanup();
  process.exit(0);
}

main().catch((error) => fail(error.message || String(error)));
