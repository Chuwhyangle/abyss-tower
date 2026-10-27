#!/usr/bin/env node
// 确定性视觉场景采集：固定种子、固定模拟步长、固定视口，产出 PNG + contact sheet + manifest。
// 场景：title / lobby / map / combat / result；战斗场景由脚本化建塔与固定波次制造稳定混战。
// 用法：node tests/visual-scenes.mjs --scene combat --quality high --out /tmp/visual-smoke
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { QUALITY_PRESETS } from '../public/js/settings.js';
import { decodePng, encodePng, RgbaImage, fillRect, blit } from '../scripts/lib/png.mjs';
import { lumaSignature, pixelHash, regionStats } from '../scripts/lib/visual-metrics.mjs';
import {
  chooseOpeningHex,
  launchBrowser,
  registerAndLogin,
  startTestServer,
} from './harness.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TEST_SEED = 'visual-fixed-seed';
export const GAME_SEED = 'visual-scene-seed';
export const SCENES = Object.freeze(['title', 'lobby', 'map', 'combat', 'result']);

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

export const CONTACT_CELL_WIDTH = 520;
export const CONTACT_CELL_HEIGHT = 400;
const CONTACT_GUTTER = 14;
const CONTACT_COLUMNS = 3;
const CONTACT_BG = [12, 18, 22, 255];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function resolveQuality(name = 'high') {
  const preset = QUALITY_PRESETS[name];
  if (!preset) throw new Error(`未知画质：${name}（可选 ${Object.keys(QUALITY_PRESETS).join(' / ')}）`);
  return { name, settings: preset };
}

