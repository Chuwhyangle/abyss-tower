// 镜头反馈层：hitstop、定向震屏与镜头缩放冲击（AC-013）。
//
// 边界（docs/PHASE_FEEL_ART.md §3.4 / §3.8）：
//   - 只读 `sim.impactEvents`，不 import 模拟层、不触碰模拟随机源、不出现未播种随机；
//   - 抖动来自注入种子的 mulberry32（`shared/rng.js`，同 seed 同序列），消费端可按事件对象身份去重；
//   - 运动分量受设置护栏约束：reduced-motion / 关闭震屏 / 最低画质时位移与缩放精确为 0，
//     但命中闪光与致死边缘染色（非运动反馈）照常产出。
//   - 坐标约定：事件 x/y 是格坐标，`focusX/focusY` 与 `flashX/flashY` 同为格坐标，
//     渲染层乘 TILE 换算成逻辑像素。

import { hashString, mulberry32 } from '../shared/rng.js';

// 冻结表（与 docs/PHASE_FEEL_ART.md §3.4 一一对应；只改一处视为漂移）。
export const CAMERA_LIMITS = Object.freeze({
  hitstopMax: 0.09,
  hitstopMin: 0.018,
  shakeMax: 7,
  zoomMax: 0.035,
  window: 0.22,
  maxImpulses: 6,
});

// 命中瞬间的冻结：按本次掉血分级，再叠加暴击/致死/破盾，最后 clamp 到上下限。
const HITSTOP_BASE = 0.006;
const HITSTOP_TIERS = Object.freeze([
  Object.freeze({ hpLost: 30, hitstop: 0.03 }),
  Object.freeze({ hpLost: 15, hitstop: 0.02 }),
  Object.freeze({ hpLost: 6, hitstop: 0.012 }),
]);
const HITSTOP_CRIT = 0.018;
const HITSTOP_LETHAL = 0.03;
const HITSTOP_SHIELD = 0.01;

// 定向冲量：幅度分级同样按掉血/暴击/致死/破盾，永不超过 shakeMax。
const SHAKE_BASE = 2.4;
const SHAKE_TIERS = Object.freeze([
  Object.freeze({ hpLost: 30, shake: 2.8 }),
  Object.freeze({ hpLost: 15, shake: 1.8 }),
  Object.freeze({ hpLost: 6, shake: 0.8 }),
]);
const SHAKE_CRIT = 1.2;
const SHAKE_LETHAL = 1.6;
const SHAKE_SHIELD = 0.6;
// 方向抖动：以「命中点 → 屏幕中心」为基准的播种 ±8°。
const SHAKE_JITTER_RAD = (8 * Math.PI) / 180;

// 非运动反馈：命中闪光与致死边缘染色，关闭运动时仍保留。
const FLASH_HIT = 0.34;
const FLASH_CRIT = 0.46;
const FLASH_LETHAL = 0.62;
const FLASH_DECAY = 2.8;
const LETHAL_DECAY = 3.4;

const HITSTOP_TIME_SCALE = 0.05;

const finiteOr = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function normalizeViewport(viewport) {
  const width = finiteOr(viewport?.width, 0);
  const height = finiteOr(viewport?.height, 0);
  return { width: width > 0 ? width : 1, height: height > 0 ? height : 1 };
}

// 运动预算：reduced-motion、关闭震屏、最低画质三处任一成立即关闭位移/缩放。
// hitstop 不是位移（冻结只放慢步进），降级时保留但减半；闪光与非运动染色始终保留。
export function resolveMotionBudget(settings = {}, { reducedMotion = false } = {}) {
  const motion =
    reducedMotion !== true &&
    settings?.shake === true &&
    settings?.decorations !== 'off';
  return {
    motion,
    shakeScale: motion ? 1 : 0,
    zoomScale: motion ? 1 : 0,
    hitstopScale: motion ? 1 : 0.5,
    flashScale: 1,
  };
}

// 单次命中冻结时长（秒）。纯函数：不读时钟、不读全局设置，只吃事件字段与预算。
export function hitstopFor(event, budget = null) {
  if (!event || event.source === 'dot') return 0;
  const hpLost = Math.max(0, finiteOr(event.hpLost));
  let duration = HITSTOP_BASE;
  for (const tier of HITSTOP_TIERS) {
    if (hpLost >= tier.hpLost) {
      duration += tier.hitstop;
      break;
    }
  }
  if (event.crit === true) duration += HITSTOP_CRIT;
  if (event.lethal === true) duration += HITSTOP_LETHAL;
  if (finiteOr(event.shieldAbsorbed) > 0) duration += HITSTOP_SHIELD;
  const clamped = clamp(duration, CAMERA_LIMITS.hitstopMin, CAMERA_LIMITS.hitstopMax);
  const scale = finiteOr(budget?.hitstopScale, 1);
  return clamped * Math.max(0, scale);
}

