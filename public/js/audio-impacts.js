// 命中音效层：八种武器的可区分命中签名、并发限流、簇音与战旗光环脉冲（AC-014）。
//
// 边界（docs/PHASE_FEEL_ART.md §3.5）：
//   - 只读 `sim.impactEvents` / `sim.towers` / `sim.phase`，不 import 模拟层、不写回模拟状态；
//   - 变调由事件字段的字符串哈希派生（同一事件重放同音高），本模块不使用未播种随机；
//   - 本模块只产出「该发什么声」的计划（plan），振荡器/噪声合成在 audio.js 的 impactVoice；
//     限流/压缩只作用于表现，不改变模拟与结算。

import { TOWERS } from './shared/data.js';

const freezeSignature = (type, freq, slide, duration, gain, noise = null) =>
  Object.freeze({
    type,
    freq,
    slide,
    duration,
    gain,
    noise: noise
      ? Object.freeze({ filter: noise.filter, cutoff: noise.cutoff, duration: noise.duration, gain: noise.gain })
      : null,
  });

// 冻结表：键集合必须与 `Object.keys(TOWERS)` 完全一致（含不参战的战旗）。
// 可分辨性靠「波形 / 基频 / 噪声滤波类型 / 截止频率 / 时长」五维，任意两武器至少差 2 维。
export const IMPACT_SIGNATURES = Object.freeze({
  arrow: freezeSignature('square', 1180, -520, 0.06, 0.022),
  cannon: freezeSignature('sine', 92, -38, 0.2, 0.045, { filter: 'lowpass', cutoff: 620, duration: 0.16, gain: 0.026 }),
  frost: freezeSignature('triangle', 1760, 260, 0.09, 0.018, { filter: 'highpass', cutoff: 3400, duration: 0.06, gain: 0.014 }),
  arc: freezeSignature('sawtooth', 560, -340, 0.11, 0.024, { filter: 'bandpass', cutoff: 2600, duration: 0.1, gain: 0.02 }),
  poison: freezeSignature('sine', 268, -70, 0.12, 0.026, { filter: 'lowpass', cutoff: 480, duration: 0.12, gain: 0.02 }),
  banner: freezeSignature('triangle', 720, 210, 0.13, 0.03),
  shock: freezeSignature('square', 180, -60, 0.16, 0.032, { filter: 'lowpass', cutoff: 1100, duration: 0.12, gain: 0.022 }),
  sniper: freezeSignature('sawtooth', 140, -170, 0.22, 0.028, { filter: 'highpass', cutoff: 2200, duration: 0.09, gain: 0.018 }),
});

// 限流冻结值（与 docs/PHASE_FEEL_ART.md §3.5 一一对应；只改一处视为漂移）。
export const IMPACT_LIMITS = Object.freeze({
  windowMs: 120,
  maxVoicesPerWindow: 4,
  perWeaponGapMs: 60,
  globalGapMs: 16,
  maxPerFrame: 3,
  jitterCents: 18,
  clusterStep: 0.12,
  clusterCap: 5,
  auraGapMs: 1200,
});

const finiteOr = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);