// 页面初始化脚本：固定 Math.random、固定测试种子请求头、预置画质设置。
export function buildInitScript({ seed, quality, settings }) {
  const source = JSON.stringify(settings);
  return `
(() => {
  let state = (${JSON.stringify(seed)} >>> 0) || 1;
  Math.random = function seededRandom() {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
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

// ── 单场景采集 ───────────────────────────────────────────────────────────────
async function captureScene(session, scene, options = {}) {
  const started = Date.now();
  if (scene === 'title') {
    const image = await session.gotoTitle();
    return { frames: [{ id: 'title', image }], dom: await session.domMetrics(), notes: '', elapsedMs: Date.now() - started };
  }
  if (scene === 'lobby') {
    const image = await session.gotoLobby();
    return { frames: [{ id: 'lobby', image }], dom: await session.domMetrics(), notes: '', elapsedMs: Date.now() - started };
  }
  if (scene === 'map') {
    const image = await session.gotoMap();
    return { frames: [{ id: 'map', image }], dom: await session.domMetrics(), notes: '', elapsedMs: Date.now() - started };
  }
  if (scene === 'result') {
    if (session.stage !== 'combat') await session.beginCombat();
    await session.renderFrame(0);
    await session.showResult();
    const image = await session.screenshot();
    return { frames: [{ id: 'result', image }], dom: await session.domMetrics(), notes: '', elapsedMs: Date.now() - started };
  }
  if (scene !== 'combat') throw new Error(`未知场景：${scene}`);

  await session.beginCombat({ injection: options.injection });
  // 装饰档位在重建背景之前生效（默认 full：产品高配画面）。
  await session.setDecorations(options.decorations || 'full');
  const frames = [];

  // 第一帧：敌人刚进入射程，接触战开始。时间兜底保证注入回归时场景仍然非空。
  const contact = await session.stepUntil((snap) => snap.enemies >= 5 || snap.time >= 6);
  await session.renderFrame(1 / 60);
  frames.push({ id: 'combat-contact', image: await session.screenshot(), snapshot: contact.snapshot });

  // 第二帧：混战高峰（敌人数与特效数同时上来）。
  const mixed = await session.stepUntil(
    (snap) => (snap.enemies >= 10 && snap.effects >= 6) || snap.time >= 8,
    { maxSteps: 1800 }
  );
  await session.renderFrame(1 / 60);
  frames.push({ id: 'combat-mixed', image: await session.screenshot(), snapshot: mixed.snapshot });

  // 第三帧：战线铺开后的密集命中帧（飘字 + 多个持续特效），作为指标帧。
  const impact = await session.stepUntil(
    (snap) => (snap.time >= 8 && snap.floaters >= 1 && snap.effects >= 6) || snap.time >= 12,
    { maxSteps: 2400 }
  );
  await session.renderFrame(1 / 60);
  const onFrame = await session.screenshot();
  frames.push({ id: 'combat-impact', image: onFrame, snapshot: impact.snapshot });

  const payload = await session.combatPayload();
  const references = {};
  for (const [key, options] of Object.entries({
    all: { effects: true, floaters: true, flash: true },
    effects: { effects: true, floaters: false, flash: false },
    floaters: { effects: false, floaters: true, flash: false },
    flash: { effects: false, floaters: false, flash: true },
  })) {
    await session.hideFeedback(options);
    await session.renderFrame(0);
    references[key] = await session.screenshot();
    await session.restoreFeedback();
  }
  await session.renderFrame(0);
  const dom = await session.domMetrics();

  return {
    frames,
    metricsFrame: 'combat-impact',
    references,
    payload,
    dom,
    notes: `wave=${impact.snapshot.phase} t=${impact.snapshot.time}s enemies=${impact.snapshot.enemies}`,
    elapsedMs: Date.now() - started,
  };
}

// ── contact sheet ────────────────────────────────────────────────────────────
// 每格固定 520×400 的容器，图片等比缩放后居中；竖屏手机图因此不会被拉成巨幅。
function fitWithin(image, maxWidth, maxHeight) {
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  return { width, height };
}

export function buildContactSheet(entries) {
  const cells = entries.map((entry) => ({ ...entry, ...fitWithin(entry.image, CONTACT_CELL_WIDTH, CONTACT_CELL_HEIGHT) }));
  const columns = Math.min(CONTACT_COLUMNS, Math.max(1, cells.length));
  const rows = Math.ceil(cells.length / columns);
  const width = columns * CONTACT_CELL_WIDTH + (columns + 1) * CONTACT_GUTTER;
  const height = rows * CONTACT_CELL_HEIGHT + (rows + 1) * CONTACT_GUTTER;
  const sheet = new RgbaImage(width, height);
  fillRect(sheet, 0, 0, width, height, CONTACT_BG);
  cells.forEach((cell, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const originX = CONTACT_GUTTER + col * (CONTACT_CELL_WIDTH + CONTACT_GUTTER);
    const originY = CONTACT_GUTTER + row * (CONTACT_CELL_HEIGHT + CONTACT_GUTTER);
    const x = originX + Math.floor((CONTACT_CELL_WIDTH - cell.width) / 2);
    const y = originY + Math.floor((CONTACT_CELL_HEIGHT - cell.height) / 2);
    blit(sheet, cell.image, x, y, cell.width, cell.height);
  });
  return sheet;
}

export function buildContactHtml(entries, meta) {
  const items = entries
    .map(
      (entry) => `      <figure>
        <img src="${entry.file}" alt="${entry.scene} ${entry.viewport}" />
        <figcaption><b>${entry.scene}</b> · ${entry.viewport} · ${entry.quality}</figcaption>
      </figure>`
    )
    .join('\n');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>视觉基线 contact sheet</title>
<style>
  body { background: #0b1013; color: #cfe3ea; font: 14px/1.5 system-ui, sans-serif; margin: 24px; }
  h1 { font-size: 18px; font-weight: 600; }
  .meta { color: #7d95a1; margin-bottom: 18px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
  figure { margin: 0; background: #121a20; border: 1px solid #22303a; border-radius: 8px; overflow: hidden; }
  img { display: block; width: 100%; height: auto; }
  figcaption { padding: 8px 10px; font-size: 13px; color: #9fb6c2; }
</style>
</head>
<body>
  <h1>视觉基线 · contact sheet</h1>
  <p class="meta">commit ${meta.commit} · seed ${meta.seed} · quality ${meta.quality} · ${meta.generatedAt}</p>
  <div class="grid">
${items}
  </div>
</body>
</html>
`;
}