// 定向冲量：镜头被推离命中点（方向 = 命中点 → 屏幕中心），叠加播种 ±8° 抖动。
// `random` 由调用方注入（默认 0.5 = 无抖动），模块内绝不取未播种随机。
export function shakeImpulseFor(event, viewport = null, random = null) {
  if (!event) return { x: 0, y: 0, magnitude: 0, ttl: 0 };
  const next = typeof random === 'function' ? random : () => 0.5;
  const hpLost = Math.max(0, finiteOr(event.hpLost));
  let magnitude = SHAKE_BASE;
  for (const tier of SHAKE_TIERS) {
    if (hpLost >= tier.hpLost) {
      magnitude += tier.shake;
      break;
    }
  }
  if (event.crit === true) magnitude += SHAKE_CRIT;
  if (event.lethal === true) magnitude += SHAKE_LETHAL;
  if (finiteOr(event.shieldAbsorbed) > 0) magnitude += SHAKE_SHIELD;
  magnitude = clamp(magnitude, 0, CAMERA_LIMITS.shakeMax);

  const { width, height } = normalizeViewport(viewport);
  let dx = width / 2 - finiteOr(event.x);
  let dy = height / 2 - finiteOr(event.y);
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) {
    // 命中点恰好落在画面中心：退化为一枚播种方向的单位向量。
    const angle = next() * Math.PI * 2;
    dx = Math.cos(angle);
    dy = Math.sin(angle);
  } else {
    dx /= length;
    dy /= length;
  }
  const jitter = (next() - 0.5) * 2 * SHAKE_JITTER_RAD;
  const cos = Math.cos(jitter);
  const sin = Math.sin(jitter);
  const ux = dx * cos - dy * sin;
  const uy = dx * sin + dy * cos;
  return {
    x: ux * magnitude,
    y: uy * magnitude,
    magnitude,
    ttl: CAMERA_LIMITS.window,
  };
}

// 命中闪光强度与致死标记：非运动反馈，运动关闭时仍照常产出。
function flashFor(event, budget = null) {
  if (!event) return { amount: 0, lethal: 0 };
  const scale = Math.max(0, finiteOr(budget?.flashScale, 1));
  if (event.lethal === true) return { amount: FLASH_LETHAL * scale, lethal: 1 };
  if (event.crit === true) return { amount: FLASH_CRIT * scale, lethal: 0 };
  return { amount: FLASH_HIT * scale, lethal: 0 };
}

// 合成最终镜头变换：运动关闭时精确恒等（x = y = 0、zoom = 1），闪光字段照常返回。
export function composeCameraTransform({
  feedback = null,
  budget = null,
  legacyShake = 0,
  jitter = null,
} = {}) {
  const motion = budget ? budget.motion === true : feedback?.motion === true;
  const flash = clamp(finiteOr(feedback?.flash), 0, 1);
  const lethal = clamp(finiteOr(feedback?.lethal), 0, 1);
  const focusX = finiteOr(feedback?.focusX);
  const focusY = finiteOr(feedback?.focusY);
  const flashX = finiteOr(feedback?.flashX);
  const flashY = finiteOr(feedback?.flashY);

  if (!motion) {
    return { x: 0, y: 0, zoom: 1, focusX, focusY, flash, flashX, flashY, lethal };
  }

  // 旧 `game.shake`（漏怪/首领死亡等无命中事件的来源）用注入的播种抖动替代无种子随机。
  const next = typeof jitter === 'function' ? jitter : () => 0.5;
  const shake = Math.max(0, finiteOr(legacyShake));
  const rawX = finiteOr(feedback?.offsetX) + (next() - 0.5) * shake;
  const rawY = finiteOr(feedback?.offsetY) + (next() - 0.5) * shake;
  const magnitude = Math.hypot(rawX, rawY);
  const scale = magnitude > CAMERA_LIMITS.shakeMax ? CAMERA_LIMITS.shakeMax / magnitude : 1;
  const zoom = clamp(finiteOr(feedback?.zoom, 1), 1, 1 + CAMERA_LIMITS.zoomMax);
  return { x: rawX * scale, y: rawY * scale, zoom, focusX, focusY, flash, flashX, flashY, lethal };
}

// 镜头反馈状态机：消费结构化命中事件 → 每帧输出镜头变换与时间缩放。
export class CameraFeedback {
  constructor({ settings = {}, reducedMotion = false, seed = 1, viewport = null } = {}) {
    this._random = mulberry32(hashString(`camera-feedback:${String(seed)}`)());
    this._seen = new WeakSet();
    this._settings = settings || {};
    this._reducedMotion = reducedMotion === true;
    this._viewport = normalizeViewport(viewport);
    this._budget = resolveMotionBudget(this._settings, { reducedMotion: this._reducedMotion });
    this._impulses = [];
    this._flash = { amount: 0, lethal: 0, x: 0, y: 0 };
    this._focus = { x: 0, y: 0 };
    this._hitstop = 0;
    this._stats = { hitstops: 0, shakeImpulses: 0, zoomPunches: 0, flashes: 0, suppressed: 0 };
  }

  get budget() {
    return { ...this._budget };
  }

  setViewport(viewport) {
    this._viewport = normalizeViewport(viewport);
    return this._viewport;
  }

  // 播种抖动的唯一出口：渲染层不再自己取随机数，旧 game.shake 的抖动也走这里
  // （docs/TECH_DESIGN.md §5.5.2「渲染层拿到的是已算好的镜头变换」）。
  nextRandom() {
    return this._random();
  }

