// 视觉采集会话：视口定义、画质解析、页面初始化脚本与 `VisualSceneSession`。
// 这里只负责「浏览器里怎么走、怎么置时钟、怎么截图」；场景编排留在 tests/visual-scenes.mjs，
// 场景计划（纯数据）在 tests/lib/visual/plan.mjs，指标换算在 tests/lib/visual/metrics.mjs。
import { QUALITY_PRESETS, DEFAULT_SETTINGS } from '../../../public/js/settings.js';
import { decodePng } from '../../../scripts/lib/png.mjs';
import { chooseOpeningHex, launchBrowser, registerAndLogin } from '../../harness.mjs';

// 采集种子：页面 Math.random 与请求头 x-test-seed 都从这里来，同 seed 两次采集逐帧一致。
export const TEST_SEED = 'visual-fixed-seed';
export const GAME_SEED = 'visual-scene-seed';
// --quality 的取值：auto 由页面按设备能力解析（与首次进入同一条路径），其余是显式预设。
export const QUALITY_CHOICES = Object.freeze(['auto', ...Object.keys(QUALITY_PRESETS)]);

// 视口固定：桌面 1440×900；移动竖屏 390×844；移动横屏 844×390（战斗只在横屏发生）。
export const VIEWPORTS = Object.freeze({
  desktop: Object.freeze({ id: 'desktop', width: 1440, height: 900, touch: false }),
  mobile: Object.freeze({ id: 'mobile', width: 390, height: 844, touch: true }),
  'mobile-landscape': Object.freeze({ id: 'mobile-landscape', width: 844, height: 390, touch: true }),
});