// ── 采集编排 ─────────────────────────────────────────────────────────────────
export function gitCommit() {
  try {
    return execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export async function capture({
  scenes = SCENES,
  viewports = null,
  quality = 'high',
  outDir,
  seed = GAME_SEED,
  injection = null,
  decorations = 'full',
  log = () => {},
} = {}) {
  const started = Date.now();
  const server = await startTestServer({ seedHeader: true });
  // 固定账号：标题页会显示指挥官昵称，随机账号名会让截图每次不同。
  const session0 = await registerAndLogin(server.base, {
    username: 'visualbot',
    password: 'rtd-visual-password',
  });
  const results = [];
  const timings = {};
  try {
    for (const scene of scenes) {
      const allowed = SCENE_VIEWPORTS[scene] || ['desktop'];
      const targets = viewports ? allowed.filter((id) => viewports.includes(id)) : allowed;
      if (!targets.length) {
        throw new Error(`场景 ${scene} 不支持指定视口：${viewports?.join(',')}`);
      }
      for (const viewportId of targets) {
        const viewport = VIEWPORTS[viewportId];
        if (!viewport) throw new Error(`未知视口：${viewportId}`);
        log(`[visual] ${scene} @ ${viewportId} (${viewport.width}×${viewport.height})`);
        const session = new VisualSceneSession({
          base: server.base,
          viewport,
          quality,
          seed,
          prefix: `rtd-visual-${scene}`,
        });
        try {
          await session.open({ cookie: session0.rawCookie });
          const captured = await captureScene(session, scene, { quality, injection, decorations });
          const entry = { scene, viewport: viewportId, quality, ...captured };
          results.push(entry);
          timings[`${scene}@${viewportId}`] = captured.elapsedMs;
          log(`[visual] ${scene} @ ${viewportId} 完成 ${captured.elapsedMs}ms（${captured.frames.length} 帧）`);
        } finally {
          await session.close();
        }
      }
    }
  } finally {
    await server.stop();
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    commit: gitCommit(),
    seed,
    gameSeed: seed,
    testSeed: TEST_SEED,
    quality,
    injection: injection || null,
    decorations,
    scenes: [],
    timings,
    totalMs: Date.now() - started,
  };

  const entries = [];
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    for (const result of results) {
      for (const frame of result.frames) {
        const file = `${result.scene}-${result.viewport}-${frame.id}-${result.quality}.png`;
        fs.writeFileSync(path.join(outDir, file), encodePng(frame.image));
        entries.push({
          scene: result.scene,
          viewport: result.viewport,
          frame: frame.id,
          file,
          image: frame.image,
          quality: result.quality,
        });
      }
      manifest.scenes.push({
        scene: result.scene,
        viewport: result.viewport,
        quality: result.quality,
        notes: result.notes || '',
        elapsedMs: result.elapsedMs,
        frames: result.frames.map((frame) => ({
          id: frame.id,
          width: frame.image.width,
          height: frame.image.height,
          pixelHash: pixelHash(frame.image),
          lumaSignature: lumaSignature(frame.image),
          snapshot: frame.snapshot || null,
        })),
        dom: result.dom || null,
      });
    }
    if (entries.length) {
      const sheet = buildContactSheet(entries);
      fs.writeFileSync(path.join(outDir, 'contact-sheet.png'), encodePng(sheet));
      fs.writeFileSync(
        path.join(outDir, 'contact-sheet.html'),
        buildContactHtml(entries, {
          commit: manifest.commit.slice(0, 12),
          seed,
          quality,
          generatedAt: manifest.generatedAt,
        })
      );
    }
    manifest.artifacts = {
      dir: outDir,
      contactSheet: entries.length ? 'contact-sheet.png' : null,
      contactSheetHtml: entries.length ? 'contact-sheet.html' : null,
    };
    fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  }

  return { manifest, results, entries };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const options = {
    scenes: [...SCENES],
    viewports: null,
    quality: 'high',
    outDir: '/tmp/rtd-visual',
    seed: GAME_SEED,
    repeat: 1,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--scene') {
      const value = next();
      options.scenes = value === 'all' ? [...SCENES] : String(value).split(',').map((item) => item.trim()).filter(Boolean);
    } else if (arg === '--viewport') {
      const value = next();
      options.viewports = value === 'all' ? null : String(value).split(',').map((item) => item.trim()).filter(Boolean);
    } else if (arg === '--quality') {
      options.quality = next();
    } else if (arg === '--out') {
      options.outDir = next();
    } else if (arg === '--seed') {
      options.seed = next();
    } else if (arg === '--repeat') {
      options.repeat = Math.max(1, Number(next()) || 1);
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  for (const scene of options.scenes) {
    if (!SCENES.includes(scene)) throw new Error(`未知场景：${scene}（可选 ${SCENES.join(' / ')} / all）`);
  }
  return options;
}

// 两次采集的指纹对比：图片逐帧比较 32×32 亮度签名，容差内视为一致。
export function compareRuns(first, second) {
  const index = new Map();
  for (const result of first) {
    for (const frame of result.frames) index.set(`${result.scene}@${result.viewport}#${frame.id}`, frame.image);
  }
  const comparisons = [];
  const seen = new Set();
  for (const result of second) {
    for (const frame of result.frames) {
      const key = `${result.scene}@${result.viewport}#${frame.id}`;
      seen.add(key);
      const other = index.get(key);
      if (!other) {
        comparisons.push({ key, ok: false, reason: 'missing-first-run' });
        continue;
      }
      const a = lumaSignature(other);
      const b = lumaSignature(frame.image);
      const exact = pixelHash(other) === pixelHash(frame.image);
      let sum = 0;
      let changed = 0;
      for (let i = 0; i < a.length; i++) {
        const d = Math.abs(a[i] - b[i]);
        sum += d;
        if (d > 6) changed++;
      }
      const meanAbs = sum / a.length;
      const diffRatio = changed / a.length;
      comparisons.push({
        key,
        ok: meanAbs <= 2.5 && diffRatio <= 0.08,
        exact,
        meanAbs: Number(meanAbs.toFixed(3)),
        diffRatio: Number(diffRatio.toFixed(4)),
      });
    }
  }
  for (const key of index.keys()) {
    if (!seen.has(key)) comparisons.push({ key, ok: false, reason: 'missing-second-run' });
  }
  return { ok: comparisons.every((item) => item.ok), comparisons };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('用法：node tests/visual-scenes.mjs --scene combat --quality high --out /tmp/visual-smoke [--viewport desktop] [--repeat 2]');
    return 0;
  }
  resolveQuality(options.quality);
  const runs = [];
  for (let round = 0; round < options.repeat; round++) {
    const outDir = options.repeat > 1
      ? path.join(options.outDir, `run-${round + 1}`)
      : options.outDir;
    runs.push(
      await capture({
        scenes: options.scenes,
        viewports: options.viewports,
        quality: options.quality,
        outDir,
        seed: options.seed,
        log: (line) => console.log(line),
      })
    );
  }

  let determinism = null;
  if (runs.length > 1) {
    determinism = compareRuns(runs[0].results, runs[1].results);
    fs.writeFileSync(
      path.join(options.outDir, 'determinism.json'),
      `${JSON.stringify(determinism, null, 2)}\n`
    );
    console.log(`[visual] 确定性：${determinism.ok ? 'PASS' : 'FAIL'}（${determinism.comparisons.length} 帧）`);
  }

  const manifest = runs[0].manifest;
  const manifestPath = options.repeat > 1
    ? path.join(options.outDir, 'run-1', 'manifest.json')
    : path.join(options.outDir, 'manifest.json');
  const summary = {
    out: options.outDir,
    scenes: options.scenes,
    viewports: options.viewports,
    quality: options.quality,
    frames: runs[0].entries.length,
    totalMs: manifest.totalMs,
    determinism,
    manifest: manifestPath,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (determinism && !determinism.ok) return 1;
  return 0;
}

const isDirectEntry =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectEntry) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`[visual-scenes] ${error.stack || error.message}`);
      process.exit(2);
    });
}