// FNV-1a：与 audio.js 的变体哈希同族，纯函数、跨会话稳定。
function hashText(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

// 确定性变调：同一 weapon + target.id + t 永远得到同一音分；不使用随机数。
export function pitchCentsFor(event, limits = IMPACT_LIMITS) {
  const jitter = Math.max(0, Math.floor(finiteOr(limits?.jitterCents, IMPACT_LIMITS.jitterCents)));
  if (jitter === 0) return 0;
  const weapon = typeof event?.weapon === 'string' ? event.weapon : '';
  const targetId = finiteOr(event?.target?.id, 0);
  const time = finiteOr(event?.t, 0);
  const hash = hashText(`${weapon}:${targetId}:${time}`);
  return (hash % (jitter * 2 + 1)) - jitter;
}

const priorityOf = (event) => (event?.lethal === true ? 2 : event?.crit === true ? 1 : 0);

// 簇音：同武器同帧的连续命中合并为一次，增益按命中数抬升（封顶 clusterCap-1）。
function clusterGain(limits, count) {
  const step = finiteOr(limits.clusterStep, IMPACT_LIMITS.clusterStep);
  const cap = Math.max(1, Math.floor(finiteOr(limits.clusterCap, IMPACT_LIMITS.clusterCap)));
  return 1 + step * Math.min(Math.max(0, count - 1), cap - 1);
}

// 命中混音器：吃 `sim.impactEvents`（环形缓冲）与单条事件（战旗光环），产出可发声计划。
// 去重按对象身份（WeakSet），不依赖下标游标；缓冲缩水（旧事件被裁）时清空身份集合重来。
export class ImpactMixer {
  constructor({ limits = IMPACT_LIMITS, voice = null } = {}) {
    this.limits = { ...IMPACT_LIMITS, ...limits };
    this.voice = typeof voice === 'function' ? voice : () => false;
    this.stats = { played: 0, suppressed: 0, lastPlans: [] };
    this.reset();
  }

  reset() {
    this._seen = new WeakSet();
    this._ringLength = 0;
    this._lastGlobalAt = -Infinity;
    this._lastWeaponAt = new Map();
    this._voiceTimes = [];
  }

  // events 必须传 `sim.impactEvents` 环形缓冲本体（长度用于识别裁切）。
  handle(events = [], nowMs = 0) {
    const now = finiteOr(nowMs);
    if (!Array.isArray(events)) return { played: 0, suppressed: 0, plans: [] };
    if (events.length < this._ringLength) this._seen = new WeakSet();
    this._ringLength = events.length;
    const fresh = [];
    for (const event of events) {
      if (!event || typeof event !== 'object') continue;
      if (this._seen.has(event)) continue;
      this._seen.add(event);
      // 技能/盟友等非武器事件没有命中音签名：跳过且不重复扫描。
      if (!IMPACT_SIGNATURES[event.weapon]) continue;
      fresh.push(event);
    }
    return this._plan(fresh, now);
  }

  // 单条非环形事件（战旗光环脉冲）：与环形事件共用同一份声预算。
  handleEvent(event, nowMs = 0) {
    if (!event || typeof event !== 'object' || !IMPACT_SIGNATURES[event.weapon]) {
      return { played: 0, suppressed: 0, plans: [] };
    }
    return this._plan([event], finiteOr(nowMs));
  }

  _prune(now) {
    const windowMs = this.limits.windowMs;
    this._voiceTimes = this._voiceTimes.filter((voice) => now - voice.at < windowMs);
  }

  _plan(events, now) {
    if (events.length === 0) return { played: 0, suppressed: 0, plans: [] };
    const { maxPerFrame, perWeaponGapMs, globalGapMs, windowMs, maxVoicesPerWindow } = this.limits;
    // 超额时的保留顺序：lethal > crit > 普通，同级按 hpLost 降序、再按 t 降序。
    const sorted = [...events].sort(
      (a, b) =>
        priorityOf(b) - priorityOf(a) ||
        finiteOr(b.hpLost) - finiteOr(a.hpLost) ||
        finiteOr(b.t) - finiteOr(a.t)
    );
    // 同武器合并为簇音（排序后同武器相邻；首个成员即峰值优先级）。
    const clusters = [];
    const byWeapon = new Map();
    for (const event of sorted) {
      const group = byWeapon.get(event.weapon);
      if (group) {
        group.count += 1;
        group.crit = group.crit || event.crit === true;
        group.lethal = group.lethal || event.lethal === true;
        if (finiteOr(event.t) > finiteOr(group.event.t)) group.event = event;
        continue;
      }
      const created = {
        weapon: event.weapon,
        signature: IMPACT_SIGNATURES[event.weapon],
        count: 1,
        crit: event.crit === true,
        lethal: event.lethal === true,
        event,
      };
      byWeapon.set(event.weapon, created);
      clusters.push(created);
    }

    this._prune(now);
    const plans = [];
    let suppressed = 0;
    for (const group of clusters) {
      if (plans.length >= maxPerFrame) {
        suppressed += group.count;
        continue;
      }
      const lastWeapon = this._lastWeaponAt.get(group.weapon);
      if (lastWeapon !== undefined && now - lastWeapon < perWeaponGapMs) {
        suppressed += group.count;
        continue;
      }
      // 同帧多声按 globalGapMs 顺延排布（0 / +16 / +32ms），不挤在同一个采样点。
      let at = now;
      if (at - this._lastGlobalAt < globalGapMs) at = this._lastGlobalAt + globalGapMs;
      if (at - now > globalGapMs * Math.max(0, maxPerFrame - 1)) {
        suppressed += group.count;
        continue;
      }
      const inWindow = this._voiceTimes.filter((voice) => at - voice.at < windowMs);
      if (inWindow.length >= maxVoicesPerWindow) {
        suppressed += group.count;
        continue;
      }
      // 窗口节点预算：主振荡器 + 可选噪声源必发；暴击亮度层/致死低频层是可选装饰，
      // 预算不足时先降级装饰层而不是丢掉整声（保住 lethal > crit > 普通的保留顺序）。
      let accent = group.crit;
      let lethal = group.lethal;
      let nodes = 1 + (group.signature.noise ? 1 : 0) + (accent ? 1 : 0) + (lethal ? 1 : 0);
      const inWindowNodes = inWindow.reduce((total, voice) => total + voice.nodes, 0);
      if (inWindowNodes + nodes > maxVoicesPerWindow * 2) {
        accent = false;
        lethal = false;
        nodes = 1 + (group.signature.noise ? 1 : 0);
        if (inWindowNodes + nodes > maxVoicesPerWindow * 2) {
          suppressed += group.count;
          continue;
        }
      }
      const count = Math.max(1, group.count);
      const plan = {
        weapon: group.weapon,
        signature: group.signature,
        at,
        delayMs: Math.max(0, at - now),
        gainMul: clusterGain(this.limits, count),
        pitchCents: pitchCentsFor(group.event, this.limits),
        accent,
        lethal,
        cluster: count,
        nodes,
        event: group.event,
      };
      plans.push(plan);
      this._lastGlobalAt = at;
      this._lastWeaponAt.set(group.weapon, at);
      this._voiceTimes.push({ at, nodes });
      this.voice(group.signature, plan);
    }

    this.stats.played += plans.length;
    this.stats.suppressed += suppressed;
    this.stats.lastPlans = plans;
    return { played: plans.length, suppressed, plans };
  }
}

// 战旗命中层 = 光环脉冲：不参战的支援塔在波形内覆盖到至少一座攻击塔时，
// 每 auraGapMs 产出一次脉冲事件（同一事件形状，交给同一个混音器计预算）。
// 只读 `sim.phase` / `sim.towers`，状态写进调用方传入的 state（lastAt），不写回模拟。
export function supportAuraPulse(sim, nowMs = 0, state = {}) {
  if (!sim || sim.phase !== 'wave') return null;
  const towers = Array.isArray(sim.towers) ? sim.towers : [];
  const supporters = towers.filter((tower) => tower && TOWERS[tower.type]?.support);
  if (supporters.length === 0) return null;
  const attackers = towers.filter(
    (tower) =>
      tower &&
      !TOWERS[tower.type]?.support &&
      Number.isFinite(tower.x) &&
      Number.isFinite(tower.y)
  );
  if (attackers.length === 0) return null;
  const gap = IMPACT_LIMITS.auraGapMs;
  const last = Number.isFinite(state.lastAt) ? state.lastAt : -Infinity;
  if (nowMs - last < gap) return null;
  for (const support of supporters) {
    if (!Number.isFinite(support.x) || !Number.isFinite(support.y)) continue;
    const range = finiteOr(support.stats?.range);
    if (!(range > 0)) continue;
    const covered = attackers.some(
      (tower) => Math.hypot(tower.x - support.x, tower.y - support.y) <= range
    );
    if (!covered) continue;
    state.lastAt = nowMs;
    return {
      weapon: 'banner',
      source: 'aura',
      t: nowMs / 1000,
      x: support.x,
      y: support.y,
      target: { id: support.id ?? 0, type: support.type },
      hpLost: 0,
      crit: false,
      lethal: false,
    };
  }
  return null;
}