  // 当帧重算预算：关闭震屏/切到最低画质立即把位移与缩放归零，不等冲量自然衰减。
  setSettings(settings = {}, { reducedMotion = this._reducedMotion } = {}) {
    this._settings = settings || {};
    this._reducedMotion = reducedMotion === true;
    this._budget = resolveMotionBudget(this._settings, { reducedMotion: this._reducedMotion });
    if (!this._budget.motion) this._impulses.length = 0;
    return { ...this._budget };
  }

  // 消费新事件：按对象身份去重（不要求事件携带序号），返回本次新增的事件数。
  consume(events = []) {
    if (!Array.isArray(events) || events.length === 0) return 0;
    let added = 0;
    for (const event of events) {
      if (!event || typeof event !== 'object') continue;
      if (this._seen.has(event)) continue;
      this._seen.add(event);
      added += 1;
      this._absorb(event);
    }
    return added;
  }

  _absorb(event) {
    const budget = this._budget;
    const hitstop = hitstopFor(event, budget);
    if (hitstop > 0) {
      // 并发命中取最长冻结，避免叠到失控。
      this._hitstop = Math.max(this._hitstop, hitstop);
      this._stats.hitstops += 1;
    }

    const impulse = shakeImpulseFor(event, this._viewport, () => this._random());
    if (impulse.magnitude > 0) {
      if (budget.motion) {
        this._impulses.push({
          x: impulse.x,
          y: impulse.y,
          magnitude: impulse.magnitude,
          ttl: impulse.ttl,
          maxTtl: impulse.ttl,
        });
        if (this._impulses.length > CAMERA_LIMITS.maxImpulses) {
          this._impulses.splice(0, this._impulses.length - CAMERA_LIMITS.maxImpulses);
        }
        this._stats.shakeImpulses += 1;
        this._stats.zoomPunches += 1;
      } else {
        // 被护栏压掉的运动分量（非运动闪光照常产出）。
        this._stats.suppressed += 1;
      }
    }

    const flash = flashFor(event, budget);
    if (flash.amount > 0) {
      // 连击取较强的一档而不是累加，避免闪成白屏。
      this._flash.amount = Math.max(this._flash.amount * 0.6, flash.amount);
      this._flash.lethal = Math.max(this._flash.lethal, flash.lethal);
      this._flash.x = finiteOr(event.x);
      this._flash.y = finiteOr(event.y);
      this._focus.x = this._flash.x;
      this._focus.y = this._flash.y;
      this._stats.flashes += 1;
    }
  }

  // 按真实时间衰减，返回本帧镜头变换。冻结期 timeScale = 0.05（步进近乎停住，渲染照常）。
  update(dt = 0) {
    const delta = Math.max(0, finiteOr(dt));
    this._hitstop = Math.max(0, this._hitstop - delta);
    this._flash.amount = Math.max(0, this._flash.amount - delta * FLASH_DECAY);
    this._flash.lethal = Math.max(0, this._flash.lethal - delta * LETHAL_DECAY);

    let offsetX = 0;
    let offsetY = 0;
    let zoomAdd = 0;
    if (this._budget.motion) {
      const alive = [];
      for (const impulse of this._impulses) {
        impulse.ttl -= delta;
        if (impulse.ttl <= 0) continue;
        alive.push(impulse);
        const fade = impulse.ttl / Math.max(1e-6, impulse.maxTtl);
        const ease = fade * fade;
        offsetX += impulse.x * ease;
        offsetY += impulse.y * ease;
        zoomAdd += (impulse.magnitude / CAMERA_LIMITS.shakeMax) * CAMERA_LIMITS.zoomMax * ease;
      }
      this._impulses = alive;
    } else {
      this._impulses.length = 0;
    }

    const magnitude = Math.hypot(offsetX, offsetY);
    if (magnitude > CAMERA_LIMITS.shakeMax) {
      const scale = CAMERA_LIMITS.shakeMax / magnitude;
      offsetX *= scale;
      offsetY *= scale;
    }
    const zoom = this._budget.motion ? 1 + Math.min(CAMERA_LIMITS.zoomMax, zoomAdd) : 1;

    return {
      timeScale: this._hitstop > 0 ? HITSTOP_TIME_SCALE : 1,
      offsetX,
      offsetY,
      zoom,
      focusX: this._focus.x,
      focusY: this._focus.y,
      flash: this._flash.amount,
      flashX: this._flash.x,
      flashY: this._flash.y,
      lethal: this._flash.lethal,
      hitstopRemaining: this._hitstop,
      motion: this._budget.motion,
    };
  }

  stats() {
    return { ...this._stats };
  }

  reset() {
    this._seen = new WeakSet();
    this._impulses = [];
    this._flash = { amount: 0, lethal: 0, x: 0, y: 0 };
    this._focus = { x: 0, y: 0 };
    this._hitstop = 0;
    this._stats = { hitstops: 0, shakeImpulses: 0, zoomPunches: 0, flashes: 0, suppressed: 0 };
  }
}