// 每个场景在哪些视口采集：UI 场景两视口，战斗/结算在移动端用横屏。
export const SCENE_VIEWPORTS = Object.freeze({
  title: Object.freeze(['desktop', 'mobile']),
  lobby: Object.freeze(['desktop', 'mobile']),
  map: Object.freeze(['desktop', 'mobile']),
  combat: Object.freeze(['desktop', 'mobile-landscape']),
  result: Object.freeze(['desktop', 'mobile-landscape']),
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 画质解析：auto 交给页面按设备能力解析（首次进入的默认路径），显式档位原样写入。
// 显式档位必须标 qualityMode: 'manual'，否则 loadSettings 会把它当成自动档再解析一次。
export function resolveQuality(name = 'high') {
  if (name === 'auto') {
    return { name: 'auto', settings: { ...DEFAULT_SETTINGS, qualityMode: 'auto' } };
  }
  const preset = QUALITY_PRESETS[name];
  if (!preset) throw new Error(`未知画质：${name}（可选 ${QUALITY_CHOICES.join(' / ')}）`);
  return { name, settings: { ...preset, qualityMode: 'manual' } };
}

// 页面初始化脚本：固定 Math.random、固定测试种子请求头、预置画质设置。
// __reseedRandom 让战斗/场景接管时把随机序列拉回同一起点（同 seed 两次采集指纹一致）。
export function buildInitScript({ seed, quality, settings }) {
  const source = JSON.stringify(settings);
  return `
(() => {
  let state = (${JSON.stringify(seed)} >>> 0) || 1;
  const nextRandom = () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Math.random = nextRandom;
  // 同一页面里多次接管时钟（combat 场景、每个注入场景）都从固定起点重播 Math.random。
  window.__reseedRandom = (key) => {
    const text = ${JSON.stringify(TEST_SEED)} + ':' + String(key);
    let h = 2166136261 >>> 0;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    state = (h >>> 0) || 1;
    return state;
  };
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const headers = new Headers(init.headers || {});
    headers.set('x-test-seed', ${JSON.stringify(TEST_SEED)});
    return originalFetch(input, { ...init, headers });
  };
  try {
    localStorage.setItem('abyss-tower.settings.v1', ${JSON.stringify(source)});
    localStorage.setItem('abyss-tower.settings.v1.updatedAt', '1');
  } catch { /* 存储不可用时保持默认设置 */ }
  window.__visualQuality = ${JSON.stringify(quality)};
})();
`;
}

// 冻结时变元素：CSS 动画与过渡统一停在基础样式，避免截图随墙钟漂移。
const FREEZE_UI_SCRIPT = `
(() => {
  if (document.getElementById('visual-freeze-style')) return true;
  const style = document.createElement('style');
  style.id = 'visual-freeze-style';
  style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}';
  document.head.appendChild(style);
  return true;
})()
`;

// 大厅动态背景用固定相位渲染一帧：同一主题、同一种子 → 同一画面。
const FREEZE_MENU_BG_SCRIPT = `
(() => {
  const ui = window.__rtd && window.__rtd.ui;
  const bg = ui && ui._menuBackground;
  if (!bg || !bg.canvas) return false;
  bg.stop();
  bg.running = true;
  bg.elapsed = 0;
  bg.lastAt = null;
  bg._seedParticles();
  bg.tint = { ...bg.targetTint };
  bg.render(1 / 30);
  bg.running = false;
  return true;
})()
`;

// 战斗接管脚本：停止真实时钟循环，清空上一局残留，按固定顺序建塔并开波。
const COMBAT_SETUP_SCRIPT = `
(async () => {
  const { state } = window.__rtd;
  const sim = state.sim;
  const app = state.app;
  if (!sim || !app) throw new Error('战斗场景需要已加载的模拟与 GameApp');
  const { TOWERS } = await import('/js/shared/data.js');
  const { generateWave } = await import('/js/shared/waves.js');

  // 接管时钟前把随机序列拉回固定起点：同 seed 两次采集的画面因此逐步一致。
  window.__reseedRandom?.('combat');
  app.destroy();
  app.paused = false;
  app.speed = 1;
  app.renderer.time = 0;
  app.renderer.lastBaseHp = null;
  app.renderer.hurtFlash = 0;

  sim.opts.onSave = () => {};
  sim.opts.onSound = () => {};
  sim.opts.onToast = () => {};
  sim.opts.onGameOver = () => {};

  sim.time = 0;
  sim.waveTime = 0;
  sim.phase = 'prep';
  sim.paused = false;
  sim.wave = 0;
  sim.clearedWave = 0;
  sim.waveDef = null;
  sim.spawnQueue = [];
  sim.spawnIndex = 0;
  sim.enemies.length = 0;
  sim.projectiles.length = 0;
  sim.effects.length = 0;
  sim.floaters.length = 0;
  sim.skillFx.length = 0;
  sim.skillPending.length = 0;
  sim.towers.length = 0;
  sim.shake = 0;
  sim.gold = 99999;
  sim.skill = null;
  sim.skillCastCount = 0;
  sim.unlockedTowers = Object.keys(TOWERS);
  sim.map.destructibles?.forEach?.((entry) => { entry.destroyed = false; });

  // 塔位：离路径最近的空地，按「距离→行→列」稳定排序，并保证彼此至少相隔一格。
  const cells = [];
  for (let r = 0; r < sim.map.rows; r++) {
    for (let c = 0; c < sim.map.cols; c++) {
      if (!sim.canBuild(c, r)) continue;
      let best = Infinity;
      for (const point of sim.map.pathCells) {
        const d = (point.c - c) ** 2 + (point.r - r) ** 2;
        if (d < best) best = d;
      }
      cells.push({ c, r, d: best });
    }
  }
  cells.sort((a, b) => a.d - b.d || a.r - b.r || a.c - b.c);
  const chosen = [];
  for (const cell of cells) {
    if (chosen.some((other) => Math.abs(other.r - cell.r) + Math.abs(other.c - cell.c) < 2)) continue;
    chosen.push(cell);
    if (chosen.length >= 8) break;
  }
  const types = ['arrow', 'cannon', 'frost', 'arc', 'sniper', 'flame', 'poison', 'support']
    .filter((type) => TOWERS[type]);
  chosen.forEach((cell, index) => sim.placeTower(types[index % types.length], cell.c, cell.r));
  sim.gold = 99999;
  sim.towers.forEach((tower, index) => {
    if (index % 2 === 0) {
      sim.upgradeTower(tower);
      sim.upgradeTower(tower);
    }
  });
  sim.recomputeTowerStats();

  // 固定波次 + 提高血量：12 秒的稳定混战，塔持续开火、敌人不会瞬间清空。
  const meta = sim.map.meta || {};
  const def = generateWave(
    sim.seed,
    9,
    sim.difficulty,
    { portalCount: meta.portalCount || 1, modifier: meta.modifier || null },
    { endless: false }
  );
  def.hpMul = (def.hpMul || 1) * 6;
  for (const group of def.groups) if (group.hpMul) group.hpMul *= 6;
  sim.beginWave(def);
  app.emitHud(true);

  const TILE_VALUE = app.renderer.W / sim.map.cols;
  const canvas = app.canvas || document.querySelector('#game-canvas');
  const feedback = {
    saved: null,
    hide({ effects = true, floaters = true, flash = true } = {}) {
      if (!this.saved) {
        this.saved = {
          effects: sim.effects,
          floaters: sim.floaters,
          skillFx: sim.skillFx,
          flash: sim.enemies.map((enemy) => enemy.hitFlash || 0),
          shake: sim.shake,
        };
      }
      sim.effects = effects ? [] : this.saved.effects;
      sim.floaters = floaters ? [] : this.saved.floaters;
      sim.skillFx = effects ? [] : this.saved.skillFx;
      if (flash) sim.enemies.forEach((enemy) => { enemy.hitFlash = 0; });
      else sim.enemies.forEach((enemy, index) => { enemy.hitFlash = this.saved.flash[index] || 0; });
      if (flash) sim.shake = 0;
      else sim.shake = this.saved.shake;
    },
    restore() {
      if (!this.saved) return;
      sim.effects = this.saved.effects;
      sim.floaters = this.saved.floaters;
      sim.skillFx = this.saved.skillFx;
      sim.enemies.forEach((enemy, index) => { enemy.hitFlash = this.saved.flash[index] || 0; });
      sim.shake = this.saved.shake;
      this.saved = null;
    },
  };

  // 背景氛围层注入用的纯色：与正常背景的亮度层次明显不同，只用于「把背景拍平」。
  const FLAT_BACKGROUND_FILL = '#141c22';

  window.__visual = {
    sim,
    app,
    tile: TILE_VALUE,
    injection: null,
    // 回归注入：模拟"特效被删掉/被涂成背景色"，用于验证 visual-check 真的能红。
    setInjection(name) {
      this.injection = name || null;
      if (this.injection === 'no-feedback') {
        sim.setVisualQuality({ effects: 'off', floaters: 'off' });
      }
      return this.injection;
    },
    // 装饰档位：在已建立的战场重烘焙背景（off / light / full 三档）。
    setDecorations(name) {
      const tier = ['off', 'light', 'full'].includes(name) ? name : 'full';
      app.renderer.applySettings({ ...app.renderer.settings, decorations: tier });
      return app.renderer.settings.decorations;
    },
    // 按指定装饰档位重新烘焙背景，不改动当前渲染器的设置与画面。
    bakeBackground(tier) {
      const renderer = app.renderer;
      return renderer.backgroundRenderer.build({
        width: renderer.W,
        height: renderer.H,
        dpr: renderer.dpr,
        palette: renderer.palette,
        settings: { ...renderer.settings, decorations: tier },
      });
    },
    // 把当前背景涂成单一色：背景层次/跨度/分带必须同时归零。
    flattenBackground() {
      const bg = app.renderer.bg;
      const ctx = bg.getContext('2d');
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = FLAT_BACKGROUND_FILL;
      ctx.fillRect(0, 0, bg.width, bg.height);
      ctx.restore();
      return true;
    },
    applyInjection() {
      if (this.injection === 'no-feedback') {
        sim.enemies.forEach((enemy) => { enemy.hitFlash = 0; });
        sim.shake = 0;
        sim.effects.length = 0;
        sim.floaters.length = 0;
        sim.skillFx.length = 0;
      }
    },
    step(count = 1) {
      for (let i = 0; i < count; i++) {
        sim.update(1 / 60);
        sim.updateVisuals(1 / 60);
      }
      return this.snapshot();
    },
    render(dt = 0) {
      // 「把特效画成背景色」= 特效层与背景不可区分：渲染时临时拿掉特效层。
      if (this.injection === 'effects-invisible') {
        const effects = sim.effects;
        const skillFx = sim.skillFx;
        sim.effects = [];
        sim.skillFx = [];
        app.renderer.render(dt);
        sim.effects = effects;
        sim.skillFx = skillFx;
      } else if (this.injection === 'units-hidden') {
        // 单位层整体不绘制：剪影与单位 ΔE 必须随之归零。
        const layer = app.renderer.enemies;
        const original = layer.render;
        layer.render = () => {};
        try {
          this.applyInjection();
          app.renderer.render(dt);
        } finally {
          layer.render = original;
        }
      } else if (this.injection === 'flat-background') {
        // 背景整张拍平：层次 / 跨度 / 分带必须同时跌破阈值。
        this.flattenBackground();
        this.applyInjection();
        app.renderer.render(dt);
      } else {
        this.applyInjection();
        app.renderer.render(dt);
      }
      app.emitHud(true);
      return true;
    },
    snapshot() {
      const rect = canvas.getBoundingClientRect();
      return {
        time: Number(sim.time.toFixed(4)),
        phase: sim.phase,
        enemies: sim.enemies.filter((enemy) => !enemy.dead).length,
        projectiles: sim.projectiles.length,
        effects: sim.effects.length,
        floaters: sim.floaters.length,
        skillFx: sim.skillFx.length,
        towers: sim.towers.length,
        effectKinds: [...new Set(sim.effects.map((effect) => effect.kind))].sort(),
        canvas: { left: rect.left + scrollX, top: rect.top + scrollY, width: rect.width, height: rect.height },
      };
    },
    hideFeedback(options) { feedback.hide(options); return true; },
    restoreFeedback() { feedback.restore(); return true; },
    // 单位坐标（tile）→ 截图 CSS 像素；截图与 CSS 像素 1:1（deviceScaleFactor=1）。
    toScreen(x, y) {
      const rect = canvas.getBoundingClientRect();
      const scale = rect.width / (sim.map.cols * TILE_VALUE);
      return { x: rect.left + scrollX + x * TILE_VALUE * scale, y: rect.top + scrollY + y * TILE_VALUE * scale, scale };
    },
    payload() {
      const rect = canvas.getBoundingClientRect();
      const scale = rect.width / (sim.map.cols * TILE_VALUE);
      const renderer = app.renderer;
      const background = renderer.bg;
      const dataUrl = (target) => (target && target.toDataURL ? target.toDataURL('image/png') : null);
      // 当前档位的背景受注入影响（decor-noop = 高配烘焙实际按关闭档执行）；
      // 三档原始烘焙始终如实采样，供「氛围层贡献」与「档位单调」使用。
      const currentTier = this.injection === 'decor-noop'
        ? 'off'
        : (renderer.settings.decorations || 'full');
      const current = currentTier === (renderer.settings.decorations || 'full')
        ? background
        : this.bakeBackground(currentTier);
      const full = currentTier === 'full' ? current : this.bakeBackground('full');
      const light = currentTier === 'light' ? current : this.bakeBackground('light');
      const off = currentTier === 'off' ? current : this.bakeBackground('off');
      return {
        canvas: { left: rect.left + scrollX, top: rect.top + scrollY, width: rect.width, height: rect.height },
        scale,
        tile: TILE_VALUE,
        grid: { cols: sim.map.cols, rows: sim.map.rows },
        seed: sim.seed,
        mapMeta: renderer.game?.mapMeta || sim.map.meta || {},
        decorations: currentTier,
        enemies: sim.enemies.filter((enemy) => !enemy.dead).map((enemy) => ({ x: enemy.x, y: enemy.y, r: enemy.r, boss: !!enemy.boss, hitFlash: enemy.hitFlash || 0 })),
        towers: sim.towers.map((tower) => ({ x: tower.x, y: tower.y, type: tower.type })),
        effects: sim.effects.length,
        floaters: sim.floaters.length,
        skillFx: sim.skillFx.length,
        backgroundPng: dataUrl(current),
        backgroundFullPng: dataUrl(full),
        backgroundLightPng: dataUrl(light),
        backgroundOffPng: dataUrl(off),
      };
    },
  };

  return { towers: sim.towers.length, wave: sim.wave, total: def.totalCount ?? null };
})()
`;

// DOM 指标：字号、对比度（取原始色值，换算在 Node 侧统一做）、触控尺寸、布局溢出。
const DOM_METRICS_SCRIPT = `
(() => {
  const visible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0.05;
  };
  const backgroundOf = (el) => {
    let node = el;
    while (node && node !== document.documentElement) {
      const style = getComputedStyle(node);
      const match = /^rgba?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)(?:[,\\s/]+([\\d.]+))?\\)$/.exec(style.backgroundColor);
      if (match) {
        const alpha = match[4] === undefined ? 1 : Number(match[4]);
        if (alpha > 0.5) return [Number(match[1]), Number(match[2]), Number(match[3]), alpha];
      }
      node = node.parentElement;
    }
    return null;
  };
  const colorOf = (el) => {
    const match = /^rgba?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)(?:[,\\s/]+([\\d.]+))?\\)$/.exec(getComputedStyle(el).color);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])] : null;
  };
  let minFont = Infinity;
  let minFontSample = '';
  for (const el of document.querySelectorAll('body *')) {
    // 快捷键角标（.key）与图标字形属于操作提示而非可读正文，不计入最小字号。
    if (el.closest('.key, .glyph')) continue;
    const hasText = [...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim().length > 0);
    if (!hasText || !visible(el)) continue;
    const size = parseFloat(getComputedStyle(el).fontSize) || 0;
    if (size > 0 && size < minFont) {
      minFont = size;
      minFontSample = (typeof el.className === 'string' && el.className ? el.className : el.tagName).slice(0, 48);
    }
  }
  const hudLabel = document.querySelector('.hud .stat-label');
  const shopName = document.querySelector('.tower-card .name');
  const lockedCard = document.querySelector('.tower-card.locked');
  const lockedName = lockedCard ? lockedCard.querySelector('.name') : null;
  const targets = [];
  for (const el of document.querySelectorAll('button.btn, .tower-card, #btn-play, .icon-btn')) {
    if (!visible(el)) continue;
    const rect = el.getBoundingClientRect();
    targets.push({ w: Math.round(rect.width), h: Math.round(rect.height), cls: (el.className || '').toString().slice(0, 32) });
  }
  const hint = document.querySelector('#rotate-hint');
  const canvas = document.querySelector('#game-canvas');
  const canvasRect = canvas ? canvas.getBoundingClientRect() : null;
  return {
    viewport: { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth },
    minFontSize: minFont === Infinity ? 0 : minFont,
    minFontSample,
    hud: hudLabel ? { color: colorOf(hudLabel), background: backgroundOf(hudLabel) } : null,
    shop: shopName ? { color: colorOf(shopName), background: backgroundOf(shopName) } : null,
    locked: lockedCard && lockedName ? {
      fontSize: parseFloat(getComputedStyle(lockedName).fontSize) || 0,
      opacity: Number(getComputedStyle(lockedCard).opacity),
      visible: visible(lockedCard),
      text: (lockedName.textContent || '').trim(),
    } : null,
    targets,
    canvas: canvasRect ? { width: canvasRect.width, height: canvasRect.height } : null,
    portraitHint: !!hint && getComputedStyle(hint).display !== 'none',
  };
})()
`;
export class VisualSceneSession {
  constructor({ base, viewport, quality, seed = GAME_SEED, prefix = 'rtd-visual' }) {
    this.base = base;
    this.viewport = typeof viewport === 'string' ? VIEWPORTS[viewport] : viewport;
    this.quality = resolveQuality(quality);
    this.seed = seed;
    this.prefix = prefix;
    this.browser = null;
    this.session = null;
    this.stage = 'closed';
    // 当前战斗已推进的模拟步数：stepToTime 用累计口径（2s→4.5s→8s 只补差值）。
    this.simTicks = 0;
  }

  async open({ cookie } = {}) {
    this.session = cookie ? { rawCookie: cookie } : await registerAndLogin(this.base);
    this.browser = await launchBrowser({
      base: this.base,
      name: `${this.prefix}-${this.viewport.id}`,
      cookie: this.session.rawCookie,
      initScript: buildInitScript({
        seed: this.seed,
        quality: this.quality.name,
        settings: this.quality.settings,
      }),
      width: this.viewport.width,
      height: this.viewport.height,
    });
    await this.browser.send('Emulation.setDeviceMetricsOverride', {
      width: this.viewport.width,
      height: this.viewport.height,
      deviceScaleFactor: 1,
      mobile: this.viewport.touch,
    });
    if (this.viewport.touch) {
      await this.browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }
    await this.browser.send('Page.reload', { ignoreCache: true });
    await this.browser.waitBoot();
    await this.browser.evaluate(FREEZE_UI_SCRIPT);
    this.stage = 'title';
    return this;
  }

  async close() {
    if (this.browser) await this.browser.close();
    this.browser = null;
  }

  async screenshot() {
    await this.browser.evaluate('window.scrollTo(0, 0), true');
    const { data } = await this.browser.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    return decodePng(Buffer.from(data, 'base64'));
  }

  async pressButton(selector) {
    const clicked = await this.browser.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.click();
      return true;
    })()`);
    if (!clicked) throw new Error(`场景按钮不存在：${selector}`);
  }

  // ── 场景推进 ───────────────────────────────────────────────────────────────
  async gotoTitle() {
    if (this.stage !== 'title') throw new Error(`当前阶段 ${this.stage} 无法回到标题页`);
    await this.browser.evaluate(FREEZE_MENU_BG_SCRIPT);
    return this.screenshot();
  }

  async gotoLobby() {
    if (this.stage === 'title') {
      await this.pressButton('#btn-play');
      await this.browser.waitFor('!!document.querySelector(".difficulty-modal")', '难度选择弹窗');
      this.stage = 'lobby';
    }
    await this.browser.evaluate(FREEZE_MENU_BG_SCRIPT);
    return this.screenshot();
  }

  async gotoMap() {
    await this.gotoLobby();
    if (this.stage === 'lobby') {
      const id = await this.browser.evaluate(`(() => {
        const card = document.querySelector('.diff-card:not([disabled])');
        if (!card) return null;
        card.click();
        return card.dataset.id || card.dataset.diff || '';
      })()`);
      if (id === null) throw new Error('没有可用的难度卡片');
      await chooseOpeningHex(this.browser);
      await this.browser.waitFor('!!document.querySelector(".map-modal")', '地图选择弹窗');
      this.stage = 'map';
    }
    await this.browser.evaluate(FREEZE_MENU_BG_SCRIPT);
    return this.screenshot();
  }

  // 进入战斗并接管时钟：之后的每一帧都由固定步长推进。
  async beginCombat({ injection = null } = {}) {
    await this.gotoMap();
    if (this.stage === 'map') {
      await this.browser.evaluate(`(() => {
        const cards = [...document.querySelectorAll('.map-card')];
        if (!cards.length) throw new Error('没有可用的地图卡片');
        cards[0].click();
        return true;
      })()`);
      await this.browser.waitFor('!!(window.__rtd && window.__rtd.state && window.__rtd.state.sim && window.__rtd.state.app)', '战场加载完成');
      // 等待过场动画自行结束：这里只等状态，不让模拟推进（phase 仍是 prep）。
      await sleep(900);
      const setup = await this.browser.evaluate(COMBAT_SETUP_SCRIPT);
      this.simTicks = 0;
      if (injection) {
        await this.browser.evaluate(`window.__visual.setInjection(${JSON.stringify(injection)})`);
      }
      this.stage = 'combat';
      return setup;
    }
    return null;
  }

  async stepUntil(predicate, { maxSteps = 3600, chunk = 6 } = {}) {
    let steps = 0;
    let snapshot = null;
    while (steps < maxSteps) {
      snapshot = await this.browser.evaluate(`window.__visual.step(${chunk})`);
      steps += chunk;
      if (predicate(snapshot)) break;
    }
    return { steps, snapshot };
  }

  // 精确推进到目标模拟时间（累计口径）：2s=120 步、4.5s=270 步、8s=480 步。
  // 记自己走过多少步，所以 4.5s 的帧只会补 150 步，而不是再走 270 步。
  // extraTicks 只给漂移验收用：多走的步数会让 snapshot.time 超过 requestedTime。
  async stepToTime(seconds, { extraTicks = 0, chunk = 6 } = {}) {
    const target = Math.round(seconds / (1 / 60)) + Math.max(0, extraTicks);
    let remaining = target - this.simTicks;
    let snapshot = null;
    while (remaining > 0) {
      const batch = Math.min(chunk, remaining);
      snapshot = await this.browser.evaluate(`window.__visual.step(${batch})`);
      remaining -= batch;
    }
    this.simTicks = target;
    return { steps: target, snapshot };
  }

  async renderFrame(dt = 0) {
    await this.browser.evaluate(`window.__visual.render(${dt})`);
  }

  async setDecorations(name) {
    return this.browser.evaluate(`window.__visual.setDecorations(${JSON.stringify(name)})`);
  }

  async hideFeedback(options = {}) {
    await this.browser.evaluate(`window.__visual.hideFeedback(${JSON.stringify(options)})`);
  }

  async restoreFeedback() {
    await this.browser.evaluate('window.__visual.restoreFeedback()');
  }

  async showResult() {
    await this.browser.evaluate(`(() => {
      window.__rtd.ui.showResult({
        stats: {
          wave: 12, clearedWave: 12, kills: 148, gold: 236, baseHp: 14, maxBaseHp: 20,
          victory: false, score: 8420, rawScore: 8420, cores: 34, mode: 'normal', difficulty: 'standard',
        },
        res: { reason: 'defeat', victory: false, score: 8420, coresEarned: 34, difficulty: 'standard' },
        mode: 'normal',
        dailyLeft: 3,
      });
      return true;
    })()`);
    await this.browser.waitFor('!!document.querySelector(".result-modal")', '结算弹窗');
    // 结算分数有 600ms 的数字滚动：等它停在终值，画面才可重复。
    await sleep(900);
  }

  async domMetrics() {
    return this.browser.evaluate(DOM_METRICS_SCRIPT);
  }

  async combatPayload() {
    return this.browser.evaluate('window.__visual.payload()');
  }
}
