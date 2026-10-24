// 大厅→战斗的程序化过场：纯状态机 + 轻量 DOM 播放器。
// 只做表现：不加载素材、不读取模拟状态、不拦截输入。
export const BATTLE_TRANSITION_DURATION = 720;
export const BATTLE_TRANSITION_PHASES = Object.freeze(['fade', 'expand', 'reveal', 'done']);
export const BATTLE_TRANSITION_SKIP_EVENTS = Object.freeze(['pointerdown', 'keydown', 'touchstart']);

// 三段占比：淡出大厅 → 地图轮廓展开 → 揭开战场。合计仍是 720ms。
const FADE_END = 0.3;
const EXPAND_END = 0.8;

export function transitionPhaseAt(elapsed, duration = BATTLE_TRANSITION_DURATION) {
  if (!(duration > 0)) return 'done';
  const ratio = Math.min(1, Math.max(0, Number(elapsed) / duration));
  if (ratio >= 1) return 'done';
  if (ratio < FADE_END) return 'fade';
  if (ratio < EXPAND_END) return 'expand';
  return 'reveal';
}

// reduced-motion：不播放任何阶段，直接停在结束状态。
export function createTransition({ duration = BATTLE_TRANSITION_DURATION, reducedMotion = false } = {}) {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : BATTLE_TRANSITION_DURATION;
  if (reducedMotion) {
    return Object.freeze({ duration: safeDuration, elapsed: safeDuration, phase: 'done', skipped: false, reducedMotion: true });
  }
  return Object.freeze({ duration: safeDuration, elapsed: 0, phase: 'fade', skipped: false, reducedMotion: false });
}

// 纯推进：输入状态与经过毫秒，返回新状态，不修改入参。
export function advanceTransition(state, deltaMs) {
  if (!state || state.phase === 'done') return state;
  const delta = Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0;
  const elapsed = Math.min(state.duration, state.elapsed + delta);
  return Object.freeze({ ...state, elapsed, phase: transitionPhaseAt(elapsed, state.duration) });
}

export function skipTransition(state) {
  if (!state || state.phase === 'done') return state;
  return Object.freeze({ ...state, elapsed: state.duration, phase: 'done', skipped: true });
}

export function transitionSnapshot(state) {
  const elapsed = state?.elapsed || 0;
  const duration = state?.duration || BATTLE_TRANSITION_DURATION;
  return {
    phase: state?.phase || 'done',
    progress: Math.min(1, Math.max(0, elapsed / duration)),
    done: !state || state.phase === 'done',
    skippable: !!state && state.phase !== 'done',
  };
}

export function detectReducedMotion(doc = globalThis.document) {
  const view = doc?.defaultView || (typeof globalThis.matchMedia === 'function' ? globalThis : null);
  return !!view?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
}

// 播放器只负责 DOM 与时钟；阶段推进仍由上面的纯函数决定，方便单测。
export class BattleTransitionPlayer {
  constructor({ doc = null, now = null, frame = null, reducedMotion = null } = {}) {
    this.doc = doc;
    this._now = now || (() => globalThis.performance?.now?.() ?? Date.now());
    this._frame = frame;
    this._reducedMotion = reducedMotion;
    this._state = null;
    this._overlay = null;
    this._onDone = null;
    this._skipTarget = null;
    this._raf = 0;
    this._timer = null;
    this._frameTime = 0;
    this._onSkip = () => this.skip();
  }

  get active() {
    return !!this._state && this._state.phase !== 'done';
  }

  get phase() {
    return this._state?.phase || 'done';
  }

  play({ onDone = null } = {}) {
    this.cancel();
    const reducedMotion = this._reducedMotion ?? detectReducedMotion(this.doc || globalThis.document);
    this._state = createTransition({ reducedMotion });
    this._onDone = onDone;
    if (this._state.phase === 'done') {
      this._complete();
      return this._state;
    }
    this._doc = this.doc || globalThis.document;
    this._mountOverlay();
    this._bindSkip();
    this._applyPhase();
    this._frameTime = this._now();
    this._schedule();
    return this._state;
  }

  skip() {
    if (!this.active) return;
    this._state = skipTransition(this._state);
    this._applyPhase();
    this._complete();
  }

  cancel() {
    this._stopFrames();
    this._unbindSkip();
    this._removeOverlay();
    this._state = null;
    this._onDone = null;
  }

  _schedule() {
    const view = this._doc?.defaultView || globalThis;
    const frame = this._frame || (typeof view.requestAnimationFrame === 'function' ? view.requestAnimationFrame.bind(view) : null);
    if (frame) {
      this._raf = frame((timestamp) => this._tick(timestamp));
      return;
    }
    this._timer = setTimeout(() => this._tick(this._now()), 16);
  }

  _tick(timestamp) {
    this._raf = 0;
    if (!this.active) return;
    const now = Number.isFinite(timestamp) ? timestamp : this._now();
    const delta = Math.max(0, now - this._frameTime);
    this._frameTime = now;
    this._state = advanceTransition(this._state, delta);
    this._applyPhase();
    if (this._state.phase === 'done') this._complete();
    else this._schedule();
  }

  _stopFrames() {
    if (this._raf) {
      const view = this._doc?.defaultView || globalThis;
      view.cancelAnimationFrame?.(this._raf);
      this._raf = 0;
    }
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  _mountOverlay() {
    const doc = this._doc;
    if (!doc?.createElement) return;
    const overlay = doc.createElement('div');
    overlay.className = 'battle-transition';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.setAttribute('data-phase', 'fade');
    const map = doc.createElement('div');
    map.className = 'battle-transition-map';
    overlay.appendChild(map);
    (doc.body || doc.documentElement)?.appendChild(overlay);
    this._overlay = overlay;
  }

  _removeOverlay() {
    const overlay = this._overlay;
    this._overlay = null;
    overlay?.parentNode?.removeChild(overlay);
  }

  _applyPhase() {
    this._overlay?.setAttribute('data-phase', this._state?.phase || 'done');
  }

  // 捕获阶段只观察输入、不做任何拦截：过场先结束，原输入继续送达既有绑定。
  _bindSkip() {
    const target = this._doc?.defaultView;
    if (!target?.addEventListener) return;
    this._skipTarget = target;
    for (const type of BATTLE_TRANSITION_SKIP_EVENTS) {
      target.addEventListener(type, this._onSkip, { capture: true, passive: true });
    }
  }

  _unbindSkip() {
    const target = this._skipTarget;
    this._skipTarget = null;
    if (!target?.removeEventListener) return;
    for (const type of BATTLE_TRANSITION_SKIP_EVENTS) {
      target.removeEventListener(type, this._onSkip, { capture: true, passive: true });
    }
  }

  _complete() {
    this._stopFrames();
    this._unbindSkip();
    this._removeOverlay();
    const finish = this._onDone;
    this._onDone = null;
    finish?.();
  }
}

export const battleTransition = new BattleTransitionPlayer();
